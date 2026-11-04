// PROD1-P0: validate receipt-backed Neon imports before the existing
// Firestore finishImportJob transaction creates a reusable quiz. The legacy
// finish handler remains the only writer of the final quiz metadata.
import {assert,id,fields} from "../../shared/schema.js";
import {requireTeacher} from "../neon/contracts.js";

const ALLOWED=["apiVersion","action","requestId","jobId",
  "title","description","settings","order"];
export function createProd1ImportFinisher({
  enabled=false,db,resolveActor,legacyDispatch,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    finish:async()=>({disabled:true})});
  assert(db?.doc&&typeof resolveActor==="function"&&
    typeof legacyDispatch==="function",
    "FAILED_PRECONDITION","Trusted import finalization ports required.");
  const get=async path=>{
    const snap=await db.doc(path).get();
    return snap.exists?snap.data():null;
  };
  async function finish(auth,request){
    fields(request,ALLOWED);
    assert(request?.apiVersion===2&&
      request.action==="finishImportJob"&&
      typeof request.requestId==="string"&&
      /^[A-Za-z0-9_-]{16,100}$/.test(request.requestId),
      "INVALID_FIELDS","Invalid import finalization envelope.");
    const actor=requireTeacher(await resolveActor(auth));
    const jobId=id(request.jobId);
    const job=await get("jobs/"+jobId);
    assert(job?.kind==="import"&&job.requestedBy===actor.uid,
      "RESOURCE_UNAVAILABLE","Import job unavailable.");
    // The original Firestore operation owns the success receipt and is
    // replay-safe. Preserve its result, even if the imported quiz exists.
    if(job.status==="succeeded")
      return (await legacyDispatch(db,auth,request)).data;
    assert(job.status==="running"&&
      Number.isInteger(job.input?.itemCount)&&
      job.input.itemCount>=1&&job.input.itemCount<=500&&
      Array.isArray(job.importedKeys)&&
      job.progress?.processed===job.input.itemCount&&
      job.importedKeys.length===job.input.itemCount&&
      new Set(job.importedKeys).size===job.input.itemCount,
      "FAILED_PRECONDITION","Import receipts are incomplete.");
    if(!job.input.bankOnly){
      assert(Array.isArray(request.order)&&
        request.order.length===job.input.itemCount&&
        new Set(request.order).size===request.order.length&&
        request.order.every(x=>job.importedKeys.includes(x)),
        "VERSION_CONFLICT","Import item ordering differs from receipts.");
    }
    const keys=job.input.bankOnly?job.importedKeys:request.order;
    const receipts=[];
    for(let i=0;i<keys.length;i+=20){
      const part=keys.slice(i,i+20);
      const fetched=await Promise.all(part.map(key=>
        get("jobs/"+jobId+"/mappings/"+id(key))));
      receipts.push(...fetched);
    }
    const itemIds=new Set(),problemRevisions=new Set();
    for(let i=0;i<keys.length;i++){
      const row=receipts[i];
      assert(row&&row.importItemKey===keys[i]&&
        row.hash&&/^[0-9a-f]{64}$/.test(row.hash)&&
        row.version===1&&row.problemId&&row.revisionId&&
        row.itemId&&Number.isFinite(row.points)&&row.points>0&&
        !itemIds.has(row.itemId),
        "VERSION_CONFLICT","Import receipt is missing or inconsistent.");
      itemIds.add(row.itemId);
      problemRevisions.add(row.problemId+":"+row.revisionId);
    }
    // Imported problems may be reused in a quiz; item IDs themselves must
    // be unique and every pending draft slot must match its SQL receipt.
    if(!job.input.bankOnly){
      for(let i=0;i<receipts.length;i+=20){
        const part=receipts.slice(i,i+20);
        const slots=await Promise.all(part.map(row=>
          get("quizzes/"+id(job.targetId)+"/draftItems/"+id(row.itemId))));
        assert(slots.every((slot,index)=>{
          const row=part[index];
          return slot?.itemId===row.itemId&&
            slot.problemId===row.problemId&&
            slot.problemRevisionId===row.revisionId&&
            slot.points===row.points;
        }),"VERSION_CONFLICT",
        "Imported quiz slot does not match the durable receipt.");
      }
    }
    // The original Firebase handler atomically validates ownership, job
    // state, ordering and request idempotency again before committing.
    return (await legacyDispatch(db,auth,request)).data;
  }
  return Object.freeze({enabled:true,finish});
}
