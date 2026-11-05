import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createQuizerStagedFullRuntime}
  from "../../functions/src/bundles/private-full-staging.js";
const auth={uid:"teacher_1",token:{email_verified:true}};
const denied=reason=>e=>e?.reason===reason;
function fixture({neonDown=false}={}){
  let legacy=0,sql=0,privateCalls=0;
  const db={doc:path=>({path}),async runTransaction(){
    throw Error("Only emulator may run real Firebase transactions");}};
  const p={
    enabled:true,handle:async action=>{
      privateCalls++;return {origin:"private",action};},
    publishJob:async()=>({published:true}),
    gradeJobBatch:async()=>({processed:1}),
    finalizeGradeJob:async()=>({finalized:true}),
    exportJob:async()=>({exported:true}),
  };
  const obj=createQuizerStagedFullRuntime({enabled:true,db,
    neonReader:{
      getProblemForTeacher:async({problemId})=>{
        sql++;
        if(neonDown)throw Error("Neon unavailable");
        return {problemId,revisionId:"prv_1"};},
      listProblemHeaders:async()=>({items:[],next:null}),
      listProblemRevisions:async()=>({items:[],next:null}),
    },
    neonGateway:{enabled:true,replaySafeEdits:true,
      handle:async()=>{throw Error("Unsupported fake SQL action");}},
    bankMutations:{enabled:true,
      mutate:async()=>{throw Error("Unexpected fake SQL mutation");}},
    resolveFirebaseActor:async a=>({uid:a.uid,role:"teacher",
      emailVerified:true,accountStatus:"active"}),
    resolveProblemOrigin:async()=>"neon_revision",
    privateRuntime:p,legacyHandle:async action=>{
      legacy++;return {origin:"legacy",action};},
    legacyListHeaders:async()=>({items:[],next:null}),
    legacyActionNames:["getDashboard","listMyQuizzes"],
    cursorSecret:"test_only_cursor_secret_0123456789_FOO",
  });
  const call=(action,body={})=>
    obj.handle(action,auth,{apiVersion:2,action,...body});
  return {obj,call,get legacy(){return legacy},
    get sql(){return sql},get privateCalls(){return privateCalls}};
}
test("QN11.6.5 full factory fails closed unless all trusted ports exist",async()=>{
  const off=createQuizerStagedFullRuntime();
  assert.deepEqual(await off.handle(),{disabled:true});
  assert.throws(()=>createQuizerStagedFullRuntime({
    enabled:true}),denied("INVALID_FIELDS"));
});
test("QN11.6.5 real composed bank read and private/legacy route stay separated",async()=>{
  const f=fixture();
  const row=await f.call("getProblem",{problemId:"prb_1"});
  assert.equal(row.problemId,"prb_1");
  assert.equal(f.sql,1);
  assert.equal((await f.call("startAttempt",{quizId:"quiz_1"})).origin,
    "private");
  assert.equal((await f.call("getDashboard")).origin,"legacy");
  assert.equal(f.legacy,1);
  assert.equal(f.privateCalls,1);
  assert.deepEqual(f.obj.capabilities,{
    bankMutationReceipts:true,boundedImportReceipts:true,
    privateBundleServing:true,pinnedLegacyRouting:true});
});
test("QN11.6.5 Neon failure does not use old bank fallback",async()=>{
  const f=fixture({neonDown:true});
  await assert.rejects(f.call("getProblem",{
    problemId:"prb_1"}),/Neon unavailable/);
  assert.equal(f.legacy,0);
  await assert.rejects(f.call("importProblemBatch",{
    requestId:"request_1234567890",jobId:"job_1",records:[]}));
  assert.equal(f.legacy,0);
});
test("QN11.6.5 full factory remains absent from active production entrypoints",()=>{
  const src=["router.js","index.js","jobs/worker.js"].map(p=>
    readFileSync(new URL("../../functions/src/"+p,import.meta.url),"utf8"))
    .join("\n");
  assert.doesNotMatch(src,/private-full-staging|private-staged-gateway|private-recovery-audit/);
});
