import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createQuizerStagedIntegratedGateway}
  from "../../functions/src/bundles/private-staged-gateway.js";
const auth={uid:"teacher_1",token:{email_verified:true}};
const error=reason=>e=>e?.reason===reason;
function fixture({failBank=false}={}){
  const calls=[];
  const bankCompat={enabled:true,async handle(action){
    calls.push("bank:"+action);
    if(failBank)throw Object.assign(new Error("NEON UNAVAILABLE"),{
      reason:"RESOURCE_UNAVAILABLE"});
    return {origin:"neon",action};
  }};
  const importGateway={enabled:true,async handle(action){
    calls.push("import:"+action);return {origin:"import",action};}};
  const privateRuntime={enabled:true,
    async handle(action){calls.push("private:"+action);
      return {origin:"bundle",action};},
    async publishJob({jobId}){calls.push("publish");return {jobId};},
    async gradeJobBatch({jobId}){calls.push("batch");return {jobId};},
    async finalizeGradeJob({jobId}){calls.push("finish");return {jobId};},
    async exportJob({jobId}){calls.push("export");return {jobId};},
  };
  const legacyHandle=async action=>{
    calls.push("legacy:"+action);return {origin:"firestore",action};};
  const gateway=createQuizerStagedIntegratedGateway({
    enabled:true,bankCompat,importGateway,privateRuntime,legacyHandle,
    legacyActions:["getDashboard","listMyQuizzes","getActivity"]});
  const request=(action)=>({apiVersion:2,action});
  return {gateway,request,calls};
}
test("QN11.6.5 combined gateway is default OFF and does not register actions",async()=>{
  const off=createQuizerStagedIntegratedGateway();
  assert.deepEqual(await off.handle(),{disabled:true});
  assert.deepEqual(await off.runPrivateJob(),{disabled:true});
});
test("QN11.6.5 exact private/bank/import/legacy actions never cross routes",async()=>{
  const f=fixture();
  const actions=["getProblem","importProblemBatch","startAttempt",
    "saveManualGrade","getAssetLinks","getDashboard"];
  const got=[];
  for(const action of actions){
    got.push((await f.gateway.handle(action,auth,f.request(action))).origin);
  }
  assert.deepEqual(got,["neon","import","bundle","bundle",
    "bundle","firestore"]);
  assert.deepEqual(f.calls,["bank:getProblem",
    "import:importProblemBatch","private:startAttempt",
    "private:saveManualGrade","private:getAssetLinks",
    "legacy:getDashboard"]);
});
test("QN11.6.5 a failed Neon action cannot silently replay in Firestore",async()=>{
  const f=fixture({failBank:true});
  await assert.rejects(f.gateway.handle("getProblem",auth,
    f.request("getProblem")),error("RESOURCE_UNAVAILABLE"));
  assert.deepEqual(f.calls,["bank:getProblem"]);
  await assert.rejects(f.gateway.handle("deleteEverything",auth,
    f.request("deleteEverything")),error("INVALID_FIELDS"));
  await assert.rejects(f.gateway.handle("getProblem",auth,
    {apiVersion:1,action:"getProblem"}),error("API_VERSION"));
  await assert.rejects(f.gateway.handle("getProblem",null,
    f.request("getProblem")),error("AUTH_REQUIRED"));
});
test("QN11.6.5 worker dispatch requires explicit supported operation",async()=>{
  const f=fixture();
  assert.deepEqual(await f.gateway.runPrivateJob({
    kind:"publishJob",jobId:"job_pub"}),{jobId:"job_pub"});
  assert.deepEqual(await f.gateway.runPrivateJob({
    kind:"exportJob",jobId:"job_zip"}),{jobId:"job_zip"});
  assert.deepEqual(await f.gateway.runPrivateJob({
    kind:"gradeJobBatch",jobId:"job_grade",attemptId:"att_1",
    itemIds:["itm_1"]}),{jobId:"job_grade"});
  assert.deepEqual(await f.gateway.runPrivateJob({
    kind:"finalizeGradeJob",jobId:"job_grade",
    attemptId:"att_1",leaseOwner:"lease"}),{jobId:"job_grade"});
  await assert.rejects(f.gateway.runPrivateJob({
    kind:"deleteJob",jobId:"job_1"}),error("INVALID_FIELDS"));
  await assert.rejects(f.gateway.runPrivateJob({
    kind:"gradeJobBatch",jobId:"job_1",attemptId:"att_1",
    itemIds:Array.from({length:21},(_,i)=>"itm_"+i)}),
    error("INVALID_FIELDS"));
});
test("QN11.6.5 no overlap/unknown legacy allowed, active routes untouched",()=>{
  const f=fixture();
  assert.equal(f.gateway.actionCounts.import,1);
  const base={enabled:true,
    bankCompat:{enabled:true,handle:async()=>{}},
    importGateway:{enabled:true,handle:async()=>{}},
    privateRuntime:{enabled:true,handle:async()=>{},
      publishJob:async()=>{},gradeJobBatch:async()=>{},
      finalizeGradeJob:async()=>{},exportJob:async()=>{}},
    legacyHandle:async()=>{},
  };
  assert.throws(()=>createQuizerStagedIntegratedGateway({
    ...base,legacyActions:["startAttempt"]}),
    error("INVALID_FIELDS"));
  const activeRouter=readFileSync(new URL(
    "../../functions/src/router.js",import.meta.url),"utf8");
  const activeWorker=readFileSync(new URL(
    "../../functions/src/jobs/worker.js",import.meta.url),"utf8");
  const activeEntry=readFileSync(new URL(
    "../../functions/src/index.js",import.meta.url),"utf8");
  assert.doesNotMatch(activeRouter+activeWorker+activeEntry,
    /private-staged-gateway|firebase-bank-coordinator|private-recovery-inspector/);
});
