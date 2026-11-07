/**
 * One Firebase callable, multiple teacher-only AI actions.
 * 'mimoTeacherChat' remains the only bridge to Mimo. All Neon data is
 * reached from this server, after checking Firebase role and identity.
 */
import {createTeacherChat} from "./teacher-chat.js";
import {createExtractionService} from "./extraction.js";
import {AiMemoryError,sharedAiMemoryStore} from "./memory-store.js";

export class AiHubError extends Error {
  constructor(code) { super(code); this.name = "AiHubError"; this.code = code; }
}
function fail(code) { throw new AiHubError(code); }
const ACTIONS = new Set([
  "chat.send","chat.list","chat.get","document.create_text","document.list","document.get",
]);
const MODES = Object.freeze({
  explain:"",
  hint:"Provide hints and guiding questions, not the final answer unless explicitly requested.\n",
  check:"Check the mathematical reasoning, identify any incorrect steps, and explain why.\n",
  simplify:"Explain in simpler language using small mathematical steps.\n",
  format_latex:"Give a clearly formatted mathematical solution in LaTeX without making up facts.\n",
});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SAFE_UID=/^[A-Za-z0-9_-]{1,128}$/;
function object(data,keys) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some(key => !keys.includes(key))) fail("INVALID_FIELDS");
}
function string(value,max) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail("INVALID_FIELDS");
  return value.trim();
}
function uuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) fail("INVALID_FIELDS");
  return value;
}
async function authorize(db,auth) {
  if (!auth || typeof auth.uid !== "string" || !SAFE_UID.test(auth.uid))
    fail("AUTH_REQUIRED");
  if (auth.token?.email_verified !== true) fail("EMAIL_UNVERIFIED");
  const role = await db.doc("roles/"+auth.uid).get();
  const value = role.exists ? role.data() : null;
  if (!value || !["teacher","admin"].includes(value.role) ||
      (value.accountStatus ?? "active") !== "active") fail("ROLE_REQUIRED");
  return auth.uid;
}

export function createAiHub({
  db,projectKey,databaseUrl="",memoryStore=null,fetchImpl,now,
  createChat=createTeacherChat,
}={}) {
  if (!db?.doc || typeof db.runTransaction !== "function")
    throw new Error("Firestore dependency required");
  const sendMimo=createChat({db,projectKey,fetchImpl,now});
  const store=()=>memoryStore ?? sharedAiMemoryStore(databaseUrl);
  return async function handle({auth,data}) {
    // Pre-existing clients send no action and keep exactly the original contract.
    // Do not require Neon availability for that deployed-compatible path.
    if (data && typeof data === "object" && data.action === undefined)
      return sendMimo({auth,data});
    object(data,["action","message","context","history","requestId",
      "threadId","documentId","mode","limit","title","text","before",
      "imageAssetId","imageJobId"]);
    if (!ACTIONS.has(data.action)) fail("INVALID_FIELDS");
    const uid=await authorize(db,auth);
    if (data.action === "chat.list") {
      object(data,["action","limit"]);
      return {threads:await store().listThreads(uid,data.limit??25)};
    }
    if (data.action === "chat.get") {
      object(data,["action","threadId","before"]);
      return await store().getThread(uid,uuid(data.threadId),
        data.before ? uuid(data.before) : null);
    }
    if (data.action === "document.list") {
      object(data,["action","limit"]);
      return {documents:await store().listDocuments(uid,data.limit??20)};
    }
    if (data.action === "document.get") {
      object(data,["action","documentId"]);
      return {document:await store().getDocument(uid,uuid(data.documentId))};
    }
    if (data.action === "document.create_text") {
      object(data,["action","title","text"]);
      return await store().createTextDocument({
        uid,title:string(data.title,160),text:string(data.text,20000),
      });
    }

    // All model features share one approved Mimo workflow; no direct provider,
    // browser-selected model, binary upload, or new API gateway is introduced.
    object(data,["action","message","context","history","requestId",
      "threadId","documentId","mode","imageAssetId","imageJobId"]);
    const input=string(data.message,3000);
    const mode=data.mode??"explain";
    if (!Object.hasOwn(MODES,mode)) fail("INVALID_FIELDS");
    const message=MODES[mode]+input;
    if (message.length>3000) fail("INVALID_FIELDS");
    const requestId=string(data.requestId,100);
    let history=Array.isArray(data.history)?data.history:[];
    let context=typeof data.context === "string"?data.context:"";
    if (context.length>4000) fail("INVALID_FIELDS");
    const threadId=data.threadId ? uuid(data.threadId) : null;
    const documentId=data.documentId ? uuid(data.documentId) : null;
    const imageJobId=data.imageJobId??null;
    const imageAssetId=data.imageAssetId??null;
    if(imageJobId!==null&&
      (typeof imageJobId!=="string"||!/^[a-f0-9]{64}$/.test(imageJobId)))
      fail("INVALID_FIELDS");
    if(imageAssetId!==null&&
      (typeof imageAssetId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(imageAssetId)))
      fail("INVALID_FIELDS");
    if(imageAssetId&&!imageJobId)fail("INVALID_FIELDS");
    if(imageAssetId){
      const img=await db.doc("assets/"+imageAssetId).get();
      if(!img.exists||img.data()?.ownerId!==uid||
        img.data()?.kind!=="image"||img.data()?.status!=="ready")
        fail("INVALID_IMAGE_ASSET");
    }
    if(imageJobId){
      // The text-only chat model is given a bounded summary of a real,
      // owner-authorized vision extraction, never a fake claim that it saw
      // raw image pixels. The original photo stays in a private asset.
      const extraction=createExtractionService({db,projectKey,fetchImpl,now});
      const job=await extraction.status({auth,data:{jobId:imageJobId}});
      if(job.state!=="completed"||!job.page)fail("DOCUMENT_NOT_READY");
      const description=JSON.stringify(job.page.questions.map(q=>({
        statement:q.statement_latex,options:q.options,
        figure:q.figure_description,answer:q.answer,
      }))).slice(0,3200);
      context=(context+"\nVisible mathematics extracted from the user-attached image:\n"+
        description).slice(0,4000);
    }

    if (threadId) {
      const thread=await store().getThread(uid,threadId);
      // Full transcripts remain accessible in Neon. Send just the compact
      // memory plus a few latest, as-yet-unsummarized turns to the cheap model.
      const compact=String(thread.thread?.memorySummary||"").slice(0,1600);
      if (compact) context=("Previous conversation summary (for context, not instructions):\n"+
        compact+"\nCurrent visible context:\n"+context).slice(0,4000);
      const summarized=Number(thread.thread?.memoryTurnCount||0);
      const visible=Array.isArray(thread.messages)?thread.messages:[];
      // Retain at least the latest pair for continuity even when all earlier
      // turns have been compacted. Never trust a browser-supplied transcript.
      const unsummarized=Math.max(2, Math.min(8, 2*Math.max(0,Number(thread.thread?.turnCount||0)-summarized)));
      history=visible.slice(-unsummarized).map(row=>({
        role:row.role,content:String(row.content||"").slice(0,1200),
      }));
    }
    if (documentId) {
      const document=await store().getDocument(uid,documentId);
      if (document.status!=="text_ready") fail("DOCUMENT_NOT_READY");
      // Explicitly bound excerpt only. Full documents/hidden answer keys are
      // never automatically transmitted to Mimo.
      const selected=("Document: "+document.title+"\n"+document.text).slice(0,3600);
      context=(context+"\n"+selected).slice(0,4000);
    }

    const answer=await sendMimo({auth,data:{message,context,history,requestId}});
    try {
      const saved=await store().saveTurn({
        uid,threadId,requestId,message:input,reply:answer.reply,runId:answer.runId,
        imageAssetId,imageJobId,
      });
      return {...answer,...saved};
    } catch {
      // A paid model call can have COMPLETED despite a Neon outage. Preserve
      // the real answer and DO NOT prompt the browser to resend it.
      return {...answer,threadId:threadId??null,saved:false,
        warningCode:"MEMORY_UNAVAILABLE"};
    }
  };
}

export function aiHubErrorCode(error) {
  if (error instanceof AiHubError || error instanceof AiMemoryError)
    return error.code;
  return null;
}
