/**
 * Server-only, owner-scoped Neon memory. The browser never receives a URL,
 * credentials or direct SQL access. No public/quizzes tables are touched.
 */
import {randomUUID} from "node:crypto";
import pg from "pg";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UID = /^[A-Za-z0-9_-]{1,128}$/;

export class AiMemoryError extends Error {
  constructor(code) { super(code); this.name = "AiMemoryError"; this.code = code; }
}
function invalid() { throw new AiMemoryError("INVALID_FIELDS"); }
function string(value, max, required = true) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) invalid();
  return value.trim();
}
function owner(value) { if (typeof value !== "string" || !UID.test(value)) invalid(); return value; }
function identifier(value) { if (typeof value !== "string" || !UUID.test(value)) invalid(); return value; }
function cleanThread(row) {
  return {id:row.id, title:row.title, createdAt:row.created_at, updatedAt:row.updated_at,
    memorySummary:String(row.memory_summary||"").slice(0,1600),
    memoryTurnCount:Number(row.memory_turn_count||0)};
}
function cleanMessage(row) {
  return {id:row.id, role:row.role, content:row.body, requestId:row.request_id,
    runId:row.mimo_run_id || null, createdAt:row.created_at};
}
function cleanDocument(row, includeText = false) {
  return {id:row.id, title:row.label, sourceType:row.source_type,
    status:row.status, pageCount:row.page_count, createdAt:row.created_at,
    ...(includeText ? {text:row.text_excerpt} : {})};
}

export function createAiMemoryStore({connectionString, pool} = {}) {
  if (!pool && (typeof connectionString !== "string" ||
      !/^postgres(?:ql)?:\/\//i.test(connectionString))) {
    throw new AiMemoryError("MEMORY_NOT_CONFIGURED");
  }
  const db = pool ?? new pg.Pool({
    connectionString,
    max:2, idleTimeoutMillis:15000, connectionTimeoutMillis:3500,
    allowExitOnIdle:true,
  });

  return Object.freeze({
    async listThreads(uid, limit = 25) {
      owner(uid);
      if (!Number.isInteger(limit) || limit < 1 || limit > 30) invalid();
      const result = await db.query(
        "SELECT id,title,created_at,updated_at,memory_summary,memory_turn_count FROM quizer_ai.threads WHERE owner_uid=$1 ORDER BY updated_at DESC,id DESC LIMIT $2",
        [uid,limit]);
      return result.rows.map(cleanThread);
    },
    async getThread(uid, threadId) {
      owner(uid); identifier(threadId);
      const meta = await db.query(
        "SELECT id,title,created_at,updated_at,memory_summary,memory_turn_count FROM quizer_ai.threads WHERE owner_uid=$1 AND id=$2",
        [uid,threadId]);
      if (!meta.rowCount) throw new AiMemoryError("THREAD_NOT_FOUND");
      const data = await db.query(
        "SELECT * FROM (SELECT id,role,body,request_id,mimo_run_id,created_at FROM quizer_ai.messages WHERE owner_uid=$1 AND thread_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50) recent ORDER BY created_at ASC,id ASC",
        [uid,threadId]);
      return {thread:cleanThread(meta.rows[0]), messages:data.rows.map(cleanMessage)};
    },
    async saveTurn({uid,threadId,requestId,message,reply,runId}) {
      owner(uid);
      const id = threadId ? identifier(threadId) : randomUUID();
      string(requestId,100);
      const input = string(message,3000);
      const output = string(reply,14000);
      if (runId != null) string(runId,128);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO quizer_ai.threads(id,owner_uid,title) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
          [id,uid,input.slice(0,120)]);
        const row = await client.query(
          "SELECT id FROM quizer_ai.threads WHERE id=$1 AND owner_uid=$2 FOR UPDATE",
          [id,uid]);
        if (!row.rowCount) throw new AiMemoryError("THREAD_NOT_FOUND");
        const prior = await client.query(
          "SELECT DISTINCT thread_id FROM quizer_ai.messages WHERE owner_uid=$1 AND request_id=$2",
          [uid,requestId]);
        if (prior.rows.some(item => String(item.thread_id) !== id))
          throw new AiMemoryError("REQUEST_ID_CONFLICT");
        if (!prior.rowCount) {
          await client.query(
            "INSERT INTO quizer_ai.messages(id,thread_id,owner_uid,request_id,role,body) VALUES($1,$2,$3,$4,'user',$5)",
            [randomUUID(),id,uid,requestId,input]);
          await client.query(
            "INSERT INTO quizer_ai.messages(id,thread_id,owner_uid,request_id,role,body,mimo_run_id) VALUES($1,$2,$3,$4,'assistant',$5,$6)",
            [randomUUID(),id,uid,requestId,output,runId ?? null]);
        }
        await client.query(
          `UPDATE quizer_ai.threads SET updated_at=now(),
            turn_count=turn_count+$3,
            memory_status=CASE
              WHEN memory_status IN ('idle','pending')
               AND turn_count+$3-memory_turn_count>=3 THEN 'pending'
              ELSE memory_status END
            WHERE id=$1 AND owner_uid=$2`,
          [id,uid,prior.rowCount?0:1]);
        await client.query("COMMIT");
        return {threadId:id, saved:true};
      } catch(error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
    // Claim at most one incremental summary per sweep; claim first, then make
    // the paid Mimo call. An ambiguous call is marked attention, never replayed.
    async claimMemoryTask() {
      const client=await db.connect();
      try {
        await client.query("BEGIN");
        const found=await client.query(
          `SELECT id,owner_uid,turn_count,memory_turn_count,memory_summary
            FROM quizer_ai.threads
            WHERE memory_status='pending' AND turn_count-memory_turn_count>=3
            ORDER BY updated_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`);
        if (!found.rowCount) { await client.query("COMMIT"); return null; }
        const row=found.rows[0],claimId=randomUUID();
        const turns=await client.query(
          `SELECT role,body FROM quizer_ai.messages
            WHERE owner_uid=$1 AND thread_id=$2
            ORDER BY created_at ASC,id ASC OFFSET $3 LIMIT 8`,
          [row.owner_uid,row.id,Number(row.memory_turn_count)*2]);
        await client.query(
          `UPDATE quizer_ai.threads SET memory_status='running',
            memory_claim_id=$3,memory_claimed_at=now()
            WHERE id=$1 AND owner_uid=$2`,
          [row.id,row.owner_uid,claimId]);
        await client.query("COMMIT");
        return {uid:row.owner_uid,threadId:row.id,claimId,
          oldSummary:String(row.memory_summary||""),
          fromTurn:Number(row.memory_turn_count),
          throughTurn:Math.min(Number(row.turn_count),Number(row.memory_turn_count)+4),
          messages:turns.rows.map(x=>({role:x.role,content:x.body}))};
      } catch(error) { await client.query("ROLLBACK"); throw error; }
      finally {client.release();}
    },
    async completeMemoryTask(task,summary) {
      const {uid,threadId,claimId,throughTurn}=task;
      owner(uid);identifier(threadId);identifier(claimId);
      const value=string(summary,1600);
      if (!Number.isInteger(throughTurn)||throughTurn<0) invalid();
      const result=await db.query(
        `UPDATE quizer_ai.threads SET memory_summary=$4,
          memory_turn_count=$5,memory_status=
            CASE WHEN turn_count-$5>=3 THEN 'pending' ELSE 'idle' END,
          memory_claim_id=NULL,memory_claimed_at=NULL
          WHERE id=$1 AND owner_uid=$2 AND memory_claim_id=$3
            AND memory_status='running' AND memory_turn_count<=$5`,
        [threadId,uid,claimId,value,throughTurn]);
      return result.rowCount===1;
    },
    async failMemoryTask(task) {
      const {uid,threadId,claimId}=task;
      owner(uid);identifier(threadId);identifier(claimId);
      await db.query(
        `UPDATE quizer_ai.threads SET memory_status='attention'
          WHERE id=$1 AND owner_uid=$2 AND memory_claim_id=$3
            AND memory_status='running'`,
        [threadId,uid,claimId]);
    },
    async listDocuments(uid,limit=20) {
      owner(uid);
      if (!Number.isInteger(limit) || limit<1 || limit>30) invalid();
      const result=await db.query(
        "SELECT id,label,source_type,status,page_count,created_at FROM quizer_ai.documents WHERE owner_uid=$1 ORDER BY created_at DESC,id DESC LIMIT $2",
        [uid,limit]);
      return result.rows.map(row=>cleanDocument(row));
    },
    async createTextDocument({uid,title,text}) {
      owner(uid);
      const label=string(title,160);
      const body=string(text,20000);
      const documentId=randomUUID();
      const client=await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO quizer_ai.documents(id,owner_uid,label,source_type,status,text_excerpt,page_count) VALUES($1,$2,$3,'text','text_ready',$4,1)",
          [documentId,uid,label,body]);
        await client.query(
          "INSERT INTO quizer_ai.document_pages(id,document_id,owner_uid,page_number,extracted_text,review_required) VALUES($1,$2,$3,1,$4,false)",
          [randomUUID(),documentId,uid,body.slice(0,10000)]);
        await client.query("COMMIT");
        return {documentId,status:"text_ready"};
      } catch (error) {
        await client.query("ROLLBACK"); throw error;
      } finally { client.release(); }
    },
    async getDocument(uid,documentId) {
      owner(uid); identifier(documentId);
      const result=await db.query(
        "SELECT id,label,source_type,status,page_count,text_excerpt,created_at FROM quizer_ai.documents WHERE owner_uid=$1 AND id=$2",
        [uid,documentId]);
      if (!result.rowCount) throw new AiMemoryError("DOCUMENT_NOT_FOUND");
      return cleanDocument(result.rows[0],true);
    },
    async close() { if (!pool) await db.end(); },
  });
}

// One low-cap server-side pool per active secret value, never per request.
// A new secret value creates a new pool, without exposing credentials in logs.
let activeUrl = null, activeStore = null;
export function sharedAiMemoryStore(connectionString) {
  if (!connectionString) throw new AiMemoryError("MEMORY_NOT_CONFIGURED");
  if (connectionString !== activeUrl) {
    const previous = activeStore;
    activeStore = createAiMemoryStore({connectionString});
    activeUrl = connectionString;
    if (previous) void previous.close().catch(() => {});
  }
  return activeStore;
}
