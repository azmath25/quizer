import test from "node:test";
import assert from "node:assert/strict";
import {createProd1FirebaseBankPorts}
  from "../../functions/src/prod1/firebase-bank-ports.js";
import {createProd1BankRuntime}
  from "../../functions/src/prod1/bank-runtime.js";
import {SAT_QUIZ_NEON}
  from "../../functions/src/neon/sat-quiz-live-sql.js";

const auth=Object.freeze({uid:"teacher_1",token:{
  email_verified:true,name:"Teacher"}});
const connect="postgresql://quizer_app:synthetic@" +
  SAT_QUIZ_NEON.pooledHostname +
  "/quizer?sslmode=require&channel_binding=require";
const cursorSecret="a-prod1-only-test-key-at-least-32-chars";
function createDb(sets={}){
  const queries=[];
  let records={...sets};
  const query={
    where(...args){queries.push(["where",...args]);return this;},
    orderBy(...args){queries.push(["orderBy",...args]);return this;},
    startAfter(...args){queries.push(["startAfter",...args]);return this;},
    limit(n){queries.push(["limit",n]);return this;},
    async get(){return {docs:[]};},
  };
  return {
    records,queries,
    doc(path){return {path,async get(){return{
      exists:Object.hasOwn(records,path),
      data:()=>records[path],
    };}};},
    collection(path){queries.push(["collection",path]);return query;},
    async runTransaction(fn){throw Error("No writes allowed in this test");},
  };
}
function teacherDb(){
  return createDb({
    "roles/teacher_1":{role:"teacher",accountStatus:"active",version:4},
    "users/teacher_1":{displayName:"Instructor"},
    "problems/old_1":{ownerId:"teacher_1"},
    "assets/img_1":{ownerId:"teacher_1",kind:"image",status:"ready"},
    "assets/img_other":{ownerId:"other",kind:"image",status:"ready"},
    "assets/queued":{ownerId:"teacher_1",kind:"source",status:"processing"},
    "jobs/job_1":{kind:"import",status:"running",requestedBy:"teacher_1",
      input:{itemCount:2,sourceAssetId:null}},
  });
}
const dispatch=async(_db,_auth,r)=>({apiVersion:2,
  serverTime:"2026-11-04T00:00:00.000Z",
  data:{legacy:true,action:r.action}});

test("default-off Prod1 bank is inert and never requests secrets",async()=>{
  const x=createProd1BankRuntime({enabled:false});
  assert.equal(x.enabled,false);
  assert.deepEqual(await x.handle("createProblem",auth,{}),{disabled:true});
  await x.close();
});
test("rejects wrong Firebase project and missing signed cursor key",()=>{
  for(const project of ["mimo-backend-513412","quizer-staging-az26",""]){
    assert.throws(()=>createProd1BankRuntime({
      enabled:true,firebaseProjectId:project,db:teacherDb(),
      connectionString:connect,cursorSecret,legacyDispatch:dispatch,
    }),/project and private bank cursor key/);
  }
  assert.throws(()=>createProd1BankRuntime({
    enabled:true,firebaseProjectId:SAT_QUIZ_NEON.firebaseProject,
    db:teacherDb(),connectionString:connect,cursorSecret:"short",
    legacyDispatch:dispatch,
  }),/project and private bank cursor key/);
});
test("Firebase actor and asset policies ignore caller-provided roles",async()=>{
  const db=teacherDb();
  const p=createProd1FirebaseBankPorts({
    enabled:true,db,legacyDispatch:dispatch});
  const actor=await p.resolveFirebaseActor({...auth,role:"admin"});
  assert.equal(actor.role,"teacher");
  assert.equal(actor.emailVerified,true);
  assert.equal(actor.displayName,"Instructor");
  assert.equal(actor.roleVersion,4);
  assert.equal(await p.verifyAssets({actor,assetIds:["img_1"]}),true);
  await assert.rejects(p.verifyAssets({actor,assetIds:["img_other"]}),
    /not authorized/);
  await assert.rejects(p.verifyAssets({actor,assetIds:["queued"]}),
    /not authorized/);
  await assert.rejects(p.verifyAssets({actor,assetIds:["missing"]}),
    /not authorized/);
  await assert.rejects(p.verifyAssets({actor,
    assetIds:Array.from({length:201},()=> "img_1")}),/Too many/);
  const student=await p.resolveFirebaseActor({
    uid:"teacher_1",token:{email_verified:false}});
  await assert.rejects(p.verifyAssets({actor:student,assetIds:[]}),
    /Verify your email/);
});
test("unknown IDs cannot be silently migrated into legacy writes",async()=>{
  const p=createProd1FirebaseBankPorts({
    enabled:true,db:teacherDb(),legacyDispatch:dispatch});
  const actor=await p.resolveFirebaseActor(auth);
  assert.equal(await p.resolveProblemOrigin({actor,problemId:"old_1"}),
    "firestore_legacy");
  assert.equal(await p.resolveProblemOrigin({actor,problemId:"new_1"}),
    "neon_revision");
  const job=await p.readFirebaseImportJob({actor,jobId:"job_1"});
  assert.equal(job.kind,"import");
  await assert.rejects(p.readFirebaseImportJob({actor,jobId:"unknown"}),
    /Import job unavailable/);
});
test("legacy bank listing uses keyset cursor and server-only safe headers",async()=>{
  const db=teacherDb();
  const p=createProd1FirebaseBankPorts({
    enabled:true,db,legacyDispatch:dispatch});
  const actor=await p.resolveFirebaseActor(auth);
  const out=await p.legacyListHeaders({
    actor,view:"mine",lifecycle:"active",limit:31,
    after:{problemId:"p_1",updatedAt:"2026-11-03T01:00:00.000Z"},
  });
  assert.deepEqual(out,{items:[]});
  assert(db.queries.some(x=>x[0]==="where"&&x[1]==="ownerId"&&
    x[3]==="teacher_1"));
  assert(db.queries.some(x=>x[0]==="orderBy"&&x[1]==="__name__"));
  assert(db.queries.some(x=>x[0]==="startAfter"&&
    x[2]==="p_1"));
});
test("teacher-only legacy problem routing works without SQL queries",async()=>{
  const db=teacherDb();
  const runtime=createProd1BankRuntime({
    enabled:true,firebaseProjectId:SAT_QUIZ_NEON.firebaseProject,
    db,connectionString:connect,cursorSecret,legacyDispatch:dispatch,
  });
  assert.equal(runtime.enabled,true);
  const out=await runtime.handle("getProblem",auth,{
    apiVersion:2,action:"getProblem",problemId:"old_1",
  });
  assert.deepEqual(out,{legacy:true,action:"getProblem"});
  for(const action of ["publishQuiz","getQuizDraft","startAttempt"]){
    await assert.rejects(runtime.handle(action,auth,{
      apiVersion:2,action}),/Prod1 bank does not own/);
  }
  await runtime.close();
});
