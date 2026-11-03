// QN11.6.4 — READ-ONLY, default-OFF cross-store recovery classification.
// No object listing, overwrite, deletion, permission fallback, or automatic
// publication activation. Operators must approve recovery in later staging.
import {assert,id} from "../../shared/schema.js";
import {bundleStoragePath,validatePublishedBundleManifest}
  from "./published-bundle.js";

const fail=(reason,message)=>assert(false,reason,message);
const isSha=x=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x);
const isGen=x=>/^[1-9][0-9]{0,22}$/.test(String(x??""));
const deadlineMs=x=>typeof x==="number"?x:
  typeof x?.toMillis==="function"?x.toMillis():
  x instanceof Date?x.getTime():
  typeof x==="string"?Date.parse(x):NaN;
const result=(kind,jobId,state,reason,details={})=>Object.freeze({
  kind,jobId,state,reason,automaticCleanupAllowed:false,
  ...details,
});
function confirmedObject(meta,expected){
  return meta?.exists===true&&
    String(meta.generation)===String(expected.generation)&&
    Number(meta.byteLength)===Number(expected.byteLength)&&
    meta.contentType===expected.contentType&&
    (!expected.sha256 || meta.sha256===expected.sha256);
}
export function createQuizerRecoveryInspector({
  enabled=false,loadTrustedSnapshot,inspectObject,
  now=()=>Date.now(),
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    inspectPublication:async()=>({disabled:true}),
    inspectExport:async()=>({disabled:true}),
  });
  assert(typeof loadTrustedSnapshot==="function"&&
    typeof inspectObject==="function"&&typeof now==="function",
    "INVALID_FIELDS","Trusted read-only job, Storage and clock ports required.");
  async function snapshot(kind,jobId){
    id(jobId,"job ID");
    const data=await loadTrustedSnapshot({kind,jobId});
    assert(data?.job&&data?.quiz&&data?.revision &&
      data.job.kind===(kind==="publication"?"publish_quiz":"export_quiz")&&
      data.job.targetId===data.quiz.id&&
      data.job.input?.revisionId===data.revision.id&&
      data.job.requestedBy===data.quiz.ownerId,
      "RESOURCE_UNAVAILABLE","Trusted recovery snapshot unavailable.");
    return data;
  }
  async function inspectPublication(jobId){
    const {job,quiz,revision}=await snapshot("publication",jobId);
    const {id:quizId}=quiz,{id:revisionId}=revision;
    // A failed preparation may not have any verified private object hash.
    // Never enumerate Storage or guess an object name from client input.
    if(!revision.bundle){
      return result("publication",jobId,
        job.status==="running"?"pending_source":"manual_review",
        "No trusted published bundle manifest; cannot identify an object");
    }
    let manifest;
    try{
      manifest=validatePublishedBundleManifest(
        revision.bundle,quizId,revisionId);
    }catch{
      return result("publication",jobId,"integrity_alert",
        "Persisted private bundle manifest is invalid");
    }
    const storagePath=manifest.storagePath;
    assert(storagePath===bundleStoragePath(
      quizId,revisionId,manifest.sha256),"RESOURCE_UNAVAILABLE",
      "Unexpected private bundle provenance.");
    const meta=await inspectObject({
      kind:"publication",storagePath,
      generation:String(manifest.generation),maxBytes:24*1024*1024,
    });
    const verified=confirmedObject(meta,{
      generation:manifest.generation,byteLength:manifest.byteLength,
      contentType:manifest.contentType,
    });
    if(job.status==="succeeded")
      return result("publication",jobId,
        revision.state==="ready"&&verified?"consistent":"integrity_alert",
        revision.state==="ready"&&verified
          ?"Immutable published bundle verified"
          :"Completed publication or private object is inconsistent",
        {storagePath});
    if(revision.state==="ready")
      return result("publication",jobId,"integrity_alert",
        "Ready revision exists without a succeeded publication job",
        {storagePath});
    const active=job.status==="running"&&
      job.leaseExpiresAt&&deadlineMs(job.leaseExpiresAt)>now();
    if(active)return result("publication",jobId,"in_flight",
      "Worker lease is active; leave the private object unchanged",
      {storagePath});
    return result("publication",jobId,
      meta?.exists===true?"unlinked_private_object":"retryable_missing_object",
      meta?.exists===true
        ?"Unlinked object requires fenced human review; never delete it"
        :"No object detected; a separately authorized worker may retry",
      {storagePath});
  }
  async function inspectExport(jobId){
    const {job,quiz,revision}=await snapshot("export",jobId);
    const quizId=quiz.id,revId=revision.id;
    const path="exports/"+job.requestedBy+"/"+jobId+"/"+
      quizId+"-"+jobId+".zip";
    const obj=job.result;
    if(job.status==="succeeded"){
      if(obj?.privateBundleExport!==true ||
        obj.storagePath!==path || obj.quizId!==quizId ||
        obj.revisionId!==revId || !isSha(obj.sha256) ||
        !isGen(obj.generation) ||
        !Number.isInteger(obj.byteLength) || obj.byteLength<=0)
        return result("export",jobId,"integrity_alert",
          "Completed ZIP metadata is not trusted");
      const meta=await inspectObject({kind:"export",storagePath:path,
        generation:String(obj.generation),maxBytes:128*1024*1024});
      const good=confirmedObject(meta,{
        generation:obj.generation,byteLength:obj.byteLength,
        contentType:"application/zip",sha256:obj.sha256});
      return result("export",jobId,good?"consistent":"integrity_alert",
        good?"Private ZIP metadata verified":
          "Completed export references missing or corrupted ZIP",{storagePath:path});
    }
    const meta=await inspectObject({
      kind:"export",storagePath:path,maxBytes:128*1024*1024});
    const active=job.status==="running"&&
      job.leaseExpiresAt&&deadlineMs(job.leaseExpiresAt)>now();
    if(active)return result("export",jobId,"in_flight",
      "Export lease is active; no cleanup permitted",{storagePath:path});
    return result("export",jobId,
      meta?.exists===true?"unlinked_private_object":"retryable_missing_object",
      meta?.exists===true
        ?"Unlinked ZIP may belong to a lost acknowledgment; verify bytes before replay"
        :"No ZIP found; restart only with a fresh trusted lease",
      {storagePath:path});
  }
  return Object.freeze({enabled:true,inspectPublication,inspectExport});
}
