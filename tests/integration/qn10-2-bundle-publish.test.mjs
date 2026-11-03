// QN10.2 — Firebase/Storage EMULATOR ONLY. No production credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import { getFirestore, Timestamp } from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getAuth } from "../../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import { getStorage } from "../../functions/node_modules/firebase-admin/lib/esm/storage/index.js";
import { hash } from "../../functions/src/domain/runtime.js";
import { validateProblem } from "../../shared/schema.js";
import { fingerprint } from "../../functions/src/neon/write-repository.js";
import { createPrivateBundlePublisher } from "../../functions/src/bundles/publish-writer.js";
import { createFirestoreBundlePublicationStore } from "../../functions/src/bundles/firestore-publication-store.js";
import { createPrivateBundleStoragePort } from "../../functions/src/bundles/private-storage.js";

assert(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST &&
  process.env.FIREBASE_AUTH_EMULATOR_HOST,
  "QN10.2 must run only against Firebase emulators");
initializeApp({projectId:"demo-mathquiz-v2",
  storageBucket:"demo-mathquiz-v2.appspot.com"});
const db=getFirestore(), auth=getAuth(), bucket=getStorage().bucket();
const uid="qn10_bundle_teacher";
const settings={durationSeconds:1200,shuffleQuestions:false,
  shuffleOptions:false,allowBack:false,penalty:0,
  scoreRelease:"immediate",solutionRelease:"manual"};
const content={type:"open",answerMode:"auto",statementLatex:"Compute 3+4.",
  options:[],defaultPoints:2,questionAssetBindings:{}};
const grading={correctOptionId:null,acceptedAnswers:["7"],tolerance:0,
  explanationLatex:"",rubricLatex:"",solutionAssetBindings:{}};
const normalized=validateProblem(content,grading);
const authFor=async userId=>{
  const u=await auth.getUser(userId);
  return {uid:u.uid,token:{email:u.email,email_verified:u.emailVerified,
    name:u.displayName??""}};
};

async function seed(label) {
  const quizId="quiz_qn10_"+label, revisionId="qrv_new_"+label,
    oldRevisionId="qrv_old_"+label, jobId="job_bundle_"+label;
  const itemId="itm_0_"+label,problemId="prb_0_"+label,
    problemRevisionId="prv_0_"+label;
  const stamp=Timestamp.now();
  const sources=[{
    itemId,problemId,problemRevisionId,points:2,
    contentHash:fingerprint(normalized),
    source:{kind:"neon_revision",problemId,problemRevisionId},
  }];
  const draft={version:3,title:"Private bundle test",description:"",
    subject:"Math",difficulty:"Practice",settings,
    itemOrder:[itemId],updatedAt:stamp,updatedBy:uid};
  const quiz={schemaVersion:2,ownerId:uid,ownerDisplayName:"Bundle Teacher",
    lifecycle:"active",visibility:"public",accessMode:"open",
    maxAttempts:null,opensAt:null,closesAt:null,
    version:10,draftVersion:3,
    publishedRevisionId:oldRevisionId,
    lastPublishedRevisionId:oldRevisionId,
    publishingJobId:jobId,updatedAt:stamp,publishedAt:stamp};
  const revision={schemaVersion:2,state:"building",revisionNumber:2,
    publicationJobId:jobId,sourceDraftVersion:3,
    title:draft.title,description:draft.description,
    subject:draft.subject,difficulty:draft.difficulty,settings,
    itemOrder:[itemId],itemCount:1,totalPoints:2,
    manifestHash:hash({draft,sources}),
    createdBy:uid,createdAt:stamp,readyAt:null};
  const job={kind:"publish_quiz",status:"running",targetId:quizId,
    requestedBy:uid,actorRoleAtTime:"teacher",
    leaseOwner:"lease_"+label,
    leaseExpiresAt:Timestamp.fromMillis(Date.now()+15*60*1000),
    retryCount:1,error:null,
    input:{bundleMode:"private_bundle_v1",revisionId,
      draftVersion:3,sources},
    progress:{total:1,processed:0,stage:"Preparing bundle"},
    createdAt:stamp,updatedAt:stamp,result:{}};
  const oldPath="quizzes/"+quizId+"/revisions/"+oldRevisionId;
  const batch=db.batch();
  batch.set(db.doc("quizzes/"+quizId),quiz);
  batch.set(db.doc("quizzes/"+quizId+"/drafts/current"),draft);
  batch.set(db.doc("quizzes/"+quizId+"/revisions/"+revisionId),revision);
  batch.set(db.doc(oldPath),{...revision,state:"ready",
    revisionNumber:1,publicationJobId:"job_old",readyAt:stamp});
  batch.set(db.doc(oldPath+"/items/"+itemId),{
    ...content,itemId,problemId,problemRevisionId,points:2});
  batch.set(db.doc(oldPath+"/grading/"+itemId),{
    ...normalized.grading,acceptedAnswers:["old_answer"]});
  batch.set(db.doc("attempts/att_old_"+label),{
    quizId,quizRevisionId:oldRevisionId,
    studentId:"qn10_student",status:"submitted",
    totals:{score:2,possible:2}});
  batch.set(db.doc("jobs/"+jobId),job);
  await batch.commit();
  const publicationStore=createFirestoreBundlePublicationStore({
    db,authFor,enabled:true});
  const storage=createPrivateBundleStoragePort({bucket,enabled:true});
  const writer=createPrivateBundlePublisher({
    enabled:true,publicationStore,storage,
    resolvePinnedRevision:async request=>{
      assert.equal(request.problemId,problemId);
      assert.equal(request.problemRevisionId,problemRevisionId);
      return {...normalized,problemId,problemRevisionId};
    },
  });
  return {quizId,revisionId,oldRevisionId,jobId,itemId,
    oldPath,publicationStore,storage,writer};
}
async function assertOldPreserved(f){
  const [old,gradingSnap,attempt]=await Promise.all([
    db.doc(f.oldPath).get(),
    db.doc(f.oldPath+"/grading/"+f.itemId).get(),
    db.doc("attempts/att_old_"+f.quizId.slice("quiz_qn10_".length)).get(),
  ]);
  assert.equal(old.data().state,"ready");
  assert.equal(gradingSnap.data().acceptedAnswers[0],"old_answer");
  assert.equal(attempt.data().quizRevisionId,f.oldRevisionId);
}
test("QN10.2: verified Storage generation activates Firestore pointer atomically",async()=>{
  const f=await seed("success");
  const result=await f.writer.publish({jobId:f.jobId});
  assert.equal(result.activated,true);
  assert.equal(result.manifest.itemCount,1);
  const [quiz,rev,job,catalog]=await Promise.all([
    db.doc("quizzes/"+f.quizId).get(),
    db.doc("quizzes/"+f.quizId+"/revisions/"+f.revisionId).get(),
    db.doc("jobs/"+f.jobId).get(),
    db.doc("catalog/"+f.quizId).get(),
  ]);
  assert.equal(quiz.data().publishedRevisionId,f.revisionId);
  assert.equal(quiz.data().lastPublishedRevisionId,f.revisionId);
  assert.equal(quiz.data().version,11);
  assert.equal(rev.data().state,"ready");
  assert.deepEqual(rev.data().bundle,result.manifest);
  assert.equal(job.data().status,"succeeded");
  assert.equal(job.data().result.privateBundleVerified,true);
  assert.equal(catalog.data().publishedRevisionId,f.revisionId);
  const [metadata]=await bucket.file(result.manifest.storagePath).getMetadata();
  assert.equal(String(metadata.generation),result.manifest.generation);
  assert.equal(metadata.cacheControl,"private, no-store");
  assert(!metadata.metadata?.firebaseStorageDownloadTokens);
  assert.equal((await db.doc("quizzes/"+f.quizId+
    "/revisions/"+f.revisionId+"/items/"+f.itemId).get()).exists,false);
  await assertOldPreserved(f);
  const replay=await f.writer.publish({jobId:f.jobId});
  assert.equal(replay.alreadyPublished,true);
  assert.equal((await db.doc("quizzes/"+f.quizId).get()).data().version,11);
});
test("QN10.2: a failed Firestore commit leaves old published revision active",async()=>{
  const f=await seed("stale");
  const wrapped=createPrivateBundlePublisher({
    enabled:true,
    publicationStore:{
      load:f.publicationStore.load,
      activate:async details=>{
        await db.doc("quizzes/"+f.quizId+"/drafts/current").update({version:4});
        return f.publicationStore.activate(details);
      },
    },
    storage:f.storage,
    resolvePinnedRevision:async({problemId,problemRevisionId})=>({
      ...normalized,problemId,problemRevisionId,
    }),
  });
  await assert.rejects(wrapped.publish({jobId:f.jobId}),
    e=>e.reason==="VERSION_CONFLICT");
  assert.equal((await db.doc("quizzes/"+f.quizId).get()).data()
    .publishedRevisionId,f.oldRevisionId);
  assert.equal((await db.doc("quizzes/"+f.quizId+
    "/revisions/"+f.revisionId).get()).data().state,"building");
  assert.equal((await db.doc("jobs/"+f.jobId).get()).data().status,"running");
  await assertOldPreserved(f);
});
test("QN10.2: changed lease before activation cannot publish an orphaned bundle",async()=>{
  const f=await seed("lease");
  const wrapped=createPrivateBundlePublisher({
    enabled:true,
    publicationStore:{
      load:f.publicationStore.load,
      activate:async details=>{
        await db.doc("jobs/"+f.jobId).update({leaseOwner:"another_worker"});
        return f.publicationStore.activate(details);
      },
    },
    storage:f.storage,
    resolvePinnedRevision:async({problemId,problemRevisionId})=>({
      ...normalized,problemId,problemRevisionId,
    }),
  });
  await assert.rejects(wrapped.publish({jobId:f.jobId}),
    e=>e.reason==="JOB_LEASE");
  assert.equal((await db.doc("quizzes/"+f.quizId).get()).data()
    .publishedRevisionId,f.oldRevisionId);
  await assertOldPreserved(f);
});
