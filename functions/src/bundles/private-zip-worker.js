// QN11.6.3 — deterministic, private, bounded ZIP backup worker.
// No public endpoints. All Firebase/Storage IO happens OUTSIDE Firestore
// retry transactions; only the final lease/owner check is transactional.
import archiver from "archiver";
import {Writable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {createHash} from "node:crypto";
import {assert,id} from "../../shared/schema.js";
import {wire} from "../domain/runtime.js";
import {MAX_PRIVATE_EXPORT_BYTES} from "./private-export-store.js";
const ARCHIVE_DATE=new Date("1980-01-01T00:00:00Z");
const MAX_IMAGE_PAYLOAD_BYTES=80*1024*1024;
const sha=buffer=>createHash("sha256").update(buffer).digest("hex");

async function buildZip({source,images}){
  const buffers=[];
  let byteCount=0;
  const output=new Writable({write(chunk,encoding,callback){
    byteCount+=chunk.length;
    if(byteCount>MAX_PRIVATE_EXPORT_BYTES)
      return callback(new Error("QN11.6.3 ZIP byte ceiling exceeded"));
    buffers.push(chunk);callback();
  }});
  const zip=archiver("zip",{zlib:{level:6}});
  zip.on("warning",e=>output.destroy(e));
  zip.on("error",e=>output.destroy(e));
  const writing=pipeline(zip,output);
  const assets={};
  for(const a of images){
    assets[a.assetId]={path:a.name,originalName:a.originalName,
      sha256:a.sha256};
    zip.append(a.bytes,{name:a.name,date:ARCHIVE_DATE});
  }
  const body=wire({schemaVersion:2,kind:"math-quiz-backup",
    quizId:source.quizId,revision:source.revision,
    records:source.records.map(x=>({content:x.content,
      grading:x.grading})),assets});
  zip.append(Buffer.from(JSON.stringify(body,null,2),"utf8"),
    {name:"quiz.json",date:ARCHIVE_DATE});
  try{
    await zip.finalize();
    await writing;
  }catch(error){
    zip.abort();
    throw error;
  }
  const bytes=Buffer.concat(buffers);
  assert(bytes.byteLength>0&&
    bytes.byteLength<=MAX_PRIVATE_EXPORT_BYTES,
    "RESOURCE_UNAVAILABLE","Invalid private ZIP output.");
  return bytes;
}
export function createPrivateQuizZipWorker({
  enabled=false,exportStore,sourceReader,assetReader,storage,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    exportJob:async()=>({disabled:true})});
  assert(exportStore?.enabled===true &&
    typeof exportStore.load==="function" &&
    typeof exportStore.finish==="function" &&
    typeof sourceReader==="function" &&
    assetReader?.enabled===true &&
    typeof assetReader.readVerified==="function" &&
    storage?.enabled===true &&
    typeof storage.createOnly==="function" &&
    typeof storage.readExact==="function",
    "INVALID_FIELDS","Trusted ZIP export worker ports required.");
  async function exportJob({jobId}={}){
    id(jobId,"export job ID");
    const plan=await exportStore.load(jobId);
    if(plan?.completed===true)
      return {alreadyExported:true,jobId,result:plan.result};
    assert(plan?.authorized===true && plan.jobId===jobId &&
      plan.kind==="export_quiz" && plan.status==="running" &&
      plan.leaseOwner && plan.ownerId &&
      plan.manifest?.sha256,
      "RESOURCE_UNAVAILABLE","Verified export lease required.");
    const source=await sourceReader({jobId});
    assert(source?.quizId===plan.quizId &&
      source.revisionId===plan.revisionId &&
      source.revision?.bundle?.sha256===plan.manifest.sha256 &&
      source.revision?.bundle?.generation===plan.manifest.generation &&
      source.itemCount===plan.manifest.itemCount &&
      Array.isArray(source.records) &&
      source.records.length===source.itemCount &&
      Array.isArray(source.assetIds) &&
      source.assetIds.length<=2000 &&
      source.records.every((row,i)=>
        row.itemId===source.revision.itemOrder?.[i]) &&
      new Set(source.assetIds).size===source.assetIds.length,
      "VERSION_CONFLICT","Protected export source changed.");
    const assets=[];
    let assetBytes=0;
    for(const assetId of [...source.assetIds].sort()){
      id(assetId,"retained image ID");
      const a=await assetReader.readVerified({job:plan,
        quizId:plan.quizId,revisionId:plan.revisionId,assetId});
      assert(a?.assetId===assetId&&Buffer.isBuffer(a.bytes)&&
        a.name?.startsWith("images/"+assetId+"."),
        "RESOURCE_UNAVAILABLE","Retained image reader failed.");
      assetBytes+=a.bytes.length;
      assert(assetBytes<=MAX_IMAGE_PAYLOAD_BYTES,
        "RESOURCE_UNAVAILABLE","Too many image bytes for private ZIP.");
      assets.push(a);
    }
    const bytes=await buildZip({source,images:assets});
    const storagePath="exports/"+plan.ownerId+"/"+jobId+"/"+
      plan.quizId+"-"+jobId+".zip";
    try{
      await storage.createOnly({storagePath,bytes,quizId:plan.quizId});
    }catch(e){
      if(e?.code!==412 && e?.code!=="OBJECT_ALREADY_EXISTS")throw e;
    }
    // A retry may find a previous unacknowledged ZIP; its bytes MUST be
    // identical before Firestore reports a successful export.
    const verified=await storage.readExact({storagePath,quizId:plan.quizId,
      sha256:sha(bytes),byteLength:bytes.byteLength});
    return exportStore.finish({plan,object:verified});
  }
  return Object.freeze({enabled:true,exportJob});
}
