// QN11.6.3 — default-OFF Firebase export coordinator and owner-only link.
// Only the isolated worker calls load/finish; signing occurs AFTER Firebase
// read-only authorization, never inside a Firestore transaction callback.
import {assert,id,number} from "../../shared/schema.js";
import {transact,manage,requireRole,millis,hash} from "../domain/runtime.js";
import {validatePublishedBundleManifest} from "./published-bundle.js";

const SAFE_ZIP=/^exports\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})-([A-Za-z0-9_-]{1,128})\.zip$/;
export const MAX_PRIVATE_EXPORT_BYTES=128*1024*1024;
function readyJob(job,quiz,revisionId,jobId) {
  assert(job?.kind==="export_quiz" && job.targetId===quiz?.id &&
    job.input?.revisionId===revisionId &&
    job.requestedBy===quiz.ownerId,
    "RESOURCE_UNAVAILABLE","Pinned export job unavailable.");
  assert(quiz.lifecycle==="active" || quiz.lifecycle==="archived",
    "RESOURCE_UNAVAILABLE","Quiz export unavailable.");
  id(jobId,"export job ID");
}
function persistedLink(job,jobId,quizId) {
  const obj=job.result;
  assert(obj?.privateBundleExport===true &&
    obj.quizId===quizId &&
    obj.revisionId===job.input?.revisionId &&
    obj.filename===quizId+"-"+jobId+".zip" &&
    typeof obj.storagePath==="string" &&
    obj.storagePath==="exports/"+job.requestedBy+"/"+jobId+"/"+obj.filename &&
    SAFE_ZIP.test(obj.storagePath) &&
    /^[1-9][0-9]{0,22}$/.test(String(obj.generation)) &&
    /^[0-9a-f]{64}$/.test(obj.sha256) &&
    Number.isInteger(obj.byteLength) && obj.byteLength>0 &&
    obj.byteLength<=MAX_PRIVATE_EXPORT_BYTES,
    "RESOURCE_UNAVAILABLE","Verified private export not available.");
  return obj;
}
export function createFirestorePrivateExportStore({
  enabled=false,db,authFor,signExport,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    load:async()=>({disabled:true}),
    finish:async()=>({disabled:true}),
    getLink:async()=>({disabled:true}),
  });
  assert(db?.runTransaction&&db?.doc&&
    typeof authFor==="function"&&typeof signExport==="function",
    "INVALID_FIELDS","Trusted Firebase export and signing ports required.");
  const authForJob=async jobId=>{
    id(jobId,"export job ID");
    const doc=await db.doc("jobs/"+jobId).get();
    assert(doc.exists && doc.data()?.requestedBy,
      "RESOURCE_UNAVAILABLE","Export job unavailable.");
    return authFor(id(doc.data().requestedBy,"export owner"));
  };
  async function load(jobId){
    const auth=await authForJob(jobId);
    return transact(db,"bundle.export.preflight",jobId+"-read",async c=>{
      requireRole(c.actor,"teacher");
      const job=await c.get("jobs/"+jobId);
      const quizId=id(job.targetId,"quiz ID"),
        revisionId=id(job.input?.revisionId,"revision ID");
      const quiz=await c.get("quizzes/"+quizId);
      manage(c.actor,quiz);
      readyJob(job,{...quiz,id:quizId},revisionId,jobId);
      const revision=await c.get(
        "quizzes/"+quizId+"/revisions/"+revisionId);
      assert(revision.state==="ready" && revision.bundle,
        "RESOURCE_UNAVAILABLE","Private published revision unavailable.");
      validatePublishedBundleManifest(revision.bundle,quizId,revisionId);
      if(job.status==="succeeded"){
        const completed=persistedLink(job,jobId,quizId);
        return {completed:true,jobId,quizId,revisionId,
          result:completed};
      }
      assert(job.status==="running" && job.leaseOwner &&
        job.leaseExpiresAt && millis(job.leaseExpiresAt)>millis(c.now),
        "JOB_LEASE","Export lease has expired.");
      return {authorized:true,jobId,quizId,revisionId,
        kind:"export_quiz",status:"running",leaseOwner:job.leaseOwner,
        ownerId:job.requestedBy,manifest:revision.bundle,
        jobInputHash:hash(job.input)};
    },auth);
  }
  async function finish({plan,object}={}){
    assert(plan?.authorized && plan.jobId &&
      plan.quizId && plan.revisionId && plan.ownerId && plan.leaseOwner,
      "RESOURCE_UNAVAILABLE","Trusted export preflight missing.");
    const jobId=id(plan.jobId);
    assert(object?.storagePath===
      "exports/"+plan.ownerId+"/"+jobId+"/"+plan.quizId+"-"+jobId+".zip" &&
      /^[1-9][0-9]{0,22}$/.test(String(object.generation)) &&
      /^[0-9a-f]{64}$/.test(object.sha256) &&
      Number.isInteger(object.byteLength) && object.byteLength>0 &&
      object.byteLength<=MAX_PRIVATE_EXPORT_BYTES &&
      object.contentType==="application/zip",
      "RESOURCE_UNAVAILABLE","Unverified export object.");
    const auth=await authForJob(jobId);
    return transact(db,"bundle.export.finish",jobId+"-finish",async c=>{
      const job=await c.get("jobs/"+jobId);
      const quiz=await c.get("quizzes/"+plan.quizId);
      requireRole(c.actor,"teacher");
      manage(c.actor,quiz);
      readyJob(job,{...quiz,id:plan.quizId},plan.revisionId,jobId);
      assert(job.requestedBy===plan.ownerId,
        "RESOURCE_UNAVAILABLE","Export owner changed.");
      if(job.status==="succeeded"){
        const prior=persistedLink(job,jobId,plan.quizId);
        assert(prior.storagePath===object.storagePath &&
          prior.generation===String(object.generation) &&
          prior.sha256===object.sha256,
          "VERSION_CONFLICT","Completed export changed.");
        return {alreadyExported:true,jobId,result:prior};
      }
      assert(job.status==="running" &&
        job.leaseOwner===plan.leaseOwner &&
        job.leaseExpiresAt && millis(job.leaseExpiresAt)>millis(c.now) &&
        hash(job.input)===plan.jobInputHash,
        "JOB_LEASE","Export lease no longer owned.");
      const revision=await c.get(
        "quizzes/"+plan.quizId+"/revisions/"+plan.revisionId);
      assert(revision.state==="ready" &&
        revision.bundle?.sha256===plan.manifest.sha256 &&
        revision.bundle?.generation===plan.manifest.generation,
        "VERSION_CONFLICT","Export source revision changed.");
      const result={quizId:plan.quizId,revisionId:plan.revisionId,
        privateBundleExport:true,
        filename:plan.quizId+"-"+jobId+".zip",
        storagePath:object.storagePath,
        generation:String(object.generation),
        sha256:object.sha256,byteLength:object.byteLength,
        count:plan.manifest.itemCount,asOf:c.now};
      c.set("jobs/"+jobId,{...job,
        status:"succeeded",result,
        completedAt:c.now,updatedAt:c.now,
        leaseOwner:null,leaseExpiresAt:null,
        progress:{...job.progress,processed:plan.manifest.itemCount,
          total:plan.manifest.itemCount,stage:"Complete"}});
      c.audit("report.exported","quiz",plan.quizId,{
        quizId:plan.quizId,quizOwnerId:quiz.ownerId});
      return {jobId,result};
    },auth);
  }
  async function getLink({firebaseAuth,jobId}={}){
    id(jobId,"export job ID");
    assert(firebaseAuth?.uid&&firebaseAuth?.token,
      "AUTH_REQUIRED","Verified Firebase identity required.");
    const meta=await transact(db,"bundle.export.link",jobId+"-read",async c=>{
      requireRole(c.actor,"teacher");
      const job=await c.get("jobs/"+jobId);
      const quizId=id(job.targetId);
      const quiz=await c.get("quizzes/"+quizId);
      manage(c.actor,quiz);
      assert(job.status==="succeeded" &&
        (job.requestedBy===c.actor.uid || c.actor.role==="admin") &&
        job.kind==="export_quiz",
        "RESOURCE_UNAVAILABLE","Export unavailable.");
      return persistedLink(job,jobId,quizId);
    },firebaseAuth);
    const url=await signExport({storagePath:meta.storagePath,
      generation:meta.generation,expiresAt:new Date(Date.now()+120000)});
    assert(typeof url==="string"&&url.startsWith("https://") &&
      !url.includes("published-bundles") &&
      !url.includes("firebaseStorageDownloadTokens"),
      "RESOURCE_UNAVAILABLE","Unsafe private export signature.");
    return {url,filename:meta.filename,
      expiresAt:new Date(Date.now()+120000)};
  }
  return Object.freeze({enabled:true,load,finish,getLink});
}
