// PROD1 P1 — classification and fenced processing of private grading
// and ZIP export jobs. Never uses Neon for grading an already published quiz.
// No job may downgrade to the legacy Firestore worker after a private
// origin is established. All ownership/lease checks are read from Firestore.
import {randomUUID} from "node:crypto";
import {assert,id} from "../../shared/schema.js";
import {Timestamp,millis} from "../domain/runtime.js";
const MAX_RETRIES=5, LEASE_MS=590000;
export function createProd1SecondaryWorker({
  db,runLegacy,runPrivateJob,
  now=()=>Date.now(),randomLease=()=>randomUUID(),
}={}){
  assert(db?.doc&&typeof db.runTransaction==="function"&&
    typeof runLegacy==="function"&&
    typeof runPrivateJob==="function",
    "FAILED_PRECONDITION","Verified private job services required.");
  const ref=path=>db.doc(path);
  const read=async path=>{
    const s=await ref(path).get();
    return s.exists?s.data():null;
  };
  const inspect=async job=>{
    assert(["grade_attempt","export_quiz"].includes(job?.kind),
      "INVALID_FIELDS","Unsupported private-job origin.");
    const idOfJob=id(job.targetId);
    let quizId,revisionId,attempt=null,quiz=null;
    if(job.kind==="grade_attempt"){
      attempt=await read("attempts/"+idOfJob);
      assert(attempt?.quizId&&attempt?.quizRevisionId&&
        attempt?.gradingJobId,
        "RESOURCE_UNAVAILABLE","Grading attempt unavailable.");
      quizId=id(attempt.quizId);
      revisionId=id(attempt.quizRevisionId);
    }else{
      quizId=id(job.targetId);
      revisionId=id(job.input?.revisionId);
      quiz=await read("quizzes/"+quizId);
      assert(quiz?.ownerId&&quiz.ownerId===job.requestedBy,
        "RESOURCE_UNAVAILABLE","Export owner unavailable.");
    }
    const revision=await read("quizzes/"+quizId+
      "/revisions/"+revisionId);
    assert(revision?.state==="ready",
      "RESOURCE_UNAVAILABLE","Pinned quiz revision unavailable.");
    return {kind:revision.bundle?"private":"legacy",
      attempt,quiz,quizId,revisionId};
  };
  const claim=async(jobId,type)=>{
    return db.runTransaction(async tx=>{
      const get=async path=>{
        const s=await tx.get(ref(path));
        return s.exists?s.data():null;
      };
      const job=await get("jobs/"+jobId);
      assert(job?.kind===type,"RESOURCE_UNAVAILABLE",
        "Private job kind changed.");
      if(job.status==="succeeded"||job.status==="failed")
        return {status:"finished"};
      assert(["queued","running"].includes(job.status),
        "FAILED_PRECONDITION","Private job not runnable.");
      const maintenance=await get("system/maintenance");
      if(maintenance?.enabled)return {status:"maintenance"};
      const t=now();
      if(job.status==="running"&&millis(job.leaseExpiresAt)>t)
        return {status:"busy"};
      let attempt=null,quizId,revisionId;
      if(type==="grade_attempt"){
        attempt=await get("attempts/"+id(job.targetId));
        assert(attempt?.gradingJobId===jobId&&
          attempt.status!=="active"&&attempt.gradeVersion===0&&
          Array.isArray(attempt.order)&&
          attempt.order.length>0&&attempt.order.length<=500,
          "VERSION_CONFLICT","Private grading attempt changed.");
        quizId=id(attempt.quizId);
        revisionId=id(attempt.quizRevisionId);
      }else{
        quizId=id(job.targetId);
        revisionId=id(job.input?.revisionId);
        const quiz=await get("quizzes/"+quizId);
        assert(quiz?.ownerId===job.requestedBy,
          "RESOURCE_UNAVAILABLE","Private export owner changed.");
      }
      const revision=await get("quizzes/"+quizId+
        "/revisions/"+revisionId);
      assert(revision?.state==="ready"&&revision.bundle,
        "VERSION_CONFLICT","Private bundle provenance changed.");
      const retries=(job.retryCount??0)+1;
      if(retries>MAX_RETRIES){
        const at=Timestamp.fromMillis(t);
        tx.set(ref("jobs/"+jobId),{...job,status:"failed",
          completedAt:at,updatedAt:at,
          leaseOwner:null,leaseExpiresAt:null,
          error:{reason:"PRIVATE_JOB_RETRIES_EXHAUSTED",
            message:"Private job requires review after repeated failures."}});
        if(type==="grade_attempt"&&attempt)
          tx.set(ref("attempts/"+job.targetId),{
            ...attempt,gradeState:"failed"});
        return {status:"exhausted"};
      }
      const lease=randomLease();
      assert(typeof lease==="string"&&lease.length>=16,
        "FAILED_PRECONDITION","Invalid private job lease.");
      tx.set(ref("jobs/"+jobId),{...job,
        status:"running",leaseOwner:lease,
        leaseExpiresAt:Timestamp.fromMillis(t+LEASE_MS),
        retryCount:retries,updatedAt:Timestamp.fromMillis(t),
        error:null,
      });
      return {status:"claimed",lease,attempt,revisionId,
        processed:job.progress?.processed??0};
    });
  };
  async function release(jobId,lease){
    return db.runTransaction(async tx=>{
      const snap=await tx.get(ref("jobs/"+jobId));
      const job=snap.exists?snap.data():null;
      if(job?.status!=="running"||job.leaseOwner!==lease)return false;
      tx.set(ref("jobs/"+jobId),{...job,
        updatedAt:Timestamp.fromMillis(now()),
        leaseExpiresAt:Timestamp.fromMillis(now()-1),
        error:{reason:"PRIVATE_JOB_RETRY_PENDING",
          message:"Interrupted job will resume with a new lease."}});
      return true;
    });
  }
  async function runJob(jobId){
    const s=await ref("jobs/"+id(jobId)).get();
    if(!s.exists)return {status:"missing"};
    const job=s.data();
    const origin=await inspect(job);
    if(origin.kind==="legacy")return runLegacy(db,jobId);
    const state=await claim(jobId,job.kind);
    if(state.status!=="claimed")return state;
    try{
      let result;
      if(job.kind==="grade_attempt"){
        const order=state.attempt.order;
        assert(Number.isInteger(state.processed)&&
          state.processed>=0&&state.processed<=order.length,
          "VERSION_CONFLICT","Invalid persisted grading progress.");
        for(let i=state.processed;i<order.length;i+=20){
          result=await runPrivateJob({kind:"gradeJobBatch",jobId,
            attemptId:job.targetId,itemIds:order.slice(i,i+20)});
        }
        result=await runPrivateJob({kind:"finalizeGradeJob",jobId,
          attemptId:job.targetId,leaseOwner:state.lease});
      }else{
        result=await runPrivateJob({kind:"exportJob",jobId});
      }
      return {status:"handled",result};
    }catch(error){
      try{await release(jobId,state.lease);}
      catch{/* preserve source error, never use legacy fallback */}
      throw error;
    }
  }
  return Object.freeze({enabled:true,runJob,inspect});
}
