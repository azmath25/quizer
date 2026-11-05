// QN11.4 staged read-only source/quiz-draft compatibility.
// No live dispatcher import, no Firestore transaction callback wrapping Neon.
// The trusted Firestore snapshot/recheck callbacks MUST validate ownership,
// versions, slot IDs and retained published-revision identity atomically.
import {NeonContractError,requireTeacher,requireId} from "./contracts.js";
import {assetIds} from "../../shared/schema.js";
const fail=(reason,message)=>{throw new NeonContractError(reason,message);};
const SOURCE_KINDS=new Set(["firestore_legacy","neon_revision"]);
function checkIdentity(source,slot){
  if(source?.problemId!==slot.problemId ||
     source?.revisionId!==slot.problemRevisionId ||
     !source?.content||!source?.grading)
    fail("VERSION_CONFLICT","Problem source no longer matches pinned slot.");
}
export function createQuizerDraftCompatibility({
  enabled=false,resolveActor,resolveOrigin,loadOwnedDraft,loadSlots,
  neonReader,readLegacySource,readRetainedSource,recheckDraft,
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,getItems:async()=>({disabled:true}),
    prepareUpserts:async()=>({disabled:true}),
    draftAssetIds:async()=>({disabled:true}),
  });
  const callbacks=[resolveActor,resolveOrigin,loadOwnedDraft,loadSlots,
    neonReader?.getProblemForTeacher,readLegacySource,
    readRetainedSource,recheckDraft];
  if(callbacks.some(fn=>typeof fn!=="function"))
    throw Error("QN11.4 requires trusted, independently authorized draft ports.");
  async function context(auth,quizId){
    requireId(quizId,"quiz ID");
    const actor=requireTeacher(await resolveActor(auth));
    const owned=await loadOwnedDraft({actor,quizId});
    if(!owned?.quiz||!owned?.draft ||
      (owned.quiz.ownerId!==actor.uid && actor.role!=="admin")||
      !Number.isInteger(owned.draft.version)||
      owned.draft.version<1)
      fail("RESOURCE_UNAVAILABLE","Quiz draft unavailable.");
    return {actor,...owned,quizId};
  }
  async function resolveSlot(state,slot){
    for(const key of ["itemId","problemId","problemRevisionId"])
      requireId(slot[key],key);
    const origin=await resolveOrigin({
      actor:state.actor,problemId:slot.problemId});
    if(!SOURCE_KINDS.has(origin))
      fail("RESOURCE_UNAVAILABLE","Problem origin is not verified.");
    let source;
    try{
      source=origin==="neon_revision"
        ? await neonReader.getProblemForTeacher({
          actor:state.actor,problemId:slot.problemId,
          revisionId:slot.problemRevisionId})
        : await readLegacySource({
          actor:state.actor,quizId:state.quizId,slot});
    }catch(error){
      // Revoked sharing may use a legitimately pinned old published slot;
      // database outage, permission errors and schema errors MUST NOT be
      // misinterpreted as an authorizable published snapshot.
      if(error?.reason!=="RESOURCE_UNAVAILABLE")throw error;
      source=await readRetainedSource({
        actor:state.actor,quizId:state.quizId,quiz:state.quiz,
        slot,retainedRevisionId:
          state.quiz.publishedRevisionId??state.quiz.lastPublishedRevisionId});
    }
    checkIdentity(source,slot);
    return {...slot,content:source.content,grading:source.grading};
  }
  async function verifyFresh(state,slots){
    // This callback MUST use a short Firebase transaction to recheck actor
    // role/ownership/draft.version and exact slot versions after external IO.
    const ok=await recheckDraft({
      actor:state.actor,quizId:state.quizId,
      draftVersion:state.draft.version,
      itemIds:slots.map(s=>s.itemId),
      problemRefs:slots.map(s=>({
        itemId:s.itemId,problemId:s.problemId,
        problemRevisionId:s.problemRevisionId})),
    });
    if(ok!==true)
      fail("VERSION_CONFLICT","Quiz draft changed while loading problems.");
  }
  async function getItems({auth,quizId,itemIds}={}){
    if(!Array.isArray(itemIds)||itemIds.length>20 ||
      new Set(itemIds).size!==itemIds.length)
      fail("INVALID_FIELDS","Request at most 20 distinct draft items.");
    const state=await context(auth,quizId);
    const slots=await loadSlots({
      actor:state.actor,quizId,itemIds:itemIds.map(id=>requireId(id))});
    if(!Array.isArray(slots)||slots.length!==itemIds.length||
      slots.some((slot,i)=>slot.itemId!==itemIds[i]))
      fail("RESOURCE_UNAVAILABLE","Draft slot unavailable.");
    const items=[];
    for(const slot of slots)items.push(await resolveSlot(state,slot));
    await verifyFresh(state,slots);
    return {items};
  }
  async function prepareUpserts({auth,quizId,expectedDraftVersion,items}={}){
    if(!Array.isArray(items)||items.length>20)
      fail("INVALID_FIELDS","Save at most 20 changed problems.");
    const state=await context(auth,quizId);
    if(state.draft.version!==expectedDraftVersion)
      fail("VERSION_CONFLICT","The quiz draft changed elsewhere.");
    const slots=items.map((item,i)=>({
      itemId:item.itemId??item.clientKey??"new_"+i,
      problemId:item.problemId,problemRevisionId:item.problemRevisionId,
      points:item.points,
    }));
    const pins=[];
    for(const slot of slots){
      const resolved=await resolveSlot(state,slot);
      pins.push({itemId:slot.itemId,problemId:slot.problemId,
        problemRevisionId:slot.problemRevisionId,
        points:slot.points,questionAssetIds:assetIds(resolved.content),
        solutionAssetIds:assetIds({},resolved.grading)});
    }
    // For NEW slots the recheck port verifies owner, draft version and
    // existing referenced slot identities, not client-generated slot IDs.
    await verifyFresh(state,slots);
    return {quizId,draftVersion:state.draft.version,pins};
  }
  async function draftAssetIds({auth,quizId,itemIds}={}){
    const page=await getItems({auth,quizId,itemIds});
    return [...new Set(page.items.flatMap(x=>assetIds(x.content,x.grading)))];
  }
  return Object.freeze({enabled:true,getItems,prepareUpserts,draftAssetIds});
}
