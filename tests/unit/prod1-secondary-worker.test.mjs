import test from "node:test";
import assert from "node:assert/strict";
import {Timestamp} from "../../functions/src/domain/runtime.js";
import {createProd1SecondaryWorker}
  from "../../functions/src/prod1/secondary-worker.js";
const NOW=1730000000000;
function fixture({kind="grade_attempt",privateBundle=true,
  retryCount=0,status="queued"}={}){
  const attemptId="att_1",jobId="job_1",quizId="quiz_1",
    revisionId="rev_1";
  const data={
    ["jobs/"+jobId]:{
      kind,targetId:kind==="grade_attempt"?attemptId:quizId,
      requestedBy:kind==="grade_attempt"?"student_1":"teacher_1",
      input:kind==="export_quiz"?{revisionId}:{},
      status,leaseOwner:null,leaseExpiresAt:null,
      retryCount,progress:{processed:0,total:0,stage:"Queued"},
    },
    ["attempts/"+attemptId]:{
      quizId,quizRevisionId:revisionId,gradingJobId:jobId,
      gradeVersion:0,gradeState:"queued",status:"submitted",
      order:Array.from({length:24},(_,i)=>"itm_"+i),
    },
    ["quizzes/"+quizId]:{ownerId:"teacher_1",lifecycle:"active"},
    ["quizzes/"+quizId+"/revisions/"+revisionId]:{
      state:"ready",bundle:privateBundle?{sha256:"a".repeat(64)}:null,
    },
  };
  const db={
    data,doc(path){return {path,async get(){
      return {exists:Object.hasOwn(data,path),
        data:()=>data[path]};}};},
    async runTransaction(fn){
      const changes=[];
      const tx={get:ref=>db.doc(ref.path).get(),
        set:(ref,value)=>changes.push([ref.path,value])};
      const result=await fn(tx);
      for(const [path,value] of changes)data[path]=value;
      return result;
    },
  };
  let legacy=0;const calls=[];
  const dependencies={db,
    now:()=>NOW,
    randomLease:()=> "lease_generated_123456789",
    runLegacy:async()=>{legacy++;return "legacy";},
    runPrivateJob:async job=>{
      calls.push(job);
      if(job.kind==="gradeJobBatch"){
        data["jobs/"+jobId].progress.processed+=job.itemIds.length;
        return {processed:data["jobs/"+jobId].progress.processed};
      }
      data["jobs/"+jobId].status="succeeded";
      return {completed:true};
    }};
  return {data,dependencies,calls,get legacy(){return legacy;}};
}
test("legacy frozen grade and export remain with old worker",async()=>{
  for(const kind of ["grade_attempt","export_quiz"]){
    const f=fixture({kind,privateBundle:false});
    const res=await createProd1SecondaryWorker(f.dependencies).runJob("job_1");
    assert.equal(res,"legacy");
    assert.equal(f.legacy,1);
    assert.equal(f.calls.length,0);
  }
});
test("private frozen grade processes bounded batches and finalizes",async()=>{
  const f=fixture();
  const result=await createProd1SecondaryWorker(f.dependencies).runJob("job_1");
  assert.equal(result.status,"handled");
  assert.deepEqual(f.calls.map(c=>c.kind),
    ["gradeJobBatch","gradeJobBatch","finalizeGradeJob"]);
  assert.equal(f.calls[0].itemIds.length,20);
  assert.equal(f.calls[1].itemIds.length,4);
  assert.equal(f.calls[2].leaseOwner,"lease_generated_123456789");
  assert.equal(f.legacy,0);
  assert.equal(f.data["jobs/job_1"].retryCount,1);
});
test("private ZIP job is pinned to published protected revision",async()=>{
  const f=fixture({kind:"export_quiz"});
  assert.equal((await createProd1SecondaryWorker(f.dependencies)
    .runJob("job_1")).status,"handled");
  assert.deepEqual(f.calls.map(x=>x.kind),["exportJob"]);
  assert.equal(f.legacy,0);
});
test("private grading errors never fall through and own lease expires",async()=>{
  const f=fixture();
  f.dependencies.runPrivateJob=async()=>{throw Error("Storage unavailable");};
  await assert.rejects(createProd1SecondaryWorker(f.dependencies)
    .runJob("job_1"),/Storage unavailable/);
  assert.equal(f.legacy,0);
  assert.equal(f.data["jobs/job_1"].status,"running");
  assert(f.data["jobs/job_1"].leaseExpiresAt.toMillis()<NOW);
  assert.equal(f.data["jobs/job_1"].error.reason,
    "PRIVATE_JOB_RETRY_PENDING");
});
test("private grading exhausts retries without erasing a quiz revision",async()=>{
  const f=fixture({retryCount:5});
  const r=await createProd1SecondaryWorker(f.dependencies).runJob("job_1");
  assert.equal(r.status,"exhausted");
  assert.equal(f.data["jobs/job_1"].status,"failed");
  assert.equal(f.data["attempts/att_1"].gradeState,"failed");
  assert.equal(f.data["quizzes/quiz_1/revisions/rev_1"].state,"ready");
  assert.equal(f.calls.length,0);
});
test("a changed grading job pin is rejected before private calls",async()=>{
  const f=fixture();
  f.data["attempts/att_1"].gradingJobId="another_job";
  await assert.rejects(createProd1SecondaryWorker(f.dependencies)
    .runJob("job_1"),/Private grading attempt changed/);
  assert.equal(f.calls.length,0);
  assert.equal(f.legacy,0);
});
