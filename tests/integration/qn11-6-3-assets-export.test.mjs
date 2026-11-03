// QN11.6.3 — Firebase EMULATOR ONLY. Never talk to production.
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {initializeApp,getApps} from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {getFirestore,Timestamp} from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import {hash} from "../../functions/src/domain/runtime.js";
import {createFirestorePrivateImageScope}
  from "../../functions/src/bundles/private-image-scope.js";
import {createFirestorePublishedImageRetention}
  from "../../functions/src/bundles/private-asset-retention.js";
import {createFirestorePrivateExportStore}
  from "../../functions/src/bundles/private-export-store.js";
import {preparePublishedBundle,makePublishedBundleManifest,BUNDLE_FORMAT}
  from "../../functions/src/bundles/published-bundle.js";
assert(process.env.FIRESTORE_EMULATOR_HOST,
  "QN11.6.3 requires a disposable Firebase EMULATOR only");
if(!getApps().length)initializeApp({projectId:"demo-mathquiz-v2"});
const db=getFirestore();
const make=p=>p+randomUUID().replaceAll("-","_");
const reason=r=>e=>e?.reason===r;
const settings={durationSeconds:1200,allowBack:false,penalty:0,
  scoreRelease:"manual",solutionRelease:"never",shuffleOptions:false,
  shuffleQuestions:false};
async function actorFixture(){
  const uid=make("student_"),teacher=make("teacher_"),
    quizId=make("quiz_"),attemptId=make("att_"),
    firebaseAuth={uid,token:{email_verified:true}},
    teacherAuth={uid:teacher,token:{email_verified:true}};
  await Promise.all([
    db.doc("roles/"+uid).set({role:"student",
      accountStatus:"active",version:1}),
    db.doc("roles/"+teacher).set({role:"teacher",
      accountStatus:"active",version:1}),
    db.doc("attempts/"+attemptId).set({
      studentId:uid,quizOwnerId:teacher,quizId,
      quizRevisionId:"qrv_1",status:"active",gradeState:"not_started",
      order:["itm_1","itm_2"],currentFrontier:0,
      deadlineAt:Timestamp.fromMillis(Date.now()+300000),
      settingsSnapshot:settings,
    }),
  ]);
  return {uid,teacher,quizId,attemptId,
    firebaseAuth,teacherAuth,scope:createFirestorePrivateImageScope({
      enabled:true,db})};
}
test("QN11.6.3 private image scope disabled by default",async()=>{
  assert.deepEqual(await createFirestorePrivateImageScope().resolve(),
    {disabled:true});
});
test("QN11.6.3 no-back attempt images only expose current frontier",async()=>{
  const f=await actorFixture();
  const scoped=await f.scope.resolve({
    firebaseAuth:f.firebaseAuth,attemptId:f.attemptId,kind:"attempt"});
  assert.deepEqual(scoped.itemIds,["itm_1"]);
  assert.equal(scoped.solutionVisible,false);
  await db.doc("attempts/"+f.attemptId).update({currentFrontier:1});
  const next=await f.scope.resolve({
    firebaseAuth:f.firebaseAuth,attemptId:f.attemptId,kind:"attempt"});
  assert.deepEqual(next.itemIds,["itm_2"]);
  const staff=await f.scope.resolve({
    firebaseAuth:f.teacherAuth,attemptId:f.attemptId,kind:"attempt"});
  assert.deepEqual(staff.itemIds,["itm_1","itm_2"]);
  await assert.rejects(f.scope.resolve({firebaseAuth:f.firebaseAuth,
    attemptId:f.attemptId,kind:"result"}),
    reason("RESOURCE_UNAVAILABLE"));
});
test("QN11.6.3 expired, submitted, revoked and non-owner image contexts fail",async()=>{
  const f=await actorFixture();
  await db.doc("attempts/"+f.attemptId).update({
    deadlineAt:Timestamp.fromMillis(Date.now()-1000)});
  await assert.rejects(f.scope.resolve({firebaseAuth:f.firebaseAuth,
    attemptId:f.attemptId,kind:"attempt"}),reason("ATTEMPT_EXPIRED"));
  await db.doc("attempts/"+f.attemptId).update({
    status:"submitted",gradeState:"final",deadlineAt:null});
  const result=await f.scope.resolve({firebaseAuth:f.firebaseAuth,
    attemptId:f.attemptId,kind:"result"});
  assert.equal(result.solutionVisible,false);
  const unauth={uid:make("student_other_"),token:{email_verified:true}};
  await assert.rejects(f.scope.resolve({firebaseAuth:unauth,
    attemptId:f.attemptId,kind:"result"}),
    reason("RESOURCE_UNAVAILABLE"));
  await db.doc("roles/"+f.uid).update({accountStatus:"disabled"});
  await assert.rejects(f.scope.resolve({firebaseAuth:f.firebaseAuth,
    attemptId:f.attemptId,kind:"result"}),reason("ACCOUNT_DISABLED"));
});
async function retentionFixture({count=21,bad=false}={}){
  const teacher=make("teacher_"),quizId=make("quiz_"),
    revisionId=make("qrv_"),jobId=make("job_"),
    input={revisionId,bundleMode:"private_bundle_v1",
      sources:[{itemId:"itm_1"}]};
  const job={kind:"publish_quiz",targetId:quizId,
    requestedBy:teacher,input,status:"running",
    leaseOwner:"lease_one",
    leaseExpiresAt:Timestamp.fromMillis(Date.now()+300000),
    progress:{processed:0,total:1}};
  const manifestHash=hash("synthetic-pinned-manifest");
  await Promise.all([
    db.doc("roles/"+teacher).set({
      role:"teacher",accountStatus:"active",version:1}),
    db.doc("quizzes/"+quizId).set({
      ownerId:teacher,lifecycle:"active",
      publishingJobId:jobId}),
    db.doc("jobs/"+jobId).set(job),
    db.doc("quizzes/"+quizId+"/revisions/"+revisionId).set({
      state:"building",publicationJobId:jobId,
      manifestHash}),
  ]);
  const imageIds=Array.from({length:count},()=>make("ast_"));
  await Promise.all(imageIds.map((assetId,index)=>
    db.doc("assets/"+assetId).set({
      ownerId:teacher,kind:"image",status:
        bad&&index===count-1?"processing":"ready",
      generation:"7",sha256:"a".repeat(64),
      referenceCount:0,version:1,
      storagePath:"assets/"+teacher+"/"+assetId+"/image.png",
      contentType:"image/png",sizeBytes:128,
    })));
  const items=[{content:{questionAssetBindings:Object.fromEntries(
    imageIds.map((x,i)=>["i"+i,x]))},grading:{solutionAssetBindings:{}}}];
  const plan={jobId,quizId,revisionId,ownerId:teacher,
    leaseOwner:"lease_one",jobInputHash:hash(input),
    revisionManifestHash:manifestHash};
  const retention=createFirestorePublishedImageRetention({
    enabled:true,db,
    authFor:async()=>({uid:teacher,token:{email_verified:true}}),
  });
  return {teacher,quizId,revisionId,jobId,plan,items,imageIds,
    retention,target:"quizzes/"+quizId+"/revisions/"+revisionId};
}
test("QN11.6.3 21 image refs use 2 atomic batches and replay without overcount",async()=>{
  const f=await retentionFixture();
  const result=await f.retention.ensureRetained({
    plan:f.plan,items:f.items});
  assert.equal(result.assetCount,21);
  assert.equal(result.batches,2);
  const rev=(await db.doc(f.target).get()).data();
  assert.equal(rev.assetRetention.assetHash,result.assetHash);
  for(const id of f.imageIds){
    const asset=(await db.doc("assets/"+id).get()).data();
    assert.equal(asset.referenceCount,1);
    const ref=await db.doc("assets/"+id+"/refs/"+hash(f.target)).get();
    assert.equal(ref.data().target,f.target);
  }
  const replay=await f.retention.ensureRetained({
    plan:f.plan,items:f.items});
  assert.equal(replay.assetHash,result.assetHash);
  assert.equal((await db.doc("assets/"+f.imageIds[0]).get())
    .data().referenceCount,1);
});
test("QN11.6.3 revoked publication lease or unready asset blocks retention",async()=>{
  const f=await retentionFixture({count:1});
  await db.doc("jobs/"+f.jobId).update({leaseOwner:"other"});
  await assert.rejects(f.retention.ensureRetained({
    plan:f.plan,items:f.items}),reason("JOB_LEASE"));
  assert.equal((await db.doc("assets/"+f.imageIds[0]).get())
    .data().referenceCount,0);
  const g=await retentionFixture({count:1,bad:true});
  await assert.rejects(g.retention.ensureRetained({
    plan:g.plan,items:g.items}),reason("ASSET_NOT_READY"));
  assert.equal((await db.doc(g.target).get()).data().assetRetention,
    undefined);
});
function manifest(quizId,revisionId){
  const content={type:"open",answerMode:"auto",statementLatex:"2+2",
    defaultPoints:2,options:[],questionAssetBindings:{}},
    grading={correctOptionId:null,acceptedAnswers:["4"],tolerance:0,
      explanationLatex:"",rubricLatex:"",
      solutionAssetBindings:{}};
  const prepared=preparePublishedBundle({format:BUNDLE_FORMAT,
    quizId,revisionId,revisionNumber:1,title:"Quiz",
    description:"",subject:"Mathematics",difficulty:"",settings,
    itemOrder:["itm_1"],itemCount:1,totalPoints:2,
    items:[{itemId:"itm_1",problemId:"prb_1",
      problemRevisionId:"prv_1",points:2,content,grading}]});
  return makePublishedBundleManifest(prepared,"101");
}
async function exportFixture(){
  const teacher=make("teacher_"),quizId=make("quiz_"),
    revisionId=make("qrv_"),jobId=make("job_");
  const record={kind:"export_quiz",targetId:quizId,
    input:{revisionId},requestedBy:teacher,status:"running",
    leaseOwner:"lease_one",
    leaseExpiresAt:Timestamp.fromMillis(Date.now()+300000),
    progress:{processed:0,total:1,stage:"Exporting"}};
  await Promise.all([
    db.doc("roles/"+teacher).set({
      role:"teacher",accountStatus:"active",version:1}),
    db.doc("quizzes/"+quizId).set({
      ownerId:teacher,lifecycle:"active",publishedRevisionId:revisionId}),
    db.doc("quizzes/"+quizId+"/revisions/"+revisionId).set({
      state:"ready",bundle:manifest(quizId,revisionId)}),
    db.doc("jobs/"+jobId).set(record),
  ]);
  let signed=0;
  const service=createFirestorePrivateExportStore({
    enabled:true,db,
    authFor:async()=>({uid:teacher,token:{email_verified:true}}),
    signExport:async()=>{signed++;
      return "https://files.example.test/owner-export.zip?sig=abc";},
  });
  const actor={uid:teacher,token:{email_verified:true}};
  return {teacher,quizId,revisionId,jobId,record,service,actor,
    get signed(){return signed}};
}
test("QN11.6.3 export job lease and manifest are verified and finished atomically",async()=>{
  const f=await exportFixture();
  const plan=await f.service.load(f.jobId);
  assert.equal(plan.manifest.generation,"101");
  const object={contentType:"application/zip",
    storagePath:"exports/"+f.teacher+"/"+f.jobId+"/"+
      f.quizId+"-"+f.jobId+".zip",
    generation:"202",sha256:"a".repeat(64),byteLength:105};
  const first=await f.service.finish({plan,object});
  assert.equal(first.result.privateBundleExport,true);
  assert.equal((await db.doc("jobs/"+f.jobId).get()).data().status,
    "succeeded");
  const again=await f.service.load(f.jobId);
  assert.equal(again.completed,true);
  assert.equal((await f.service.finish({plan,object})).alreadyExported,true);
  const link=await f.service.getLink({
    firebaseAuth:f.actor,jobId:f.jobId});
  assert.equal(link.filename,f.quizId+"-"+f.jobId+".zip");
  assert.equal(f.signed,1);
  await assert.rejects(f.service.getLink({
    firebaseAuth:{uid:make("other_"),token:{email_verified:true}},
    jobId:f.jobId}),reason("ROLE_REQUIRED"));
});
test("QN11.6.3 lost lease prevents ZIP job completion after external write",async()=>{
  const f=await exportFixture();
  const plan=await f.service.load(f.jobId);
  await db.doc("jobs/"+f.jobId).update({leaseOwner:"new_worker"});
  const object={contentType:"application/zip",
    storagePath:"exports/"+f.teacher+"/"+f.jobId+"/"+
      f.quizId+"-"+f.jobId+".zip",
    generation:"202",sha256:"a".repeat(64),byteLength:105};
  await assert.rejects(f.service.finish({plan,object}),reason("JOB_LEASE"));
  assert.equal((await db.doc("jobs/"+f.jobId).get()).data().status,
    "running");
  assert.equal(f.signed,0);
});
