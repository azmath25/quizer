// QN11.5 — STAGED Firebase-only CAS writes after PRIVATE Storage preflight.
// This module is NEVER mounted by the active router/worker. No external SQL
// or Storage calls inside transact(), and no client-provided preflight proof.
import {assert,id,number,fields,text,byteSize} from "../../shared/schema.js";
import {transact,requireRole,millis,version} from "../domain/runtime.js";
import {fingerprint} from "../neon/write-repository.js";

function assertActive(c,attempt,uid) {
  requireRole(c.actor,"verified");
  assert(attempt?.studentId===uid && c.actor.uid===uid,
    "RESOURCE_UNAVAILABLE","Attempt unavailable.");
  assert(attempt.status==="active","ATTEMPT_FROZEN",
    "The attempt has ended.");
  assert(!attempt.deadlineAt || millis(c.now)<millis(attempt.deadlineAt),
    "ATTEMPT_EXPIRED","The attempt deadline has passed.");
}
export function createFirestorePrivateAttemptCommits({enabled=false,db}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,
    saveAnswers:async()=>({disabled:true}),
    navigate:async()=>({disabled:true}),
    gradeBatch:async()=>({disabled:true}),
  });
  assert(db?.runTransaction && db?.doc,
    "INVALID_FIELDS","Trusted Firebase transaction client required.");
  async function saveAnswers({firebaseAuth,attemptId,expectedAnswerVersion,
    changes,proof,requestId}={}){
    id(attemptId,"attempt ID");id(requestId,"request ID");
    assert(proof?.validated===true && proof.attemptId===attemptId &&
      Array.isArray(proof.itemIds) && Array.isArray(changes) &&
      changes.length>0 && changes.length<=20 &&
      changes.length===proof.itemIds.length &&
      changes.every((r,i)=>r.itemId===proof.itemIds[i]) &&
      byteSize(changes)<=262144,
      "FAILED_PRECONDITION","Trusted answer preflight missing.");
    return transact(db,"bundle.answer.save",requestId,async c=>{
      const path="attempts/"+attemptId;
      const attempt=await c.get(path);
      assertActive(c,attempt,firebaseAuth?.uid);
      assert(attempt.quizRevisionId===proof.pinnedRevisionId,
        "VERSION_CONFLICT","Attempt publication changed.");
      version(attempt.answerVersion,expectedAnswerVersion);
      const seen=new Set(),confirmed=[],answered=new Set(attempt.answeredItemIds??[]);
      let count=attempt.answeredCount??0,changed=false;
      for(const input of changes){
        fields(input,["itemId","value","expectedRevision"],"answer");
        const itemId=id(input.itemId),index=attempt.order.indexOf(itemId);
        assert(index>=0 && (attempt.settingsSnapshot.allowBack ||
          index===attempt.currentFrontier) && !seen.has(itemId),
          "RESOURCE_UNAVAILABLE","Problem is not currently accessible.");
        seen.add(itemId);
        text(input.value,"Response",10000);
        number(input.expectedRevision,"Expected answer revision",
          0,Number.MAX_SAFE_INTEGER,true);
        const answerPath=path+"/answers/"+itemId;
        const prior=await c.get(answerPath,false);
        version(prior?.revision??0,input.expectedRevision);
        if((prior?.value??"")===input.value){
          confirmed.push({itemId,revision:prior?.revision??0,
            savedAt:prior?.updatedAt??null});
          continue;
        }
        const revision=(prior?.revision??0)+1;
        c.set(answerPath,{value:input.value,revision,updatedAt:c.now,
          lastRequestId:requestId,updatedBy:c.actor.uid});
        c.set(answerPath+"/changes/"+String(revision).padStart(8,"0"),{
          value:input.value,revision,savedAt:c.now,
          actorId:c.actor.uid,requestId});
        count+=Number(!!input.value.trim())-Number(!!prior?.value?.trim());
        if(input.value.trim())answered.add(itemId);
        else answered.delete(itemId);
        changed=true;
        confirmed.push({itemId,revision,savedAt:c.now});
      }
      if(changed) {
        c.set(path,{...attempt,answeredCount:count,
          answeredItemIds:[...answered],answerVersion:attempt.answerVersion+1,
          lastSavedAt:c.now});
        c.audit("attempt.answers_saved","attempt",attemptId,{
          quizId:attempt.quizId,quizOwnerId:attempt.quizOwnerId,
          affectedUserId:attempt.studentId,changedFields:[...seen]});
      }
      return {answerVersion:attempt.answerVersion+Number(changed),
        answeredCount:count,answeredItemIds:[...answered],
        confirmed,savedAt:changed?c.now:attempt.lastSavedAt};
    },firebaseAuth);
  }
  async function navigate({firebaseAuth,attemptId,targetIndex,proof,requestId}={}){
    id(attemptId,"attempt ID");id(requestId,"request ID");
    assert(proof?.attemptId===attemptId && proof.targetIndex===targetIndex &&
      proof?.item?.itemId && proof.pinnedRevisionId &&
      Number.isInteger(proof.expectedFrontier) &&
      Number.isInteger(proof.expectedUiVersion),
      "FAILED_PRECONDITION","Trusted navigation preflight missing.");
    return transact(db,"bundle.attempt.navigate",requestId,async c=>{
      const path="attempts/"+attemptId;
      const a=await c.get(path);
      assertActive(c,a,firebaseAuth?.uid);
      assert(a.quizRevisionId===proof.pinnedRevisionId &&
        a.currentFrontier===proof.expectedFrontier &&
        a.uiState.version===proof.expectedUiVersion,
        "VERSION_CONFLICT","Attempt position changed.");
      number(targetIndex,"Problem number",0,a.order.length-1,true);
      assert(a.settingsSnapshot.allowBack ||
        targetIndex===a.currentFrontier ||
        targetIndex===a.currentFrontier+1,
        "RESOURCE_UNAVAILABLE","Cannot navigate to that problem.");
      assert(a.order[targetIndex]===proof.item.itemId,
        "VERSION_CONFLICT","Pinned question no longer matches position.");
      const currentFrontier=Math.max(a.currentFrontier,targetIndex);
      const uiState={...a.uiState,currentIndex:targetIndex,
        version:a.uiState.version+1};
      c.set(path,{...a,currentFrontier,uiState});
      return {currentFrontier,uiState,item:proof.item};
    },firebaseAuth);
  }
  async function gradeBatch({jobId,attemptId,proof}={}){
    id(jobId,"grading job ID");id(attemptId,"attempt ID");
    assert(proof?.jobId===jobId && proof.attemptId===attemptId &&
      typeof proof.leaseOwner==="string" && proof.leaseOwner.length>0 &&
      Array.isArray(proof.grades) && proof.grades.length>0 &&
      proof.grades.length<=20 &&
      new Set(proof.grades.map(g=>g.itemId)).size===proof.grades.length &&
      proof.grades.every(g=>g.gradingVersion===1 &&
        g.gradedBy==="system" && g.version===1 &&
        typeof g.status==="string" && Number.isFinite(g.possible) &&
        Number.isFinite(g.awarded)),
      "FAILED_PRECONDITION","Trusted grade preflight missing.");
    // Worker identity, job, lease and frozen attempt are rechecked in ONE
    // Firestore transaction. The protected bundle keys are not carried here.
    return transact(db,"bundle.grade.batch",jobId+"-"+fingerprint(
      proof.grades.map(x=>x.itemId)).slice(0,20),async c=>{
      const j=await c.get("jobs/"+jobId);
      const a=await c.get("attempts/"+attemptId);
      assert(j.kind==="grade_attempt" && j.targetId===attemptId &&
        j.status==="running" && j.leaseOwner===proof.leaseOwner &&
        j.leaseExpiresAt && millis(j.leaseExpiresAt)>millis(c.now),
        "JOB_LEASE","Grading lease changed.");
      assert(a.status!=="active" && a.gradeVersion===0 &&
        a.quizRevisionId===proof.pinnedRevisionId &&
        a.order.length>0,"VERSION_CONFLICT",
        "Frozen attempt changed before grading.");
      const processed=j.progress?.processed??0;
      const expected=a.order.slice(processed,processed+proof.grades.length);
      assert(expected.length===proof.grades.length &&
        expected.every((itemId,i)=>itemId===proof.grades[i].itemId),
        "VERSION_CONFLICT","Grading batch order or progress changed.");
      for(const row of proof.grades){
        const old=await c.get("attempts/"+attemptId+"/grades/"+id(row.itemId),false);
        assert(!old,"VERSION_CONFLICT","Grading slot was already written.");
        c.set("attempts/"+attemptId+"/grades/"+row.itemId,{
          ...row,updatedAt:c.now});
      }
      c.set("jobs/"+jobId,{...j,progress:{
        ...(j.progress??{}),processed:processed+proof.grades.length,
        total:a.order.length,stage:"Grading"}});
      return {attemptId,processed:processed+proof.grades.length,
        total:a.order.length};
    });
  }
  return Object.freeze({enabled:true,saveAnswers,navigate,gradeBatch});
}
