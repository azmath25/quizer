// QN11.6.5 — unmounted read-only Firebase + pinned-Storage inspector.
// It NEVER lists or deletes objects, never changes jobs/pointers/refs and
// never interprets auth/Storage/network failures as a missing object.
import {createHash} from "node:crypto";
import {assert,id} from "../../shared/schema.js";
import {transact,requireRole,manage} from "../domain/runtime.js";
import {createQuizerRecoveryInspector}
  from "./private-recovery-inspector.js";
import {MAX_BUNDLE_BYTES} from "./published-bundle.js";
import {MAX_PRIVATE_EXPORT_BYTES} from "./private-export-store.js";

const PUBLISHED=/^published-bundles\/v1\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[a-f0-9]{64}\.json$/;
const EXPORT=/^exports\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\.zip$/;
const hashBytes=bytes=>createHash("sha256").update(bytes).digest("hex");

export function createQuizerStagedRecoveryAudit({
  enabled=false,db,bucket,authFor,now=()=>Date.now(),
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,inspectPublication:async()=>({disabled:true}),
    inspectExport:async()=>({disabled:true}),
  });
  assert(db?.doc&&typeof db.runTransaction==="function"&&
    typeof bucket?.file==="function"&&typeof authFor==="function",
    "INVALID_FIELDS","Trusted, read-only recovery Firebase/Storage ports required.");
  const loadTrustedSnapshot=async({kind,jobId})=>{
    const snap=await db.doc("jobs/"+id(jobId)).get();
    assert(snap.exists&&snap.data()?.requestedBy,
      "RESOURCE_UNAVAILABLE","Recovery job unavailable.");
    const auth=await authFor(id(snap.data().requestedBy));
    return transact(db,"bundle.recovery.inspect",jobId+"-"+kind,
      async c=>{
        requireRole(c.actor,"teacher");
        const job=await c.get("jobs/"+jobId);
        const quizId=id(job.targetId,"quiz ID");
        const revisionId=id(job.input?.revisionId,"revision ID");
        const quiz=await c.get("quizzes/"+quizId);
        manage(c.actor,quiz);
        assert(job.requestedBy===quiz.ownerId &&
          job.kind===(kind==="publication"?"publish_quiz":"export_quiz"),
          "RESOURCE_UNAVAILABLE","Recovery job owner or kind changed.");
        const revision=await c.get(
          "quizzes/"+quizId+"/revisions/"+revisionId);
        return {job,quiz:{id:quizId,ownerId:quiz.ownerId},
          revision:{...revision,id:revisionId}};
      },auth);
  };
  const inspectObject=async({kind,storagePath,generation,maxBytes,
    requireByteHash=false}={})=>{
    const ceiling=kind==="publication"?MAX_BUNDLE_BYTES:
      kind==="export"?MAX_PRIVATE_EXPORT_BYTES:0;
    assert(ceiling>0 && maxBytes===ceiling &&
      typeof storagePath==="string" &&
      (kind==="publication"?PUBLISHED:EXPORT).test(storagePath),
      "INVALID_FIELDS","Forbidden recovery Storage inspection.");
    let metadata;
    try{
      [metadata]=await bucket.file(storagePath).getMetadata();
    }catch(error){
      if(error?.code===404||error?.code==="404")
        return {exists:false};
      throw error;
    }
    assert(metadata&&
      metadata.cacheControl==="private, no-store" &&
      !Object.hasOwn(metadata.metadata??{},
        "firebaseStorageDownloadTokens")&&
      (kind==="publication"?
        metadata.contentType==="application/json":
        metadata.contentType==="application/zip")&&
      /^[1-9][0-9]{0,22}$/.test(String(metadata.generation))&&
      Number.isSafeInteger(Number(metadata.size))&&
      Number(metadata.size)>0&&Number(metadata.size)<=ceiling,
      "RESOURCE_UNAVAILABLE","Private recovery object metadata invalid.");
    const found=String(metadata.generation);
    if(generation!==undefined&&generation!==found)
      return {exists:true,generation:found,
        byteLength:Number(metadata.size),
        contentType:metadata.contentType,
        sha256:null};
    if(!requireByteHash)return {exists:true,generation:found,
      byteLength:Number(metadata.size),contentType:metadata.contentType};
    // Read EXACT generation, bounded bytes, and derive the SHA from bytes.
    // Never trust only mutable GCS custom metadata when checking integrity.
    const [bytes]=await bucket.file(storagePath,{generation:found})
      .download({validation:"crc32c"});
    assert(Buffer.isBuffer(bytes)&&
      bytes.length===Number(metadata.size)&&bytes.length<=ceiling,
      "RESOURCE_UNAVAILABLE","Private recovery byte read mismatch.");
    return {exists:true,generation:found,
      byteLength:bytes.length,contentType:metadata.contentType,
      sha256:hashBytes(bytes)};
  };
  const inspector=createQuizerRecoveryInspector({
    enabled:true,loadTrustedSnapshot,inspectObject,now});
  return Object.freeze({...inspector,enabled:true});
}
