import test from "node:test";
import assert from "node:assert/strict";
import {createProd1EntrypointBridge, PROD1_PROJECT}
  from "../../functions/src/prod1/entrypoint-switch.js";

// The browser submits with the v2 callable envelope. Submission remains
// on the legacy atomic Firestore freeze route even for private-bundle quizzes;
// the worker routes the resulting grading job by persisted revision provenance.
test("QN-PROD.2 submission uses one legacy freeze with idempotent replay",async()=>{
  const receipts=new Map();
  let legacyCalls=0,hybridCalls=0,secretReads=0;
  const db={doc(){return {async get(){return {exists:false};}}}};
  const bridge=createProd1EntrypointBridge({
    enabled:true,db,
    environment:{GCLOUD_PROJECT:PROD1_PROJECT},
    legacyDispatch:async(_db,actor,request)=>{
      legacyCalls++;
      assert.equal(actor.uid,"student_test");
      assert.equal(request.action,"submitAttempt");
      assert.match(request.requestId,/^[a-z0-9-]{16,100}$/);
      if(!receipts.has(request.requestId))
        receipts.set(request.requestId,{attemptId:request.attemptId,
          status:"submitted",jobId:"job_once"});
      return {apiVersion:2,serverTime:"2026-11-05T00:00:00.000Z",
        data:receipts.get(request.requestId)};
    },
    legacyRunJob:async()=>{throw Error("Unexpected job");},
    runtimeFactory:async()=>({
      dispatch:async()=>{hybridCalls++;throw Error("Unexpected hybrid submit");},
      createWorker:()=>({runJob:async()=>true}),
    }),
    readSecrets:async()=>{secretReads++;return {
      databaseUrl:"postgresql://synthetic",cursorKey:"x".repeat(32)};},
  });
  const request={apiVersion:2,action:"submitAttempt",
    requestId:"12345678-1234-4234-8234-123456789abc",attemptId:"att_test"};
  const first=await bridge.dispatch({uid:"student_test"},request);
  const replay=await bridge.dispatch({uid:"student_test"},{...request});
  assert.deepEqual(first,replay);
  assert.equal(first.data.jobId,"job_once");
  assert.equal(legacyCalls,2);
  assert.equal(hybridCalls,0);
  assert.equal(secretReads,0,"Submission must not initialize Neon");
});

test("QN-PROD.2 results and answer-save routes remain hybrid when enabled",async()=>{
  let legacy=0,hybrid=0;
  const bridge=createProd1EntrypointBridge({
    enabled:true,db:{doc(){return {async get(){return {exists:false};}}}},
    environment:{GCLOUD_PROJECT:PROD1_PROJECT},
    legacyDispatch:async()=>{legacy++;return {legacy:true};},
    legacyRunJob:async()=>true,
    runtimeFactory:async()=>({
      dispatch:async(_auth,request)=>{
        hybrid++;return {hybrid:true,action:request.action};},
      createWorker:()=>({runJob:async()=>true}),
    }),
    readSecrets:async()=>({databaseUrl:"postgresql://synthetic",
      cursorKey:"x".repeat(32)}),
  });
  for(const action of ["getAttemptResult","getAttemptQuestions","saveAnswers",
    "navigateAttempt"]){
    const result=await bridge.dispatch({uid:"student_test"},{
      apiVersion:2,action,requestId:"12345678-1234-4234-8234-123456789abc",
      attemptId:"att_test"});
    assert.equal(result.action,action);
  }
  assert.equal(hybrid,4);
  assert.equal(legacy,0);
});
