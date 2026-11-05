// STG2.5: synthetic cross-store smoke with genuine FIRESTORE EMULATOR
// but deliberately FAKE Neon and private Storage services. Not live staging.
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {initializeApp,getApps}
  from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {getFirestore}
  from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import {createQuizerStg2StagingRuntime}
  from "../../functions/src/bundles/stg2-staging-composition.js";
import {dispatch}
  from "../../functions/src/router.js";

assert(process.env.FIRESTORE_EMULATOR_HOST,
  "STG2.5 must NEVER run against live Firestore");
if(!getApps().length)initializeApp({projectId:"demo-mathquiz-v2"});
const db=getFirestore();
const id=prefix=>prefix+randomUUID().replaceAll("-","_");
const permitted=reason=>e=>e?.reason===reason;
const meta={title:"Synthetic parity",subject:"Number theory",
  difficulty:"Practice",tags:[],bankVisibility:"private"};
const body={type:"choice",answerMode:"auto",
  statementLatex:"Is 1+1 even?",options:[
    {id:"a",textLatex:"No"},{id:"b",textLatex:"Yes"}],
  defaultPoints:2,questionAssetBindings:{}};
const grading={correctOptionId:"b",acceptedAnswers:[],
  tolerance:0,explanationLatex:"2 is even.",rubricLatex:"",
  solutionAssetBindings:{}};

async function fixture(){
  const teacher=id("teacher_"),student=id("student_");
  await db.doc("roles/"+teacher).set({
    role:"teacher",accountStatus:"active",version:1});
  await db.doc("roles/"+student).set({
    role:"student",accountStatus:"active",version:1});
  const people={
    teacher:{uid:teacher,token:{email_verified:true}},
    student:{uid:student,token:{email_verified:true}},
  };
  let sqlCalls=0,privateCalls=0,legacyCalls=0;
  let neonDown=false;
  const reader={
    async getProblemForTeacher({problemId}){
      if(neonDown)throw Error("Synthetic Neon connection refused");
      return {problemId,revisionId:"prv_demo"};
    },
    async listProblemHeaders(){return {items:[],next:null};},
    async listProblemRevisions(){return {items:[],next:null};},
  };
  const privateRuntime={
    enabled:true,
    async handle(action,auth,request){
      privateCalls++;
      if(action==="startAttempt"){
        assert.equal(auth.uid,student);
        return {attemptId:"att_synthetic",quizId:request.quizId};
      }
      throw Error("Unsupported synthetic private action");
    },
    async publishJob(){return {processed:true};},
    async gradeJobBatch(){return {processed:1};},
    async finalizeGradeJob(){return {finished:true};},
    async exportJob(){return {exported:true};},
  };
  const stagingPorts={
    db,neonReader:reader,
    neonGateway:{enabled:true,replaySafeEdits:true,
      async handle(action){
        sqlCalls++;
        assert.equal(action,"createProblem");
        if(neonDown)throw Error("Synthetic Neon connection refused");
        return {problemId:id("prb_"),revisionId:id("prv_"),version:1};
      }},
    bankMutations:{enabled:true,async mutate(){
      throw Error("Unexpected write mutation");
    }},
    async resolveFirebaseActor(auth){
      const doc=await db.doc("roles/"+auth.uid).get();
      const role=doc.exists?doc.data():null;
      return {uid:auth.uid,role:role?.role??"student",
        accountStatus:role?.accountStatus??"active",
        emailVerified:auth.token?.email_verified===true};
    },
    async resolveProblemOrigin(){return "neon_revision";},
    privateRuntime,
    async legacyHandle(action,auth,request){
      legacyCalls++;return dispatch(db,auth,request);
    },
    async legacyListHeaders(){return {items:[],next:null};},
    legacyActionNames:["getDashboard"],
    cursorSecret:"synthetic_only_cursor_not_a_real_key_123",
  };
  const bridge=createQuizerStg2StagingRuntime({
    enabled:true,stagingPorts,
    attestIdentity:async()=>({projectId:"quizer-staging-az26",
      serverVerified:true,runtimeKind:"firebase-functions-v2",
      appCheckPolicyReviewed:true,credentialsServerOnly:true}),
    authorizeWorker:async()=>true,
  });
  const call=(person,action,extra={},requestId=id("req_"))=>
    bridge.callable(people[person],{apiVersion:2,action,requestId,...extra});
  return {bridge,call,teacher,student,
    setNeonDown(v){neonDown=v;},
    get sqlCalls(){return sqlCalls;},
    get privateCalls(){return privateCalls;},
    get legacyCalls(){return legacyCalls;}};
}

test("STG2.5 teacher bank creation retries are durably fenced in Firestore",async()=>{
  const f=await fixture(),requestId=id("req_");
  const payload={metadata:meta,content:body,grading};
  const first=await f.call("teacher","createProblem",payload,requestId);
  const repeat=await f.call("teacher","createProblem",payload,requestId);
  assert.equal(first.data.problemId,repeat.data.problemId);
  assert.equal(f.sqlCalls,1);
  const receipt=await db.doc("operations/"+f.teacher+
    "/bankMutations/"+requestId).get();
  assert.equal(receipt.data().status,"complete");
  assert(!JSON.stringify(receipt.data()).includes("correctOptionId"));
  assert(!JSON.stringify(receipt.data()).includes("statementLatex"));
  await assert.rejects(f.call("teacher","createProblem",
    {...payload,metadata:{...meta,title:"Changed"}},requestId),
  permitted("VERSION_CONFLICT"));
  assert.equal(f.sqlCalls,1);
});

test("STG2.5 student cannot create/read teacher's bank problem",async()=>{
  const f=await fixture();
  await assert.rejects(f.call("student","createProblem",
    {metadata:meta,content:body,grading}),permitted("ROLE_REQUIRED"));
  await assert.rejects(f.call("student","getProblem",{problemId:"prb_1"}),
    permitted("ROLE_REQUIRED"));
  assert.equal(f.sqlCalls,0);
});

test("STG2.5 stage bridge routes student attempt and legacy dashboard",async()=>{
  const f=await fixture();
  const attempt=await f.call("student","startAttempt",{quizId:"quiz_demo"});
  assert.equal(attempt.data.attemptId,"att_synthetic");
  assert.equal(f.privateCalls,1);
  const dashboard=await f.call("teacher","getDashboard");
  assert.equal(dashboard.apiVersion,2);
  assert.equal(typeof dashboard.serverTime,"string");
  assert.equal(f.legacyCalls,1);
});

test("STG2.5 Neon outage does not replay as a legacy Firebase mutation",async()=>{
  const f=await fixture();
  f.setNeonDown(true);
  await assert.rejects(f.call("teacher","createProblem",
    {metadata:meta,content:body,grading}),
    /Synthetic Neon connection refused/);
  assert.equal(f.sqlCalls,1);
  assert.equal(f.legacyCalls,0);
});

test("STG2.5 job service boundary refuses untrusted invocation",async()=>{
  const f=await fixture();
  await assert.rejects(f.bridge.worker({
    firebaseProjectId:"sat-quiz-fd317",trustedServerInvocation:true,
  },{kind:"publishJob",jobId:"job_1"}),/unavailable/);
  const response=await f.bridge.worker({
    firebaseProjectId:"quizer-staging-az26",trustedServerInvocation:true,
  },{kind:"publishJob",jobId:"job_1"});
  assert.deepEqual(response,{processed:true});
});
