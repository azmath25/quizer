// QN11.6.3 — staged author-owned problem/draft image scopes.
// Trusted QN11.4 ports resolve hybrid provenance. Unknown provenance,
// Neon outage and revoked sharing NEVER fall back to Firestore legacy.
import {assert,id,assetIds} from "../../shared/schema.js";
import {requireRole} from "../domain/runtime.js";
const ORIGINS=new Set(["firestore_legacy","neon_revision","hybrid"]);
export function createQuizerAuthorImageScope({
  enabled=false,resolveActor,resolveProblemOrigin,resolveDraftOrigin,
  neonReader,draftCompat,loadOwnedDraft,recheckDraft,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    authorize:async()=>({disabled:true})});
  assert([resolveActor,resolveProblemOrigin,resolveDraftOrigin,
    neonReader?.getProblemForTeacher,draftCompat?.getItems,
    loadOwnedDraft,recheckDraft].every(fn=>typeof fn==="function"),
    "INVALID_FIELDS","Trusted hybrid author image access ports required.");
  async function authorize({firebaseAuth,context}={}){
    assert(firebaseAuth?.uid&&firebaseAuth?.token &&
      context&&typeof context==="object",
      "AUTH_REQUIRED","Verified author identity and context required.");
    const actor=await resolveActor(firebaseAuth);
    requireRole(actor,"teacher");
    assert(actor.uid===firebaseAuth.uid,"AUTH_REQUIRED",
      "Image author mismatch.");
    const target=id(context.id,"author content ID");
    if(context.kind==="problem"){
      const origin=await resolveProblemOrigin({actor,problemId:target});
      assert(ORIGINS.has(origin)&&origin!=="hybrid",
        "RESOURCE_UNAVAILABLE","Problem image origin unavailable.");
      if(origin==="firestore_legacy")return {route:"legacy"};
      const revisionId=context.revisionId==null?null:
        id(context.revisionId,"problem revision ID");
      const row=await neonReader.getProblemForTeacher({
        actor,problemId:target,revisionId});
      assert(row?.problemId===target && row.content&&row.grading &&
        (!revisionId||row.revisionId===revisionId),
        "RESOURCE_UNAVAILABLE","Authorized problem revision unavailable.");
      return {route:"private",assetIds:[...new Set(
        assetIds(row.content,row.grading))].sort()};
    }
    assert(context.kind==="quiz_draft","INVALID_FIELDS",
      "Unsupported author image context.");
    const origin=await resolveDraftOrigin({actor,quizId:target});
    assert(ORIGINS.has(origin),"RESOURCE_UNAVAILABLE",
      "Draft provenance unavailable.");
    if(origin==="firestore_legacy")return {route:"legacy"};
    const snap=await loadOwnedDraft({actor,quizId:target});
    assert(snap?.quiz && snap.quiz.ownerId===actor.uid ||
      actor.role==="admin"&&snap?.quiz,
      "RESOURCE_UNAVAILABLE","Owned draft unavailable.");
    assert(snap.draft && Number.isInteger(snap.draft.version) &&
      Array.isArray(snap.draft.itemOrder) &&
      snap.draft.itemOrder.length<=500 &&
      new Set(snap.draft.itemOrder).size===snap.draft.itemOrder.length,
      "RESOURCE_UNAVAILABLE","Invalid pinned draft state.");
    const out=new Set();
    for(let index=0;index<snap.draft.itemOrder.length;index+=20){
      const ids=snap.draft.itemOrder.slice(index,index+20).map(v=>id(v));
      if(!ids.length)continue;
      const page=await draftCompat.getItems({
        auth:firebaseAuth,quizId:target,itemIds:ids});
      assert(page?.items?.length===ids.length &&
        page.items.every((x,i)=>x.itemId===ids[i]),
        "VERSION_CONFLICT","Draft sources changed.");
      for(const item of page.items)
        assetIds(item.content,item.grading).forEach(v=>out.add(v));
    }
    // Recheck owner and draft version after ALL cross-store reads.
    assert(await recheckDraft({
      actor,quizId:target,draftVersion:snap.draft.version,
      itemOrder:snap.draft.itemOrder,
    })===true,
      "VERSION_CONFLICT","Draft changed during image lookup.");
    return {route:"private",assetIds:[...out].sort()};
  }
  return Object.freeze({enabled:true,authorize});
}
