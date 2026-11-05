// QN10.2 — private Google Cloud/Firebase Storage Admin SDK adapter.
// No signed URLs, firebaseStorageDownloadTokens, public ACL or delete APIs.
// The publishing caller MUST be a trusted backend service identity.
import { assert, id, number } from "../../shared/schema.js";
import {
  BUNDLE_CONTENT_TYPE, BUNDLE_FORMAT, MAX_BUNDLE_BYTES,
  BUNDLE_OBJECT_PREFIX,
} from "./published-bundle.js";

const SAFE_OBJECT=/^published-bundles\/v1\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/([0-9a-f]{64})\.json$/;
function privatePath(path) {
  assert(typeof path==="string" && path.startsWith(BUNDLE_OBJECT_PREFIX+"/") &&
    SAFE_OBJECT.test(path),"INVALID_FIELDS","Unsafe private bundle object path.");
  const m=path.match(SAFE_OBJECT);
  id(m[1],"quiz ID");
  id(m[2],"revision ID");
  return path;
}

export function createPrivateBundleStoragePort({bucket,enabled=false}={}) {
  if(enabled!==true)
    return Object.freeze({enabled:false,
      createOnly:async()=>({disabled:true}),
      readExact:async()=>({disabled:true})});
  assert(bucket && typeof bucket.file==="function",
    "INVALID_FIELDS","Private Admin Storage bucket required.");
  async function createOnly({
    storagePath,bytes,contentType,cacheControl,ifGenerationMatch,
  }={}) {
    const path=privatePath(storagePath);
    assert(Buffer.isBuffer(bytes) && bytes.byteLength>0 &&
      bytes.byteLength<=MAX_BUNDLE_BYTES &&
      contentType===BUNDLE_CONTENT_TYPE &&
      cacheControl==="private, no-store" && ifGenerationMatch===0,
      "INVALID_FIELDS","Unverified create-only Storage request.");
    // GCS rejects a second create via HTTP 412. Never overwrite an existing
    // generation; the caller will independently verify duplicate content.
    await bucket.file(path).save(bytes,{
      resumable:false,
      validation:"crc32c",
      preconditionOpts:{ifGenerationMatch:0},
      metadata:{
        contentType:BUNDLE_CONTENT_TYPE,
        cacheControl:"private, no-store",
        metadata:{bundleFormat:BUNDLE_FORMAT},
      },
    });
    return {created:true};
  }
  async function readExact({storagePath,maxBytes}={}) {
    const path=privatePath(storagePath);
    assert(maxBytes===MAX_BUNDLE_BYTES,
      "INVALID_FIELDS","Private object byte ceiling required.");
    const file=bucket.file(path);
    const [metadata]=await file.getMetadata();
    assert(metadata && typeof metadata.generation!=="undefined" &&
      /^[1-9][0-9]{0,22}$/.test(String(metadata.generation)) &&
      Number.isSafeInteger(Number(metadata.size)) &&
      Number(metadata.size)>0 &&
      Number(metadata.size)<=MAX_BUNDLE_BYTES,
      "RESOURCE_UNAVAILABLE","Private bundle metadata invalid.");
    const custom=metadata.metadata??{};
    assert(!Object.hasOwn(custom,"firebaseStorageDownloadTokens") &&
      metadata.cacheControl==="private, no-store" &&
      metadata.contentType===BUNDLE_CONTENT_TYPE,
      "RESOURCE_UNAVAILABLE","Private object has unsafe metadata.");
    const generation=String(metadata.generation);
    // A pinned generation prevents a concurrent replacement from changing
    // the payload between metadata inspection and byte read.
    const [bytes]=await bucket.file(path,{generation}).download({
      validation:"crc32c",
    });
    assert(Buffer.isBuffer(bytes) && bytes.byteLength<=MAX_BUNDLE_BYTES &&
      bytes.byteLength===Number(metadata.size),
      "RESOURCE_UNAVAILABLE","Private bundle bytes unavailable.");
    return {
      bytes,generation,contentType:metadata.contentType,
      downloadTokenPresent:false,
    };
  }
  return Object.freeze({enabled:true,createOnly,readExact});
}
