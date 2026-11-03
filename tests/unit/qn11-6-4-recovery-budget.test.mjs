import test from "node:test";
import assert from "node:assert/strict";
import {createQuizerRecoveryInspector}
  from "../../functions/src/bundles/private-recovery-inspector.js";
import {preparePublishedBundle,makePublishedBundleManifest,
  BUNDLE_FORMAT,MAX_BUNDLE_BYTES} from "../../functions/src/bundles/published-bundle.js";
import {publishedAssetIds} from "../../functions/src/bundles/private-asset-retention.js";
const sha="b".repeat(64);
function publication(){
  const settings={durationSeconds:600,shuffleQuestions:false,
    shuffleOptions:false,allowBack:true,penalty:0,
    scoreRelease:"immediate",solutionRelease:"manual"};
  const bundle=preparePublishedBundle({format:BUNDLE_FORMAT,
    quizId:"quiz_1",revisionId:"qrv_1",revisionNumber:1,
    title:"Recovery",description:"",subject:"Math",difficulty:"",
    settings,itemOrder:["itm_1"],itemCount:1,totalPoints:2,
    items:[{itemId:"itm_1",problemId:"prb_1",
      problemRevisionId:"prv_1",points:2,
      content:{type:"open",answerMode:"auto",statementLatex:"x+1=2",
        defaultPoints:2,options:[],questionAssetBindings:{}},
      grading:{correctOptionId:null,acceptedAnswers:["1"],tolerance:0,
        explanationLatex:"",rubricLatex:"",solutionAssetBindings:{}}}]});
  return makePublishedBundleManifest(bundle,"17");
}
function harness({kind="publication",status="succeeded",hasObject=true,
  corrupt=false,leaseExpired=false,noManifest=false}={}){
  const man=publication();
  const jobId="job_1",quiz={id:"quiz_1",ownerId:"teacher_1"},
    revision={id:"qrv_1",state:status==="succeeded"?"ready":"building",
      bundle:noManifest?null:man};
  const job={kind:kind==="publication"?"publish_quiz":"export_quiz",
    targetId:quiz.id,requestedBy:quiz.ownerId,
    input:{revisionId:revision.id},status,
    leaseExpiresAt:leaseExpired?100:2000,
    ...(kind==="export"&&status==="succeeded"?{
      result:{privateBundleExport:true,quizId:quiz.id,
        revisionId:revision.id,sha256:sha,generation:"22",
        byteLength:123,filename:"quiz_1-job_1.zip",
        storagePath:"exports/teacher_1/job_1/quiz_1-job_1.zip"}}:{}),
  };
  let reads=0;
  const inspector=createQuizerRecoveryInspector({enabled:true,
    now:()=>1000,
    loadTrustedSnapshot:async()=>({job,quiz,revision}),
    inspectObject:async({storagePath})=>{
      reads++;
      if(!hasObject)return {exists:false};
      if(kind==="publication")return {
        exists:true,generation:corrupt?"99":"17",
        byteLength:man.byteLength,
        contentType:"application/json",sha256:man.sha256};
      return {exists:true,generation:corrupt?"23":"22",
        byteLength:123,contentType:"application/zip",sha256:sha};
    },
  });
  return {inspector,job,revision,get reads(){return reads}};
}
test("QN11.6.4 recovery is default OFF and never exposes cleanup methods",async()=>{
  const off=createQuizerRecoveryInspector();
  assert.deepEqual(await off.inspectPublication(),{disabled:true});
  assert.equal("deleteObject" in off,false);
  assert.throws(()=>createQuizerRecoveryInspector({enabled:true}),
    /Trusted read-only/);
});
test("QN11.6.4 succeeded private publication requires exact pinned object",async()=>{
  const ok=harness();
  const outcome=await ok.inspector.inspectPublication("job_1");
  assert.equal(outcome.state,"consistent");
  assert.equal(outcome.automaticCleanupAllowed,false);
  assert.equal(ok.reads,1);
  const gone=await harness({hasObject:false}).inspector
    .inspectPublication("job_1");
  assert.equal(gone.state,"integrity_alert");
  const drift=await harness({corrupt:true}).inspector
    .inspectPublication("job_1");
  assert.equal(drift.state,"integrity_alert");
});
test("QN11.6.4 interrupted publication never deletes preexisting private object",async()=>{
  const old=harness({status:"running",leaseExpired:true});
  const outcome=await old.inspector.inspectPublication("job_1");
  assert.equal(outcome.state,"unlinked_private_object");
  assert.equal(outcome.automaticCleanupAllowed,false);
  assert.equal((await harness({status:"running",hasObject:false,
    leaseExpired:true}).inspector.inspectPublication("job_1"))
    .state,"retryable_missing_object");
  assert.equal((await harness({status:"running"}).inspector
    .inspectPublication("job_1")).state,"in_flight");
  const missing=harness({status:"failed",noManifest:true});
  assert.equal((await missing.inspector.inspectPublication("job_1")).state,
    "manual_review");
  assert.equal(missing.reads,0);
});
test("QN11.6.4 exporter identifies completed, corrupt and unlinked ZIPs",async()=>{
  assert.equal((await harness({kind:"export"}).inspector
    .inspectExport("job_1")).state,"consistent");
  assert.equal((await harness({kind:"export",corrupt:true}).inspector
    .inspectExport("job_1")).state,"integrity_alert");
  const orphan=await harness({kind:"export",status:"running",
    leaseExpired:true}).inspector.inspectExport("job_1");
  assert.equal(orphan.state,"unlinked_private_object");
  assert.equal(orphan.automaticCleanupAllowed,false);
  assert.equal((await harness({kind:"export",status:"running",
    hasObject:false,leaseExpired:true}).inspector
    .inspectExport("job_1")).state,"retryable_missing_object");
});
test("QN11.6.4 untrusted recovery job identity must fail before Storage IO",async()=>{
  const f=harness();
  f.job.targetId="quiz_other";
  await assert.rejects(f.inspector.inspectPublication("job_1"),
    e=>e.reason==="RESOURCE_UNAVAILABLE");
  assert.equal(f.reads,0);
});
test("QN11.6.4 bound 500 item/2000 image source with no remote calls",()=>{
  for(const size of [10,100,500]){
    const items=Array.from({length:size},(_,i)=>({
      content:{questionAssetBindings:Object.fromEntries(
        Array.from({length:4},(_,j)=>["image"+j,"ast_"+i+"_"+j]))},
      grading:{solutionAssetBindings:{}},
    }));
    const ids=publishedAssetIds(items);
    assert.equal(ids.length,size*4);
  }
  const tooMany=Array.from({length:500},(_,i)=>({
    content:{questionAssetBindings:Object.fromEntries(
      Array.from({length:5},(_,j)=>["asset"+j,"ast_"+i+"_"+j]))},
    grading:{solutionAssetBindings:{}},
  }));
  assert.throws(()=>publishedAssetIds(tooMany),
    e=>e.reason==="INVALID_FIELDS");
  assert.equal(MAX_BUNDLE_BYTES,24*1024*1024);
});
