// QN11.6.1: isolated Firebase emulator only. No real cloud connections.
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {initializeApp,getApps} from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {getFirestore,Timestamp} from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import {DEFAULT_SETTINGS} from "../../shared/schema.js";
import {createFirestorePrivateAttemptStart} from "../../functions/src/bundles/private-attempt-start.js";
import {createQuizerPrivateStartAndExport} from "../../functions/src/bundles/private-start-export.js";
import {
  preparePublishedBundle,makePublishedBundleManifest,
  BUNDLE_FORMAT,BUNDLE_CONTENT_TYPE,
} from "../../functions/src/bundles/published-bundle.js";

assert(process.env.FIRESTORE_EMULATOR_HOST,
  "QN11.6.1 must NEVER connect to production Firestore");
if(!getApps().length)initializeApp({projectId:"demo-mathquiz-v2"});
const db=getFirestore();
const ident=prefix=>prefix+randomUUID().replaceAll("-","_");
const why=reason=>error=>error?.reason===reason;
const settings={...DEFAULT_SETTINGS,shuffleQuestions:false,
  shuffleOptions:false,durationSeconds:1200};
const items=["itm_a","itm_b","itm_c"];
const selected=[
  {itemId:"itm_a",points:2,optionIds:["oa","ob","oc"]},
  {itemId:"itm_b",points:3,optionIds:["od","oe"]},
  {itemId:"itm_c",points:4,optionIds:[]},
];
const frozen=(revisionId,overrides={})=>({
  state:"ready",title:"Mathematics Quiz",
  settings,itemOrder:items,itemCount:3,totalPoints:9,
  bundle:{sha256:"a".repeat(64),generation:"1001"},
  ...overrides,
});
async function fixture({quizOverrides={},part=null,settingsOverride=null}={}){
  const uid=ident("student_"),quizId=ident("quiz_"),
    currentRevisionId="qrv_current",auth={uid,token:{
      email_verified:true,email:uid+"@example.invalid",name:"Test Student"}};
  const quiz={schemaVersion:2,ownerId:"teacher_fixture",
    lifecycle:"active",visibility:"public",accessMode:"open",
    publishedRevisionId:currentRevisionId,opensAt:null,closesAt:null,
    maxAttempts:3,version:1,title:"Mathematics Quiz",...quizOverrides};
  const revision=frozen(currentRevisionId,
    settingsOverride?{settings:settingsOverride}:{});
  await Promise.all([
    db.doc("roles/"+uid).set({role:"student",
      accountStatus:"active",version:1}),
    db.doc("users/"+uid).set({displayName:"Test Student"}),
    db.doc("quizzes/"+quizId).set(quiz),
    db.doc(`quizzes/${quizId}/revisions/${currentRevisionId}`).set(revision),
  ]);
  const pp=`quizzes/${quizId}/participants/${uid}`;
  if(part)await db.doc(pp).set({...part,quizId,uid,
    quizOwnerId:quiz.ownerId,quizTitle:quiz.title,
    updatedAt:Timestamp.now()});
  const svc=createFirestorePrivateAttemptStart({enabled:true,db});
  const preflight=(sourceAttemptId=null)=>
    svc.preflightStart({firebaseAuth:auth,quizId,sourceAttemptId});
  const commit=(proof,options={})=>svc.commitStart({
    firebaseAuth:auth,quizId,sourceAttemptId:options.sourceAttemptId??null,
    requestId:options.requestId??ident("request_"),proof,
    plan:options.plan===undefined ? planOf(proof):options.plan,
  });
  return {uid,auth,quizId,quiz,revision,pp,currentRevisionId,svc,
    preflight,commit};
}
function planOf(proof,records=selected,override={}){
  if(proof.existingAttemptId)return null;
  return {revisionId:proof.revisionId,bundleHash:proof.bundleHash,
    itemOrder:items,selected:records.filter(x=>proof.selectedItemIds.includes(x.itemId)),
    settings:proof.settingsSnapshot,...override};
}
test("QN11.6.1 factory is inert until explicitly enabled",async()=>{
  const off=createFirestorePrivateAttemptStart();
  assert.equal(off.enabled,false);
  assert.deepEqual(await off.preflightStart(),{disabled:true});
  assert.deepEqual(await off.commitStart(),{disabled:true});
  assert.throws(()=>createFirestorePrivateAttemptStart({enabled:true}),
    /Trusted Firebase transaction client/);
});
test("QN11.6.1 initial start is atomic, pinned, has legacy-compatible DTO and stats",async()=>{
  const f=await fixture();
  const proof=await f.preflight();
  assert.equal(proof.authorized,true);
  assert.equal(proof.revisionId,f.currentRevisionId);
  assert.deepEqual(proof.selectedItemIds,items);
  const started=await f.commit(proof);
  assert.equal(started.status,"active");
  assert.equal(started.quizRevisionId,f.currentRevisionId);
  assert.equal(started.ordinal,1);
  assert.equal(started.attemptKind,"standard");
  assert.deepEqual(started.order,items);
  assert.deepEqual(started.optionOrder.itm_a,["oa","ob","oc"]);
  assert.equal(started.totals.possible,9);
  assert.equal(started.answerVersion,0);
  assert.equal(started.currentFrontier,0);
  assert.equal(started.uiState.version,0);
  assert.equal(started.gradeState,"not_started");
  assert.equal(started.provenance,"server_v2");
  assert(!JSON.stringify(started).includes("acceptedAnswers"));
  const stored=(await db.doc("attempts/"+started.attemptId).get()).data();
  assert.equal(stored.privateBundleHash,proof.bundleHash);
  assert.equal(stored.deadlineAt.toMillis()>Date.now(),true);
  assert.equal((await db.doc(f.pp).get()).data().activeAttemptId,started.attemptId);
  const stats=(await db.doc(`quizzes/${f.quizId}/statistics/qrv_current`).get()).data();
  assert.equal(stats.attempts,1);
  assert.equal(stats.active,1);
  assert.equal(stats.uniqueParticipants,1);
});
test("QN11.6.1 active resume returns exactly same attempt with no new Storage requirement",async()=>{
  const f=await fixture();
  const proof=await f.preflight();
  const first=await f.commit(proof);
  const resumeProof=await f.preflight();
  assert.equal(resumeProof.existingAttemptId,first.attemptId);
  assert.deepEqual(await f.commit(resumeProof,{plan:null}),first);
  assert.equal((await db.doc(f.pp).get()).data().attemptCount,1);
});
test("QN11.6.1 same request ID after submission replays original start, never creates an extra",async()=>{
  const f=await fixture(),proof=await f.preflight();
  const requestId=ident("request_");
  const first=await f.commit(proof,{requestId});
  await db.doc("attempts/"+first.attemptId).update({status:"submitted"});
  await db.doc(f.pp).update({activeAttemptId:null});
  const retry=await f.commit(proof,{requestId});
  assert.equal(retry.attemptId,first.attemptId);
  assert.equal(retry.status,"submitted");
  assert.equal((await db.doc(f.pp).get()).data().attemptCount,1);
  await assert.rejects(f.commit(proof,{requestId,
    sourceAttemptId:"att_other"}),why("INVALID_FIELDS"));
});
test("QN11.6.1 concurrent starts commit just one active attempt and one count",async()=>{
  const f=await fixture(),proof=await f.preflight();
  const [a,b]=await Promise.all([
    f.commit(proof,{requestId:ident("request_")}),
    f.commit(proof,{requestId:ident("request_")}),
  ]);
  assert.equal(a.attemptId,b.attemptId);
  assert.equal((await db.doc(f.pp).get()).data().attemptCount,1);
  const stats=(await db.doc(`quizzes/${f.quizId}/statistics/qrv_current`).get()).data();
  assert.equal(stats.attempts,1);
});
test("QN11.6.1 revoked access and disabled role after preflight fail at commit",async()=>{
  const f=await fixture(),proof=await f.preflight();
  await db.doc(f.pp).set({accessStatus:"revoked",attemptCount:0,
    activeAttemptId:null,version:1}, {merge:true});
  await assert.rejects(f.commit(proof),why("ACCESS_REVOKED"));
  assert.equal((await db.doc(f.pp).get()).data().attemptCount,0);
  const g=await fixture(),p=await g.preflight();
  await db.doc("roles/"+g.uid).update({accountStatus:"disabled",version:2});
  await assert.rejects(g.commit(p),why("ACCOUNT_DISABLED"));
  assert.equal((await db.doc(g.pp).get()).exists,false);
});
test("QN11.6.1 denied approval, future opening and attempt limits match legacy",async()=>{
  const f=await fixture({quizOverrides:{
    accessMode:"approval",visibility:"private"}});
  await assert.rejects(f.preflight(),why("ROLE_REQUIRED"));
  await db.doc(f.pp).set({accessStatus:"approved",attemptCount:0,
    activeAttemptId:null,version:1});
  assert.equal((await f.preflight()).authorized,true);
  const f2=await fixture({quizOverrides:{
    opensAt:Timestamp.fromMillis(Date.now()+120000)}});
  await assert.rejects(f2.preflight(),why("QUIZ_NOT_OPEN"));
  const limited=await fixture({quizOverrides:{maxAttempts:1},
    part:{accessStatus:"approved",attemptCount:1,extraAttempts:0,
      activeAttemptId:null,version:2}});
  await assert.rejects(limited.preflight(),why("ATTEMPT_LIMIT"));
  await db.doc(limited.pp).update({extraAttempts:1,version:3});
  const allowed=await limited.preflight();
  assert.equal((await limited.commit(allowed)).ordinal,2);
  const after=await limited.preflight();
  assert.equal(after.existingAttemptId!=null,true);
});
test("QN11.6.1 stale quiz/participant version, republish and bad pins fail closed",async()=>{
  const f=await fixture(),proof=await f.preflight();
  await db.doc("quizzes/"+f.quizId).update({version:2});
  await assert.rejects(f.commit(proof),why("VERSION_CONFLICT"));
  const g=await fixture(),pg=await g.preflight();
  await db.doc(g.pp).set({attemptCount:0,version:1,accessStatus:"approved",
    activeAttemptId:null});
  await assert.rejects(g.commit(pg),why("VERSION_CONFLICT"));
  const h=await fixture(),ph=await h.preflight();
  await db.doc("quizzes/"+h.quizId).update({
    publishedRevisionId:"qrv_new",version:2});
  await assert.rejects(h.commit(ph),why("VERSION_CONFLICT"));
  const k=await fixture(),pk=await k.preflight();
  await assert.rejects(k.commit(pk,{plan:planOf(pk,selected,
    {bundleHash:"c".repeat(64)})}),why("VERSION_CONFLICT"));
  assert.equal((await db.doc(k.pp).get()).exists,false);
});
test("QN11.6.1 preserves close cutoff and duration with server-side deadline",async()=>{
  const settingsShort={...settings,durationSeconds:1800};
  const closesAt=Timestamp.fromMillis(Date.now()+120000);
  const f=await fixture({quizOverrides:{closesAt},settingsOverride:settingsShort});
  const p=await f.preflight(),reply=await f.commit(p);
  const snap=(await db.doc("attempts/"+reply.attemptId).get()).data();
  assert.equal(snap.deadlineAt.toMillis(),closesAt.toMillis());
  assert.equal(snap.closedAtSnapshot.toMillis(),closesAt.toMillis());
  const g=await fixture(),proof=await g.preflight();
  await db.doc("quizzes/"+g.quizId).update({
    closesAt:Timestamp.fromMillis(Date.now()-1000)});
  await assert.rejects(g.commit(proof),why("QUIZ_CLOSED"));
});
test("QN11.6.1 shuffles questions/options without changing pinned identities or points",async()=>{
  const shuffledSettings={...settings,shuffleQuestions:true,
    shuffleOptions:true};
  const f=await fixture({settingsOverride:shuffledSettings});
  const p=await f.preflight(),r=await f.commit(p);
  assert.deepEqual([...r.order].sort(),[...items].sort());
  assert.deepEqual([...r.optionOrder.itm_a].sort(),["oa","ob","oc"]);
  assert.deepEqual([...r.optionOrder.itm_b].sort(),["od","oe"]);
  assert.equal(r.totals.possible,9);
});
test("QN11.6.1 retry selects only final released incorrect/skipped questions",async()=>{
  const f=await fixture({quizOverrides:{maxAttempts:3}});
  const sourceId=ident("att_source_"),oldRevisionId="qrv_previous";
  const oldSettings={...settings,shuffleQuestions:true,shuffleOptions:true,
    durationSeconds:600};
  await db.doc(`quizzes/${f.quizId}/revisions/${oldRevisionId}`).set(
    frozen(oldRevisionId,{settings:oldSettings,
      bundle:{sha256:"b".repeat(64),generation:"2012"}}));
  await db.doc("attempts/"+sourceId).set({
    schemaVersion:2,studentId:f.uid,quizId:f.quizId,
    quizRevisionId:oldRevisionId,quizOwnerId:f.quiz.ownerId,
    order:items,status:"submitted",gradeState:"final",
    gradeVersion:2,settingsSnapshot:oldSettings,
    scoreReleasedAt:Timestamp.now(),
  });
  await Promise.all([
    db.doc(`attempts/${sourceId}/grades/itm_a`).set({status:"incorrect"}),
    db.doc(`attempts/${sourceId}/grades/itm_b`).set({status:"correct"}),
    db.doc(`attempts/${sourceId}/grades/itm_c`).set({status:"skipped"}),
  ]);
  const proof=await f.preflight(sourceId);
  assert.equal(proof.revisionId,oldRevisionId);
  assert.deepEqual(proof.selectedItemIds,["itm_a","itm_c"]);
  assert.equal(proof.settingsSnapshot.durationSeconds,600);
  const original=planOf(proof,selected);
  const reply=await f.commit(proof,{sourceAttemptId:sourceId,plan:original});
  assert.equal(reply.attemptKind,"retry_incorrect");
  assert.equal(reply.sourceAttemptId,sourceId);
  assert.equal(reply.quizRevisionId,oldRevisionId);
  assert.equal(reply.totals.possible,6);
  assert.deepEqual([...reply.order].sort(),["itm_a","itm_c"]);
  assert.equal(reply.settings.durationSeconds,600);
  const oldStats=await db.doc(`quizzes/${f.quizId}/statistics/${oldRevisionId}`).get();
  assert.equal(oldStats.exists,false,
    "Retry-incorrect does not inflate regular-quiz statistics");
});
test("QN11.6.1 retry with missing/revoked grade release or changed selected keys fails",async()=>{
  const f=await fixture();
  const sourceId=ident("att_source_");
  await db.doc("attempts/"+sourceId).set({
    studentId:f.uid,quizId:f.quizId,quizRevisionId:f.currentRevisionId,
    order:items,status:"submitted",gradeState:"final",
    gradeVersion:1,settingsSnapshot:settings,
    scoreReleasedAt:Timestamp.now(),
  });
  await db.doc(`attempts/${sourceId}/grades/itm_a`).set({status:"incorrect"});
  const p=await f.preflight(sourceId);
  await db.doc(`attempts/${sourceId}/grades/itm_a`).update({status:"correct"});
  await assert.rejects(f.commit(p,{sourceAttemptId:sourceId}),why("FAILED_PRECONDITION"));
  await db.doc("attempts/"+sourceId).update({gradeState:"running"});
  await assert.rejects(f.preflight(sourceId),why("RESOURCE_UNAVAILABLE"));
});
test("QN11.6.1 expired active attempt is timed out and replaced atomically if permitted",async()=>{
  const f=await fixture({quizOverrides:{maxAttempts:2},
    part:{attemptCount:1,extraAttempts:0,
      accessStatus:"approved",activeAttemptId:"att_expired",version:1}});
  await db.doc("attempts/att_expired").set({
    schemaVersion:2,studentId:f.uid,quizId:f.quizId,
    quizOwnerId:f.quiz.ownerId,quizRevisionId:f.currentRevisionId,
    quizTitle:"Mathematics Quiz",ordinal:1,attemptKind:"standard",
    status:"active",gradeState:"not_started",
    settingsSnapshot:settings,
    startedAt:Timestamp.fromMillis(Date.now()-400000),
    deadlineAt:Timestamp.fromMillis(Date.now()-1000),
    closedAtSnapshot:null,totals:{score:null,percentage:null,possible:9},
    order:items,answerVersion:0,gradeVersion:0,
  });
  const proof=await f.preflight();
  assert.equal(proof.existingAttemptId,undefined);
  const reply=await f.commit(proof);
  assert.equal(reply.ordinal,2);
  assert.equal((await db.doc("attempts/att_expired").get()).data().status,
    "timed_out");
  const job=(await db.doc("attempts/att_expired").get()).data().gradingJobId;
  assert.equal((await db.doc("jobs/"+job).get()).data().kind,"grade_attempt");
  assert.equal((await db.doc(f.pp).get()).data().attemptCount,2);
});

function publishedFixture(f){
  const payload=preparePublishedBundle({
    format:BUNDLE_FORMAT,quizId:f.quizId,
    revisionId:f.currentRevisionId,revisionNumber:1,
    title:"Mathematics Quiz",description:"",
    subject:"Math",difficulty:"",settings,
    itemOrder:items,itemCount:3,totalPoints:9,
    items:items.map((itemId,i)=>({
      itemId,problemId:"prb_"+i,problemRevisionId:"prv_"+i,
      points:selected[i].points,
      content:{type:"open",answerMode:"auto",
        statementLatex:"Question "+i,options:[],
        defaultPoints:selected[i].points,
        questionAssetBindings:{}},
      grading:{correctOptionId:null,
        acceptedAnswers:["supersecret_answer_"+i],tolerance:0,
        explanationLatex:"",rubricLatex:"",
        solutionAssetBindings:{}},
    })),
  });
  const manifest=makePublishedBundleManifest(payload,"1001");
  return {payload,manifest};
}
test("QN11.6.1 full staged bundle start loads protected bytes outside Firestore, then replays",async()=>{
  const f=await fixture(),{payload,manifest}=publishedFixture(f);
  await db.doc(`quizzes/${f.quizId}/revisions/${f.currentRevisionId}`)
    .update({bundle:manifest});
  let privateReads=0;
  const service=createQuizerPrivateStartAndExport({enabled:true,
    preflightStart:f.svc.preflightStart,
    commitStart:f.svc.commitStart,
    loadRevision:async({quizId,revisionId})=>
      (await db.doc(`quizzes/${quizId}/revisions/${revisionId}`).get()).data(),
    readPrivateObject:async({generation,storagePath})=>{
      privateReads++;
      assert.equal(generation,manifest.generation);
      assert.equal(storagePath,manifest.storagePath);
      return {bytes:payload.bytes,generation,contentType:BUNDLE_CONTENT_TYPE};
    },
    authorizeExport:async()=>({authorized:false}),
    verifyExportAssets:async()=>false,
  });
  const requestId=ident("request_");
  const first=await service.start({
    firebaseAuth:f.auth,quizId:f.quizId,requestId});
  assert.equal(first.quizRevisionId,f.currentRevisionId);
  assert.equal(first.totals.possible,9);
  assert(!JSON.stringify(first).includes("supersecret_answer"));
  assert.equal(privateReads,1);
  await db.doc("attempts/"+first.attemptId).update({status:"submitted"});
  await db.doc(f.pp).update({activeAttemptId:null});
  const second=await service.start({
    firebaseAuth:f.auth,quizId:f.quizId,requestId});
  assert.equal(second.attemptId,first.attemptId);
  assert.equal(second.status,"submitted");
  assert.equal(privateReads,1,"Receipt replay needs no private Storage read");
  assert.equal((await db.doc(f.pp).get()).data().attemptCount,1);
});
test("QN11.6.1 Storage failure leaves no attempt, participant, job or statistics",async()=>{
  const f=await fixture(),{manifest}=publishedFixture(f);
  await db.doc(`quizzes/${f.quizId}/revisions/${f.currentRevisionId}`)
    .update({bundle:manifest});
  const service=createQuizerPrivateStartAndExport({enabled:true,
    preflightStart:f.svc.preflightStart,
    commitStart:f.svc.commitStart,
    loadRevision:async({quizId,revisionId})=>
      (await db.doc(`quizzes/${quizId}/revisions/${revisionId}`).get()).data(),
    readPrivateObject:async()=>{throw Error("SIMULATED_PRIVATE_STORAGE_OUTAGE");},
    authorizeExport:async()=>({authorized:false}),
    verifyExportAssets:async()=>false,
  });
  await assert.rejects(service.start({
    firebaseAuth:f.auth,quizId:f.quizId,requestId:ident("request_")}),
    /SIMULATED_PRIVATE_STORAGE_OUTAGE/);
  assert.equal((await db.doc(f.pp).get()).exists,false);
  assert.equal((await db.doc(`quizzes/${f.quizId}/statistics/qrv_current`).get())
    .exists,false);
});
