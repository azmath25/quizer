// N-A2: DISABLED BY DEFAULT. Trusted Firebase-verifying backend-only Neon
// transaction engine; NOT registered with the live Quizer callable API.
// Every attempt pins one authenticated/authorized immutable publication.
// No SQL runs inside Firestore transactions and no protected grading is
// returned to clients. Future cutover must be per-attempt, not dual-write.
import {createHash} from "node:crypto";
import {assertNewNeonId} from "./attempt-provenance.js";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const HASH=/^[0-9a-f]{64}$/;
const fail=(reason,message)=>{
  const error=new Error(message);
  error.reason=reason;
  throw error;
};
const requireId=(value,name="ID")=>{
  if(typeof value!=="string"||!ID.test(value))
    fail("INVALID_FIELDS","Invalid "+name);
  return value;
};
const actorUid=actor=>{
  if(!actor?.verifiedFirebaseAuth || actor.accountStatus==="disabled" ||
      actor.emailVerified!==true)
    fail("AUTH_REQUIRED","Verified Firebase identity required.");
  return requireId(actor.uid,"actor UID");
};
const digest=payload=>createHash("sha256")
  .update(JSON.stringify(payload)).digest("hex");
const row=result=>result?.rows?.[0]??null;
const itemList=(items)=>{
  if(!Array.isArray(items)||items.length<1||items.length>500)
    fail("INVALID_FIELDS","Expected 1–500 published items.");
  const seen=new Set();
  return items.map((item,index)=>{
    const itemId=requireId(item.itemId,"published item");
    if(seen.has(itemId))fail("INVALID_FIELDS","Duplicate item.");
    seen.add(itemId);
    if(typeof item.points!=="number"||!Number.isFinite(item.points)||
        item.points<=0||item.points>1000)
      fail("INVALID_FIELDS","Invalid item points.");
    return {itemId,ordinal:index,
      problemId:requireId(item.problemId,"problem"),
      problemRevisionId:requireId(item.problemRevisionId,"revision"),
      points:item.points};
  });
};
async function transaction(pool,fn){
  if(typeof pool?.connect!=="function")
    fail("FAILED_PRECONDITION","Trusted SQL connection required.");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const result=await fn(client);
    await client.query("COMMIT");
    return result;
  }catch(error){
    try{await client.query("ROLLBACK");}catch{}
    throw error;
  }finally{client.release();}
}
async function receipt(client,uid,requestId,attemptId,operation,hash){
  const old=row(await client.query(
    "SELECT attempt_id,operation,payload_hash,result_json "+
    "FROM quizer.attempt_receipts_v2 WHERE actor_uid=$1 AND request_id=$2",
    [uid,requestId]));
  if(!old)return null;
  if(old.attempt_id!==attemptId||old.operation!==operation||
      old.payload_hash!==hash)
    fail("VERSION_CONFLICT","Idempotency key reused with different input.");
  return old.result_json;
}
async function remember(client,uid,requestId,attemptId,operation,hash,result){
  await client.query(
    "INSERT INTO quizer.attempt_receipts_v2 "+
    "(actor_uid,request_id,attempt_id,operation,payload_hash,result_json) "+
    "VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
    [uid,requestId,attemptId,operation,hash,JSON.stringify(result)]);
}
async function lockOwned(client,uid,attemptId){
  const attempt=row(await client.query(
    "SELECT *,clock_timestamp() AS database_now "+
    "FROM quizer.attempts_v2 WHERE attempt_id=$1 FOR UPDATE",
    [attemptId]));
  if(!attempt||attempt.student_uid!==uid)
    fail("RESOURCE_UNAVAILABLE","Attempt is unavailable.");
  return attempt;
}
const validateChanges=changes=>{
  if(!Array.isArray(changes)||!changes.length||changes.length>20)
    fail("INVALID_FIELDS","Save 1–20 answers.");
  const seen=new Set();
  return changes.map(change=>{
    const itemId=requireId(change?.itemId,"item");
    if(seen.has(itemId))fail("INVALID_FIELDS","Duplicate answer.");
    seen.add(itemId);
    if(typeof change.value!=="string"||
        Buffer.byteLength(change.value,"utf8")>65536)
      fail("INVALID_FIELDS","Invalid answer.");
    return {item_id:itemId,answer_text:change.value};
  });
};
const idempotency=(requestId)=>requireId(requestId,"request ID");

// Deliberate separate verification boundary: the caller must load a trusted
// Firebase/Storage pinned snapshot and authenticate before invoking start.
// plan is *never* accepted from the student payload.
export function createNeonAttemptV2Engine({enabled=false,pool=null,
  verifyStart=null}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    start:async()=>({disabled:true}),saveAnswers:async()=>({disabled:true}),
    submit:async()=>({disabled:true})});
  if(typeof pool?.connect!=="function"||typeof verifyStart!=="function")
    fail("FAILED_PRECONDITION","Trusted SQL and bundle gateway required.");

  async function start({actor,requestId,quizId,sourceAttemptId=null}={}){
    const uid=actorUid(actor),key=idempotency(requestId),
      requestedQuiz=requireId(quizId,"quiz");
    if(sourceAttemptId!==null)
      requireId(sourceAttemptId,"retry source attempt");
    // The caller can supply ONLY a quiz ID and optional retry attempt ID.
    // This injected trusted gateway must verify Firebase role, admissions,
    // attempt allowance, active-attempt replay, the exact published pointer,
    // Storage SHA/generation, and selected item pins. No client-provided plan
    // or grading payload can be forwarded into this SQL transaction.
    const plan=await verifyStart({actor,quizId:requestedQuiz,
      sourceAttemptId,requestId:key});
    if(plan?.verified!==true||plan.studentUid!==uid ||
        plan.quizId!==requestedQuiz ||
        plan.firebaseProjectId!=="sat-quiz-fd317" ||
        !HASH.test(plan?.bundleSha256??"") ||
        !/^[1-9][0-9]{0,22}$/.test(plan?.bundleGeneration??""))
      fail("RESOURCE_UNAVAILABLE","Unverified published quiz snapshot.");
    const attemptId=assertNewNeonId(plan.attemptId);
    const items=itemList(plan.items);
    const frozenQuizId=requireId(plan.quizId,"quiz");
    const revisionId=requireId(plan.quizRevisionId,"revision");
    const teacherUid=requireId(plan.teacherUid,"teacher");
    const quizIdForReceipt=frozenQuizId;
    const payload={uid,attemptId,quizId:quizIdForReceipt,revisionId,
      sha256:plan.bundleSha256,generation:plan.bundleGeneration,
      deadlineAt:plan.deadlineAt??null,items};
    const hash=digest(payload);
    return transaction(pool,async client=>{
      const old=await receipt(client,uid,key,attemptId,"startAttempt",hash);
      if(old)return old;
      const result={attemptId,quizId:frozenQuizId,quizRevisionId:revisionId,
        status:"active",answerVersion:0};
      await client.query(
        "INSERT INTO quizer.attempts_v2 "+
        "(attempt_id,quiz_id,quiz_revision_id,bundle_sha256,"+
        "bundle_generation,student_uid,teacher_uid,item_count,"+
        "settings_json,deadline_at) "+
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz)",
        [attemptId,frozenQuizId,revisionId,plan.bundleSha256,
          plan.bundleGeneration,uid,teacherUid,items.length,
          JSON.stringify(plan.settings),plan.deadlineAt??null]);
      await client.query(
        "INSERT INTO quizer.attempt_items_v2 "+
        "(attempt_id,item_id,ordinal,problem_id,problem_revision_id,points) "+
        "SELECT $1,x.item_id,x.ordinal,x.problem_id,x.problem_revision_id,"+
        "x.points FROM jsonb_to_recordset($2::jsonb) "+
        "AS x(item_id varchar,ordinal integer,problem_id varchar,"+
        "problem_revision_id varchar,points numeric)",
        [attemptId,JSON.stringify(items)]);
      await remember(client,uid,key,attemptId,"startAttempt",hash,result);
      await client.query(
        "INSERT INTO quizer.attempt_outbox_v2 "+
        "(event_id,attempt_id,event_type,event_json) "+
        "VALUES ($1,$2,'attempt.started','{}'::jsonb)",
        ["evt_"+digest([attemptId,"start"]).slice(0,28),attemptId]);
      return result;
    });
  }

  async function saveAnswers({actor,requestId,attemptId,
    expectedAnswerVersion,changes}={}){
    const uid=actorUid(actor),key=idempotency(requestId),
      attempt=requireId(attemptId,"attempt"),
      values=validateChanges(changes);
    if(!Number.isSafeInteger(expectedAnswerVersion)||expectedAnswerVersion<0)
      fail("INVALID_FIELDS","Expected answer version required.");
    const hash=digest({attempt,expectedAnswerVersion,values});
    return transaction(pool,async client=>{
      const a=await lockOwned(client,uid,attempt);
      const old=await receipt(client,uid,key,attempt,"saveAnswers",hash);
      if(old)return old;
      if(a.state!=="active")
        fail("ATTEMPT_FROZEN","This attempt is no longer active.");
      if(a.deadline_at && new Date(a.database_now)>=new Date(a.deadline_at))
        fail("ATTEMPT_EXPIRED","The attempt deadline has passed.");
      if(Number(a.answer_version)!==expectedAnswerVersion)
        fail("VERSION_CONFLICT","Answers changed in another tab.");
      const ids=values.map(v=>v.item_id);
      const count=row(await client.query(
        "SELECT count(*)::integer AS total FROM quizer.attempt_items_v2 "+
        "WHERE attempt_id=$1 AND item_id=ANY($2::varchar[])",
        [attempt,ids]));
      if(count?.total!==ids.length)
        fail("RESOURCE_UNAVAILABLE","Unpinned answer item.");
      const changed=await client.query(
        "WITH input AS ("+
        "SELECT x.item_id,x.answer_text FROM "+
        "jsonb_to_recordset($2::jsonb) AS x(item_id varchar,answer_text text)), "+
        "written AS ("+
        "INSERT INTO quizer.attempt_answers_v2 "+
        "(attempt_id,item_id,answer_text,answer_revision) "+
        "SELECT $1,i.item_id,i.answer_text,1 FROM input i "+
        "ON CONFLICT (attempt_id,item_id) DO UPDATE "+
        "SET answer_text=EXCLUDED.answer_text,"+
        "answer_revision=quizer.attempt_answers_v2.answer_revision+1,"+
        "updated_at=clock_timestamp() "+
        "WHERE quizer.attempt_answers_v2.answer_text "+
        "IS DISTINCT FROM EXCLUDED.answer_text "+
        "RETURNING item_id,answer_revision,answer_text,updated_at), "+
        "logged AS ("+
        "INSERT INTO quizer.attempt_answer_events_v2 "+
        "(attempt_id,item_id,answer_revision,answer_text,actor_uid) "+
        "SELECT $1,w.item_id,w.answer_revision,w.answer_text,$3 FROM written w "+
        "RETURNING item_id) "+
        "SELECT w.item_id,w.answer_revision,w.updated_at FROM written w",
        [attempt,JSON.stringify(values),uid]);
      let version=Number(a.answer_version);
      if(changed.rows.length){
        version++;
        await client.query(
          "UPDATE quizer.attempts_v2 SET answer_version=$2,"+
          "updated_at=clock_timestamp() WHERE attempt_id=$1",
          [attempt,version]);
      }
      const result={attemptId:attempt,answerVersion:version,
        confirmed:changed.rows.map(x=>({itemId:x.item_id,
          revision:Number(x.answer_revision),savedAt:x.updated_at}))};
      await remember(client,uid,key,attempt,"saveAnswers",hash,result);
      return result;
    });
  }

  async function submit({actor,requestId,attemptId}={}){
    const uid=actorUid(actor),key=idempotency(requestId),
      attempt=requireId(attemptId,"attempt"),hash=digest({attempt});
    return transaction(pool,async client=>{
      const a=await lockOwned(client,uid,attempt);
      const old=await receipt(client,uid,key,attempt,"submitAttempt",hash);
      if(old)return old;
      if(a.state!=="active")
        fail("ATTEMPT_FROZEN","Attempt already finished.");
      const expired=Boolean(a.deadline_at&&
        new Date(a.database_now)>=new Date(a.deadline_at));
      const state=expired?"expired":"submitted";
      await client.query(
        "UPDATE quizer.attempts_v2 SET state=$2,"+
        "frozen_at=clock_timestamp(),updated_at=clock_timestamp() "+
        "WHERE attempt_id=$1",[attempt,state]);
      const result={attemptId:attempt,status:state,
        answerVersion:Number(a.answer_version),gradeState:"not_started"};
      await remember(client,uid,key,attempt,"submitAttempt",hash,result);
      await client.query(
        "INSERT INTO quizer.attempt_outbox_v2 "+
        "(event_id,attempt_id,event_type,event_json) "+
        "VALUES ($1,$2,$3,'{}'::jsonb)",
        ["evt_"+digest([attempt,state]).slice(0,28),attempt,
          state==="expired"?"attempt.expired":"attempt.submitted"]);
      return result;
    });
  }
  return Object.freeze({enabled:true,start,saveAnswers,submit});
}
