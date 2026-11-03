// QN11.6.1: trusted Firebase admission + atomic private-bundle start.
// The factory remains DEFAULT OFF and is NOT imported by the active router.
// Preflight is read-only Firestore. Commit is ONE Firestore transaction.
// Private Storage/Neon reads are performed by private-start-export BETWEEN
// these two stages, never inside the transaction or its retry callback.
import {randomUUID,randomInt} from "node:crypto";
import {assert,id,number} from "../../shared/schema.js";
import {
  Context,transact,admission,released,requireRole,millis,Timestamp,
} from "../domain/runtime.js";
import {attemptDTO,expire} from "../api/attempts.js";
import {participant} from "../api/access.js";
import {updateStatistics} from "../domain/statistics.js";
import {fingerprint} from "../neon/write-repository.js";

const startId=()=>randomUUID().replaceAll("-","_");
function shuffled(values) {
  const out=[...values];
  for(let i=out.length-1;i>0;i--){
    const j=randomInt(i+1);
    [out[i],out[j]]=[out[j],out[i]];
  }
  return out;
}
const sameIds=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&
  a.length===b.length&&a.every((v,i)=>v===b[i]);
const fail=(reason,message)=>assert(false,reason,message);
const pPart=(quizId,uid)=>`quizzes/${quizId}/participants/${uid}`;
const pRevision=(quizId,revisionId)=>
  `quizzes/${quizId}/revisions/${revisionId}`;
const hasDeadlinePassed=(a,now)=>!!a?.deadlineAt&&
  millis(a.deadlineAt)<=millis(now);
const requestKey=requestId=>{
  if(requestId==null)return startId();
  assert(typeof requestId==="string"&&
    /^[a-zA-Z0-9_-]{16,100}$/.test(requestId),
    "INVALID_FIELDS","A valid start request ID is required.");
  return requestId;
};
async function sourceSelection(c,quizId,sourceAttemptId){
  const source=await c.get(`attempts/${id(sourceAttemptId)}`);
  assert(source.studentId===c.actor.uid&&source.quizId===quizId&&
    source.status!=="active"&&source.gradeState==="final"&&
    released(source,"score",c.now)&&
    Array.isArray(source.order)&&source.order.length>0&&
    source.order.length<=500&&
    new Set(source.order).size===source.order.length,
    "RESOURCE_UNAVAILABLE","A released, fully marked result is required.");
  const sourceRevision=await c.get(pRevision(quizId,source.quizRevisionId));
  assert(sourceRevision.state==="ready"&&sourceRevision.bundle,
    "RESOURCE_UNAVAILABLE","Pinned retry revision unavailable.");
  const grades=await c.all(`attempts/${sourceAttemptId}/grades`,[],
    "__name__","asc",500);
  const retryIds=new Set(grades.filter(g=>
    ["incorrect","skipped"].includes(g.status)).map(g=>g.id));
  const selected=source.order.filter(itemId=>retryIds.has(itemId));
  assert(selected.length>0,"FAILED_PRECONDITION",
    "There are no incorrect or skipped problems to retry.");
  assert(selected.every(x=>sourceRevision.itemOrder.includes(x)),
    "VERSION_CONFLICT","Retry source revision no longer matches its items.");
  return {source,revision:sourceRevision,
    revisionId:source.quizRevisionId,selected,
    settings:source.settingsSnapshot,
    sourceGradeVersion:source.gradeVersion??0};
}
async function snapshot(c,quizId,sourceAttemptId,{allowExisting=true}={}){
  requireRole(c.actor,"verified");
  const quiz=await c.get(`quizzes/${quizId}`);
  const pp=pPart(quizId,c.actor.uid);
  const part=await c.get(pp,false);
  if(allowExisting && part?.activeAttemptId){
    const existing=await c.get(`attempts/${part.activeAttemptId}`,false);
    if(existing?.status==="active" && !hasDeadlinePassed(existing,c.now)){
      assert(existing.studentId===c.actor.uid&&existing.quizId===quizId,
        "RESOURCE_UNAVAILABLE","Participant attempt does not match.");
      return {kind:"existing",quiz,part,
        existingAttemptId:part.activeAttemptId,
        existingRevisionId:existing.quizRevisionId};
    }
  }
  admission(quiz,part,c.actor,c.now);
  const latest=await c.get(pRevision(quizId,quiz.publishedRevisionId));
  assert(latest.state==="ready"&&latest.bundle,
    "RESOURCE_UNAVAILABLE","Current private quiz publication unavailable.");
  const retry=sourceAttemptId
    ? await sourceSelection(c,quizId,sourceAttemptId):null;
  const revision=retry?.revision??latest;
  const revisionId=retry?.revisionId??quiz.publishedRevisionId;
  assert(Array.isArray(revision.itemOrder)&&revision.itemOrder.length>0&&
    revision.itemOrder.length<=500&&
    new Set(revision.itemOrder).size===revision.itemOrder.length&&
    revision.bundle?.sha256&&revision.bundle?.generation,
    "RESOURCE_UNAVAILABLE","Private publication is incomplete.");
  const selected=retry?.selected??[...revision.itemOrder];
  return {kind:"new",quiz,part,revision,revisionId,selected,
    settings:retry?.settings??revision.settings,
    sourceGradeVersion:retry?.sourceGradeVersion??null,
    sourceAttemptId:sourceAttemptId??null,
    sourceRevisionId:retry?.source?.quizRevisionId??null,
    quizVersion:quiz.version,
    participantVersion:part?.version??0};
}
function proofOf(state,actor,quizId){
  if(state.kind==="existing")
    return {authorized:true,actorUid:actor.uid,quizId,
      existingAttemptId:state.existingAttemptId,
      revisionId:state.existingRevisionId};
  return {authorized:true,actorUid:actor.uid,quizId,
    revisionId:state.revisionId,selectedItemIds:state.selected,
    settingsSnapshot:state.settings,
    sourceGradeVersion:state.sourceGradeVersion,
    sourceAttemptId:state.sourceAttemptId,
    sourceRevisionId:state.sourceRevisionId,
    quizVersion:state.quizVersion,
    participantVersion:state.participantVersion,
    bundleHash:state.revision.bundle.sha256,
    bundleGeneration:String(state.revision.bundle.generation),
    revisionHash:fingerprint({
      itemOrder:state.revision.itemOrder,settings:state.revision.settings,
      title:state.revision.title,totalPoints:state.revision.totalPoints,
      bundle:state.revision.bundle,
    })};
}
export function createFirestorePrivateAttemptStart({
  enabled=false,db,
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,preflightStart:async()=>({disabled:true}),
    commitStart:async()=>({disabled:true}),
  });
  assert(typeof db?.runTransaction==="function"&&
    typeof db?.doc==="function","INVALID_FIELDS",
    "Trusted Firebase transaction client required.");
  async function preflightStart({firebaseAuth,quizId,
    sourceAttemptId=null,requestId=null}={}){
    id(quizId,"quiz ID");
    if(sourceAttemptId!==null)id(sourceAttemptId,"retry source ID");
    assert(firebaseAuth?.uid&&firebaseAuth?.token&&
      typeof firebaseAuth.token==="object",
      "AUTH_REQUIRED","Verified Firebase callable identity required.");
    return db.runTransaction(async tx=>{
      const c=new Context(db,tx,firebaseAuth,
        "bundle.attempt.preflight",startId(),Timestamp.now());
      await c.loadActor();
      requireRole(c.actor,"verified");
      if(requestId!==null){
        const rid=requestKey(requestId);
        const receipt=await c.get(
          `operations/${c.actor.uid}/requests/${rid}`,false);
        if(receipt){
          const expected=fingerprint({
            action:"startAttempt",quizId,sourceAttemptId,
          });
          assert(receipt.action==="startAttempt" &&
            receipt.payloadHash===expected,
            "INVALID_FIELDS","Start request ID was reused.");
          const attempt=await c.get(`attempts/${receipt.attemptId}`);
          assert(attempt.quizId===quizId&&
            attempt.studentId===c.actor.uid,
            "RESOURCE_UNAVAILABLE","Previous start request unavailable.");
          return {authorized:true,actorUid:c.actor.uid,quizId,
            existingAttemptId:receipt.attemptId,
            revisionId:attempt.quizRevisionId};
        }
      }
      const state=await snapshot(c,quizId,sourceAttemptId);
      return proofOf(state,c.actor,quizId);
    });
  }
  async function commitStart({firebaseAuth,quizId,
    sourceAttemptId=null,requestId,proof,plan}={}){
    id(quizId,"quiz ID");
    if(sourceAttemptId!==null)id(sourceAttemptId,"retry source ID");
    assert(firebaseAuth?.uid && firebaseAuth?.token &&
      proof?.authorized===true && proof.actorUid===firebaseAuth.uid &&
      proof.quizId===quizId,
      "AUTH_REQUIRED","Trusted Firebase preflight required.");
    const rid=requestKey(requestId);
    // The original request ID is persisted in transaction data for
    // deterministic attempt IDs and audit IDs. No external IO inside fn.
    return transact(db,"bundle.attempt.start",rid,async c=>{
      requireRole(c.actor,"verified");
      assert(c.actor.uid===proof.actorUid,"AUTH_REQUIRED",
        "Preflight actor changed.");
      const receiptPath=`operations/${c.actor.uid}/requests/${rid}`;
      const payloadHash=fingerprint({
        action:"startAttempt",quizId,sourceAttemptId,
      });
      const priorReceipt=await c.get(receiptPath,false);
      if(priorReceipt){
        assert(priorReceipt.action==="startAttempt" &&
          priorReceipt.payloadHash===payloadHash,
          "INVALID_FIELDS","Start request ID reused with another quiz/retry.");
        const original=await c.get(`attempts/${priorReceipt.attemptId}`);
        assert(original.studentId===c.actor.uid&&original.quizId===quizId,
          "RESOURCE_UNAVAILABLE","Previous start request unavailable.");
        return attemptDTO(c,original,priorReceipt.attemptId);
      }
      const quiz=await c.get(`quizzes/${quizId}`);
      const pp=pPart(quizId,c.actor.uid);
      let part=await c.get(pp,false);
      const initialParticipantVersion=part?.version??0;
      if(part?.activeAttemptId){
        let existing=await c.get(`attempts/${part.activeAttemptId}`,false);
        if(existing?.status==="active"){
          assert(existing.studentId===c.actor.uid&&existing.quizId===quizId,
            "RESOURCE_UNAVAILABLE","Participant attempt does not match.");
          if(!hasDeadlinePassed(existing,c.now)){
            c.set(receiptPath,{
              action:"startAttempt",payloadHash,
              attemptId:part.activeAttemptId,createdAt:c.now,
            });
            return attemptDTO(c,existing,part.activeAttemptId);
          }
          // Preserve the legacy expiry/job/statistics semantics atomically.
          existing=await expire(c,part.activeAttemptId,existing);
        }
        part=await c.get(pp,false);
      }
      assert(!proof.existingAttemptId,"VERSION_CONFLICT",
        "Previously active attempt is no longer resumable.");
      // Roles, current visibility, approval, dates, extra attempts and limits
      // can change between preflight and private Storage read.
      admission(quiz,part,c.actor,c.now);
      assert(quiz.version===proof.quizVersion &&
        initialParticipantVersion===proof.participantVersion,
        "VERSION_CONFLICT","Quiz or participant changed during admission.");
      assert(!!plan && plan.revisionId===proof.revisionId &&
        plan.bundleHash===proof.bundleHash &&
        Array.isArray(plan.selected) &&
        plan.selected.length===proof.selectedItemIds.length &&
        plan.selected.length<=500 &&
        sameIds(plan.selected.map(x=>x.itemId),proof.selectedItemIds),
        "VERSION_CONFLICT","Private start plan differs from preflight.");
      const revisionId=id(proof.revisionId);
      if(!sourceAttemptId)
        assert(quiz.publishedRevisionId===revisionId,
          "VERSION_CONFLICT","Quiz was republished during admission.");
      else
        assert(sourceAttemptId===proof.sourceAttemptId,
          "VERSION_CONFLICT","Retry source changed.");
      const latest=await c.get(pRevision(quizId,quiz.publishedRevisionId));
      assert(latest.state==="ready"&&latest.bundle,
        "RESOURCE_UNAVAILABLE","Current publication unavailable.");
      const retry=sourceAttemptId
        ? await sourceSelection(c,quizId,sourceAttemptId):null;
      const revision=retry?.revision??latest;
      const settings=retry?.settings??revision.settings;
      assert((retry?.revisionId??quiz.publishedRevisionId)===revisionId &&
        sameIds(retry?.selected??revision.itemOrder,proof.selectedItemIds)&&
        (retry?.sourceGradeVersion??null)===proof.sourceGradeVersion&&
        revision.bundle?.sha256===proof.bundleHash&&
        String(revision.bundle?.generation)===proof.bundleGeneration&&
        fingerprint({itemOrder:revision.itemOrder,settings:revision.settings,
          title:revision.title,totalPoints:revision.totalPoints,
          bundle:revision.bundle})===proof.revisionHash&&
        fingerprint(settings)===fingerprint(plan.settings),
        "VERSION_CONFLICT","Pinned private revision or retry eligibility changed.");
      let total=0;const optionOrder=Object.create(null);
      for(const item of plan.selected){
        const itemId=id(item.itemId,"selected item ID");
        assert(revision.itemOrder.includes(itemId) &&
          Array.isArray(item.optionIds) &&
          item.optionIds.length<=12 &&
          new Set(item.optionIds).size===item.optionIds.length,
          "VERSION_CONFLICT","Selected question is not in pinned revision.");
        const points=number(item.points,"Question points",0.00000001,1000);
        total+=points;
        const ids=item.optionIds.map(x=>id(x,"option ID"));
        optionOrder[itemId]=settings.shuffleOptions?shuffled(ids):ids;
      }
      assert(total>0 && Number.isFinite(total),"VERSION_CONFLICT",
        "Selected question total is invalid.");
      if(!sourceAttemptId)
        assert(Math.abs(total-revision.totalPoints)<1e-7,
          "VERSION_CONFLICT","Private start total does not match revision.");
      const order=settings.shuffleQuestions
        ? shuffled(proof.selectedItemIds):[...proof.selectedItemIds];
      const nowMs=millis(c.now);
      const duration=number(settings.durationSeconds,
        "Duration",0,604800,true);
      const end=Math.min(duration ? nowMs+duration*1000:Infinity,
        quiz.closesAt ? millis(quiz.closesAt):Infinity);
      const profile=await c.get(`users/${c.actor.uid}`,false);
      const attemptId=c.key("att_",quizId);
      const a={
        schemaVersion:2,
        studentId:c.actor.uid,
        studentDisplayName:profile?.displayName??c.actor.displayName,
        studentEmail:c.actor.email,
        quizId,quizOwnerId:quiz.ownerId,quizRevisionId:revisionId,
        quizTitle:revision.title,
        ordinal:(part?.attemptCount??0)+1,
        attemptKind:sourceAttemptId?"retry_incorrect":"standard",
        sourceAttemptId:sourceAttemptId??null,
        status:"active",gradeState:"not_started",
        startedAt:c.now,
        deadlineAt:Number.isFinite(end)?Timestamp.fromMillis(end):null,
        closedAtSnapshot:quiz.closesAt??null,
        submittedAt:null,finalizedAt:null,lastSavedAt:null,
        currentFrontier:0,
        uiState:{currentIndex:0,flaggedItemIds:[],version:0},
        order,optionOrder,settingsSnapshot:settings,
        answeredCount:0,answeredItemIds:[],answerVersion:0,gradeVersion:0,
        scoreReleasedAt:null,solutionsReleasedAt:null,
        terminationReason:null,provenance:"server_v2",
        privateBundleHash:proof.bundleHash,
        totals:{score:null,possible:Math.round(total*1e8)/1e8,
          percentage:null,correct:0,incorrect:0,skipped:0,
          pending:0,partial:0},
      };
      await updateStatistics(c,null,a);
      c.set(`attempts/${attemptId}`,a);
      c.set(receiptPath,{
        action:"startAttempt",payloadHash,attemptId,createdAt:c.now,
      });
      c.set(pp,{
        ...(part??participant(c,quizId,quiz)),
        displayName:a.studentDisplayName,email:a.studentEmail,
        attemptCount:a.ordinal,activeAttemptId:attemptId,
        latestAttemptId:attemptId,
        version:(part?.version??0)+1,updatedAt:c.now,
      });
      c.audit("attempt.started","attempt",attemptId,{
        quizId,quizOwnerId:quiz.ownerId,affectedUserId:c.actor.uid,
      });
      return attemptDTO(c,a,attemptId);
    },firebaseAuth);
  }
  return Object.freeze({enabled:true,preflightStart,commitStart});
}
