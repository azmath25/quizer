import test from "node:test";
import assert from "node:assert/strict";
import {createProd1PublicationIdentityPort,createProd1PrivateRuntime}
  from "../../functions/src/prod1/private-runtime.js";
import {createProd1BankRuntime}
  from "../../functions/src/prod1/bank-runtime.js";
import {SAT_QUIZ_NEON}
  from "../../functions/src/neon/sat-quiz-live-sql.js";

const uid="teacher_1",auth={uid,token:{email_verified:true}};
const plan={jobId:"job_1",quizId:"quiz_1",revisionId:"pub_1",
  ownerId:uid,leaseOwner:"lease_1"};
const url="postgresql://quizer_app:synthetic@" +
  SAT_QUIZ_NEON.pooledHostname+"/quizer?sslmode=require";
function dbFor(){
  const data={
    "roles/"+uid:{role:"teacher",accountStatus:"active"},
    "users/"+uid:{displayName:"Teacher"},
    "jobs/job_1":{kind:"publish_quiz",status:"running",
      leaseOwner:"lease_1",targetId:"quiz_1",
      requestedBy:uid,input:{revisionId:"pub_1"}},
    "quizzes/quiz_1":{ownerId:uid,publishingJobId:"job_1"},
  };
  return {
    data,
    doc(path){return {path,async get(){return{
      exists:Object.hasOwn(data,path),data:()=>data[path]};}};},
    collection(){return{};},
    async runTransaction(){throw Error("No real Firebase writes");},
  };
}
test("prod1 publication actor requires the real persisted job and lease",async()=>{
  const db=dbFor();
  const lookup=createProd1PublicationIdentityPort({
    db,authFor:async()=>auth,
    resolveFirebaseActor:async()=>({
      uid,role:"teacher",emailVerified:true,accountStatus:"active"}),
  });
  const actor=await lookup({plan});
  assert.equal(actor.uid,uid);
  for(const change of [
    {...plan,leaseOwner:"wrong"},
    {...plan,revisionId:"other"},
    {...plan,ownerId:"other"},
  ]){
    await assert.rejects(lookup({plan:change}),/lease or ownership/);
  }
  db.data["jobs/job_1"].status="succeeded";
  await assert.rejects(lookup({plan}),/lease or ownership/);
});
test("prod1 publication actor fails closed on teacher revocation",async()=>{
  const db=dbFor();
  const lookup=createProd1PublicationIdentityPort({
    db,authFor:async()=>auth,
    resolveFirebaseActor:async()=>({
      uid,role:"student",emailVerified:true,accountStatus:"active"}),
  });
  await assert.rejects(lookup({plan}),/Teacher access required/);
});
test("prod1 private hybrid is inert until explicit trustworthy configuration",async()=>{
  const off=createProd1PrivateRuntime();
  assert.equal(off.enabled,false);
  assert.deepEqual(await off.handle("startAttempt"),{disabled:true});
  assert.throws(()=>createProd1PrivateRuntime({enabled:true}),
    /Trusted Firebase Admin\/bank ports required/);
});
test("prod1 fully staged gateway composes without live Firebase or SQL calls",async()=>{
  const db=dbFor();
  const legacy=async(_db,_a,r)=>({apiVersion:2,
    serverTime:"2026-11-04T00:00:00Z",data:{action:r.action,legacy:true}});
  const bank=createProd1BankRuntime({
    enabled:true,firebaseProjectId:"sat-quiz-fd317",db,
    connectionString:url,cursorSecret:"sandbox-test-cursor-secret-32-bytes",
    legacyDispatch:legacy,
  });
  const hybrid=createProd1PrivateRuntime({
    enabled:true,firebaseProjectId:"sat-quiz-fd317",db,
    bucket:{file(){}},authFor:async()=>auth,
    bankRuntime:bank,legacyDispatch:legacy,
    legacyActions:["getDashboard"],
  });
  assert.equal(hybrid.enabled,true);
  assert.equal(hybrid.actionCounts.import,1);
  const result=await hybrid.handle("getDashboard",auth,{
    apiVersion:2,action:"getDashboard"});
  assert.deepEqual(result,{action:"getDashboard",legacy:true});
  await assert.rejects(hybrid.runPrivateJob({kind:"unknown",jobId:"job_1"}),
    /Unknown staged private job kind/);
  await hybrid.close();
});
