// QN11.6.2 — default-OFF, trusted Firestore grade completion and release.
// The worker's private Storage/Neon reads happen BEFORE these short transactions.
// Never mounted in the active router or worker; legacy stays authoritative.
import {assert,id,number,text,version,fields} from "../../shared/schema.js";
import {summarize} from "../../shared/grading.js";
import {transact,requireRole,manage,millis} from "../domain/runtime.js";
import {attemptManager} from "../api/attempts.js";
import {updateStatistics} from "../domain/statistics.js";
import {fingerprint} from "../neon/write-repository.js";

const gradePath=(attemptId,itemId)=>"attempts/"+attemptId+"/grades/"+itemId;
function frozen(a) {
  assert(a && a.status!=="active" &&
    ["submitted","timed_out","terminated","abandoned"].includes(a.status) &&
    typeof a.quizId==="string" && typeof a.quizRevisionId==="string" &&
    Array.isArray(a.order) && a.order.length>0 && a.order.length<=500 &&
    new Set(a.order).size===a.order.length,
    "FAILED_PRECONDITION","The attempt is not a valid frozen submission.");
}
function ensureTeacher(c,a) {
  requireRole(c.actor,"teacher");
  assert(attemptManager(c.actor,a),
    "RESOURCE_UNAVAILABLE","This attempt is unavailable.");
}
function calculate(grades,a) {
  assert(grades.length===a.order.length &&
    new Set(grades.map(g=>g.id)).size===a.order.length &&
    grades.every(g=>a.order.includes(g.id) &&
      ["correct","incorrect","partial","skipped","pending"].includes(g.status) &&
      typeof g.awarded==="number" && Number.isFinite(g.awarded) &&
      typeof g.possible==="number" && Number.isFinite(g.possible) &&
      g.possible>0 && g.possible<=1000 &&
      g.gradingVersion===1),
    "FAILED_PRECONDITION","Some grades are missing or invalid.");
  const totals=summarize(grades);
  assert(Math.abs(totals.possible-a.totals.possible)<1e-7,
    "VERSION_CONFLICT","Pinned question points do not match grades.");
  return totals;
}
function validateLease(job,attemptId,leaseOwner,now){
  assert(job?.kind==="grade_attempt" && job.targetId===attemptId &&
    job.status==="running" &&
    typeof leaseOwner==="string" && leaseOwner.length>0 &&
    job.leaseOwner===leaseOwner && job.leaseExpiresAt &&
    millis(job.leaseExpiresAt)>millis(now),
    "JOB_LEASE","Grading lease expired or changed.");
}
export function createFirestorePrivateGradeFinalization({
  enabled=false,db,
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,finalizeGradeJob:async()=>({disabled:true}),
    saveManualGrade:async()=>({disabled:true}),
    releaseResults:async()=>({disabled:true}),
  });
  assert(db?.doc && typeof db.runTransaction==="function",
    "INVALID_FIELDS","Trusted Firestore transaction client required.");

  async function finalizeGradeJob({jobId,attemptId,leaseOwner}={}){
    id(jobId,"grading job ID");id(attemptId,"attempt ID");
    assert(typeof leaseOwner==="string" && leaseOwner.length>0 &&
      leaseOwner.length<=128,
      "INVALID_FIELDS","Verified worker lease owner required.");
    // Worker-only invocation. No user-supplied identity, grade or Storage URL.
    return transact(db,"bundle.grade.finish",jobId+"-finish",async c=>{
      const job=await c.get("jobs/"+jobId);
      const a=await c.get("attempts/"+attemptId);
      if(job.status==="succeeded" && job.kind==="grade_attempt" &&
        job.targetId===attemptId && job.result?.attemptId===attemptId &&
        a.gradeVersion>=1 && a.gradeState!=="running") {
        return job.result;
      }
      validateLease(job,attemptId,leaseOwner,c.now);
      frozen(a);
      assert(a.gradeVersion===0 && ["queued","running"].includes(a.gradeState) &&
        a.gradingJobId===jobId &&
        job.progress?.processed===a.order.length,
        "VERSION_CONFLICT","Grading was already finalized or is incomplete.");
      const grades=await c.all("attempts/"+attemptId+"/grades",[],
        "__name__","asc",500);
      const totals=calculate(grades,a);
      const next={...a,totals,
        gradeState:totals.pending?"pending_manual":"final",
        gradeVersion:1,finalizedAt:c.now};
      await updateStatistics(c,a,next);
      c.set("attempts/"+attemptId,next);
      c.audit("grade.completed","attempt",attemptId,{
        quizId:a.quizId,quizOwnerId:a.quizOwnerId,
        affectedUserId:a.studentId});
      c.notify(a.quizOwnerId,totals.pending?"marking_required":"submission",
        a.studentDisplayName+" submitted "+a.quizTitle,
        a.quizId,attemptId);
      c.notify(a.studentId,"graded",
        "Your submission was processed: "+a.quizTitle,
        a.quizId,attemptId);
      const result={attemptId};
      c.set("jobs/"+jobId,{...job,status:"succeeded",
        result,completedAt:c.now,updatedAt:c.now,
        leaseOwner:null,leaseExpiresAt:null,
        progress:{...job.progress,stage:"Complete",
          processed:a.order.length,total:a.order.length}});
      return result;
    });
  }

  async function saveManualGrade({firebaseAuth,attemptId,itemId,
    points,feedback="",reason="",expectedGradeVersion,proof,requestId}={}){
    id(attemptId,"attempt ID");id(itemId,"question ID");
    id(requestId,"request ID");
    number(points,"Mark",0,1000);
    text(feedback,"Feedback",30000);
    text(reason,"Reason",500);
    assert(proof?.attemptId===attemptId &&
      proof.itemId===itemId && proof.pinnedRevisionId &&
      proof.verifiedManual===true &&
      proof.expectedGradeVersion===expectedGradeVersion &&
      proof.points===points && proof.feedback===feedback &&
      proof.reason===reason && proof.grade &&
      proof.grade.manualPoints===points &&
      proof.grade.gradingVersion===1 &&
      proof.grade.gradedBy===firebaseAuth?.uid &&
      /^[0-9a-f]{64}$/.test(proof.answerHash) &&
      /^[0-9a-f]{64}$/.test(proof.oldGradeHash),
      "FAILED_PRECONDITION","Trusted manual-grade preflight missing.");
    // Receipt allows same-revision replay after an ack loss, while writes
    // always recheck current teacher rights and attempt versions.
    return transact(db,"bundle.grade.manual",requestId,async c=>{
      const a=await c.get("attempts/"+attemptId);
      ensureTeacher(c,a);
      const receiptPath="operations/"+c.actor.uid+"/requests/"+requestId;
      const inputHash=fingerprint({
        action:"saveManualGrade",attemptId,itemId,points,feedback,
        reason,expectedGradeVersion});
      const receipt=await c.get(receiptPath,false);
      if(receipt){
        assert(receipt.action==="saveManualGrade" &&
          receipt.inputHash===inputHash,"INVALID_FIELDS",
          "Request ID reused for a different manual grade.");
        return receipt.result;
      }
      frozen(a);
      assert(["pending_manual","final"].includes(a.gradeState),
        "FAILED_PRECONDITION","Wait for automatic grading to finish.");
      version(a.gradeVersion,expectedGradeVersion);
      assert(a.quizRevisionId===proof.pinnedRevisionId &&
        a.order.includes(itemId),
        "VERSION_CONFLICT","The pinned question changed.");
      const old=await c.get(gradePath(attemptId,itemId));
      assert(old.version===proof.oldGradeVersion &&
        fingerprint({status:old.status,awarded:old.awarded,
          possible:old.possible,manualPoints:old.manualPoints??null,
          version:old.version})===proof.oldGradeHash,
        "VERSION_CONFLICT","Existing grade changed.");
      const answer=await c.get("attempts/"+attemptId+"/answers/"+itemId,false);
      assert(fingerprint(answer?.value??"")===proof.answerHash &&
        answer?.value?.trim(),
        "VERSION_CONFLICT","Answer changed after private-key preflight.");
      if(old.manualPoints!==null)
        text(reason,"Correction reason",500,true);
      const grade={...proof.grade,updatedAt:c.now,version:old.version+1};
      assert(grade.possible===old.possible &&
        grade.awarded>=0 && grade.awarded<=old.possible &&
        grade.status!=="pending" &&
        grade.status!=="skipped",
        "VERSION_CONFLICT","Manual grade is outside the pinned rubric.");
      const all=await c.all("attempts/"+attemptId+"/grades",[],
        "__name__","asc",500);
      const totals=calculate(all.map(g=>g.id===itemId?
        {...grade,id:itemId}:g),a);
      const next={...a,totals,gradeVersion:a.gradeVersion+1,
        gradeState:totals.pending?"pending_manual":"final",
        finalizedAt:c.now};
      c.set(gradePath(attemptId,itemId),grade);
      const eventId=c.key("gre_",itemId);
      c.set("attempts/"+attemptId+"/gradeEvents/"+eventId,{
        itemId,before:old,after:grade,reason,
        actorId:c.actor.uid,occurredAt:c.now});
      await updateStatistics(c,a,next);
      c.set("attempts/"+attemptId,next);
      c.audit("grade.manually_changed","attempt",attemptId,{
        quizId:a.quizId,quizOwnerId:a.quizOwnerId,
        affectedUserId:a.studentId,changedFields:[itemId]});
      c.notify(a.studentId,"grade_updated",
        "Mark updated: "+a.quizTitle,a.quizId,attemptId);
      const result={gradeVersion:next.gradeVersion,grade,totals};
      c.set(receiptPath,{action:"saveManualGrade",inputHash,
        result,createdAt:c.now});
      return result;
    },firebaseAuth);
  }

  async function releaseResults({firebaseAuth,quizId,attemptIds,
    score=false,solutions=false,requestId}={}){
    id(quizId,"quiz ID");id(requestId,"request ID");
    assert(score===true||solutions===true,"INVALID_FIELDS",
      "Choose scores or solutions to release.");
    assert(Array.isArray(attemptIds) && attemptIds.length>0 &&
      attemptIds.length<=25 &&
      new Set(attemptIds).size===attemptIds.length &&
      attemptIds.every(a=>typeof a==="string"),
      "INVALID_FIELDS","Choose 1–25 distinct attempts.");
    attemptIds.forEach(a=>id(a,"attempt ID"));
    return transact(db,"bundle.grade.release",requestId,async c=>{
      requireRole(c.actor,"teacher");
      const quiz=await c.get("quizzes/"+quizId);
      manage(c.actor,quiz);
      const receiptPath="operations/"+c.actor.uid+"/requests/"+requestId;
      const inputHash=fingerprint({action:"releaseResults",quizId,
        attemptIds,score,solutions});
      const receipt=await c.get(receiptPath,false);
      if(receipt){
        assert(receipt.action==="releaseResults" &&
          receipt.inputHash===inputHash,"INVALID_FIELDS",
          "Request ID reused for another release.");
        return receipt.result;
      }
      // ALL reads and policy/ownership checks happen before any buffered
      // writes. One invalid attempt prevents any partial batch release.
      const originals=[];
      for(const attemptId of attemptIds){
        const a=await c.get("attempts/"+attemptId);
        assert(a.quizId===quizId && a.quizOwnerId===quiz.ownerId &&
          a.status!=="active" && a.gradeState==="final" &&
          a.gradeVersion>=1,
          "RESOURCE_UNAVAILABLE","Attempt is not ready for release.");
        assert(!score || a.settingsSnapshot?.scoreRelease!=="never",
          "INVALID_FIELDS","Scores are never released for this revision.");
        assert(!solutions ||
          a.settingsSnapshot?.solutionRelease!=="never",
          "INVALID_FIELDS","Solutions are never released for this revision.");
        originals.push({attemptId,a});
      }
      let updated=0;
      for(const {attemptId,a} of originals){
        const addScore=score&&!a.scoreReleasedAt;
        const addSolutions=solutions&&!a.solutionsReleasedAt;
        if(!addScore&&!addSolutions)continue;
        updated++;
        c.set("attempts/"+attemptId,{
          ...a,scoreReleasedAt:addScore?c.now:a.scoreReleasedAt,
          solutionsReleasedAt:addSolutions?c.now:a.solutionsReleasedAt});
        c.audit("result.released","attempt",attemptId,{
          quizId,quizOwnerId:quiz.ownerId,affectedUserId:a.studentId});
        c.notify(a.studentId,"result_released",
          "Results released: "+a.quizTitle,quizId,attemptId);
      }
      const result={released:attemptIds.length};
      c.set(receiptPath,{action:"releaseResults",inputHash,
        result,createdAt:c.now,updated});
      return result;
    },firebaseAuth);
  }
  return Object.freeze({enabled:true,finalizeGradeJob,
    saveManualGrade,releaseResults});
}
