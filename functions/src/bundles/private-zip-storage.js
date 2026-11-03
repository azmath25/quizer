// QN11.6.3 — private ZIP Storage port. No public ACL, token, deletion, or
// published-bundle signing. Output is owner-only and CREATE-ONLY.
import {assert,id} from "../../shared/schema.js";
import {createHash} from "node:crypto";
import {MAX_PRIVATE_EXPORT_BYTES} from "./private-export-store.js";
const SHA=/^[0-9a-f]{64}$/;
const SAFE=/^exports\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})-([A-Za-z0-9_-]{1,128})\.zip$/;
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
export function createPrivateZipStoragePort({enabled=false,bucket}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    createOnly:async()=>({disabled:true}),
    readExact:async()=>({disabled:true}),
    sign:async()=>({disabled:true})});
  assert(typeof bucket?.file==="function",
    "INVALID_FIELDS","Trusted private ZIP bucket required.");
  function safePath(storagePath){
    assert(typeof storagePath==="string"&&SAFE.test(storagePath),
      "INVALID_FIELDS","Unsafe private export path.");
    const m=storagePath.match(SAFE);
    assert(m[3]===m[1]||id(m[3]),
      "INVALID_FIELDS","Invalid ZIP filename quiz ID.");
    assert(m[4]===m[2],"INVALID_FIELDS",
      "Export filename job mismatch.");
    return storagePath;
  }
  async function createOnly({storagePath,bytes}={}){
    const path=safePath(storagePath);
    assert(Buffer.isBuffer(bytes) && bytes.byteLength>0 &&
      bytes.byteLength<=MAX_PRIVATE_EXPORT_BYTES,
      "INVALID_FIELDS","Private ZIP exceeds bounded size.");
    const sha256=digest(bytes);
    await bucket.file(path).save(bytes,{
      resumable:false,validation:"crc32c",
      preconditionOpts:{ifGenerationMatch:0},
      metadata:{contentType:"application/zip",
        cacheControl:"private, no-store",
        metadata:{sha256}},
    });
    return {storagePath,sha256,byteLength:bytes.length};
  }
  async function readExact({storagePath,sha256,byteLength}={}){
    const path=safePath(storagePath);
    assert(SHA.test(sha256) &&
      Number.isInteger(byteLength) && byteLength>0 &&
      byteLength<=MAX_PRIVATE_EXPORT_BYTES,
      "INVALID_FIELDS","Invalid private ZIP readback proof.");
    const [metadata]=await bucket.file(path).getMetadata();
    assert(metadata && metadata.contentType==="application/zip" &&
      metadata.cacheControl==="private, no-store" &&
      !Object.hasOwn(metadata.metadata??{},"firebaseStorageDownloadTokens") &&
      metadata.metadata?.sha256===sha256 &&
      Number(metadata.size)===byteLength &&
      /^[1-9][0-9]{0,22}$/.test(String(metadata.generation)),
      "RESOURCE_UNAVAILABLE","Private ZIP metadata mismatch.");
    const generation=String(metadata.generation);
    const [bytes]=await bucket.file(path,{generation}).download({
      validation:"crc32c"});
    assert(Buffer.isBuffer(bytes) && bytes.byteLength===byteLength &&
      digest(bytes)===sha256,
      "RESOURCE_UNAVAILABLE","Private ZIP content mismatch.");
    return {storagePath,generation,sha256,byteLength,
      contentType:"application/zip"};
  }
  async function sign({storagePath,generation,expiresAt}={}){
    const path=safePath(storagePath);
    assert(/^[1-9][0-9]{0,22}$/.test(String(generation)) &&
      expiresAt instanceof Date &&
      Number.isFinite(expiresAt.getTime()) &&
      expiresAt.getTime()>Date.now() &&
      expiresAt.getTime()-Date.now()<=120001,
      "INVALID_FIELDS","Short-lived ZIP access required.");
    const [url]=await bucket.file(path,{generation:String(generation)})
      .getSignedUrl({version:"v4",action:"read",expires:expiresAt,
        queryParams:{generation:String(generation)}});
    assert(typeof url==="string"&&url.startsWith("https://") &&
      !url.includes("firebaseStorageDownloadTokens") &&
      !url.includes("published-bundles"),
      "RESOURCE_UNAVAILABLE","Private ZIP signature unavailable.");
    return url;
  }
  return Object.freeze({enabled:true,createOnly,readExact,sign});
}
