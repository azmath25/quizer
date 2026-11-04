import test from "node:test";
import assert from "node:assert/strict";
import {createProd1WorkerRouter,classifyProd1Job}
  from "../../functions/src/prod1/worker-router.js";
import {Timestamp} from "../../functions/src/domain/runtime.js";
function fixture({kind="private",status="queued",retryCount=0}={}){
  const docs={
    "jobs/job_1":{
      kind:kind==="other"?"export_quiz":"publish_quiz",
      status,requestId:"request_123456789abcdefg",
      input:kind==="legacy"?{revisionId:"pub_1",sources:[{}]}:
        {bundleMode:"private_bundle_v1",revisionId:"pub_1",
          sources:[{source:{kind:"neon_revision"},itemId:"itm_1"}]},
      targetId:"quiz_1",requestedBy:"owner_1",
      retryCount,
      leaseOwner:status==="running"?"old_lease_identifier_1234":null,
      leaseExpiresAt:status==="running"?Timestamp.fromMillis(10):null,
    },
    "quizzes/quiz_1":{ownerId:"owner_1",lifecycle:"active",
      publishedRevisionId:"pub_previous",publishingJobId:"job_1"},
    "quizzes/quiz_1/revisions/pub_1":{
      state:"building",publicationJobId:"job_1"},
  };
  let current=100,legacyCalls=0,privateCalls=0,writes=0;
  const db={
    docs,
    doc(path){return {path,async get(){
      return {exists:Object.hasOwn(docs,path),data:()=>docs[path]};
    }};},
    async runTransaction(fn){
      const staged=[];
      const tx={
        get:ref=>db.doc(ref.path).get(),
        set(ref,val){staged.push([ref.path,val]);},
      };
      const result=await fn(tx);
      for(const [path,val] of staged){writes++;docs[path]=val;}
      return result;
    },
  };
  const deps={
    enabled:true,db,
    now:()=>current,
    randomLease:()=> "lease_new_123456789abcdefg",
    runLegacy:async()=>{legacyCalls++;return {legacy:true};},
    runPrivateJob:async()=>{privateCalls++;return {private:true};},
  };
  return {db,deps,docs,clock(v){current=v;},
    get stats(){return {writes,legacyCalls,privateCalls}}};
}
test("private mode is classified from persisted job only",()=>{
  assert.equal(classifyProd1Job(fixture().docs["jobs/job_1"]),"private");
  assert.equal(classifyProd1Job(fixture({kind:"legacy"}).docs["jobs/job_1"]),"legacy");
  assert.throws(()=>classifyProd1Job({
    kind:"publish_quiz",input:{bundleMode:"unknown",sources:[]}
  }),/Unknown or invalid/);
});
test("default OFF private router performs no DB or worker access",async()=>{
  const r=createProd1WorkerRouter();
  assert.deepEqual(await r.runJob("job_1"),{disabled:true});
});
test("existing legacy publication passes exclusively to legacy worker",async()=>{
  const f=fixture({kind:"legacy"});
  const out=await createProd1WorkerRouter(f.deps).runJob("job_1");
  assert.deepEqual(out,{legacy:true});
  assert.equal(f.stats.legacyCalls,1);
  assert.equal(f.stats.privateCalls,0);
  assert.equal(f.stats.writes,0);
});
test("private publication is leased and never goes to the old worker",async()=>{
  const f=fixture(),r=createProd1WorkerRouter(f.deps);
  const result=await r.runJob("job_1");
  assert.equal(result.status,"handled");
  assert.equal(f.stats.legacyCalls,0);
  assert.equal(f.stats.privateCalls,1);
  assert.equal(f.docs["jobs/job_1"].status,"running");
  assert.equal(f.docs["jobs/job_1"].retryCount,1);
  assert(f.docs["jobs/job_1"].leaseExpiresAt.toMillis()>100);
  const concurrent=await r.runJob("job_1");
  assert.deepEqual(concurrent,{status:"busy"});
  assert.equal(f.stats.privateCalls,1);
});
test("private worker exception never retries in legacy Firestore path",async()=>{
  const f=fixture(),r=createProd1WorkerRouter({
    ...f.deps,runPrivateJob:async()=>{throw Error("storage unavailable");},
  });
  await assert.rejects(r.runJob("job_1"),/storage unavailable/);
  assert.equal(f.stats.legacyCalls,0);
  assert.equal(f.docs["quizzes/quiz_1"].publishedRevisionId,"pub_previous");
});
test("expired private lease is safely reclaimed; future lease is not stolen",async()=>{
  const f=fixture({status:"running"});
  const r=createProd1WorkerRouter(f.deps);
  const first=await r.runJob("job_1");
  assert.equal(first.status,"handled");
  assert.equal(f.docs["jobs/job_1"].retryCount,1);
  const again=await r.runJob("job_1");
  assert.equal(again.status,"busy");
});
test("failure after exhausted attempts retains old revision and clears only private pointer",async()=>{
  const f=fixture({retryCount:5,status:"running"});
  f.docs["jobs/job_1"].leaseExpiresAt=Timestamp.fromMillis(20);
  const r=createProd1WorkerRouter(f.deps);
  const result=await r.runJob("job_1");
  assert.equal(result.status,"exhausted");
  assert.equal(f.docs["jobs/job_1"].status,"failed");
  assert.equal(f.docs["quizzes/quiz_1"].publishedRevisionId,"pub_previous");
  assert.equal(f.docs["quizzes/quiz_1"].publishingJobId,null);
  assert.equal(f.docs["quizzes/quiz_1/revisions/pub_1"].state,"failed");
  assert.equal(f.stats.privateCalls,0);
  assert.equal(f.stats.legacyCalls,0);
});
test("maintenance and cancellation block claiming private publication",async()=>{
  const maint=fixture();
  maint.docs["system/maintenance"]={enabled:true};
  assert.equal((await createProd1WorkerRouter(maint.deps).runJob("job_1"))
    .status,"maintenance");
  assert.equal(maint.stats.writes,0);
  const cancelled=fixture();
  cancelled.docs["quizzes/quiz_1"].publishingJobId="another_job";
  await assert.rejects(createProd1WorkerRouter(cancelled.deps)
    .runJob("job_1"),/cancelled or ownership/);
  assert.equal(cancelled.stats.privateCalls,0);
  assert.equal(cancelled.stats.writes,0);
});
