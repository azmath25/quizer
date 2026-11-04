// PROD1: staged hybrid draft writes. No SQL inside Firestore transactions.
// No live endpoint registration; immutable Neon revisions are preflighted by
// trusted server SQL before committing minimal Firebase slot references.
import {assert,id,fields,text,number,validateSettings} from "../../shared/schema.js";
import {hash} from "../domain/runtime.js";
import {requireTeacher} from "../neon/contracts.js";

const ALLOWED=["apiVersion","action","requestId","quizId",
  "expectedDraftVersion","patch","upsertItems","removeItemIds","itemOrder"];
const metadataFields=["title","description","subject","difficulty","settings"];
const slotFields=["clientKey","itemId","problemId","problemRevisionId","points"];
const fail=(why,whyText)=>assert(false,why,whyText);
const doc=async(db,path)=>{
  const snap=await db.doc(path).get();
  return snap.exists?snap.data():null;
};
const stamp=()=>new Date();
export function createProd1DraftMutationGateway({
  enabled=false,db,resolveActor,resolveOrigin,neonReader,
  legacyDispatch,verifyAssets,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    handle:async()=>({disabled:true})});
  assert(db?.doc&&typeof db.runTransaction==="function"&&
    [resolveActor,resolveOrigin,legacyDispatch,verifyAssets,
      neonReader?.getProblemForTeacher].every(fn=>typeof fn==="function"),
    "FAILED_PRECONDITION","Trusted hybrid draft service required.");
  async function handle(auth,r){
    fields(r,ALLOWED);
    assert(r?.apiVersion===2&&r.action==="saveQuizDraft"&&
      typeof r.requestId==="string"&&
      /^[A-Za-z0-9_-]{16,100}$/.test(r.requestId),
      "INVALID_FIELDS","Invalid draft mutation envelope.");
    const upserts=r.upsertItems??[], removes=r.removeItemIds??[];
    assert(Array.isArray(upserts)&&upserts.length<=20&&
      Array.isArray(removes)&&removes.length<=20,
      "INVALID_FIELDS","Save at most 20 modified slots.");
    // Metadata-only and unchanged saves retain the existing efficient
    // Firebase path. Avoid any SQL call or TeX/source read.
    if(upserts.length===0)
      return (await legacyDispatch(db,auth,r)).data;
    const actor=requireTeacher(await resolveActor(auth));
    const quizId=id(r.quizId);
    const pins=[];
    let needsHybrid=false;
    for(const item of upserts){
      fields(item,slotFields);
      assert(Boolean(item.clientKey)!==Boolean(item.itemId),
        "INVALID_FIELDS","Choose one client key or item ID.");
      const problemId=id(item.problemId),
        revisionId=id(item.problemRevisionId);
      const origin=await resolveOrigin({actor,problemId});
      assert(["firestore_legacy","neon_revision"].includes(origin),
        "RESOURCE_UNAVAILABLE","Unknown problem provenance.");
      if(origin==="neon_revision"){
        needsHybrid=true;
        const resolved=await neonReader.getProblemForTeacher({
          actor,problemId,revisionId});
        // First release permits only self-owned Neon pins. Third-party
        // sharing/grants require a separate Firebase transaction fence.
        assert(resolved?.problemId===problemId&&
          resolved.revisionId===revisionId&&
          resolved.problem?.ownerId===actor.uid&&
          resolved.problem?.lifecycle==="active",
          "RESOURCE_UNAVAILABLE","Owner's pinned Neon revision unavailable.");
        await verifyAssets({actor,assetIds:[
          ...new Set([
            ...(resolved.content?.questionAssetBindings??[])
              .map(x=>typeof x==="string"?x:x.assetId),
            ...(resolved.grading?.solutionAssetBindings??[])
              .map(x=>typeof x==="string"?x:x.assetId),
          ].filter(Boolean))]});
      }
      pins.push({item,problemId,revisionId,origin});
    }
    if(!needsHybrid)
      return (await legacyDispatch(db,auth,r)).data;
    const digest=hash(r);
    // Only trusted Firebase actors can reach this transaction; the current
    // role, owner, draft version, receipt and old-source grants are rechecked.
    return db.runTransaction(async tx=>{
      const ref=path=>db.doc(path);
      const read=async path=>{
        const snap=await tx.get(ref(path));
        return snap.exists?snap.data():null;
      };
      const rp="operations/"+actor.uid+"/requests/"+r.requestId;
      const [receipt,role,quiz,draft]=await Promise.all([
        read(rp),read("roles/"+actor.uid),
        read("quizzes/"+quizId),
        read("quizzes/"+quizId+"/drafts/current"),
      ]);
      if(receipt){
        assert(receipt.inputHash===digest,
          "VERSION_CONFLICT","Request ID was reused.");
        return receipt.result;
      }
      assert(role&&role.accountStatus!=="disabled"&&
        ["teacher","admin"].includes(role.role)&&
        (quiz?.ownerId===actor.uid||role.role==="admin")&&
        quiz?.lifecycle==="active"&&!quiz.publishingJobId&&
        draft?.version===r.expectedDraftVersion,
        "VERSION_CONFLICT","Quiz, author or draft changed.");
      const extra=await Promise.all(pins.map(async pin=>{
        if(pin.origin==="neon_revision")return null;
        return read("problems/"+pin.problemId);
      }));
      const oldOrder=[...draft.itemOrder], existing=new Set(oldOrder);
      const seen=new Set(),mapping={},order=[...oldOrder],writes=[];
      for(let i=0;i<pins.length;i++){
        const {item,problemId,revisionId,origin}=pins[i],
          key=id(item.itemId??item.clientKey);
        assert(!seen.has(key),"INVALID_FIELDS","Duplicate draft item.");
        seen.add(key);
        const itemId=item.itemId?id(item.itemId):
          "itm_"+hash(actor.uid+":"+r.requestId+":"+key).slice(0,28);
        if(item.itemId)
          assert(existing.has(itemId),"INVALID_FIELDS","Unknown draft item.");
        else {mapping[key]=itemId;order.push(itemId);}
        if(origin==="firestore_legacy"){
          const p=extra[i];
          assert(p&&(p.ownerId===actor.uid||role.role==="admin"||
            (p.bankVisibility==="teachers"&&p.lifecycle==="active")),
            "RESOURCE_UNAVAILABLE","Legacy problem not authorized.");
        }
        writes.push({itemId,problemId,problemRevisionId:revisionId,
          points:number(item.points,"Points",0.00000001,1000),
          reuseFromQuizRevisionId:null});
      }
      const removed=new Set(removes.map(id));
      assert(removed.size===removes.length&&
        removes.every(key=>existing.has(key)&&!seen.has(key)),
        "INVALID_FIELDS","Invalid removed slots.");
      const remaining=order.filter(x=>!removed.has(x));
      const nextOrder=r.itemOrder?
        r.itemOrder.map(x=>mapping[x]??id(x)):remaining;
      assert(nextOrder.length===remaining.length&&
        nextOrder.length<=500&&new Set(nextOrder).size===nextOrder.length&&
        nextOrder.every(x=>remaining.includes(x)),
        "INVALID_FIELDS","Draft order must contain exactly the current slots.");
      const patch=r.patch??{};
      fields(patch,metadataFields,"draft");
      const next={...draft,version:draft.version+1,
        updatedAt:stamp(),updatedBy:actor.uid,
        itemOrder:nextOrder};
      for(const [k,max] of [["title",200],["description",2000],
        ["subject",80],["difficulty",40]])
        if(patch[k]!==undefined)
          next[k]=text(patch[k],k,max,k==="title");
      if(patch.settings!==undefined)
        next.settings=validateSettings(patch.settings,draft.settings);
      // Reads are complete. Commit only lightweight slot refs and metadata.
      for(const slot of writes)
        tx.set(ref("quizzes/"+quizId+"/draftItems/"+slot.itemId),slot);
      for(const key of removed)
        tx.delete(ref("quizzes/"+quizId+"/draftItems/"+key));
      tx.set(ref("quizzes/"+quizId+"/drafts/current"),next);
      tx.set(ref("quizzes/"+quizId),{...quiz,
        title:next.title,searchTitle:next.title.toLowerCase(),
        description:next.description,subject:next.subject,
        difficulty:next.difficulty,draftVersion:next.version,
        version:quiz.version+1,updatedAt:stamp()});
      const result={draftVersion:next.version,version:quiz.version+1,
        itemOrder:nextOrder,itemIdMap:mapping};
      tx.set(ref(rp),{action:r.action,inputHash:digest,
        result,createdAt:stamp()});
      tx.set(ref("auditEvents/evt_"+hash(rp).slice(0,28)),{
        actorId:actor.uid,actorRoleAtTime:role.role,
        action:"quiz.draft_saved",targetType:"quiz",targetId:quizId,
        quizId,quizOwnerId:quiz.ownerId,requestId:r.requestId,
        changedFields:["items",...Object.keys(patch)],
        occurredAt:stamp()});
      return result;
    });
  }
  return Object.freeze({enabled:true,handle});
}
