import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createQuizerStg2StagingRuntime}
  from "../../functions/src/bundles/stg2-staging-composition.js";
const verifiedAuth={uid:"teacher_1",token:{email_verified:true}};
const trustedIdentity=async()=>({
  projectId:"quizer-staging-az26",serverVerified:true,
  runtimeKind:"firebase-functions-v2",appCheckPolicyReviewed:true,
  credentialsServerOnly:true,
});
function createFixture({failNeon=false}={}){
  let legacy=0,neon=0,privateActions=0;
  const db={doc:path=>({path}),async runTransaction(){
    throw Error("No fake transactions allowed");}};
  const privateRuntime={
    enabled:true,handle:async action=>{
      privateActions++;return {origin:"private",action};},
    publishJob:async()=>({published:true}),
    gradeJobBatch:async()=>({processed:1}),
    finalizeGradeJob:async()=>({finalized:true}),
    exportJob:async()=>({exported:true}),
  };
  const stagingPorts={
    db,neonReader:{
      getProblemForTeacher:async({problemId})=>{
        neon++;
        if(failNeon)throw Error("External Neon unavailable");
        return {problemId,revisionId:"prv_1"};
      },
      listProblemHeaders:async()=>({items:[],next:null}),
      listProblemRevisions:async()=>({items:[],next:null}),
    },
    neonGateway:{enabled:true,replaySafeEdits:true,
      handle:async()=>{throw Error("Unexpected SQL write");}},
    bankMutations:{enabled:true,mutate:async()=>{throw Error("Unexpected mutation");}},
    resolveFirebaseActor:async auth=>({uid:auth.uid,role:"teacher",
      emailVerified:true,accountStatus:"active"}),
    resolveProblemOrigin:async()=>"neon_revision",
    privateRuntime,
    legacyHandle:async action=>{legacy++;return {origin:"legacy",action};},
    legacyListHeaders:async()=>({items:[],next:null}),
    legacyActionNames:["getDashboard"],
    cursorSecret:"fixture_only_not_live_secret_1234567890",
  };
  const bridge=createQuizerStg2StagingRuntime({
    enabled:true,stagingPorts,attestIdentity:trustedIdentity,
    authorizeWorker:async()=>true,
    now:()=>new Date("2026-11-04T01:00:00Z"),
  });
  return {bridge, get legacy(){return legacy},
    get neon(){return neon}, get privateActions(){return privateActions}};
}
const call=(bridge,action,payload={})=>bridge.callable(verifiedAuth,{
  apiVersion:2,action,...payload,
});

test("STG2.1 assembly is default disabled with no trusted ports",async()=>{
  const bridge=createQuizerStg2StagingRuntime();
  assert.equal(bridge.enabled,false);
  await assert.rejects(call(bridge,"getProblem",{problemId:"prb_1"}));
  assert.throws(()=>createQuizerStg2StagingRuntime({enabled:true}),
    /Missing trusted Quizer/);
});
test("STG2.1 exact QN11 full factory is actually composed behind v2 bridge",async()=>{
  const f=createFixture();
  const problem=await call(f.bridge,"getProblem",{problemId:"prb_1"});
  assert.equal(problem.apiVersion,2);
  assert.equal(problem.data.problemId,"prb_1");
  assert.equal(f.neon,1);
  const privateResult=await call(f.bridge,"startAttempt",{quizId:"quiz_1"});
  assert.equal(privateResult.data.origin,"private");
  assert.equal(f.privateActions,1);
  const legacy=await call(f.bridge,"getDashboard");
  assert.equal(legacy.data.origin,"legacy");
  assert.equal(f.legacy,1);
});
test("STG2.1 external Neon outage never falls back to Firestore writes",async()=>{
  const f=createFixture({failNeon:true});
  await assert.rejects(call(f.bridge,"getProblem",{problemId:"prb_1"}),
    /External Neon unavailable/);
  assert.equal(f.legacy,0);
});
test("STG2.1 strict worker gate invokes only permitted composed jobs",async()=>{
  const f=createFixture();
  const context={firebaseProjectId:"quizer-staging-az26",
    trustedServerInvocation:true};
  assert.deepEqual(await f.bridge.worker(context,
    {kind:"publishJob",jobId:"job_123"}),{published:true});
  await assert.rejects(f.bridge.worker(context,
    {kind:"deleteEverything",jobId:"job_123"}),e=>e.reason==="INVALID_FIELDS");
  await assert.rejects(f.bridge.worker(context,
    {kind:"gradeJobBatch",jobId:"job_123",attemptId:"att_1",
      itemIds:Array(21).fill("itm_1")}),e=>e.reason==="INVALID_FIELDS");
});
test("STG2.1 active production runtime entrypoints remain separate",()=>{
  const root=new URL("../../functions/src/",import.meta.url);
  const src=["index.js","router.js","jobs/worker.js"]
    .map(p=>readFileSync(new URL(p,root),"utf8")).join("\n");
  assert.doesNotMatch(src,
    /stg2-staging-composition|stg2-callable-bridge|private-full-staging/);
});
