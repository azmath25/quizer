import test from "node:test";
import assert from "node:assert/strict";
import "../../functions/src/router.js";
import {createProd1LiveRuntime,createProd1TrustedWorkerInvoker}
  from "../../functions/src/prod1/live-factory.js";
import {SAT_QUIZ_NEON}
  from "../../functions/src/neon/sat-quiz-live-sql.js";
const db={doc(){return {async get(){return {exists:false};}};},
  collection(){return{};},
  async runTransaction(){throw Error("Unexpected Firestore I/O");}};
const connect="postgresql://quizer_app:synthetic@" +
  SAT_QUIZ_NEON.pooledHostname+"/quizer?sslmode=require";
const base={
  enabled:true,db,firebaseProjectId:"sat-quiz-fd317",
  connectionString:connect,
  cursorSecret:"sample-only-cursor-secret-for-prod1-tests",
  firebaseAuth:{async getUser(){return{
    emailVerified:true,disabled:false,displayName:"Teacher"};}},
  storageBucket:{name:"sat-quiz-fd317.firebasestorage.app",file(){}},
};
test("live prod1 factory defaults off without opening Firebase/Neon",async()=>{
  const r=await createProd1LiveRuntime();
  assert.equal(r.enabled,false);
  assert.deepEqual(await r.dispatch(),{disabled:true});
});
test("prod1 factory refuses Mimo and mismatched Firebase buckets",async()=>{
  await assert.rejects(createProd1LiveRuntime({
    ...base,firebaseProjectId:"mimo-backend-513412"}),
    /preflight not satisfied/);
  await assert.rejects(createProd1LiveRuntime({
    ...base,storageBucket:{name:"mimo-bucket",file(){}}}),
    /Expected SAT QUIZ Auth and Storage/);
});
test("live prod1 composition enforces trusted worker context",async()=>{
  const runtime=await createProd1LiveRuntime(base);
  assert.equal(runtime.enabled,true);
  await assert.rejects(runtime.runPrivateJob({
    firebaseProjectId:"mimo-backend-513412",
    trustedServerInvocation:true},{kind:"publishJob",jobId:"job_1"}),
    /Trusted PROD1 worker required/);
  await assert.rejects(runtime.dispatch(null,{
    apiVersion:2,action:"createProblem"}),
    /Sign in to continue/);
  await runtime.close();
});

test("trusted private worker delivers original job payload, never context as job",async()=>{
  const received=[];
  const invoke=createProd1TrustedWorkerInvoker({
    firebaseProjectId:"sat-quiz-fd317",
    privateRuntime:{async runPrivateJob(job){
      received.push(job);
      return {handled:job.kind};
    }},
  });
  const context={firebaseProjectId:"sat-quiz-fd317",
    trustedServerInvocation:true};
  const job=Object.freeze({kind:"publishJob",jobId:"job_1",
    leaseOwner:"lease_example_12345"});
  assert.deepEqual(await invoke(context,job),{handled:"publishJob"});
  assert.deepEqual(received,[job]);
  assert.equal(received[0].firebaseProjectId,undefined);
  await assert.rejects(invoke({firebaseProjectId:"mimo-backend-513412",
    trustedServerInvocation:true},job),/Trusted PROD1 worker required/);
  await assert.rejects(invoke(context,context),/Private job payload required/);
  assert.equal(received.length,1);
});
