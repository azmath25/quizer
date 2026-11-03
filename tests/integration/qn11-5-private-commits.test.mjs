// QN11.5: Emulator-only Firestore CAS acceptance. Never use live credentials.
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {initializeApp,getApps} from "firebase-admin/app";
import {getFirestore,Timestamp} from "firebase-admin/firestore";
import {createFirestorePrivateAttemptCommits} from "../../functions/src/bundles/private-attempt-commits.js";
assert(process.env.FIRESTORE_EMULATOR_HOST,
  "QN11.5 tests must NEVER reach live Firestore");
if(!getApps().length)initializeApp({projectId:"demo-mathquiz-v2"});
const db=getFirestore();
const id=prefix=>prefix+randomUUID().replaceAll("-","_");
const requestId=()=>id("request_");
const settings={allowBack:false,penalty:0,scoreRelease:"immediate",
  solutionRelease:"manual",durationSeconds:1200};
const why=reason=>e=>e?.reason===reason;
async function seeded(){
  const uid=id("student_");
  const attemptId=id("att_"),quizId=id("quiz_"),jobId=id("job_");
  const actor={uid,token:{email_verified:true,email:"test@example.invalid"}};
  await db.doc("roles/"+uid).set({
    role:"student",accountStatus:"active",version:1});
  await db.doc("attempts/"+attemptId).set({
    studentId:uid,quizId,quizRevisionId:"qrv_bundle_new",
    quizOwnerId:"teacher_syn",status:"active",
    deadlineAt:Timestamp.fromMillis(Date.now()+300000),
    settingsSnapshot:settings,order:["itm_a","itm_b"],
    answerVersion:0,answeredCount:0,answeredItemIds:[],
    lastSavedAt:null,currentFrontier:0,
    uiState:{currentIndex:0,flaggedItemIds:[],version:0},
    gradeVersion:0,gradeState:"not_started",
  });
  return {uid,actor,attemptId,quizId,jobId,
    svc:createFirestorePrivateAttemptCommits({enabled:true,db})};
}
const proof=(attemptId,ids)=>({validated:true,attemptId,
  pinnedRevisionId:"qrv_bundle_new",itemIds:ids});
const change=(itemId,value="",expectedRevision=0)=>({
  itemId,value,expectedRevision});
test("QN11.5: disabled commit adapter has no Firebase side effects",async()=>{
  const adapter=createFirestorePrivateAttemptCommits();
  assert.deepEqual(await adapter.saveAnswers(),{disabled:true});
  assert.deepEqual(await adapter.navigate(),{disabled:true});
  assert.deepEqual(await adapter.gradeBatch(),{disabled:true});
});
test("QN11.5: answer save writes atomic answer history + receipt, replays after lost ACK",async()=>{
  const f=await seeded(),changes=[change("itm_a","4")],
    rid=requestId();
  const input={firebaseAuth:f.actor,attemptId:f.attemptId,
    expectedAnswerVersion:0,changes,proof:proof(f.attemptId,["itm_a"]),
    requestId:rid};
  const first=await f.svc.saveAnswers(input);
  assert.equal(first.answerVersion,1);
  assert.equal(first.answeredCount,1);
  assert.equal(first.confirmed[0].revision,1);
  assert.equal((await db.doc("attempts/"+f.attemptId).get()).data().answerVersion,1);
  const reread=await f.svc.saveAnswers(input);
  assert.deepEqual(reread,first);
  const ans=await db.doc("attempts/"+f.attemptId+"/answers/itm_a").get();
  assert.equal(ans.data().revision,1);
  const history=await db.doc(
    "attempts/"+f.attemptId+"/answers/itm_a/changes/00000001").get();
  assert.equal(history.data().value,"4");
  await assert.rejects(f.svc.saveAnswers({...input,
    changes:[change("itm_a","5")]}),why("INVALID_FIELDS"));
  await assert.rejects(f.svc.saveAnswers({...input,requestId:requestId()}),
    why("VERSION_CONFLICT"));
});
test("QN11.5: expired or revoked attempt is rejected after external preflight",async()=>{
  const f=await seeded();
  const input={firebaseAuth:f.actor,attemptId:f.attemptId,
    expectedAnswerVersion:0,changes:[change("itm_a","4")],
    proof:proof(f.attemptId,["itm_a"]),requestId:requestId()};
  await db.doc("roles/"+f.uid).set({role:"student",
    accountStatus:"disabled",version:2});
  await assert.rejects(f.svc.saveAnswers(input),why("ACCOUNT_DISABLED"));
  await db.doc("roles/"+f.uid).set({
    role:"student",accountStatus:"active",version:3});
  await db.doc("attempts/"+f.attemptId).update({
    deadlineAt:Timestamp.fromMillis(Date.now()-5000)});
  await assert.rejects(f.svc.saveAnswers(input),why("ATTEMPT_EXPIRED"));
  assert.equal((await db.doc("attempts/"+f.attemptId+"/answers/itm_a").get()).exists,false);
});
test("QN11.5: no-back navigation only advances one step and replays receipt",async()=>{
  const f=await seeded(),rid=requestId();
  const navProof={attemptId:f.attemptId,
    pinnedRevisionId:"qrv_bundle_new",expectedFrontier:0,
    expectedUiVersion:0,targetIndex:1,item:{itemId:"itm_b",
      statementLatex:"Public question",options:[]}};
  const input={firebaseAuth:f.actor,attemptId:f.attemptId,
    targetIndex:1,proof:navProof,requestId:rid};
  const first=await f.svc.navigate(input);
  assert.equal(first.currentFrontier,1);
  assert.equal(first.uiState.version,1);
  assert.deepEqual(await f.svc.navigate(input),first);
  assert.equal((await db.doc("attempts/"+f.attemptId).get()).data().uiState.version,1);
  await assert.rejects(f.svc.navigate({...input,requestId:requestId()}),
    why("VERSION_CONFLICT"));
  await assert.rejects(f.svc.navigate({...input,targetIndex:0,
    requestId:requestId(),
    proof:{...navProof,targetIndex:0,item:{itemId:"itm_a"},
      expectedFrontier:1,expectedUiVersion:1}}),
    why("RESOURCE_UNAVAILABLE"));
});
test("QN11.5: grade batch verifies frozen revision, lease, ordered progress and once-only writes",async()=>{
  const f=await seeded();
  await db.doc("attempts/"+f.attemptId).update({
    status:"submitted",gradeState:"running"});
  await db.doc("jobs/"+f.jobId).set({
    kind:"grade_attempt",targetId:f.attemptId,status:"running",
    leaseOwner:"worker_1",
    leaseExpiresAt:Timestamp.fromMillis(Date.now()+300000),
    progress:{processed:0,total:2,stage:"Grading"}});
  const row=i=>({itemId:i,status:"correct",awarded:2,possible:2,
    gradedBy:"system",gradingVersion:1,
    feedbackLatex:"",version:1});
  const plan1={jobId:f.jobId,attemptId:f.attemptId,
    pinnedRevisionId:"qrv_bundle_new",leaseOwner:"worker_1",
    grades:[row("itm_a")]};
  assert.equal((await f.svc.gradeBatch({
    jobId:f.jobId,attemptId:f.attemptId,proof:plan1})).processed,1);
  await assert.rejects(f.svc.gradeBatch({
    jobId:f.jobId,attemptId:f.attemptId,proof:plan1}),why("VERSION_CONFLICT"));
  const plan2={...plan1,grades:[row("itm_b")]};
  assert.equal((await f.svc.gradeBatch({
    jobId:f.jobId,attemptId:f.attemptId,proof:plan2})).processed,2);
  assert.equal((await db.doc("jobs/"+f.jobId).get()).data().progress.processed,2);
  assert.equal((await db.doc("attempts/"+f.attemptId).get()).data().gradeVersion,0,
    "Finalization is separate; staging must not declare grading final.");
});
test("QN11.5: stale grading lease, pinned revision or active attempt blocks grade writes",async()=>{
  const f=await seeded();
  await db.doc("jobs/"+f.jobId).set({
    kind:"grade_attempt",targetId:f.attemptId,status:"running",
    leaseOwner:"worker_2",
    leaseExpiresAt:Timestamp.fromMillis(Date.now()+300000),
    progress:{processed:0,total:2}});
  const plan={jobId:f.jobId,attemptId:f.attemptId,
    pinnedRevisionId:"qrv_bundle_new",leaseOwner:"worker_1",
    grades:[{itemId:"itm_a",status:"correct",
      awarded:2,possible:2,gradedBy:"system",gradingVersion:1,version:1}]};
  await assert.rejects(f.svc.gradeBatch({
    jobId:f.jobId,attemptId:f.attemptId,proof:plan}),why("JOB_LEASE"));
  await db.doc("jobs/"+f.jobId).update({leaseOwner:"worker_1"});
  await assert.rejects(f.svc.gradeBatch({
    jobId:f.jobId,attemptId:f.attemptId,proof:plan}),
    why("VERSION_CONFLICT"));
  assert.equal((await db.doc("attempts/"+f.attemptId+"/grades/itm_a").get()).exists,false);
});
