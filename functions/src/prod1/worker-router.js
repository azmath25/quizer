// PROD1-P0: server-side job classifier + fenced private-bundle worker.
// UNMOUNTED: the deployed runJob/sweeper continue to use the old worker
// until an explicitly authorized release. A private job NEVER falls back
// to legacy processing after error, timeout or infrastructure outage.
import {randomUUID} from "node:crypto";
import {assert,id} from "../../shared/schema.js";
import {Timestamp,millis} from "../domain/runtime.js";
import {createProd1SecondaryWorker} from "./secondary-worker.js";

const PRIVATE_MODE="private_bundle_v1";
const RETRIES=5;
const LEASE_MS=590000; // longer than the 540s Functions maximum.
const snapshot=async(db,path)=>{
  const s=await db.doc(path).get();
  return s.exists?s.data():null;
};
export function classifyProd1Job(job){
  assert(job&&typeof job==="object","RESOURCE_UNAVAILABLE",
    "Job unavailable.");
  if(job.kind!=="publish_quiz")return "legacy";
  if(job.input?.bundleMode===undefined)return "legacy";
  assert(job.input.bundleMode===PRIVATE_MODE &&
    typeof job.input.revisionId==="string" &&
    Array.isArray(job.input.sources)&&
    job.input.sources.length>=1&&job.input.sources.length<=500 &&
    job.input.sources.every(s=>
      s?.source&&["neon_revision","firestore_legacy"]
        .includes(s.source.kind)),
    "FAILED_PRECONDITION","Unknown or invalid private publication job.");
  return "private";
}
export function createProd1WorkerRouter({
  enabled=false,db,runLegacy,runPrivateJob,
  now=()=>Date.now(),randomLease=()=>randomUUID(),
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    runJob:async()=>({disabled:true})});
  assert(db?.doc&&typeof db.runTransaction==="function"&&
    typeof runLegacy==="function"&&
    typeof runPrivateJob==="function"&&
    typeof now==="function"&&typeof randomLease==="function",
    "FAILED_PRECONDITION","Trusted PROD1 worker dependencies required.");
  async function claim(jobId){
    return db.runTransaction(async tx=>{
      const read=async path=>{
        const snap=await tx.get(db.doc(path));
        return snap.exists?snap.data():null;
      };
      const [job,maintenance]=await Promise.all([
        read("jobs/"+jobId),read("system/maintenance"),
      ]);
      if(maintenance?.enabled)return {state:"maintenance"};
      assert(classifyProd1Job(job)==="private",
        "FAILED_PRECONDITION","Private job mode changed.");
      if(job.status==="succeeded"||job.status==="failed")
        return {state:"finished"};
      assert(["queued","running"].includes(job.status),
        "FAILED_PRECONDITION","Cannot claim publication in this state.");
      const currentMs=now();
      if(job.status==="running"&&
        millis(job.leaseExpiresAt)>currentMs)
        return {state:"busy"};
      const quiz=await read("quizzes/"+id(job.targetId));
      const revision=await read("quizzes/"+id(job.targetId)+
        "/revisions/"+id(job.input.revisionId));
      if(!(quiz?.lifecycle==="active"&&
        quiz.publishingJobId===jobId&&
        quiz.ownerId===job.requestedBy&&
        revision?.state==="building"&&
        revision.publicationJobId===jobId)){
        // An intentionally cancelled/trashed publication should not remain
        // stuck in the queue and fail every future maintenance sweep.
        const at=Timestamp.fromMillis(currentMs);
        tx.set(db.doc("jobs/"+jobId),{...job,status:"failed",
          leaseOwner:null,leaseExpiresAt:null,completedAt:at,updatedAt:at,
          error:{reason:"PRIVATE_PUBLICATION_CANCELLED",
            message:"Publication was cancelled or the quiz changed."}});
        if(revision?.state==="building"&&
          revision.publicationJobId===jobId)
          tx.set(db.doc("quizzes/"+job.targetId+
            "/revisions/"+job.input.revisionId),
            {...revision,state:"failed"});
        if(quiz?.publishingJobId===jobId)
          tx.set(db.doc("quizzes/"+job.targetId),{...quiz,
            publishingJobId:null,updatedAt:at});
        return {state:"cancelled"};
      }
      const attempt=(job.retryCount??0)+1;
      if(attempt>RETRIES)return {state:"exhausted",job,quiz,revision};
      const lease=randomLease();
      assert(typeof lease==="string"&&lease.length>=16,
        "FAILED_PRECONDITION","Unsafe publication lease.");
      tx.set(db.doc("jobs/"+jobId),{
        ...job,status:"running",leaseOwner:lease,
        leaseExpiresAt:Timestamp.fromMillis(currentMs+LEASE_MS),
        retryCount:attempt,updatedAt:Timestamp.fromMillis(currentMs),
        error:null,
      });
      return {state:"claimed",lease};
    });
  }
  async function failFinal(jobId,reason){
    return db.runTransaction(async tx=>{
      const read=async path=>{
        const snap=await tx.get(db.doc(path));
        return snap.exists?snap.data():null;
      };
      const job=await read("jobs/"+jobId);
      if(!job||classifyProd1Job(job)!=="private" ||
        job.status==="succeeded"||job.status==="failed")
        return false;
      if((job.retryCount??0)<RETRIES)return false;
      const quiz=await read("quizzes/"+id(job.targetId));
      const revisionPath="quizzes/"+id(job.targetId)+
        "/revisions/"+id(job.input.revisionId);
      const revision=await read(revisionPath);
      const expired=millis(job.leaseExpiresAt)<=now();
      if(!expired && job.status==="running")return false;
      const at=Timestamp.fromMillis(now());
      tx.set(db.doc("jobs/"+jobId),{
        ...job,status:"failed",leaseOwner:null,leaseExpiresAt:null,
        completedAt:at,updatedAt:at,
        error:{reason:"PRIVATE_PUBLICATION_RETRY_EXHAUSTED",
          message:"Publication did not complete; retry after reviewing the issue."},
      });
      if(revision?.state==="building"&&
        revision.publicationJobId===jobId)
        tx.set(db.doc(revisionPath),{...revision,state:"failed"});
      // Never alter the old published revision, attempts or stored bundle.
      if(quiz?.publishingJobId===jobId)
        tx.set(db.doc("quizzes/"+job.targetId),{
          ...quiz,publishingJobId:null,updatedAt:at});
      return true;
    });
  }
  async function releaseFailedLease(jobId,lease){
    // Only release our own still-running lease after an exception.
    // If publication committed successfully, the lease no longer belongs
    // to us and no field is modified. This avoids a 10-minute stall.
    return db.runTransaction(async tx=>{
      const ref=db.doc("jobs/"+jobId);
      const snap=await tx.get(ref);
      const job=snap.exists?snap.data():null;
      if(!job||job.status!=="running"||job.leaseOwner!==lease||
        classifyProd1Job(job)!=="private")return false;
      tx.set(ref,{...job,
        leaseExpiresAt:Timestamp.fromMillis(now()-1),
        updatedAt:Timestamp.fromMillis(now()),
        error:{reason:"PRIVATE_PUBLICATION_RETRY_PENDING",
          message:"Publication interrupted; waiting for a safe retry."}});
      return true;
    });
  }
  const secondary=createProd1SecondaryWorker({
    db,runLegacy,runPrivateJob,now,randomLease,
  });
  async function runJob(jobId){
    id(jobId);
    const original=await snapshot(db,"jobs/"+jobId);
    if(!original)return {status:"missing"};
    // The saved attempt/published revision, never the browser or job
    // request, decides whether grading/export uses private bundle keys.
    if(["grade_attempt","export_quiz"].includes(original.kind))
      return secondary.runJob(jobId);
    const kind=classifyProd1Job(original);
    if(kind==="legacy"){
      // The legacy worker owns its own lease and all old job kinds.
      return runLegacy(db,jobId);
    }
    const claimResult=await claim(jobId);
    if(claimResult.state==="exhausted"){
      await failFinal(jobId,"exhausted");
      return {status:"exhausted"};
    }
    if(claimResult.state!=="claimed")
      return {status:claimResult.state};
    try{
      const result=await runPrivateJob({
        kind:"publishJob",jobId,leaseOwner:claimResult.lease});
      return {status:"handled",result};
    }catch(error){
      // Never replay as legacy. Release ONLY our own lease after the
      // private publisher fails, then let the next sweep retry with a new
      // claim and verify the immutable Storage generation.
      try{await releaseFailedLease(jobId,claimResult.lease);}
      catch{ /* report the publisher's original failure unchanged */ }
      throw error;
    }
  }
  return Object.freeze({enabled:true,runJob,failFinal});
}
