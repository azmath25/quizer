import test from "node:test";
import assert from "node:assert/strict";
import {createQuizerStagedPrivateRuntime} from "../../functions/src/bundles/private-staging-runtime.js";
const student={uid:"student_one",token:{email_verified:true}};
const st={
  "roles/student_one":{role:"student",accountStatus:"active",version:1},
  "roles/teacher_one":{role:"teacher",accountStatus:"active",version:1},
  "attempts/att_legacy":{quizId:"quiz_test",quizRevisionId:"qrv_old",
    studentId:"student_one",quizOwnerId:"teacher_one"},
  "attempts/att_new":{quizId:"quiz_test",quizRevisionId:"qrv_current",
    studentId:"student_one",quizOwnerId:"teacher_one"},
  "quizzes/quiz_test":{publishedRevisionId:"qrv_current"},
  "quizzes/quiz_test/revisions/qrv_old":{state:"ready",itemOrder:["itm_1"]},
  "quizzes/quiz_test/revisions/qrv_current":{state:"ready",
    itemOrder:["itm_1"],bundle:{format:"fake-private-placeholder"}},
};
const why=r=>e=>e?.reason===r;
function build({data=st}={}){
  let storage=0,tx=0,legacy=0;
  const db={
    doc:path=>({async get(){const x=data[path];
      return {exists:!!x,data:()=>x}}}),
    async runTransaction(){tx++;throw Error("Unexpected transaction");},
  };
  const p=createQuizerStagedPrivateRuntime({
    enabled:true,db,bucket:{file(){storage++;
      throw Error("Unexpected Storage");}},
    authFor:async()=>({uid:"teacher_one",token:{email_verified:true}}),
    neonReader:{getProblemForTeacher:async()=>{throw Error("Unexpected Neon");}},
    resolvePublicationActor:async()=>({uid:"teacher_one",role:"teacher",
      emailVerified:true,accountStatus:"active"}),
    verifyPublicationAssets:async()=>true,
    preflightStart:async()=>({authorized:false}),
    commitStart:async()=>{throw Error("Unexpected start")},
    authorizeExport:async()=>({authorized:false}),
    verifyExportAssets:async()=>false,
    resolveImageScope:async()=>({authorized:false}),
    signImage:async()=>{throw Error("Unexpected signer")},
    legacyHandle:async action=>{legacy++;return {legacy:true,action};},
  });
  return {p,get storage(){return storage},get tx(){return tx},
    get legacy(){return legacy}};
}
test("QN11.5 factory is inert by default and requires explicit trusted ports",async()=>{
  const off=createQuizerStagedPrivateRuntime();
  assert.deepEqual(await off.handle(),{disabled:true});
  assert.deepEqual(await off.gradeJobBatch(),{disabled:true});
  assert.deepEqual(await off.publishJob(),{disabled:true});
  assert.throws(()=>createQuizerStagedPrivateRuntime({enabled:true}),
    /Verified QN11.5 integration ports/);
});
test("QN11.5 composed server routes old quiz and older frozen retry via legacy",async()=>{
  const f=build();
  const old=await f.p.handle("getAttemptQuestions",student,{
    apiVersion:2,action:"getAttemptQuestions",
    attemptId:"att_legacy",itemIds:["itm_1"]});
  assert.equal(old.legacy,true);
  const retry=await f.p.handle("startAttempt",student,{
    apiVersion:2,action:"startAttempt",quizId:"quiz_test",
    sourceAttemptId:"att_legacy"});
  assert.equal(retry.legacy,true);
  assert.equal(f.storage,0);
  assert.equal(f.tx,0);
  assert.equal(f.legacy,2);
});
test("QN11.5 current private revision is never silently served as legacy",async()=>{
  const f=build();
  await assert.rejects(f.p.handle("getAttemptQuestions",student,{
    apiVersion:2,action:"getAttemptQuestions",
    attemptId:"att_new",itemIds:["itm_1"]}));
  assert.equal(f.legacy,0);
  // Invalid private manifest must fail closed, without switching source.
  assert(f.storage===0||f.storage===1);
});
test("QN11.5 unauthorized attempt lookup fails before legacy dispatch",async()=>{
  const f=build();
  await assert.rejects(f.p.handle("getAttemptQuestions",{
    uid:"student_other",token:{email_verified:true}},{
    apiVersion:2,action:"getAttemptQuestions",
    attemptId:"att_legacy",itemIds:["itm_1"]}),
    why("RESOURCE_UNAVAILABLE"));
  assert.equal(f.legacy,0);
});
test("QN11.5 trusted worker refuses legacy grading",async()=>{
  const f=build();
  await assert.rejects(f.p.gradeJobBatch({
    jobId:"job_grading",attemptId:"att_legacy",itemIds:["itm_1"]}),
    why("FAILED_PRECONDITION"));
  assert.equal(f.storage,0);
  assert.equal(f.legacy,0);
});
