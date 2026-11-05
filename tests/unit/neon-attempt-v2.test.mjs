import test from "node:test";
import assert from "node:assert/strict";
import {createNeonAttemptV2Engine} from "../../functions/src/neon/attempt-v2-engine.js";

const actor={uid:"student_1",verifiedFirebaseAuth:true,
  emailVerified:true,accountStatus:"active"};
const authorizedPlan=Object.freeze({
  verified:true,studentUid:"student_1",firebaseProjectId:"sat-quiz-fd317",
  attemptId:"att_abc",quizId:"quiz_1",quizRevisionId:"qrv_1",
  bundleSha256:"a".repeat(64),bundleGeneration:"123",
  teacherUid:"teacher_1",settings:{durationSeconds:1200},
  deadlineAt:null,
  items:[{itemId:"itm_1",problemId:"prb_1",
    problemRevisionId:"prv_1",points:2}],
});
const requestId="unique_request_12345678";

function fakeSql({attempt=null,receipt=null,rows=null}={}){
  const queries=[],client={
    async query(sql,values=[]){
      queries.push({sql,values});
      if(sql.includes("FROM quizer.attempts_v2 WHERE attempt_id=$1 FOR UPDATE"))
        return {rows:attempt?[{...attempt,database_now:
          new Date("2026-11-05T18:00:00Z")}]:[]};
      if(sql.startsWith("SELECT attempt_id,operation,payload_hash,result_json"))
        return {rows:receipt?[receipt]:[]};
      if(sql.includes("count(*)::integer AS total"))
        return {rows:[{total:values[1].length}]};
      if(sql.startsWith("WITH input AS"))
        return {rows:rows??[
          {item_id:"itm_1",answer_revision:"1",
            updated_at:new Date("2026-11-05T18:00:00Z")}]};
      return {rows:[]};
    },
    release(){queries.push({sql:"RELEASE",values:[]});},
  };
  return {pool:{async connect(){return client;}},queries};
}
test("Neon attempts are disabled by default and never touch SQL",async()=>{
  const engine=createNeonAttemptV2Engine();
  assert.equal(engine.enabled,false);
  assert.deepEqual(await engine.submit(),{disabled:true});
  assert.throws(()=>createNeonAttemptV2Engine({enabled:true}),/Trusted SQL/);
});
test("start rejects fake Firebase actors and unverified bundles before opening a transaction",async()=>{
  const db=fakeSql(),engine=createNeonAttemptV2Engine({
    enabled:true,pool:db.pool,verifyStart:async()=>authorizedPlan});
  await assert.rejects(engine.start({actor:{uid:"student_1"},
    requestId,authorizedPlan}),e=>e.reason==="AUTH_REQUIRED");
  const invalid=createNeonAttemptV2Engine({enabled:true,pool:db.pool,
    verifyStart:async()=>({...authorizedPlan,verified:false})});
  await assert.rejects(invalid.start({actor,requestId,authorizedPlan}),
    e=>e.reason==="RESOURCE_UNAVAILABLE");
  assert.equal(db.queries.length,0);
});
test("verified start pins exact bundle and creates attempt, item pins, receipt, outbox atomically",async()=>{
  const db=fakeSql(),engine=createNeonAttemptV2Engine({
    enabled:true,pool:db.pool,verifyStart:async()=>authorizedPlan});
  const result=await engine.start({actor,requestId,authorizedPlan});
  assert.deepEqual(result,{attemptId:"att_abc",quizId:"quiz_1",
    quizRevisionId:"qrv_1",status:"active",answerVersion:0});
  assert.equal(db.queries[0].sql,"BEGIN");
  assert.equal(db.queries.at(-2).sql,"COMMIT");
  assert(db.queries.some(q=>q.sql.includes("INSERT INTO quizer.attempt_items_v2")));
  assert(db.queries.some(q=>q.sql.includes("INSERT INTO quizer.attempt_outbox_v2")));
  assert(!JSON.stringify(db.queries).includes("acceptedAnswers"));
  assert(!JSON.stringify(result).includes("grading"));
});
test("answer batches use a single SQL upsert/answer-event CTE and one version commit",async()=>{
  const db=fakeSql({attempt:{student_uid:"student_1",
    state:"active",deadline_at:null,answer_version:"0"}});
  const engine=createNeonAttemptV2Engine({enabled:true,pool:db.pool,
    verifyStart:async()=>authorizedPlan});
  const out=await engine.saveAnswers({actor,requestId,attemptId:"att_abc",
    expectedAnswerVersion:0,changes:[{itemId:"itm_1",value:"4"}]});
  assert.equal(out.answerVersion,1);
  assert.deepEqual(out.confirmed.map(x=>[x.itemId,x.revision]),[["itm_1",1]]);
  assert.equal(db.queries.filter(q=>q.sql.startsWith("WITH input AS")).length,1);
  assert.equal(db.queries.at(-2).sql,"COMMIT");
});
test("version conflicts roll back and never write answers",async()=>{
  const db=fakeSql({attempt:{student_uid:"student_1",
    state:"active",deadline_at:null,answer_version:"6"}});
  const engine=createNeonAttemptV2Engine({enabled:true,pool:db.pool,
    verifyStart:async()=>authorizedPlan});
  await assert.rejects(engine.saveAnswers({actor,requestId,
    attemptId:"att_abc",expectedAnswerVersion:2,
    changes:[{itemId:"itm_1",value:"4"}]}),
    e=>e.reason==="VERSION_CONFLICT");
  assert(db.queries.some(q=>q.sql==="ROLLBACK"));
  assert(!db.queries.some(q=>q.sql.startsWith("WITH input AS")));
});
test("submit atomically freezes the attempt and records one grading outbox event",async()=>{
  const db=fakeSql({attempt:{student_uid:"student_1",
    state:"active",deadline_at:null,answer_version:"4"}});
  const engine=createNeonAttemptV2Engine({enabled:true,pool:db.pool,
    verifyStart:async()=>authorizedPlan});
  const out=await engine.submit({actor,requestId,attemptId:"att_abc"});
  assert.deepEqual(out,{attemptId:"att_abc",status:"submitted",
    answerVersion:4,gradeState:"not_started"});
  assert(db.queries.some(q=>q.sql.includes("UPDATE quizer.attempts_v2 SET state")));
  assert(db.queries.some(q=>q.sql.includes("'attempt.submitted'") ||
    q.values?.includes("attempt.submitted")));
  assert.equal(db.queries.at(-2).sql,"COMMIT");
});
test("expired attempts cannot accept answer changes even when browser clock differs",async()=>{
  const db=fakeSql({attempt:{student_uid:"student_1",
    state:"active",deadline_at:new Date("2026-11-05T17:59:00Z"),
    answer_version:"0"}});
  const engine=createNeonAttemptV2Engine({enabled:true,pool:db.pool,
    verifyStart:async()=>authorizedPlan});
  await assert.rejects(engine.saveAnswers({actor,requestId,
    attemptId:"att_abc",expectedAnswerVersion:0,
    changes:[{itemId:"itm_1",value:"late"}]}),
    e=>e.reason==="ATTEMPT_EXPIRED");
  const result=await engine.submit({actor,requestId:"another_request_123456",
    attemptId:"att_abc"});
  assert.equal(result.status,"expired");
});
