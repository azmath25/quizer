import test from "node:test";
import assert from "node:assert/strict";
import {createSecureBundleAttemptService} from "../../functions/src/bundles/secure-attempt-service.js";
import {preparePublishedBundle,makePublishedBundleManifest,
  BUNDLE_FORMAT,BUNDLE_CONTENT_TYPE} from "../../functions/src/bundles/published-bundle.js";
const teacher={uid:"teacher_1",role:"teacher",
  accountStatus:"active",emailVerified:true};
const student={uid:"student_1",role:"student",
  accountStatus:"active",emailVerified:true};
const grading={correctOptionId:null,acceptedAnswers:[],tolerance:0,
  explanationLatex:"SECRET_solution",rubricLatex:"SECRET_rubric",
  solutionAssetBindings:{}};
const item={itemId:"itm_1",problemId:"prb_1",problemRevisionId:"prv_1",
  points:2,content:{type:"open",answerMode:"manual",
    statementLatex:"Prove the statement.",options:[],defaultPoints:2,
    questionAssetBindings:{}},grading};
const settings={durationSeconds:1200,shuffleQuestions:false,
  shuffleOptions:false,allowBack:true,penalty:0,
  scoreRelease:"manual",solutionRelease:"never"};
const now=new Date("2026-11-04T12:00:00Z");
function fixture({answer="A complete proof",mode="manual",status="pending_manual",
  oldManual=null}={}){
  let reads=0;
  const chosen={...item,content:{...item.content,answerMode:mode}};
  const b=preparePublishedBundle({format:BUNDLE_FORMAT,quizId:"quiz_1",
    revisionId:"qrv_1",revisionNumber:1,title:"Quiz",
    description:"",subject:"Math",difficulty:"",settings,
    itemOrder:["itm_1"],itemCount:1,totalPoints:2,items:[chosen]});
  const manifest=makePublishedBundleManifest(b,"180");
  const a={studentId:student.uid,quizOwnerId:teacher.uid,
    quizId:"quiz_1",quizRevisionId:"qrv_1",order:["itm_1"],
    gradeVersion:1,gradeState:status,status:"submitted",
    settingsSnapshot:settings,currentFrontier:0};
  let enabled=true;
  const svc=createSecureBundleAttemptService({enabled:true,
    async resolveFirebaseActor(auth){
      return auth===teacher.uid ? enabled?teacher:{...teacher,accountStatus:"disabled"}:
        student;
    },
    loadAttempt:async()=>a,
    loadRevision:async()=>({state:"ready",itemOrder:["itm_1"],bundle:manifest}),
    readPrivateObject:async({generation})=>{
      reads++;return {bytes:b.bytes,generation,contentType:BUNDLE_CONTENT_TYPE};},
    loadLegacyItem:async()=>{throw Error("Legacy read forbidden");},
    loadLegacyGrading:async()=>{throw Error("Legacy grading forbidden");},
    loadAnswer:async()=>({value:answer,revision:1}),
    loadGrade:async()=>({status:oldManual===null?"pending":"partial",
      awarded:oldManual??0,possible:2,manualPoints:oldManual,
      gradingVersion:1,version:oldManual===null?1:2}),
    authorizeGradeJob:async()=>null,serverNow:()=>now,
  });
  return {svc,attempt:a,disable:()=>{enabled=false;},
    get reads(){return reads}};
}
const denied=reason=>e=>e?.reason===reason;
test("QN11.6.2 manual preflight computes rubric privately; no key leaves service",async()=>{
  const f=fixture();
  const proof=await f.svc.previewManualGrade({
    firebaseAuth:teacher.uid,attemptId:"att_1",itemId:"itm_1",
    points:1,feedback:"Good effort",reason:"",
    expectedGradeVersion:1});
  assert.equal(proof.verifiedManual,true);
  assert.equal(proof.grade.status,"partial");
  assert.equal(proof.grade.awarded,1);
  assert.equal(proof.grade.possible,2);
  assert.equal(proof.pinnedRevisionId,"qrv_1");
  assert.match(proof.answerHash,/^[0-9a-f]{64}$/);
  assert(!JSON.stringify(proof).includes("SECRET_rubric"));
  assert(!JSON.stringify(proof).includes("SECRET_solution"));
  assert(!JSON.stringify(proof).includes("A complete proof"));
  assert.equal(f.reads,1);
});
test("QN11.6.2 manual preflight rejects students, revoked staff and automatic questions",async()=>{
  const f=fixture();
  await assert.rejects(f.svc.previewManualGrade({
    firebaseAuth:student.uid,attemptId:"att_1",itemId:"itm_1",
    points:1,expectedGradeVersion:1}),denied("RESOURCE_UNAVAILABLE"));
  assert.equal(f.reads,0);
  f.disable();
  await assert.rejects(f.svc.previewManualGrade({
    firebaseAuth:teacher.uid,attemptId:"att_1",itemId:"itm_1",
    points:1,expectedGradeVersion:1}),denied("ACCOUNT_DISABLED"));
  const auto=fixture({mode:"auto"});
  await assert.rejects(auto.svc.previewManualGrade({
    firebaseAuth:teacher.uid,attemptId:"att_1",itemId:"itm_1",
    points:1,expectedGradeVersion:1}),denied("INVALID_FIELDS"));
});
test("QN11.6.2 manual preflight validates grading state, answer, correction reason",async()=>{
  const incomplete=fixture({status:"running"});
  await assert.rejects(incomplete.svc.previewManualGrade({
    firebaseAuth:teacher.uid,attemptId:"att_1",itemId:"itm_1",
    points:1,expectedGradeVersion:1}),denied("FAILED_PRECONDITION"));
  assert.equal(incomplete.reads,0);
  const blank=fixture({answer:""});
  await assert.rejects(blank.svc.previewManualGrade({
    firebaseAuth:teacher.uid,attemptId:"att_1",itemId:"itm_1",
    points:1,expectedGradeVersion:1}),denied("INVALID_FIELDS"));
  const corrected=fixture({status:"final",oldManual:1});
  await assert.rejects(corrected.svc.previewManualGrade({
    firebaseAuth:teacher.uid,attemptId:"att_1",itemId:"itm_1",
    points:2,expectedGradeVersion:1}),denied("INVALID_FIELDS"));
  const valid=await corrected.svc.previewManualGrade({
    firebaseAuth:teacher.uid,attemptId:"att_1",itemId:"itm_1",
    points:2,reason:"Detailed second review",expectedGradeVersion:1});
  assert.equal(valid.grade.manualPoints,2);
  assert.equal(valid.reason,"Detailed second review");
});
