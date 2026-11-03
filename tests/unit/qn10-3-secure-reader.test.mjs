import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createSecureBundleAttemptService } from "../../functions/src/bundles/secure-attempt-service.js";
import {
  BUNDLE_FORMAT, BUNDLE_CONTENT_TYPE, preparePublishedBundle,
  makePublishedBundleManifest,
} from "../../functions/src/bundles/published-bundle.js";

const student={uid:"student_syn",role:"student",emailVerified:true,accountStatus:"active"};
const other={uid:"student_other",role:"student",emailVerified:true,accountStatus:"active"};
const teacher={uid:"teacher_syn",role:"teacher",emailVerified:true,accountStatus:"active"};
const unverified={...student,emailVerified:false};
const now=new Date("2026-11-03T12:00:00Z");
const settings={durationSeconds:1200,shuffleQuestions:false,shuffleOptions:false,
  allowBack:false,penalty:0,scoreRelease:"immediate",solutionRelease:"manual"};
const item=n=>({
  itemId:"itm_"+n,problemId:"prb_"+n,problemRevisionId:"prv_"+n,
  points:2,
  content:{type:"open",answerMode:"auto",statementLatex:"Compute "+n+"+1",
    options:[],defaultPoints:2,
    questionAssetBindings:n===0?{"figure.png":"ast_question"}:{}},
  grading:{correctOptionId:null,acceptedAnswers:[String(n+1)],
    tolerance:0,explanationLatex:"The answer is "+(n+1),
    rubricLatex:"Private rubric",solutionAssetBindings:
    n===0?{"solution.png":"ast_solution"}:{}},
});
const makeFixture=(n=3,{legacy=false,allowBack=false,
  studentStatus="active",gradeState="not_started",
  scoreRelease="immediate",solutionRelease="manual"}={})=>{
  const order=Array.from({length:n},(_,i)=>"itm_"+i);
  const bundle=preparePublishedBundle({
    format:BUNDLE_FORMAT,quizId:"quiz_syn",revisionId:"qrv_old",
    revisionNumber:1,title:"Quiz",description:"",subject:"Math",
    difficulty:"Practice",settings:{...settings,allowBack,scoreRelease,solutionRelease},
    itemOrder:order,itemCount:n,totalPoints:n*2,items:order.map((_,i)=>item(i)),
  });
  let manifest=makePublishedBundleManifest(bundle,"9812345");
  const attempt={
    quizId:"quiz_syn",quizRevisionId:"qrv_old",quizTitle:"Quiz",
    quizOwnerId:teacher.uid,studentId:student.uid,
    studentDisplayName:"Synthetic student",studentEmail:"s@synthetic.invalid",
    status:studentStatus,gradeState,order,
    currentFrontier:0,uiState:{currentIndex:0,flaggedItemIds:[],version:0},
    optionOrder:{},answeredCount:1,answeredItemIds:["itm_0"],
    answerVersion:1,gradeVersion:0,
    settingsSnapshot:{...settings,allowBack,scoreRelease,solutionRelease},
    totals:{score:2,possible:n*2,correct:1,incorrect:0,skipped:n-1,
      pending:0,partial:0,percentage:100/n},
    startedAt:new Date(now.valueOf()-60000),deadlineAt:new Date(now.valueOf()+120000),
    closedAtSnapshot:new Date(now.valueOf()+600000),
    scoreReleasedAt:null,solutionsReleasedAt:null,
    submittedAt:studentStatus==="active"?null:new Date(now.valueOf()-10000),
  };
  const auth=new Map([
    [student.uid,student],[teacher.uid,teacher],[other.uid,other],
    ["unverified",unverified],
  ]);
  let reads=0, legacyReads=0,keyReads=0;
  const data=order.map((_,i)=>item(i));
  const svc=createSecureBundleAttemptService({
    enabled:true,
    resolveFirebaseActor:async token=>auth.get(token),
    loadAttempt:async id=>id==="att_syn"?attempt:null,
    loadRevision:async({quizId,revisionId})=>{
      assert.equal(quizId,attempt.quizId);
      assert.equal(revisionId,attempt.quizRevisionId);
      return {state:"ready",itemOrder:order,
        ...(legacy?{}:{bundle:manifest})};
    },
    readPrivateObject:async({storagePath,generation,maxBytes})=>{
      reads++;
      assert.equal(storagePath,manifest.storagePath);
      assert.equal(generation,manifest.generation);
      assert(maxBytes>=bundle.byteLength);
      return {bytes:Buffer.from(bundle.bytes),generation,
        contentType:BUNDLE_CONTENT_TYPE};
    },
    loadLegacyItem:async({itemId,revisionId})=>{
      legacyReads++;
      assert.equal(revisionId,"qrv_old");
      const source=data.find(x=>x.itemId===itemId);
      return source && {itemId:source.itemId,problemId:source.problemId,
        problemRevisionId:source.problemRevisionId,points:source.points,
        ...source.content};
    },
    loadLegacyGrading:async({itemId})=>{
      keyReads++;
      return data.find(x=>x.itemId===itemId)?.grading;
    },
    loadAnswer:async({itemId})=>itemId==="itm_0"?
      {value:"1",revision:1,updatedAt:now}:null,
    loadGrade:async({itemId})=>({
      status:itemId==="itm_0"?"correct":"skipped",
      awarded:itemId==="itm_0"?2:0,possible:2,
      feedbackLatex:"",version:1,manualPoints:null,
    }),
    authorizeGradeJob:async({jobId,attemptId})=>
      jobId==="job_grade_syn" && attemptId==="att_syn"?
        {kind:"grade_attempt",targetId:attemptId,
          status:"running",leaseOwner:"worker_1"}:null,
    serverNow:()=>now,
  });
  return {
    svc,attempt,bundle,manifest,auth,
    setManifest:next=>{manifest=next;},
    get reads(){return reads},
    get legacyReads(){return legacyReads},
    get keyReads(){return keyReads},
  };
};
const isReason = reason => error => error?.reason===reason;

test("QN10.3 remains default OFF with no privileged port dependencies",async()=>{
  const off=createSecureBundleAttemptService();
  assert.equal(off.enabled,false);
  assert.deepEqual(await off.questions(),{disabled:true});
  assert.deepEqual(await off.gradeBatch(),{disabled:true});
  assert.deepEqual(await off.resultPage(),{disabled:true});
});
test("enabled reader refuses missing verified Firebase, attempt, key, or Storage ports",()=>{
  assert.throws(()=>createSecureBundleAttemptService({enabled:true}),
    /Trusted Firebase\/Storage authorization ports/);
});
test("no-back student receives ONLY current pinned question and saved answer",async()=>{
  const f=makeFixture();
  const r=await f.svc.questions({
    firebaseAuth:student.uid,attemptId:"att_syn",itemIds:["itm_0"]});
  assert.equal(r.items.length,1);
  assert.equal(r.items[0].statementLatex,"Compute 0+1");
  assert.equal(r.items[0].answer.value,"1");
  assert.equal(r.items[0].questionAssetBindings["figure.png"],"ast_question");
  assert(!JSON.stringify(r).includes("acceptedAnswers"));
  assert(!JSON.stringify(r).includes("rubric"));
  assert(!JSON.stringify(r).includes("ast_solution"));
  assert(!JSON.stringify(r).includes("published-bundles"));
  assert.equal(f.reads,1);
  await assert.rejects(f.svc.questions({firebaseAuth:student.uid,
    attemptId:"att_syn",itemIds:["itm_1"]}),isReason("RESOURCE_UNAVAILABLE"));
  assert.equal(f.reads,1,"future item rejected before Storage read");
});
test("other student, guest and disabled users cannot access any bundle",async()=>{
  const f=makeFixture();
  for(const token of [other.uid,null]){
    await assert.rejects(f.svc.questions({firebaseAuth:token,
      attemptId:"att_syn",itemIds:["itm_0"]}),
      isReason(token===null?"AUTH_REQUIRED":"RESOURCE_UNAVAILABLE"));
  }
  f.auth.set("disabled",{...student,accountStatus:"disabled"});
  await assert.rejects(f.svc.questions({firebaseAuth:"disabled",
    attemptId:"att_syn",itemIds:["itm_0"]}),isReason("ACCOUNT_DISABLED"));
  assert.equal(f.reads,0);
});
test("attempt revision pin defeats latest-quiz-pointer changes",async()=>{
  const f=makeFixture();
  const r=await f.svc.questions({firebaseAuth:student.uid,
    attemptId:"att_syn",itemIds:["itm_0"]});
  assert.equal(r.items[0].statementLatex,"Compute 0+1");
  // No caller-controlled revision field exists; the stored attempt pin wins.
  await assert.rejects(f.svc.questions({firebaseAuth:student.uid,
    attemptId:"att_syn",revisionId:"qrv_new",itemIds:["itm_5"]}),
    isReason("RESOURCE_UNAVAILABLE"));
  assert.equal(f.attempt.quizRevisionId,"qrv_old");
});
test("allowBack true allows 20-item pages but never missing or duplicate IDs",async()=>{
  const f=makeFixture(100,{allowBack:true});
  const ids=Array.from({length:20},(_,i)=>"itm_"+(i+10));
  const r=await f.svc.questions({firebaseAuth:student.uid,attemptId:"att_syn",itemIds:ids});
  assert.equal(r.items.length,20);
  assert.deepEqual(r.remainingItemIds,[]);
  assert.equal(f.reads,1);
  await assert.rejects(f.svc.questions({firebaseAuth:student.uid,
    attemptId:"att_syn",itemIds:[...ids,"itm_30"]}),isReason("INVALID_FIELDS"));
  await assert.rejects(f.svc.questions({firebaseAuth:student.uid,
    attemptId:"att_syn",itemIds:["itm_0","itm_0"]}),isReason("INVALID_FIELDS"));
});
test("deadline and frozen attempt fail before private Storage read",async()=>{
  const f=makeFixture();
  f.attempt.deadlineAt=new Date(now.valueOf()-1000);
  await assert.rejects(f.svc.questions({firebaseAuth:student.uid,
    attemptId:"att_syn",itemIds:["itm_0"]}),isReason("ATTEMPT_EXPIRED"));
  f.attempt.deadlineAt=null;
  f.attempt.status="submitted";
  await assert.rejects(f.svc.questions({firebaseAuth:student.uid,
    attemptId:"att_syn",itemIds:["itm_0"]}),isReason("ATTEMPT_FROZEN"));
  assert.equal(f.reads,0);
});
test("save-answer precheck validates current slot, value, and revision",async()=>{
  const f=makeFixture();
  const r=await f.svc.validateAnswers({firebaseAuth:student.uid,
    attemptId:"att_syn",changes:[{
      itemId:"itm_0",value:"2",expectedRevision:1}]});
  assert.equal(r.validated,true);
  assert.equal(r.pinnedRevisionId,"qrv_old");
  await assert.rejects(f.svc.validateAnswers({firebaseAuth:teacher.uid,
    attemptId:"att_syn",changes:[{
      itemId:"itm_0",value:"2",expectedRevision:1}]}),
    isReason("RESOURCE_UNAVAILABLE"));
  await assert.rejects(f.svc.validateAnswers({firebaseAuth:student.uid,
    attemptId:"att_syn",changes:[{
      itemId:"itm_1",value:"2",expectedRevision:0}]}),
    isReason("RESOURCE_UNAVAILABLE"));
});
test("unreleased result hides scores/solutions, including image asset IDs",async()=>{
  const f=makeFixture(3,{studentStatus:"submitted",gradeState:"final",
    scoreRelease:"manual",solutionRelease:"never"});
  const r=await f.svc.resultPage({firebaseAuth:student.uid,attemptId:"att_syn",
    offset:0,limit:2});
  assert.equal(r.items.length,2);
  assert.equal(r.items[0].grade,null);
  assert.equal(r.items[0].solution,null);
  assert(!JSON.stringify(r).includes("Private rubric"));
  assert(!JSON.stringify(r).includes("ast_solution"));
  assert.equal(r.attempt.scoreVisible,false);
  assert.equal(r.attempt.solutionsVisible,false);
  const assets=await f.svc.allowedAssetIds({firebaseAuth:student.uid,
    attemptId:"att_syn",itemIds:["itm_0"],result:true});
  assert.deepEqual(assets.assetIds,["ast_question"]);
});
test("released result includes score and solution only when policy permits",async()=>{
  const f=makeFixture(3,{studentStatus:"submitted",gradeState:"final",
    scoreRelease:"immediate",solutionRelease:"immediate"});
  const r=await f.svc.resultPage({firebaseAuth:student.uid,attemptId:"att_syn",
    offset:0,limit:1});
  assert.equal(r.items[0].grade.awarded,2);
  assert.deepEqual(r.items[0].solution.acceptedAnswers,["1"]);
  assert.equal(r.items[0].solution.rubricLatex,undefined);
  assert.equal(r.attempt.solutionsVisible,true);
  const assets=await f.svc.allowedAssetIds({firebaseAuth:student.uid,
    attemptId:"att_syn",itemIds:["itm_0"],result:true});
  assert.deepEqual(assets.assetIds,["ast_question","ast_solution"]);
});
test("teacher can preview grading and rubric, other student cannot",async()=>{
  const f=makeFixture(3,{studentStatus:"submitted",gradeState:"final",
    solutionRelease:"never"});
  const r=await f.svc.resultPage({firebaseAuth:teacher.uid,
    attemptId:"att_syn",offset:0,limit:1,staffOnly:true});
  assert.equal(r.items[0].solution.rubricLatex,"Private rubric");
  assert.equal(r.attempt.canGrade,true);
  await assert.rejects(f.svc.resultPage({firebaseAuth:student.uid,
    attemptId:"att_syn",staffOnly:true}),isReason("RESOURCE_UNAVAILABLE"));
});
test("locked question image and solution image cannot leak through asset authorization",async()=>{
  const f=makeFixture();
  await assert.rejects(f.svc.allowedAssetIds({firebaseAuth:student.uid,
    attemptId:"att_syn",itemIds:["itm_1"]}),isReason("RESOURCE_UNAVAILABLE"));
  const r=await f.svc.allowedAssetIds({firebaseAuth:student.uid,
    attemptId:"att_syn",itemIds:["itm_0"]});
  assert.deepEqual(r.assetIds,["ast_question"]);
});
test("gradeBatch verifies persisted job and produces server-only grades",async()=>{
  const f=makeFixture(3,{studentStatus:"submitted",gradeState:"queued"});
  const graded=await f.svc.gradeBatch({jobId:"job_grade_syn",
    attemptId:"att_syn",itemIds:["itm_0","itm_1"]});
  assert.equal(graded.pinnedRevisionId,"qrv_old");
  assert.equal(graded.grades[0].status,"correct");
  assert.equal(graded.grades[0].awarded,2);
  assert.equal(graded.grades[1].status,"skipped");
  assert(!JSON.stringify(graded).includes("acceptedAnswers"));
  await assert.rejects(f.svc.gradeBatch({jobId:"job_unknown",
    attemptId:"att_syn",itemIds:["itm_0"]}),
    isReason("RESOURCE_UNAVAILABLE"));
});
test("gradeBatch denies grading active or already-final attempts",async()=>{
  const f=makeFixture();
  await assert.rejects(f.svc.gradeBatch({jobId:"job_grade_syn",
    attemptId:"att_syn",itemIds:["itm_0"]}),
    isReason("FAILED_PRECONDITION"));
  f.attempt.status="submitted";f.attempt.gradeState="final";f.attempt.gradeVersion=1;
  await assert.rejects(f.svc.gradeBatch({jobId:"job_grade_syn",
    attemptId:"att_syn",itemIds:["itm_0"]}),
    isReason("FAILED_PRECONDITION"));
});
test("legacy Firestore frozen snapshots remain readable without private Storage",async()=>{
  const f=makeFixture(3,{legacy:true,studentStatus:"submitted",
    gradeState:"final",solutionRelease:"immediate"});
  const r=await f.svc.resultPage({firebaseAuth:student.uid,
    attemptId:"att_syn",offset:0,limit:1});
  assert.deepEqual(r.items[0].solution.acceptedAnswers,["1"]);
  assert.equal(f.reads,0);
  assert.equal(f.legacyReads,1);
  assert.equal(f.keyReads,1);
});
test("legacy active questions do not fetch legacy grading keys",async()=>{
  const f=makeFixture(3,{legacy:true});
  const r=await f.svc.questions({firebaseAuth:student.uid,
    attemptId:"att_syn",itemIds:["itm_0"]});
  assert.equal(r.items.length,1);
  assert.equal(f.legacyReads,1);
  assert.equal(f.keyReads,0);
});
test("corrupt protected bytes stop every answer before exposure",async()=>{
  const f=makeFixture();
  // Retained fixture has same bytes, but signed hash is wrong. Validation
  // rejects its malformed document before Storage read.
  f.setManifest({...f.manifest,sha256:"0".repeat(64)});
  await assert.rejects(f.svc.questions({firebaseAuth:student.uid,
    attemptId:"att_syn",itemIds:["itm_0"]}),
    isReason("INVALID_FIELDS"));
});
test("100/500 bundled question pages use one validated private object per request",async()=>{
  for(const n of [100,500]){
    const f=makeFixture(n,{allowBack:true});
    const ids=Array.from({length:20},(_,i)=>"itm_"+i);
    const r=await f.svc.questions({firebaseAuth:student.uid,
      attemptId:"att_syn",itemIds:ids});
    assert.equal(r.items.length,20);
    assert.equal(f.reads,1);
    assert.equal(f.legacyReads,0);
    assert(!JSON.stringify(r).includes("acceptedAnswers"));
  }
});
test("bounded simulated 500-item decode and 8 concurrent readers report local metrics",async(t)=>{
  const f=makeFixture(500,{allowBack:true});
  const itemIds=Array.from({length:20},(_,i)=>"itm_"+i);
  const start=performance.now();
  const pages=await Promise.all(Array.from({length:8},()=>f.svc.questions({
    firebaseAuth:student.uid,attemptId:"att_syn",itemIds,
  })));
  const elapsed=performance.now()-start;
  assert.equal(pages.length,8);
  assert(pages.every(x=>x.items.length===20));
  assert.equal(f.reads,8,"one storage read per uncached request");
  t.diagnostic("QN10.3 synthetic 500-item / 8 concurrent readers: "+
    elapsed.toFixed(2)+" ms, 8 complete bundle reads, "+
    f.bundle.byteLength+" bytes each; NOT production latency/cost.");
});

test("QN11.5 next-question preview is pinned, keyless, and enforces no-back frontier",async()=>{
  const f=makeFixture();
  const proof=await f.svc.navigationPreview({firebaseAuth:student.uid,
    attemptId:"att_syn",targetIndex:1});
  assert.equal(proof.targetIndex,1);
  assert.equal(proof.expectedFrontier,0);
  assert.equal(proof.expectedUiVersion,0);
  assert.equal(proof.item.itemId,"itm_1");
  assert.equal(proof.item.statementLatex,"Compute 1+1");
  assert(!JSON.stringify(proof).includes("acceptedAnswers"));
  assert(!JSON.stringify(proof).includes("ast_solution"));
  await assert.rejects(f.svc.navigationPreview({firebaseAuth:student.uid,
    attemptId:"att_syn",targetIndex:2}),isReason("INVALID_FIELDS"));
  await assert.rejects(f.svc.navigationPreview({firebaseAuth:other.uid,
    attemptId:"att_syn",targetIndex:1}),isReason("RESOURCE_UNAVAILABLE"));
  assert.equal(f.reads,1,"future and unrelated previews rejected before Storage");
});
test("QN11.5 preview refuses expired attempts and missing private objects",async()=>{
  const f=makeFixture();
  f.attempt.deadlineAt=new Date(now.valueOf()-1000);
  await assert.rejects(f.svc.navigationPreview({firebaseAuth:student.uid,
    attemptId:"att_syn",targetIndex:1}),isReason("ATTEMPT_EXPIRED"));
  assert.equal(f.reads,0);
  f.attempt.deadlineAt=null;
  const wrongHash="e".repeat(64);
  f.setManifest({...f.manifest,sha256:wrongHash,
    storagePath:f.manifest.storagePath.replace(f.manifest.sha256,wrongHash)});
  await assert.rejects(f.svc.navigationPreview({firebaseAuth:student.uid,
    attemptId:"att_syn",targetIndex:1}),isReason("RESOURCE_UNAVAILABLE"));
});
