// PROD1: trusted, read-only mixed-source draft compatibility.
// Used to prepare the later live quiz-draft handlers. Never performs Neon
// I/O inside Firestore retryable transactions; no production route is mounted.
import {assert,id} from "../../shared/schema.js";
import {requireTeacher} from "../neon/contracts.js";
import {createQuizerDraftCompatibility}
  from "../neon/draft-compat.js";

export function createProd1DraftReader({
  enabled=false,db,resolveActor,resolveProblemOrigin,neonReader,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false});
  assert(db?.doc&&typeof db.runTransaction==="function"&&
    typeof resolveActor==="function"&&
    typeof resolveProblemOrigin==="function"&&
    typeof neonReader?.getProblemForTeacher==="function",
    "FAILED_PRECONDITION","Trusted draft source services required.");
  const doc=async path=>{
    const snapshot=await db.doc(path).get();
    return snapshot.exists?snapshot.data():null;
  };
  const loadOwnedDraft=async({actor,quizId})=>{
    requireTeacher(actor);
    const [quiz,draft]=await Promise.all([
      doc("quizzes/"+id(quizId)),
      doc("quizzes/"+id(quizId)+"/drafts/current"),
    ]);
    assert(quiz?.lifecycle==="active"&&draft&&
      (quiz.ownerId===actor.uid||actor.role==="admin"),
      "RESOURCE_UNAVAILABLE","Quiz draft unavailable.");
    return {quiz,draft};
  };
  const loadSlots=async({actor,quizId,itemIds})=>{
    await loadOwnedDraft({actor,quizId});
    return Promise.all(itemIds.map(async itemId=>{
      const slot=await doc("quizzes/"+id(quizId)+
        "/draftItems/"+id(itemId));
      assert(slot?.itemId===itemId,"RESOURCE_UNAVAILABLE",
        "Draft item missing.");
      return slot;
    }));
  };
  const readLegacySource=async({actor,slot})=>{
    const problem=await doc("problems/"+id(slot.problemId));
    assert(problem&&(problem.ownerId===actor.uid||
      actor.role==="admin"||
      (problem.bankVisibility==="teachers"&&
        problem.lifecycle==="active")),"RESOURCE_UNAVAILABLE",
      "Problem no longer accessible.");
    const root="problems/"+id(slot.problemId)+"/revisions/"+
      id(slot.problemRevisionId);
    const [content,grading]=await Promise.all([
      doc(root),doc(root+"/grading/main"),
    ]);
    assert(content&&grading,"RESOURCE_UNAVAILABLE",
      "Pinned legacy problem revision unavailable.");
    const source=problem.ownerId===actor.uid||actor.role==="admin"
      ? content.source
      : {originalQuestionId:content.source?.originalQuestionId??null,
         importJobId:null,sourceAssetId:null};
    return {problemId:slot.problemId,
      revisionId:slot.problemRevisionId,
      content:{...content,source},grading};
  };
  const readRetainedSource=async({
    actor,quizId,quiz,slot,retainedRevisionId,
  })=>{
    requireTeacher(actor);
    assert(quiz?.ownerId===actor.uid||actor.role==="admin",
      "RESOURCE_UNAVAILABLE","Retained snapshot unavailable.");
    assert(retainedRevisionId,"RESOURCE_UNAVAILABLE",
      "No retained revision exists.");
    const prefix="quizzes/"+id(quizId)+"/revisions/"+
      id(retainedRevisionId);
    const revision=await doc(prefix);
    // Private bundle contents must never be sourced from a legacy Firestore
    // path or leaked through this compatibility fallback.
    assert(revision?.state==="ready"&&!revision.bundle,
      "RESOURCE_UNAVAILABLE","Legacy snapshot unavailable.");
    const [content,grading]=await Promise.all([
      doc(prefix+"/items/"+id(slot.itemId)),
      doc(prefix+"/grading/"+id(slot.itemId)),
    ]);
    assert(content&&grading&&
      content.problemId===slot.problemId&&
      content.problemRevisionId===slot.problemRevisionId,
      "RESOURCE_UNAVAILABLE","Pinned snapshot mismatch.");
    return {problemId:slot.problemId,
      revisionId:slot.problemRevisionId,content,grading};
  };
  const recheckDraft=async({
    actor,quizId,draftVersion,itemIds,problemRefs,
  })=>db.runTransaction(async tx=>{
    const paths=["roles/"+actor.uid,"quizzes/"+id(quizId),
      "quizzes/"+id(quizId)+"/drafts/current"];
    const [r,q,d]=await Promise.all(paths.map(async p=>{
      const snap=await tx.get(db.doc(p));
      return snap.exists?snap.data():null;
    }));
    if(!r||r.accountStatus==="disabled"||
       !["teacher","admin"].includes(r.role)||
       (actor.role!=="admin"&&r.role!==actor.role)||
       !q||q.lifecycle!=="active"||
       (q.ownerId!==actor.uid&&r.role!=="admin")||
       d?.version!==draftVersion)return false;
    const refs=new Map(problemRefs.map(x=>[x.itemId,x]));
    if(refs.size!==itemIds.length)return false;
    const found=await Promise.all(itemIds.map(itemId=>
      tx.get(db.doc("quizzes/"+id(quizId)+
        "/draftItems/"+id(itemId)))));
    return found.every((snap,i)=>{
      const pin=refs.get(itemIds[i]);
      return snap.exists&&
        snap.data().itemId===pin?.itemId&&
        snap.data().problemId===pin?.problemId&&
        snap.data().problemRevisionId===pin?.problemRevisionId;
    });
  });
  const reader=createQuizerDraftCompatibility({
    enabled:true,resolveActor,resolveOrigin:resolveProblemOrigin,
    loadOwnedDraft,loadSlots,neonReader,
    readLegacySource,readRetainedSource,recheckDraft,
  });
  return Object.freeze({enabled:true,getItems:reader.getItems,
    draftAssetIds:reader.draftAssetIds,
    // Refuse unsafe new-slot preparation until the cross-store write path
    // has a separately tested Firestore slot allocation protocol.
    async prepareUpserts(){assert(false,"FAILED_PRECONDITION",
      "Prod1 draft writes require the cross-store mutation release gate.");},
  });
}
