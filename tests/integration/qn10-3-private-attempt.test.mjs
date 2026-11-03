// QN10.3 Firebase/Storage emulator-only regression. NEVER live credentials.
import test,{before} from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import { getFirestore, Timestamp } from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getAuth } from "../../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import { getStorage } from "../../functions/node_modules/firebase-admin/lib/esm/storage/index.js";
import {
  BUNDLE_FORMAT,BUNDLE_CONTENT_TYPE,preparePublishedBundle,makePublishedBundleManifest,
} from "../../functions/src/bundles/published-bundle.js";
import { createSecureBundleAttemptService } from "../../functions/src/bundles/secure-attempt-service.js";
import { createPrivateBundleStoragePort } from "../../functions/src/bundles/private-storage.js";

assert(process.env.FIRESTORE_EMULATOR_HOST &&
  process.env.FIREBASE_STORAGE_EMULATOR_HOST &&
  process.env.FIREBASE_AUTH_EMULATOR_HOST,
  "QN10.3 only supports Firebase Auth/Firestore/Storage emulators");
initializeApp({projectId:"demo-mathquiz-v2",
  storageBucket:"demo-mathquiz-v2.appspot.com"});
const db=getFirestore(), auth=getAuth();
const storage=createPrivateBundleStoragePort({
  enabled:true,bucket:getStorage().bucket(),
});
const owner="qn103_teacher",student="qn103_student",stranger="qn103_stranger";
const settings={
  durationSeconds:1200,shuffleQuestions:false,shuffleOptions:false,
  allowBack:false,penalty:0,scoreRelease:"manual",solutionRelease:"never",
};
const content=n=>({
  type:"open",answerMode:"auto",statementLatex:"Compute "+n+"+2",
  options:[],defaultPoints:2,questionAssetBindings:n===0?{"chart.png":"ast_chart_qn103"}:{},
});
const grading=n=>({
  correctOptionId:null,acceptedAnswers:[String(n+2)],tolerance:0,
  explanationLatex:"Private solution",
  rubricLatex:"Never show rubric to student",
  solutionAssetBindings:n===0?{"sol.png":"ast_private_solution"}:{},
});
const item=n=>({
  itemId:"itm_qn103_"+n,problemId:"prb_qn103_"+n,
  problemRevisionId:"prv_qn103_"+n,points:2,
  content:content(n),grading:grading(n),
});
const seedRevision="qrv_bundle_qn103";
const oldRevision="qrv_legacy_qn103";
const quizId="quiz_bundle_qn103";
const attemptId="att_bundle_qn103";
const legacyAttemptId="att_legacy_qn103";
const jobId="job_grade_qn103";
let manifest;
let objects=0;
before(async()=>{
  for(const [uid,role] of [[owner,"teacher"],[student,"student"],[stranger,"student"]]){
    await auth.createUser({uid,email:uid+"@synthetic.invalid",
      emailVerified:true,displayName:uid});
    await db.doc("roles/"+uid).set({
      role,accountStatus:"active",version:1,updatedAt:Timestamp.now(),
    });
  }
  const items=Array.from({length:3},(_,i)=>item(i));
  const prepared=preparePublishedBundle({
    format:BUNDLE_FORMAT,quizId,revisionId:seedRevision,revisionNumber:2,
    title:"Private bundled quiz",description:"",subject:"Math",
    difficulty:"Practice",settings:{...settings},
    itemOrder:items.map(x=>x.itemId),itemCount:items.length,
    totalPoints:6,items,
  });
  await storage.createOnly({storagePath:prepared.storagePath,
    bytes:prepared.bytes,contentType:BUNDLE_CONTENT_TYPE,
    cacheControl:"private, no-store",ifGenerationMatch:0});
  const stored=await storage.readExact({storagePath:prepared.storagePath,
    maxBytes:24*1024*1024});
  manifest=makePublishedBundleManifest(prepared,stored.generation);
  const stamp=Timestamp.now();
  const attempt={
    schemaVersion:2,quizId,quizRevisionId:seedRevision,
    quizTitle:"Private bundled quiz",studentId:student,
    studentDisplayName:"Synthetic student",studentEmail:student+"@synthetic.invalid",
    quizOwnerId:owner,status:"active",gradeState:"not_started",
    ordinal:1,attemptKind:"standard",sourceAttemptId:null,
    order:items.map(x=>x.itemId),optionOrder:{},
    settingsSnapshot:{...settings},currentFrontier:0,
    uiState:{currentIndex:0,flaggedItemIds:[],version:0},
    answerVersion:1,gradeVersion:0,
    answeredCount:1,answeredItemIds:[items[0].itemId],
    startedAt:stamp,deadlineAt:Timestamp.fromMillis(Date.now()+600000),
    closedAtSnapshot:Timestamp.fromMillis(Date.now()+3600000),
    submittedAt:null,lastSavedAt:stamp,
    scoreReleasedAt:null,solutionsReleasedAt:null,
    totals:{score:null,possible:6,percentage:null,
      correct:0,incorrect:0,skipped:0,pending:0,partial:0},
  };
  const batch=db.batch();
  batch.set(db.doc("quizzes/"+quizId),{
    schemaVersion:2,ownerId:owner,publishedRevisionId:seedRevision,
    lastPublishedRevisionId:seedRevision,
    lifecycle:"active",visibility:"public",accessMode:"open",
  });
  batch.set(db.doc("quizzes/"+quizId+"/revisions/"+seedRevision),{
    state:"ready",itemOrder:attempt.order,itemCount:3,totalPoints:6,
    bundle:manifest,settings:{...settings},
  });
  batch.set(db.doc("quizzes/"+quizId+"/revisions/"+oldRevision),{
    state:"ready",itemOrder:attempt.order,itemCount:3,totalPoints:6,
    settings:{...settings,solutionRelease:"immediate",
      scoreRelease:"immediate"},
  });
  for(const x of items){
    batch.set(db.doc("quizzes/"+quizId+"/revisions/"+oldRevision+
      "/items/"+x.itemId),{
      ...x.content,itemId:x.itemId,points:x.points,
      problemId:x.problemId,problemRevisionId:x.problemRevisionId});
    batch.set(db.doc("quizzes/"+quizId+"/revisions/"+oldRevision+
      "/grading/"+x.itemId),{
      ...x.grading,acceptedAnswers:["OLD_"+x.itemId]});
  }
  batch.set(db.doc("attempts/"+attemptId),attempt);
  batch.set(db.doc("attempts/"+attemptId+"/answers/"+items[0].itemId),{
    value:"2",revision:1,updatedAt:stamp,
  });
  batch.set(db.doc("attempts/"+legacyAttemptId),{
    ...attempt,quizRevisionId:oldRevision,status:"submitted",
    gradeState:"final",settingsSnapshot:{...settings,
      solutionRelease:"immediate",scoreRelease:"immediate"},
    deadlineAt:Timestamp.fromMillis(Date.now()+600000),
    totals:{score:2,possible:6,percentage:33.33,
      correct:1,incorrect:0,skipped:2,pending:0,partial:0},
    gradeVersion:1,
  });
  batch.set(db.doc("attempts/"+legacyAttemptId+"/answers/"+items[0].itemId),{
    value:"Old response",revision:1,updatedAt:stamp,
  });
  batch.set(db.doc("attempts/"+legacyAttemptId+"/grades/"+items[0].itemId),{
    status:"correct",awarded:2,possible:2,feedbackLatex:"",
    version:1,manualPoints:null,
  });
  batch.set(db.doc("jobs/"+jobId),{kind:"grade_attempt",
    targetId:attemptId,status:"running",leaseOwner:"worker_qn103"});
  await batch.commit();
});
const service=createSecureBundleAttemptService({
  enabled:true,
  resolveFirebaseActor:async trustedAuth=>{
    if(!trustedAuth?.uid)return null;
    const u=await auth.getUser(trustedAuth.uid);
    const role=(await db.doc("roles/"+u.uid).get()).data();
    return {uid:u.uid,role:role?.role??"student",
      accountStatus:role?.accountStatus??"active",
      emailVerified:u.emailVerified,email:u.email};
  },
  loadAttempt:async id=>(await db.doc("attempts/"+id).get()).data(),
  loadRevision:async({quizId,revisionId})=>
    (await db.doc("quizzes/"+quizId+"/revisions/"+revisionId).get()).data(),
  readPrivateObject:async args=>{objects++;return storage.readExact(args);},
  loadLegacyItem:async({quizId,revisionId,itemId})=>
    (await db.doc("quizzes/"+quizId+"/revisions/"+revisionId+
      "/items/"+itemId).get()).data(),
  loadLegacyGrading:async({quizId,revisionId,itemId})=>
    (await db.doc("quizzes/"+quizId+"/revisions/"+revisionId+
      "/grading/"+itemId).get()).data(),
  loadAnswer:async({attemptId,itemId})=>
    (await db.doc("attempts/"+attemptId+"/answers/"+itemId).get()).data(),
  loadGrade:async({attemptId,itemId})=>
    (await db.doc("attempts/"+attemptId+"/grades/"+itemId).get()).data(),
  authorizeGradeJob:async({jobId})=>
    (await db.doc("jobs/"+jobId).get()).data(),
  serverNow:()=>new Date(),
});
const user=uid=>({uid});
const why=reason=>e=>e.reason===reason;

test("QN10.3: real private Storage bundle serves only frontier, without grading",async()=>{
  const result=await service.questions({firebaseAuth:user(student),
    attemptId,itemIds:["itm_qn103_0"]});
  assert.equal(result.items[0].statementLatex,"Compute 0+2");
  assert.equal(result.items[0].answer.value,"2");
  assert(!JSON.stringify(result).includes("acceptedAnswers"));
  assert(!JSON.stringify(result).includes("ast_private_solution"));
  assert.equal(objects,1);
  await assert.rejects(service.questions({firebaseAuth:user(student),
    attemptId,itemIds:["itm_qn103_1"]}),why("RESOURCE_UNAVAILABLE"));
  await assert.rejects(service.questions({firebaseAuth:user(stranger),
    attemptId,itemIds:["itm_qn103_0"]}),why("RESOURCE_UNAVAILABLE"));
  assert.equal(objects,1);
});
test("QN10.3: pinned historical Firestore revision remains readable without Storage",async()=>{
  const before=objects;
  const result=await service.resultPage({firebaseAuth:user(student),
    attemptId:legacyAttemptId,offset:0,limit:1});
  assert.equal(result.items[0].statementLatex,"Compute 0+2");
  assert.equal(result.items[0].solution.acceptedAnswers[0],"OLD_itm_qn103_0");
  assert.equal(result.items[0].grade.awarded,2);
  assert.equal(result.attempt.quizRevisionId,oldRevision);
  assert.equal(objects,before);
});
test("QN10.3: server-only grade job reads pinned answer keys but never returns them",async()=>{
  const old=objects;
  const saved=(await db.doc("attempts/"+attemptId).get()).data();
  await db.doc("attempts/"+attemptId).update({status:"submitted",gradeState:"queued"});
  const g=await service.gradeBatch({jobId,attemptId,itemIds:["itm_qn103_0"]});
  assert.equal(g.grades[0].status,"correct");
  assert.equal(g.grades[0].awarded,2);
  assert.equal(g.pinnedRevisionId,seedRevision);
  assert(!JSON.stringify(g).includes("acceptedAnswers"));
  assert.equal(objects,old+1);
  await db.doc("attempts/"+attemptId).set(saved);
});
test("QN10.3: manual/never score and solution policies hide private keys",async()=>{
  const saved=(await db.doc("attempts/"+attemptId).get()).data();
  await db.doc("attempts/"+attemptId).update({
    status:"submitted",gradeState:"final",gradeVersion:1,
  });
  const result=await service.resultPage({firebaseAuth:user(student),
    attemptId,offset:0,limit:1});
  assert.equal(result.items[0].grade,null);
  assert.equal(result.items[0].solution,null);
  assert(!JSON.stringify(result).includes("ast_private_solution"));
  const images=await service.allowedAssetIds({firebaseAuth:user(student),
    attemptId,itemIds:["itm_qn103_0"],result:true});
  assert.deepEqual(images.assetIds,["ast_chart_qn103"]);
  await db.doc("attempts/"+attemptId).set(saved);
});
test("QN10.3: changed deadline is rejected before Storage, still no leak",async()=>{
  const snapshot=await db.doc("attempts/"+attemptId).get();
  const previous=snapshot.data();
  await db.doc("attempts/"+attemptId).update({
    deadlineAt:Timestamp.fromMillis(Date.now()-1000)});
  const prior=objects;
  await assert.rejects(service.questions({firebaseAuth:user(student),
    attemptId,itemIds:["itm_qn103_0"]}),why("ATTEMPT_EXPIRED"));
  assert.equal(objects,prior);
  await db.doc("attempts/"+attemptId).set(previous);
});
