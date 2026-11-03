// QN11.5 STAGED: server-only first-attempt planning and private export source.
// No direct Storage URLs, browser-supplied actor, public URLs, live routing,
// migrations or cloud calls at module import.
import {assert,id,number,assetIds} from "../../shared/schema.js";
import {readPrivatePublishedBundle} from "./published-bundle.js";

export function createQuizerPrivateStartAndExport({
  enabled=false,preflightStart,commitStart,authorizeExport,
  loadRevision,readPrivateObject,verifyExportAssets,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    start:async()=>({disabled:true}),exportSource:async()=>({disabled:true})});
  assert([preflightStart,commitStart,authorizeExport,loadRevision,
    readPrivateObject,verifyExportAssets].every(x=>typeof x==="function"),
    "INVALID_FIELDS","Trusted start, export and Storage ports required.");

  async function start({firebaseAuth,quizId,sourceAttemptId=null,
    requestId=null}={}){
    id(quizId,"quiz ID");
    if(sourceAttemptId!==null)id(sourceAttemptId,"source attempt ID");
    assert(firebaseAuth?.uid && firebaseAuth?.token,
      "AUTH_REQUIRED","Verified Firebase callable identity required.");
    // This trusted Firebase preflight MUST check admission, participant,
    // attempt count, role, visibility, deadline and retry eligibility.
    const proof=await preflightStart({
      firebaseAuth,quizId,sourceAttemptId});
    // Resume an already-active attempt without unnecessarily downloading a
    // protected bundle. The transaction rechecks ownership/status/deadline.
    if(proof?.authorized===true && proof.actorUid===firebaseAuth.uid &&
      proof.quizId===quizId && proof.existingAttemptId){
      return commitStart({firebaseAuth,quizId,sourceAttemptId,requestId,
        proof,plan:null});
    }
    assert(proof?.authorized===true &&
      proof.actorUid===firebaseAuth.uid &&
      proof.quizId===quizId && proof.revisionId &&
      Array.isArray(proof.selectedItemIds) &&
      proof.selectedItemIds.length>0 &&
      proof.selectedItemIds.length<=500 &&
      new Set(proof.selectedItemIds).size===proof.selectedItemIds.length,
      "RESOURCE_UNAVAILABLE","Authorized pinned attempt plan unavailable.");
    const revisionId=id(proof.revisionId,"pinned revision ID");
    const revision=await loadRevision({quizId,revisionId});
    assert(revision?.state==="ready" && revision.bundle &&
      Array.isArray(revision.itemOrder) &&
      proof.selectedItemIds.every(key=>revision.itemOrder.includes(key)),
      "RESOURCE_UNAVAILABLE","Pinned private publication unavailable.");
    // Read protected keys only on the server; never deliver a bundle URL.
    const bundle=await readPrivatePublishedBundle({
      manifest:revision.bundle,quizId,revisionId,
      authorizePinnedRead:async()=>({
        authorized:true,pinnedRevisionId:revisionId}),
      readObject:readPrivateObject,
    });
    assert(bundle.itemCount===revision.itemOrder.length &&
      bundle.itemOrder.every((key,i)=>key===revision.itemOrder[i]),
      "VERSION_CONFLICT","Published question order changed.");
    const byItem=new Map(bundle.items.map(x=>[x.itemId,x]));
    const selected=proof.selectedItemIds.map(key=>{
      const item=byItem.get(id(key));
      assert(item && item.content?.options &&
        Array.isArray(item.content.options),
        "RESOURCE_UNAVAILABLE","Pinned question unavailable.");
      return {itemId:key,points:item.points,
        optionIds:item.content.options.map(o=>id(o.id,"option ID"))};
    });
    // commitStart is a Firestore-only transaction and MUST recheck:
    // verified UID, admission, quiz pointer/visibility/version, retry rights,
    // duplicate active attempt, attempt count and frozen revision manifest.
    // It persists orders, deadlines and attempts; no Storage/Neon inside it.
    const result=await commitStart({
      firebaseAuth,quizId,sourceAttemptId,requestId,proof,
      plan:{revisionId,bundleHash:revision.bundle.sha256,
        itemOrder:revision.itemOrder,selected,
        settings:proof.settingsSnapshot??revision.settings},
    });
    assert(result?.attemptId && result.quizRevisionId===revisionId,
      "FAILED_PRECONDITION","Attempt commit did not confirm pinned revision.");
    return result;
  }
  async function exportSource({jobId}={}){
    id(jobId,"export job ID");
    // Only a trusted server-side export worker calls this; no public action.
    const job=await authorizeExport({jobId});
    assert(job?.authorized===true && job.jobId===jobId &&
      job.kind==="export_quiz" && job.quizId && job.revisionId &&
      job.leaseOwner && job.status==="running" && job.ownerId,
      "RESOURCE_UNAVAILABLE","Authorized export job unavailable.");
    const quizId=id(job.quizId),revisionId=id(job.revisionId);
    const revision=await loadRevision({quizId,revisionId});
    assert(revision?.state==="ready" && revision.bundle,
      "RESOURCE_UNAVAILABLE","Private export revision unavailable.");
    const bundle=await readPrivatePublishedBundle({
      manifest:revision.bundle,quizId,revisionId,
      authorizePinnedRead:async()=>({
        authorized:true,pinnedRevisionId:revisionId}),
      readObject:readPrivateObject,
    });
    const ids=[...new Set(bundle.items.flatMap(x=>
      assetIds(x.content,x.grading)))];
    assert(await verifyExportAssets({
      job,quizId,revisionId,assetIds:ids,
    })===true,"RESOURCE_UNAVAILABLE",
      "Export asset was not retained or ready.");
    // Internal protected records ONLY. Caller writes a private ZIP after a
    // separate job-lease recheck; NEVER return this from the callable API.
    return {quizId,revisionId,itemCount:bundle.itemCount,
      records:bundle.items.map(x=>({content:x.content,grading:x.grading,
        itemId:x.itemId,points:x.points,
        problemId:x.problemId,problemRevisionId:x.problemRevisionId})),
      assetIds:ids};
  }
  return Object.freeze({enabled:true,start,exportSource});
}
