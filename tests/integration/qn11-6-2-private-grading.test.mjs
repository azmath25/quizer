// QN11.6.2 — demo-Firebase-only grade completion, manual marks & release.
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {initializeApp,getApps} from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {getFirestore,Timestamp} from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import {fingerprint} from "../../functions/src/neon/write-repository.js";
import {createFirestorePrivateGradeFinalization} from "../../functions/src/bundles/private-grade-finalization.js";
assert(process.env.FIRESTORE_EMULATOR_HOST,
  "QN11.6.2 must never use live Firestore");
if(!getApps().length) initializeApp({projectId:"demo-mathquiz-v2"});
const db=getFirestore();
const uid=p=>p+randomUUID().replaceAll("-","_");
const error=reason=>e=>e?.reason===reason;
const settings={durationSeconds:1200,allowBack:false,penalty:0,
  scoreRelease:"manual",solutionRelease:"manual"};
const score=(overrides={})=>({
  score:0,possible:5,percentage:0,correct:0,incorrect:0,
  pending:0,skipped:0,partial:0,...overrides,
});
async function fixture({pending=true,kind="standard",
  gradeState="running",solutionPolicy="manual"}={}){
  const teacher=uid("teacher_"),student=uid("student_"),
    quizId=uid("quiz_"),attemptId=uid("att_"),jobId=uid("job_");
  const now=Timestamp.now();
  const teacherAuth={uid:teacher,token:{email_verified:true,
    email:teacher+"@example.invalid"}};
  const studentAuth={uid:student,token:{email_verified:true}};
  await Promise.all([
    db.doc("roles/"+teacher).set({role:"teacher",accountStatus:"active",version:1}),
    db.doc("roles/"+student).set({role:"student",accountStatus:"active",version:1}),
    db.doc("quizzes/"+quizId).set({schemaVersion:2,ownerId:teacher,
      lifecycle:"active",title:"Private Exam",publishedRevisionId:"qrv_new"}),
  ]);
  const a={studentId:student,studentDisplayName:"Student",
    studentEmail:student+"@example.invalid",
    quizId,quizOwnerId:teacher,quizRevisionId:"qrv_new",
    quizTitle:"Private Exam",attemptKind:kind,
    status:"submitted",gradeState,gradeVersion:0,
    gradingJobId:jobId,order:["itm_a","itm_b"],
    settingsSnapshot:{...settings,solutionRelease:solutionPolicy},
    submittedAt:now,startedAt:now,finalizedAt:null,
    scoreReleasedAt:null,solutionsReleasedAt:null,
    totals:score(),provenance:"server_v2"};
  const grades=[
    {itemId:"itm_a",status:"correct",awarded:3,possible:3,
      gradedBy:"system",gradingVersion:1,version:1,
      manualPoints:null,feedbackLatex:""},
    {itemId:"itm_b",status:pending?"pending":"incorrect",
      awarded:0,possible:2,gradedBy:"system",
      gradingVersion:1,version:1,manualPoints:null,
      feedbackLatex:""},
  ];
  await Promise.all([
    db.doc("attempts/"+attemptId).set(a),
    db.doc("jobs/"+jobId).set({kind:"grade_attempt",targetId:attemptId,
      status:"running",leaseOwner:"worker_good",
      leaseExpiresAt:Timestamp.fromMillis(Date.now()+240000),
      progress:{processed:2,total:2,stage:"Grading"},
      retryCount:1,requestId:"job_request"}),
    ...grades.map(g=>db.doc("attempts/"+attemptId+"/grades/"+g.itemId).set(g)),
    db.doc("attempts/"+attemptId+"/answers/itm_b").set({
      value:"Reasoned answer",revision:1,updatedAt:now}),
  ]);
  if(kind==="standard")await db.doc(
    "quizzes/"+quizId+"/statistics/qrv_new").set({
      attempts:1,active:0,completed:1,pending:0,finalCount:0,
      scoreSum:0,percentageSum:0,uniqueParticipants:1,
    });
  const api=createFirestorePrivateGradeFinalization({enabled:true,db});
  const fetchAttempt=async()=>(await db.doc("attempts/"+attemptId).get()).data();
  const fetchJob=async()=>(await db.doc("jobs/"+jobId).get()).data();
  const alerts=async who=>(await db.collection(
    "users/"+who+"/notifications").get()).docs;
  const release=(opts={})=>api.releaseResults({
    firebaseAuth:teacherAuth,quizId,attemptIds:[attemptId],
    score:true,solutions:false,requestId:uid("req_"),...opts});
  return {teacher,student,quizId,attemptId,jobId,teacherAuth,studentAuth,
    api,a,grades,fetchAttempt,fetchJob,alerts,release};
}
function manualProof(f,points=2,feedback="Careful work",reason=""){
  const old=f.grades[1];
  return {verifiedManual:true,attemptId:f.attemptId,itemId:"itm_b",
    pinnedRevisionId:"qrv_new",expectedGradeVersion:1,
    points,feedback,reason,
    grade:{status:points===2?"correct":points===0?"incorrect":"partial",
      awarded:points,possible:2,manualPoints:points,gradedBy:f.teacher,
      gradingVersion:1,feedbackLatex:feedback},
    answerHash:fingerprint("Reasoned answer"),
    oldGradeVersion:old.version,
    oldGradeHash:fingerprint({status:old.status,awarded:old.awarded,
      possible:old.possible,manualPoints:null,version:old.version})};
}
test("QN11.6.2 disabled finalizer does not access Firebase",async()=>{
  const off=createFirestorePrivateGradeFinalization();
  assert.deepEqual(await off.finalizeGradeJob(),{disabled:true});
  assert.deepEqual(await off.saveManualGrade(),{disabled:true});
  assert.deepEqual(await off.releaseResults(),{disabled:true});
});
test("QN11.6.2 finalization totals pending, stats and notifications commit once",async()=>{
  const f=await fixture();
  const args={jobId:f.jobId,attemptId:f.attemptId,leaseOwner:"worker_good"};
  const first=await f.api.finalizeGradeJob(args);
  assert.deepEqual(first,{attemptId:f.attemptId});
  const a=await f.fetchAttempt(),j=await f.fetchJob();
  assert.equal(a.gradeVersion,1);
  assert.equal(a.gradeState,"pending_manual");
  assert.equal(a.totals.score,3);
  assert.equal(a.totals.possible,5);
  assert.equal(a.totals.pending,1);
  assert.equal(j.status,"succeeded");
  assert.equal(j.leaseOwner,null);
  assert.equal(j.progress.stage,"Complete");
  assert.equal((await f.alerts(f.teacher)).length,1);
  assert.equal((await f.alerts(f.student)).length,1);
  const stats=(await db.doc("quizzes/"+f.quizId+"/statistics/qrv_new").get()).data();
  assert.equal(stats.pending,1);
  assert.equal(stats.finalCount,0);
  assert.deepEqual(await f.api.finalizeGradeJob(args),first);
  assert.equal((await f.alerts(f.student)).length,1);
});
test("QN11.6.2 all-automatic finalization releases immediate scores but respects never solutions",async()=>{
  const f=await fixture({pending:false,solutionPolicy:"never"});
  await db.doc("attempts/"+f.attemptId).update({
    settingsSnapshot:{...settings,scoreRelease:"immediate",
      solutionRelease:"never"}});
  await f.api.finalizeGradeJob({jobId:f.jobId,attemptId:f.attemptId,
    leaseOwner:"worker_good"});
  const a=await f.fetchAttempt();
  assert.equal(a.gradeState,"final");
  assert.equal(a.totals.incorrect,1);
  const stat=(await db.doc("quizzes/"+f.quizId+"/statistics/qrv_new").get()).data();
  assert.equal(stat.finalCount,1);
  await assert.rejects(f.release({solutions:true}),error("INVALID_FIELDS"));
  assert.equal((await f.fetchAttempt()).solutionsReleasedAt,null);
});
test("QN11.6.2 missing grade or premature progress rolls back entire finish",async()=>{
  const f=await fixture();
  await db.doc("attempts/"+f.attemptId+"/grades/itm_b").delete();
  await assert.rejects(f.api.finalizeGradeJob({
    jobId:f.jobId,attemptId:f.attemptId,leaseOwner:"worker_good"}),
    error("FAILED_PRECONDITION"));
  assert.equal((await f.fetchAttempt()).gradeVersion,0);
  assert.equal((await f.fetchJob()).status,"running");
  assert.equal((await f.alerts(f.student)).length,0);
  await db.doc("jobs/"+f.jobId).update({"progress.processed":1});
  await assert.rejects(f.api.finalizeGradeJob({
    jobId:f.jobId,attemptId:f.attemptId,leaseOwner:"worker_good"}),
    error("VERSION_CONFLICT"));
});
test("QN11.6.2 wrong/expired lease or active attempt blocks completion",async()=>{
  const f=await fixture();
  await assert.rejects(f.api.finalizeGradeJob({
    jobId:f.jobId,attemptId:f.attemptId,leaseOwner:"worker_bad"}),
    error("JOB_LEASE"));
  await db.doc("jobs/"+f.jobId).update({
    leaseExpiresAt:Timestamp.fromMillis(Date.now()-1000)});
  await assert.rejects(f.api.finalizeGradeJob({
    jobId:f.jobId,attemptId:f.attemptId,leaseOwner:"worker_good"}),
    error("JOB_LEASE"));
  await db.doc("jobs/"+f.jobId).update({
    leaseExpiresAt:Timestamp.fromMillis(Date.now()+120000)});
  await db.doc("attempts/"+f.attemptId).update({status:"active"});
  await assert.rejects(f.api.finalizeGradeJob({
    jobId:f.jobId,attemptId:f.attemptId,leaseOwner:"worker_good"}),
    error("FAILED_PRECONDITION"));
  assert.equal((await f.alerts(f.student)).length,0);
});
test("QN11.6.2 manual mark finalizes remaining question and updates statistics",async()=>{
  const f=await fixture();
  await f.api.finalizeGradeJob({jobId:f.jobId,attemptId:f.attemptId,
    leaseOwner:"worker_good"});
  const req=uid("req_"),proof=manualProof(f);
  const input={firebaseAuth:f.teacherAuth,attemptId:f.attemptId,
    itemId:"itm_b",points:2,feedback:"Careful work",reason:"",
    expectedGradeVersion:1,proof,requestId:req};
  const first=await f.api.saveManualGrade(input);
  assert.equal(first.gradeVersion,2);
  assert.equal(first.grade.status,"correct");
  assert.equal(first.totals.score,5);
  assert.equal(first.totals.pending,0);
  assert.equal((await f.fetchAttempt()).gradeState,"final");
  assert.equal((await db.doc(
    "quizzes/"+f.quizId+"/statistics/qrv_new").get()).data().finalCount,1);
  assert.equal((await db.collection("attempts/"+f.attemptId+"/gradeEvents").get()).size,1);
  assert.equal((await f.alerts(f.student)).length,2);
  const same=await f.api.saveManualGrade(input);
  assert.deepEqual(same,first);
  assert.equal((await f.alerts(f.student)).length,2);
});
test("QN11.6.2 stale grade CAS, changed answer and student grading are rejected",async()=>{
  const f=await fixture();
  await f.api.finalizeGradeJob({jobId:f.jobId,attemptId:f.attemptId,
    leaseOwner:"worker_good"});
  const input={firebaseAuth:f.teacherAuth,attemptId:f.attemptId,
    itemId:"itm_b",points:2,feedback:"Careful work",reason:"",
    expectedGradeVersion:1,proof:manualProof(f),requestId:uid("req_")};
  await db.doc("attempts/"+f.attemptId+"/answers/itm_b").update({
    value:"Modified answer"});
  await assert.rejects(f.api.saveManualGrade(input),error("VERSION_CONFLICT"));
  await db.doc("attempts/"+f.attemptId+"/answers/itm_b").update({
    value:"Reasoned answer"});
  // A student with someone else's trusted server proof is denied even
  // before the teacher-only Firebase transaction.
  await assert.rejects(f.api.saveManualGrade({...input,
    firebaseAuth:f.studentAuth}),error("FAILED_PRECONDITION"));
  await f.api.saveManualGrade(input);
  await assert.rejects(f.api.saveManualGrade({...input,
    requestId:uid("req_")}),error("VERSION_CONFLICT"));
});
test("QN11.6.2 teacher correction requires reason; disabled teacher denied",async()=>{
  const f=await fixture();
  await f.api.finalizeGradeJob({jobId:f.jobId,attemptId:f.attemptId,
    leaseOwner:"worker_good"});
  const first={firebaseAuth:f.teacherAuth,attemptId:f.attemptId,
    itemId:"itm_b",points:2,feedback:"Careful work",reason:"",
    expectedGradeVersion:1,proof:manualProof(f),requestId:uid("req_")};
  await f.api.saveManualGrade(first);
  const old=(await db.doc("attempts/"+f.attemptId+"/grades/itm_b").get()).data();
  const correction={...first,expectedGradeVersion:2,points:1,
    proof:{...first.proof,expectedGradeVersion:2,points:1,
      grade:{...first.proof.grade,manualPoints:1,awarded:1,
        status:"partial"},oldGradeVersion:2,
      oldGradeHash:fingerprint({status:old.status,awarded:old.awarded,
        possible:old.possible,manualPoints:old.manualPoints,version:old.version})},
    requestId:uid("req_")};
  await assert.rejects(f.api.saveManualGrade(correction),error("INVALID_FIELDS"));
  await db.doc("roles/"+f.teacher).update({accountStatus:"disabled"});
  await assert.rejects(f.api.saveManualGrade({...correction,
    reason:"Reviewer correction",proof:{...correction.proof,
      reason:"Reviewer correction"}}),error("ACCOUNT_DISABLED"));
});
test("QN11.6.2 manual release is protected and not duplicated on retries",async()=>{
  const f=await fixture({pending:false});
  await f.api.finalizeGradeJob({jobId:f.jobId,attemptId:f.attemptId,
    leaseOwner:"worker_good"});
  const req=uid("req_"),first=await f.release({requestId:req,
    score:true,solutions:true});
  assert.deepEqual(first,{released:1});
  assert((await f.fetchAttempt()).scoreReleasedAt);
  assert((await f.fetchAttempt()).solutionsReleasedAt);
  assert.equal((await f.alerts(f.student)).length,2);
  assert.deepEqual(await f.release({requestId:req,score:true,
    solutions:true}),first);
  assert.equal((await f.alerts(f.student)).length,2);
  await assert.rejects(f.release({firebaseAuth:f.studentAuth}),
    error("ROLE_REQUIRED"));
});
test("QN11.6.2 cannot release pending grading or mixed quiz groups",async()=>{
  const f=await fixture();
  await f.api.finalizeGradeJob({jobId:f.jobId,attemptId:f.attemptId,
    leaseOwner:"worker_good"});
  await assert.rejects(f.release(),error("RESOURCE_UNAVAILABLE"));
  const other=uid("att_wrong_");
  await db.doc("attempts/"+other).set({
    quizId:"quiz_other",quizOwnerId:f.teacher,
    status:"submitted",gradeState:"final",gradeVersion:1,
    settingsSnapshot:settings,studentId:f.student});
  await assert.rejects(f.release({
    attemptIds:[f.attemptId,other],score:true}),
    error("RESOURCE_UNAVAILABLE"));
  assert.equal((await f.fetchAttempt()).scoreReleasedAt,null);
});
test("QN11.6.2 retry-incorrect grades never inflate regular revision statistics",async()=>{
  const f=await fixture({kind:"retry_incorrect",pending:false});
  await f.api.finalizeGradeJob({jobId:f.jobId,attemptId:f.attemptId,
    leaseOwner:"worker_good"});
  assert.equal((await db.doc(
    "quizzes/"+f.quizId+"/statistics/qrv_new").get()).exists,false);
});
