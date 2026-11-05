// QN11.6.3 — owner-only, hash-verified retained image reads for private ZIP.
// No public image links. No Firestore retry transaction wraps Storage IO.
import {createHash} from "node:crypto";
import {assert,id,LIMITS} from "../../shared/schema.js";
import {hash} from "../domain/runtime.js";
const EXT=Object.freeze({"image/png":"png","image/jpeg":"jpg",
  "image/webp":"webp","image/gif":"gif"});
const SHA=/^[0-9a-f]{64}$/;
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
export function createFirestorePrivateExportAssetReader({
  enabled=false,db,bucket,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    readVerified:async()=>({disabled:true}),
    verifyRetained:async()=>({disabled:true})});
  assert(typeof db?.doc==="function" &&
    typeof bucket?.file==="function","INVALID_FIELDS",
    "Trusted Firestore asset metadata and Storage required.");
  async function checked({job,quizId,revisionId,assetId}={}){
    const target="quizzes/"+id(quizId)+"/revisions/"+id(revisionId);
    const itemId=id(assetId,"image ID");
    assert(job?.authorized===true && job.kind==="export_quiz" &&
      job.quizId===quizId && job.revisionId===revisionId &&
      id(job.ownerId) && job.leaseOwner && job.jobId,
      "RESOURCE_UNAVAILABLE","Trusted private export job required.");
    const [snap,refSnap]=await Promise.all([
      db.doc("assets/"+itemId).get(),
      db.doc("assets/"+itemId+"/refs/"+hash(target)).get(),
    ]);
    const a=snap.exists?snap.data():null;
    assert(refSnap.exists && refSnap.data()?.target===target &&
      a?.kind==="image" && a.status==="ready" &&
      Number.isInteger(a.referenceCount) && a.referenceCount>=1 &&
      a.ownerId && a.generation && SHA.test(a.sha256??"") &&
      Object.hasOwn(EXT,a.contentType) &&
      typeof a.storagePath==="string" &&
      a.storagePath===
        "assets/"+id(a.ownerId)+"/"+itemId+"/image."+EXT[a.contentType] &&
      Number.isInteger(a.sizeBytes) && a.sizeBytes>0 &&
      a.sizeBytes<=LIMITS.imageBytes &&
      /^[1-9][0-9]{0,22}$/.test(String(a.generation)),
      "RESOURCE_UNAVAILABLE","Image is not retained or ready.");
    return {a,itemId};
  }
  async function verifyRetained(args){
    await checked(args);
    return true;
  }
  async function readVerified(args={}){
    const {a,itemId}=await checked(args);
    const file=bucket.file(a.storagePath,{generation:String(a.generation)});
    const [metadata]=await file.getMetadata();
    assert(String(metadata.generation)===String(a.generation) &&
      Number(metadata.size)===a.sizeBytes &&
      metadata.contentType===a.contentType &&
      metadata.metadata?.sha256===a.sha256 &&
      !Object.hasOwn(metadata.metadata??{},"firebaseStorageDownloadTokens"),
      "RESOURCE_UNAVAILABLE","Retained image metadata changed.");
    const [bytes]=await file.download({validation:"crc32c"});
    assert(Buffer.isBuffer(bytes) && bytes.byteLength===a.sizeBytes &&
      digest(bytes)===a.sha256,
      "RESOURCE_UNAVAILABLE","Retained image bytes changed.");
    return {assetId:itemId,bytes,sha256:a.sha256,
      contentType:a.contentType,originalName:a.originalName??itemId,
      name:"images/"+itemId+"."+EXT[a.contentType]};
  }
  return Object.freeze({enabled:true,readVerified,verifyRetained});
}
