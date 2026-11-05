// QN10.3 — private, server-only, DISABLED-BY-DEFAULT bundle attempt service.
// NOT wired into active Firebase handlers. Browser data never provides actor,
// pinned revision, quiz-owner status, grading keys, or a Storage object path.
// All IO is through trusted Firebase/Admin SDK ports and outside Firestore
// retry callbacks; future transaction commit MUST recheck attempt/job versions.
import {
  assert, id, number, fields, text, studentItem, byteSize,
} from "../../shared/schema.js";
import { requireRole, released, millis } from "../domain/runtime.js";
import { attemptDTO } from "../api/attempts.js";
import { gradeSnapshotAnswer } from "../../shared/grading.js";
import { fingerprint } from "../neon/write-repository.js";
import { readPrivatePublishedBundle } from "./published-bundle.js";

const MAX_SLICE = 20;
const MAX_RESPONSE_BYTES = 1000000;
const MAX_GRADING_BATCH = 20;
const emptyAnswer = () => ({value:"",revision:0,updatedAt:null});

function staffFor(actor,a) {
  return !!actor?.emailVerified &&
    ["teacher","admin"].includes(actor.role) &&
    (a.quizOwnerId===actor.uid || actor.role==="admin");
}
function assertActor(actor,a,staffOnly=false) {
  requireRole(actor,"user");
  assert(a && (staffOnly ? staffFor(actor,a) :
    a.studentId===actor.uid || staffFor(actor,a)),
    "RESOURCE_UNAVAILABLE","This attempt is unavailable.");
  return staffFor(actor,a);
}
function checkAttempt(a,now) {
  assert(a && typeof a==="object" && Array.isArray(a.order) &&
    a.order.length>=1 && a.order.length<=500 &&
    new Set(a.order).size===a.order.length &&
    a.order.every(i=>typeof i==="string"),"RESOURCE_UNAVAILABLE",
    "Invalid saved attempt order.");
  assert(a.quizId && a.quizRevisionId && a.settingsSnapshot,
    "RESOURCE_UNAVAILABLE","Attempt revision not pinned.");
  assert(typeof a.currentFrontier==="number" &&
    Number.isInteger(a.currentFrontier) &&
    a.currentFrontier>=0 && a.currentFrontier<a.order.length,
    "RESOURCE_UNAVAILABLE","Invalid attempt frontier.");
  assert(now instanceof Date && Number.isFinite(now.getTime()),
    "INVALID_FIELDS","Trusted server clock required.");
}
function live(a,now) {
  assert(a.status==="active","ATTEMPT_FROZEN",
    "This attempt has ended.");
  assert(!a.deadlineAt || millis(now)<millis(a.deadlineAt),
    "ATTEMPT_EXPIRED","The saved attempt deadline has passed.");
}
function validateItems(itemIds,a,staff=false,{activeOnly=false}={}) {
  assert(Array.isArray(itemIds) && itemIds.length>0 &&
    itemIds.length<=MAX_SLICE,"INVALID_FIELDS","Request 1–20 questions.");
  const seen=new Set();
  return itemIds.map(itemId=>{
    const key=id(itemId,"item ID");
    assert(!seen.has(key),"INVALID_FIELDS","Duplicate item ID.");
    seen.add(key);
    const index=a.order.indexOf(key);
    assert(index>=0 &&
      (!activeOnly || a.settingsSnapshot.allowBack ||
        index===a.currentFrontier || staff),
      "RESOURCE_UNAVAILABLE","This problem is unavailable.");
    return key;
  });
}
function flatten(item) {
  return {
    itemId:item.itemId,problemId:item.problemId,
    problemRevisionId:item.problemRevisionId,points:item.points,
    type:item.content.type,answerMode:item.content.answerMode,
    statementLatex:item.content.statementLatex,
    options:item.content.options,
    questionAssetBindings:item.content.questionAssetBindings,
  };
}
function sanitizedAnswer(answer) {
  return answer ? {value:answer.value,revision:answer.revision,
    updatedAt:answer.updatedAt} : emptyAnswer();
}
function solutionFor(key,staff) {
  return {
    correctOptionId:key.correctOptionId,acceptedAnswers:key.acceptedAnswers,
    explanationLatex:key.explanationLatex,
    solutionAssetBindings:key.solutionAssetBindings,
    ...(staff?{rubricLatex:key.rubricLatex,tolerance:key.tolerance}:{}),
  };
}

export function createSecureBundleAttemptService({
  enabled=false,
  resolveFirebaseActor, loadAttempt, loadRevision, readPrivateObject,
  loadLegacyItem, loadLegacyGrading, loadAnswer, loadGrade,
  authorizeGradeJob, serverNow=()=>new Date(),
}={}) {
  if(enabled!==true) return Object.freeze({
    enabled:false,
    questions:async()=>({disabled:true}),
    resultPage:async()=>({disabled:true}),
    gradeBatch:async()=>({disabled:true}),
    previewManualGrade:async()=>({disabled:true}),
    validateAnswers:async()=>({disabled:true}),
    allowedAssetIds:async()=>({disabled:true}),
    navigationPreview:async()=>({disabled:true}),
  });
  assert([resolveFirebaseActor,loadAttempt,loadRevision,readPrivateObject,
    loadLegacyItem,loadLegacyGrading,loadAnswer,loadGrade,authorizeGradeJob,
    serverNow].every(fn=>typeof fn==="function"),
    "INVALID_FIELDS","Trusted Firebase/Storage authorization ports required.");

  async function caller(auth,attemptId,{staffOnly=false}={}) {
    const actor=await resolveFirebaseActor(auth);
    const a=await loadAttempt(id(attemptId,"attempt ID"));
    const staff=assertActor(actor,a,staffOnly);
    const now=serverNow();
    checkAttempt(a,now);
    return {actor,a,staff,now,attemptId};
  }
  async function source(a,permission) {
    const quizId=id(a.quizId,"quiz ID"),
      revisionId=id(a.quizRevisionId,"pinned revision ID");
    const revision=await loadRevision({quizId,revisionId});
    assert(revision?.state==="ready" &&
      Array.isArray(revision.itemOrder) &&
      revision.itemOrder.length>0 &&
      revision.itemOrder.length<=500 &&
      new Set(revision.itemOrder).size===revision.itemOrder.length &&
      a.order.every(i=>revision.itemOrder.includes(i)),
      "RESOURCE_UNAVAILABLE","Pinned publication unavailable.");
    if(!revision.bundle) {
      return {
        kind:"legacy",
        getItem:async itemId=>{
          const old=await loadLegacyItem({quizId,revisionId,itemId});
          assert(old && old.itemId===itemId,
            "RESOURCE_UNAVAILABLE","Legacy published item unavailable.");
          return old;
        },
        getKey:async itemId=>{
          // Called ONLY from privileged grade or released result branches.
          const key=await loadLegacyGrading({quizId,revisionId,itemId});
          assert(key && typeof key==="object",
            "RESOURCE_UNAVAILABLE","Legacy grading unavailable.");
          return key;
        },
      };
    }
    // readPrivatePublishedBundle validates generation, SHA, canonical bytes
    // and metadata. The "permission" proof exists only in this trusted
    // server frame after independently verifying actor/attempt/job state.
    assert(permission===true,"RESOURCE_UNAVAILABLE",
      "Private bundle access not authorized.");
    const bundle=await readPrivatePublishedBundle({
      manifest:revision.bundle,quizId,revisionId,
      authorizePinnedRead:async()=>({
        authorized:true,pinnedRevisionId:revisionId,
      }),
      readObject:readPrivateObject,
    });
    assert(bundle.itemCount===revision.itemOrder.length &&
      bundle.itemOrder.every((i,index)=>i===revision.itemOrder[index]),
      "RESOURCE_UNAVAILABLE","Pinned bundle item order changed.");
    const items=new Map(bundle.items.map(item=>[item.itemId,item]));
    return {
      kind:"private",
      getItem:async itemId=>{
        const value=items.get(itemId);
        assert(value,"RESOURCE_UNAVAILABLE","Pinned bundle item unavailable.");
        return flatten(value);
      },
      getKey:async itemId=>{
        const value=items.get(itemId);
        assert(value,"RESOURCE_UNAVAILABLE","Pinned bundle grading unavailable.");
        return value.grading;
      },
    };
  }
  async function questions({firebaseAuth,attemptId,itemIds}={}) {
    const c=await caller(firebaseAuth,attemptId);
    live(c.a,c.now);
    const ids=validateItems(itemIds,c.a,c.staff,{activeOnly:true});
    const s=await source(c.a,true);
    let bytes=0;
    const items=[];
    for(const itemId of ids){
      const item=await s.getItem(itemId);
      const answer=await loadAnswer({attemptId:c.attemptId,itemId});
      const row={...studentItem(item),answer:sanitizedAnswer(answer)};
      const n=byteSize(row);
      assert(n<=MAX_RESPONSE_BYTES,"RESOURCE_UNAVAILABLE",
        "Single question exceeds the response size limit.");
      if(bytes+n>MAX_RESPONSE_BYTES)break;
      bytes+=n;
      items.push(row);
    }
    return {items,remainingItemIds:ids.slice(items.length)};
  }
  async function validateAnswers({firebaseAuth,attemptId,changes}={}) {
    const c=await caller(firebaseAuth,attemptId);
    assert(c.actor.uid===c.a.studentId,"RESOURCE_UNAVAILABLE",
      "Only the student may save responses.");
    live(c.a,c.now);
    assert(Array.isArray(changes) && changes.length>0 &&
      changes.length<=MAX_SLICE && byteSize(changes)<=262144,
      "INVALID_FIELDS","Save 1–20 answers within 256 KiB.");
    const ids=validateItems(changes.map(x=>x?.itemId),c.a,false,{activeOnly:true});
    const s=await source(c.a,true);
    for(let i=0;i<changes.length;i++){
      fields(changes[i],["itemId","value","expectedRevision"],"answer");
      number(changes[i].expectedRevision,"Expected answer revision",
        0,Number.MAX_SAFE_INTEGER,true);
      const item=await s.getItem(ids[i]);
      text(changes[i].value,"Response",
        item.type==="choice"?128:item.answerMode==="manual"?10000:500);
      assert(item.type!=="choice" || changes[i].value==="" ||
        item.options.some(o=>o.id===changes[i].value),
      "INVALID_FIELDS","Choose a valid option.");
    }
    // This is a PRECHECK only. QN11 must recheck frozen attempt/status,
    // answer versions and navigation inside the eventual Firestore write tx.
    return {attemptId:c.attemptId,pinnedRevisionId:c.a.quizRevisionId,
      itemIds:ids,validated:true};
  }
  async function navigationPreview({firebaseAuth,attemptId,targetIndex}={}) {
    const c=await caller(firebaseAuth,attemptId);
    assert(c.actor.uid===c.a.studentId,"RESOURCE_UNAVAILABLE",
      "Only the student may navigate their attempt.");
    live(c.a,c.now);
    const index=number(targetIndex,"Problem number",
      0,c.a.order.length-1,true);
    assert(c.a.settingsSnapshot.allowBack ||
      index===c.a.currentFrontier || index===c.a.currentFrontier+1,
      "INVALID_FIELDS","You can only continue to the next problem.");
    const itemId=c.a.order[index];
    const s=await source(c.a,true);
    const item=await s.getItem(itemId);
    const answer=await loadAnswer({attemptId:c.attemptId,itemId});
    const student={...studentItem(item),answer:sanitizedAnswer(answer)};
    assert(byteSize(student)<=MAX_RESPONSE_BYTES,"RESOURCE_UNAVAILABLE",
      "Single question exceeds the response size limit.");
    // The later Firebase transaction MUST recheck status, deadline, frontier,
    // pinned revision, position and UI version before committing navigation.
    return {attemptId:c.attemptId,pinnedRevisionId:c.a.quizRevisionId,
      targetIndex:index,expectedFrontier:c.a.currentFrontier,
      expectedUiVersion:c.a.uiState?.version??0,item:student};
  }
  async function resultPage({firebaseAuth,attemptId,offset=0,limit=10,
    staffOnly=false}={}) {
    const c=await caller(firebaseAuth,attemptId,{staffOnly});
    assert(c.a.status!=="active" || c.staff,
      "ATTEMPT_FROZEN","Submit before viewing a result.");
    const score=c.staff||released(c.a,"score",c.now),
      solutions=c.staff||released(c.a,"solutions",c.now);
    const from=number(offset,"Offset",0,c.a.order.length,true),
      max=number(limit,"Page size",1,MAX_SLICE,true);
    const ids=c.a.order.slice(from,from+max);
    const s=await source(c.a,true);
    const items=[];
    for(const itemId of ids){
      const [item,answer,grade,key]=await Promise.all([
        s.getItem(itemId),loadAnswer({attemptId:c.attemptId,itemId}),
        score?loadGrade({attemptId:c.attemptId,itemId}):null,
        solutions?s.getKey(itemId):null,
      ]);
      items.push({...studentItem(item),answer:sanitizedAnswer(answer),
        grade:grade?{
          status:grade.status,awarded:grade.awarded,possible:grade.possible,
          feedbackLatex:grade.feedbackLatex,version:grade.version,
          manualPoints:grade.manualPoints,
        }:null,
        solution:key?solutionFor(key,c.staff):null});
    }
    return {
      attempt:attemptDTO({actor:c.actor,now:c.now},c.a,c.attemptId),
      items,nextOffset:from+ids.length<c.a.order.length?from+ids.length:null,
      totalItems:c.a.order.length,
    };
  }
  async function gradeBatch({jobId,attemptId,itemIds}={}) {
    id(jobId,"trusted grading job ID");
    id(attemptId,"attempt ID");
    // Crucial: this proof must be read from a running persisted Firebase job.
    // It is not a caller-provided Boolean, role, or token.
    const job=await authorizeGradeJob({jobId,attemptId});
    assert(job && job.kind==="grade_attempt" &&
      job.targetId===attemptId && job.status==="running" &&
      typeof job.leaseOwner==="string" && job.leaseOwner.length>0,
      "RESOURCE_UNAVAILABLE","Authorized grading job required.");
    const a=await loadAttempt(attemptId);
    checkAttempt(a,serverNow());
    assert(a.status!=="active" && a.gradeVersion===0,
      "FAILED_PRECONDITION","Cannot grade an active or completed attempt.");
    const ids=validateItems(itemIds,a,false);
    assert(ids.length<=MAX_GRADING_BATCH,"INVALID_FIELDS",
      "Too many grading items.");
    const s=await source(a,true);
    const grades=[];
    for(const itemId of ids){
      const [item,key,answer]=await Promise.all([
        s.getItem(itemId),s.getKey(itemId),
        loadAnswer({attemptId,itemId}),
      ]);
      const g=gradeSnapshotAnswer(item,key,answer?.value??"",null,
        a.settingsSnapshot.penalty);
      grades.push({itemId,...g,gradedBy:"system",gradingVersion:1,
        feedbackLatex:"",version:1});
    }
    // DO NOT return keys/solutions; QN11 must persist inside a Firestore
    // transaction that rechecks gradeVersion, job lease and attempt pin.
    return {attemptId,jobId,pinnedRevisionId:a.quizRevisionId,
      grades,leaseOwner:job.leaseOwner};
  }
  async function previewManualGrade({firebaseAuth,attemptId,itemId,
    points,feedback="",reason="",expectedGradeVersion}={}) {
    const c=await caller(firebaseAuth,attemptId,{staffOnly:true});
    assert(c.a.status!=="active" &&
      ["pending_manual","final"].includes(c.a.gradeState),
      "FAILED_PRECONDITION","Wait for automatic grading to finish.");
    number(expectedGradeVersion,"Expected grade version",
      1,Number.MAX_SAFE_INTEGER,true);
    assert(c.a.gradeVersion===expectedGradeVersion,
      "VERSION_CONFLICT","Grades were changed elsewhere.");
    const keyId=id(itemId,"item ID");
    assert(c.a.order.includes(keyId),"RESOURCE_UNAVAILABLE",
      "Problem unavailable.");
    text(feedback,"Feedback",30000);
    text(reason,"Reason",500);
    const s=await source(c.a,true);
    const [item,key,answer,old]=await Promise.all([
      s.getItem(keyId),s.getKey(keyId),
      loadAnswer({attemptId,itemId:keyId}),
      loadGrade({attemptId,itemId:keyId}),
    ]);
    assert(item?.answerMode==="manual",
      "INVALID_FIELDS","This response is automatically marked.");
    assert(old && old.gradingVersion===1 &&
      Number.isInteger(old.version) && old.version>=1,
      "RESOURCE_UNAVAILABLE","Original grade unavailable.");
    number(points,"Mark",0,item.points);
    assert(typeof answer?.value==="string" && answer.value.trim(),
      "INVALID_FIELDS","An unanswered problem is marked as skipped.");
    if(old.manualPoints!=null)
      text(reason,"Correction reason",500,true);
    const grade={...gradeSnapshotAnswer(item,key,answer.value,points,
      c.a.settingsSnapshot.penalty),feedbackLatex:feedback,
      gradedBy:c.actor.uid,gradingVersion:1};
    assert(grade.manualPoints===points &&
      grade.status!=="pending" && grade.status!=="skipped",
      "FAILED_PRECONDITION","Invalid manually marked answer.");
    // Only protected metadata and a hashed answer are returned to the
    // Firebase transaction adapter. Never return the grading key itself.
    return {verifiedManual:true,attemptId,itemId:keyId,
      pinnedRevisionId:c.a.quizRevisionId,
      expectedGradeVersion,points,feedback,reason,grade,
      answerHash:fingerprint(answer.value),
      oldGradeVersion:old.version,
      oldGradeHash:fingerprint({status:old.status,awarded:old.awarded,
        possible:old.possible,manualPoints:old.manualPoints??null,
        version:old.version})};
  }
  async function allowedAssetIds({firebaseAuth,attemptId,itemIds,
    result=false}={}) {
    const c=await caller(firebaseAuth,attemptId);
    if(!result)live(c.a,c.now);
    else assert(c.a.status!=="active" || c.staff,
      "ATTEMPT_FROZEN","Results unavailable.");
    const ids=validateItems(itemIds,c.a,c.staff,{activeOnly:!result});
    const showSolutions=result&&(c.staff||released(c.a,"solutions",c.now));
    const s=await source(c.a,true), allowed=new Set();
    for(const itemId of ids){
      const item=await s.getItem(itemId);
      for(const v of Object.values(item.questionAssetBindings??{}))allowed.add(v);
      if(showSolutions){
        const key=await s.getKey(itemId);
        for(const v of Object.values(key.solutionAssetBindings??{}))allowed.add(v);
      }
    }
    return {assetIds:[...allowed].sort()};
  }
  return Object.freeze({
    enabled:true,questions,validateAnswers,navigationPreview,
    resultPage,gradeBatch,previewManualGrade,allowedAssetIds,
  });
}
