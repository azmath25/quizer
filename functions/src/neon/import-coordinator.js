// QN11.3: default-OFF, trusted Firestore import coordinator.
// Every external SQL call MUST occur between these transaction callbacks.
// Not mounted in active Firebase routing. Does not store question/answer text.
import {randomUUID} from "node:crypto";
import {fingerprint} from "./write-repository.js";
import {requireId, requireTeacher, NeonContractError} from "./contracts.js";

const fail=(reason,msg)=>{throw new NeonContractError(reason,msg);};
const unique=(items)=>new Set(items).size===items.length;
const actorId=(auth)=>requireId(auth?.uid,"verified UID");
const operationPath=(jobId,requestId)=>
  "jobs/"+jobId+"/importOperations/"+requestId;
const jobPath=(jobId)=>"jobs/"+jobId;
const isHash=(x)=>typeof x==="string" && /^[a-f0-9]{64}$/.test(x);
const importItems=(items)=>{
  if(!Array.isArray(items)||items.length<1||items.length>20)
    fail("INVALID_FIELDS","Import must contain 1–20 item receipts.");
  const normalized=items.map(i=>{
    const importItemKey=requireId(i.importItemKey,"item key");
    if(!isHash(i.payloadHash))fail("INVALID_FIELDS","Invalid item digest.");
    if(typeof i.points!=="number" || !Number.isFinite(i.points) ||
       i.points<=0 || i.points>1000)
      fail("INVALID_FIELDS","Invalid problem points.");
    return {importItemKey,payloadHash:i.payloadHash,points:i.points};
  });
  if(!unique(normalized.map(i=>i.importItemKey)))
    fail("INVALID_FIELDS","Duplicate import item key.");
  return normalized;
};
function checkJob(job,uid){
  if(!job || job.kind!=="import" || job.requestedBy!==uid ||
    job.status!=="running" || !Number.isInteger(job.input?.itemCount) ||
    job.input.itemCount<1 || job.input.itemCount>500)
    fail("RESOURCE_UNAVAILABLE","Import job unavailable.");
}
function responseRows(result,items){
  if(!result || !Array.isArray(result.mappings) ||
    result.mappings.length!==items.length)
    fail("FAILED_PRECONDITION","Incomplete SQL import mappings.");
  const expected=new Map(items.map(i=>[i.importItemKey,i]));
  const seen=new Set();
  const rows=result.mappings.map(row=>{
    const key=requireId(row.importItemKey,"mapping key");
    if(!expected.has(key)||seen.has(key)||row.hash!==expected.get(key).payloadHash)
      fail("VERSION_CONFLICT","SQL mapping did not match intended import.");
    seen.add(key);
    for(const k of ["problemId","revisionId","itemId"])
      requireId(row[k],k);
    if(row.points!==expected.get(key).points)
      fail("VERSION_CONFLICT","Imported points changed.");
    return {importItemKey:key,problemId:row.problemId,
      revisionId:row.revisionId,itemId:row.itemId,
      points:row.points,hash:row.hash};
  });
  return rows;
}
export function createQuizerImportCoordinator({
  enabled=false,db,now=()=>Date.now(),leaseMs=120000,
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,prepare:async()=>({disabled:true}),
    recordEffect:async()=>({disabled:true}),
    finalize:async()=>({disabled:true}),
  });
  if(typeof db?.runTransaction!=="function" ||
     typeof db?.doc!=="function" ||
     typeof now!=="function" ||
     !Number.isInteger(leaseMs)||leaseMs<30000||leaseMs>300000)
    throw Error("QN11.3 needs trusted Firestore transactions and a bounded lease.");
  const get=async(tx,path)=>{
    const snap=await tx.get(db.doc(path));
    return snap.exists?snap.data():null;
  };
  async function actor(tx,auth){
    const uid=actorId(auth);
    const role=await get(tx,"roles/"+uid);
    requireTeacher({uid,emailVerified:auth.token?.email_verified===true,
      role:role?.role??"student",
      accountStatus:role?.accountStatus??"active"});
    return uid;
  }
  const allowed=(action)=>{if(action!=="importProblemBatch")
    fail("INVALID_FIELDS","Only staged import batches are supported.");};
  async function prepare({action,auth,requestId,payloadHash,expectedItems}){
    allowed(action);
    const uid=actorId(auth),jobId=requireId(expectedItems?.jobId,"job ID");
    requireId(requestId,"request ID");
    if(!isHash(payloadHash))fail("INVALID_FIELDS","Invalid request fingerprint.");
    const items=importItems(expectedItems.items);
    return db.runTransaction(async tx=>{
      await actor(tx,auth);
      const job=await get(tx,jobPath(jobId));
      checkJob(job,uid);
      const ref=db.doc(operationPath(jobId,requestId));
      const old=await get(tx,ref.path);
      if(old && (old.ownerId!==uid || old.payloadHash!==payloadHash ||
        old.action!==action || fingerprint(old.items)!==fingerprint(items)))
        fail("VERSION_CONFLICT","Request ID was reused for another import.");
      if(old?.status==="complete") {
        if(!old.reply)fail("FAILED_PRECONDITION","Completed import lacks a reply.");
        return {status:"complete",result:old.reply};
      }
      const stamp=now();
      const claim=job.importClaim;
      if(claim && claim.requestId!==requestId && claim.until>stamp)
        fail("FAILED_PRECONDITION","Another import batch is running; retry shortly.");
      // Expired claims may be fenced. The old SQL effect is reconciled later
      // using immutable SQL item receipts; no delete or rollback is attempted.
      const token=old && claim?.requestId===requestId &&
        claim.token===old.token && claim.until>stamp
          ? old.token : randomUUID();
      const until=stamp+leaseMs;
      const next={ownerId:uid,action,payloadHash,items,
        status:"prepared",token,until,
        ...(old?.result?{result:old.result}:{})};
      tx.set(ref,next);
      tx.set(db.doc(jobPath(jobId)),{...job,
        importClaim:{requestId,token,until},updatedAt:new Date(stamp)});
      return {status:"prepared",token};
    });
  }
  async function recordEffect({action,auth,requestId,payloadHash,token,result,
    jobId}){
    allowed(action);
    const uid=actorId(auth),jid=requireId(jobId,"job ID");
    return db.runTransaction(async tx=>{
      const path=operationPath(jid,requestId);
      const op=await get(tx,path);
      const job=await get(tx,jobPath(jid));
      if(!op || op.ownerId!==uid || op.token!==token ||
        op.payloadHash!==payloadHash || !job ||
        job.importClaim?.token!==token ||
        job.importClaim?.until<=now() || op.until<=now())
        fail("VERSION_CONFLICT","Import fence expired or no longer owns this effect.");
      const rows=responseRows(result,op.items);
      if(op.status==="complete")return {alreadyRecorded:true};
      if(op.result && fingerprint(op.result)!==fingerprint(rows))
        fail("VERSION_CONFLICT","Conflicting import effect receipts.");
      tx.set(db.doc(path),{...op,status:"effect_recorded",result:rows});
      return {recorded:true};
    });
  }
  async function finalize({action,auth,requestId,payloadHash,token,result,
    jobId}){
    allowed(action);
    const uid=actorId(auth),jid=requireId(jobId,"job ID");
    return db.runTransaction(async tx=>{
      await actor(tx,auth);
      const job=await get(tx,jobPath(jid));
      const path=operationPath(jid,requestId);
      const op=await get(tx,path);
      if(!op || op.ownerId!==uid || op.payloadHash!==payloadHash)
        fail("VERSION_CONFLICT","Operation fingerprint changed.");
      if(op.status==="complete")return op.reply;
      checkJob(job,uid);
      if(op.token!==token || job.importClaim?.token!==token ||
        job.importClaim?.until<=now() || op.until<=now())
        fail("VERSION_CONFLICT","Import operation fence expired or changed.");
      if(op.status!=="effect_recorded" || !op.result)
        fail("FAILED_PRECONDITION","SQL effect was not durably recorded.");
      const rows=responseRows(result,op.items);
      if(fingerprint(rows)!==fingerprint(op.result))
        fail("VERSION_CONFLICT","SQL effect receipt changed.");
      const existing=await Promise.all(rows.map(row=>
        get(tx,"jobs/"+jid+"/mappings/"+row.importItemKey)));
      const priorKeys=job.importedKeys??[];
      if(!Array.isArray(priorKeys)||!unique(priorKeys) ||
         priorKeys.length!==(job.progress?.processed??0))
        fail("FAILED_PRECONDITION","Import ledger requires reconciliation.");
      const keys=new Set(priorKeys);
      const newRows=[];
      rows.forEach((row,index)=>{
        if(existing[index]){
          const old=existing[index];
          if(old.hash!==row.hash || old.problemId!==row.problemId ||
            old.revisionId!==row.revisionId || old.itemId!==row.itemId ||
            old.points!==row.points)
            fail("VERSION_CONFLICT","Existing import mapping differs.");
          if(!keys.has(row.importItemKey))
            fail("FAILED_PRECONDITION","Mapping is missing from the job ledger.");
        }else{
          if(keys.has(row.importItemKey))
            fail("FAILED_PRECONDITION","Ledger item has no saved mapping.");
          keys.add(row.importItemKey);
          newRows.push(row);
        }
      });
      if(keys.size>job.input.itemCount)
        fail("INVALID_FIELDS","Too many problems imported.");
      // All Firestore reads above; no external SQL/Storage inside this callback.
      for(const row of newRows){
        tx.set(db.doc("jobs/"+jid+"/mappings/"+row.importItemKey),
          {...row,version:1});
        if(!job.input.bankOnly)
          tx.set(db.doc("quizzes/"+job.targetId+"/draftItems/"+row.itemId),{
            itemId:row.itemId,problemId:row.problemId,
            problemRevisionId:row.revisionId,points:row.points,
            reuseFromQuizRevisionId:null});
      }
      const processed=keys.size;
      const reply={mappings:rows,processed};
      tx.set(db.doc(jobPath(jid)),{...job,
        importedKeys:[...keys].sort(),
        importClaim:null,
        progress:{...job.progress,processed,stage:"Importing"},
        updatedAt:new Date(now())});
      tx.set(db.doc(path),{...op,status:"complete",result:rows,
        reply,completedAt:new Date(now())});
      return reply;
    });
  }
  return Object.freeze({enabled:true,prepare,recordEffect,finalize});
}
