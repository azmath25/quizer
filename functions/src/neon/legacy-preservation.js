// QN9: pure, read-only preservation inventory of a SANITIZED Firestore export.
// No Firebase SDK or Neon connection. Never read or mutate live data here.
// Input: { "collection/document/...": plain JS JSON record }. All catalog,
// draft, historical published/answer, asset-ref and attempt paths remain frozen.
import { validateMetadata, validateProblem, assetIds } from "../../shared/schema.js";
import { fingerprint } from "./write-repository.js";
import { requireId } from "./contracts.js";

const CONTENT = ["type","answerMode","statementLatex","options",
  "defaultPoints","questionAssetBindings"];
const GRADING = ["correctOptionId","acceptedAnswers","tolerance",
  "explanationLatex","rubricLatex","solutionAssetBindings"];
const select = (row, names) => Object.fromEntries(
  names.filter(k => Object.hasOwn(row ?? {},k)).map(k=>[k,row[k]]));
const isDoc = row => row && typeof row === "object" && !Array.isArray(row);
const present = (docs, path) => Object.hasOwn(docs,path);
const direct = (docs,prefix) =>
  Object.keys(docs).filter(k=>k.startsWith(prefix) &&
    !k.slice(prefix.length).includes("/")).sort();
const stamp = v => v?.toDate?.()?.toISOString?.() ??
  (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);

export function buildLegacyPreservationPlan({ documents } = {}) {
  if (!isDoc(documents)) throw new Error("Sanitized document map required");
  const paths=Object.keys(documents).sort();
  for(const path of paths) {
    if (!/^(?:[A-Za-z0-9_-]+\/){1,}[A-Za-z0-9_-]+$/.test(path) ||
        path.split("/").length%2!==0 || !isDoc(documents[path]))
      throw new Error("Invalid sanitized document path or record");
  }
  const errors=[], warnings=[], problemRows=[], seenAssets=new Set();
  const fail=(code,path)=>errors.push({code,path});
  const warn=(code,path)=>warnings.push({code,path});
  const find=(path,code="MISSING_REFERENCE")=>{
    if(!present(documents,path)){fail(code,path);return null;}
    return documents[path];
  };
  const checkAssets=(record,path)=>{
    for(const assetId of assetIds(record.content,record.grading)){
      try { requireId(assetId); } catch { fail("INVALID_ASSET_ID",path);continue;}
      seenAssets.add(assetId);
      if(!present(documents,"assets/"+assetId))
        fail("ASSET_RECORD_MISSING","assets/"+assetId);
    }
  };
  for(const path of direct(documents,"problems/")) {
    const problemId=path.split("/")[1], p=documents[path];
    if(p.schemaVersion!==2){warn("LEGACY_PROBLEM_PRESERVE_AS_IS",path);continue;}
    try{
      requireId(problemId); requireId(p.ownerId);
      const metadata=validateMetadata(select(p,["title","subject","difficulty",
        "tags","bankVisibility"]));
      const revPaths=direct(documents,path+"/revisions/");
      if(!revPaths.length)fail("NO_PROBLEM_REVISIONS",path);
      const revisions=[];
      for(const revPath of revPaths){
        const revisionId=revPath.split("/").at(-1);
        requireId(revisionId);
        const rev=documents[revPath], keyPath=revPath+"/grading/main";
        const gradingRaw=find(keyPath,"MISSING_PROTECTED_GRADING");
        if(!gradingRaw)continue;
        let normalized;
        try{
          normalized=validateProblem(select(rev,CONTENT),
            select(gradingRaw,GRADING));
        }catch{
          fail("INVALID_LEGACY_PROBLEM",revPath);continue;
        }
        const expected=fingerprint(normalized);
        if(rev.contentHash && rev.contentHash!==expected)
          fail("PROBLEM_HASH_MISMATCH",revPath);
        if(!Number.isInteger(rev.revisionNumber)||rev.revisionNumber<1)
          fail("INVALID_REVISION_NUMBER",revPath);
        const source=rev.source??{};
        for(const key of ["importJobId","sourceAssetId","originalQuestionId"])
          if(source[key]!=null){
            try{requireId(source[key]);}catch{fail("INVALID_SOURCE_REFERENCE",revPath);}
          }
        if(source.sourceAssetId){
          seenAssets.add(source.sourceAssetId);
          if(!present(documents,"assets/"+source.sourceAssetId))
            fail("SOURCE_ASSET_MISSING","assets/"+source.sourceAssetId);
        }
        checkAssets(normalized,revPath);
        revisions.push({revisionId,revisionNumber:rev.revisionNumber,
          content:normalized.content,grading:normalized.grading,
          source:{
            importJobId:source.importJobId??null,
            sourceAssetId:source.sourceAssetId??null,
            originalQuestionId:source.originalQuestionId??null,
          },contentHash:expected,
          createdBy:rev.createdBy??p.ownerId,
          createdAt:stamp(rev.createdAt)});
      }
      revisions.sort((a,b)=>a.revisionNumber-b.revisionNumber);
      const ids=new Set(revisions.map(x=>x.revisionId));
      if(!ids.has(p.latestRevisionId))
        fail("LATEST_REVISION_MISSING",path);
      if(new Set(revisions.map(x=>x.revisionNumber)).size!==revisions.length)
        fail("DUPLICATE_REVISION_NUMBER",path);
      const latest=revisions.find(x=>x.revisionId===p.latestRevisionId);
      if(latest && latest.revisionNumber!==p.revisionNumber)
        fail("LATEST_REVISION_NUMBER_MISMATCH",path);
      problemRows.push({problemId,ownerId:p.ownerId,
        ownerDisplayName:p.ownerDisplayName??"",metadata,
        latestRevisionId:p.latestRevisionId,
        revisionNumber:p.revisionNumber,version:p.version,
        lifecycle:p.lifecycle??"active",
        sourceProblemId:p.sourceProblemId??null,
        sourceProblemRevisionId:p.sourceProblemRevisionId??null,
        createdAt:stamp(p.createdAt),updatedAt:stamp(p.updatedAt),
        trashedAt:stamp(p.trashedAt),
        revisions});
    }catch{fail("INVALID_PROBLEM_HEADER",path);}
  }
  const quizRoots=direct(documents,"quizzes/");
  let publishedCount=0,draftCount=0,attemptCount=0,snapshotCount=0;
  const quizMap=new Map();
  for(const path of quizRoots){
    const quizId=path.split("/")[1],quiz=documents[path];
    quizMap.set(quizId,quiz);
    if(quiz.schemaVersion!==2){warn("LEGACY_QUIZ_PRESERVE_AS_IS",path);continue;}
    if(quiz.publishedRevisionId)
      find(path+"/revisions/"+quiz.publishedRevisionId,"PUBLISHED_POINTER_MISSING");
    const draftPath=path+"/drafts/current", draft=documents[draftPath];
    if(draft){
      draftCount++;
      const order=draft.itemOrder??[];
      if(!Array.isArray(order)||new Set(order).size!==order.length)
        fail("INVALID_DRAFT_ORDER",draftPath);
      for(const itemId of Array.isArray(order)?order:[]){
        const slotPath=path+"/draftItems/"+itemId,slot=find(slotPath,"DRAFT_SLOT_MISSING");
        if(!slot)continue;
        const pr=documents["problems/"+slot.problemId];
        const prPath="problems/"+slot.problemId+"/revisions/"+slot.problemRevisionId;
        if(!pr||!present(documents,prPath)){
          // Retained snapshots make historical unshared/forked sources legal.
          const retained=slot.reuseFromQuizRevisionId ??
            quiz.publishedRevisionId ?? quiz.lastPublishedRevisionId;
          const prior=documents[path+"/revisions/"+retained+"/items/"+itemId];
          if(!prior||prior.problemId!==slot.problemId||
              prior.problemRevisionId!==slot.problemRevisionId)
            fail("DRAFT_SOURCE_UNAVAILABLE",slotPath);
        }
      }
    }
    for(const rpath of direct(documents,path+"/revisions/")){
      publishedCount++;
      const rev=documents[rpath];
      const order=rev.itemOrder??[];
      if(!Array.isArray(order)||new Set(order).size!==order.length)
        fail("INVALID_PUBLISHED_ORDER",rpath);
      for(const itemId of Array.isArray(order)?order:[]){
        const itemPath=rpath+"/items/"+itemId;
        const gradePath=rpath+"/grading/"+itemId;
        const item=find(itemPath,"PUBLISHED_ITEM_MISSING");
        const grading=find(gradePath,"PUBLISHED_GRADING_MISSING");
        if(item&&grading){
          snapshotCount++;
          checkAssets({content:item,grading},itemPath);
        }
      }
      if(rev.state==="ready" && order.length!==rev.itemCount)
        fail("PUBLISHED_COUNT_MISMATCH",rpath);
    }
  }
  for(const path of direct(documents,"attempts/")){
    attemptCount++;
    const a=documents[path];
    const quiz=quizMap.get(a.quizId);
    if(!quiz){fail("ATTEMPT_QUIZ_MISSING",path);continue;}
    if(a.quizRevisionId==null &&
        (a.provenance==="legacy_client_v1"||a.legacySnapshotUnknown===true)){
      // Older client results intentionally lack a pinned server snapshot.
      // Keep their scores/answers untouched; never manufacture a revision.
      warn("LEGACY_ATTEMPT_UNPINNED_PRESERVE_AS_IS",path);
      continue;
    }
    const revisionPath="quizzes/"+a.quizId+"/revisions/"+a.quizRevisionId;
    const rev=find(revisionPath,"ATTEMPT_PINNED_REVISION_MISSING");
    if(!rev)continue;
    for(const itemId of a.order??[])
      if(!present(documents,revisionPath+"/items/"+itemId)||
          !present(documents,revisionPath+"/grading/"+itemId))
        fail("ATTEMPT_SNAPSHOT_MISSING",path);
  }
  for(const assetId of seenAssets) {
    const a=documents["assets/"+assetId];
    if(a && a.status!=="ready") fail("ASSET_NOT_READY","assets/"+assetId);
  }
  // Fingerprints are opaque and include old answers/results, but no personal
  // data or answer text leaves this module. Storage bytes require a separate
  // privileged existence/retention audit before migration approval.
  const hashes=Object.fromEntries(paths.map(path=>[path,fingerprint(documents[path])]));
  return {
    ready:errors.length===0,
    errors,warnings,
    counts:{documentPaths:paths.length,problems:problemRows.length,
      problemRevisions:problemRows.reduce((s,p)=>s+p.revisions.length,0),
      quizzes:quizRoots.length,drafts:draftCount,
      publishedRevisions:publishedCount,publishedSnapshots:snapshotCount,
      attempts:attemptCount,assetsReferenced:seenAssets.size,
      immutableDocuments:paths.filter(p=>p.startsWith("quizzes/")||
        p.startsWith("attempts/")||p.startsWith("assets/")).length},
    manifestHash:fingerprint(hashes),
    documentHashes:hashes,
    migrationRows:problemRows,
    // An external Storage verifier must confirm these assets actually exist.
    assetIds:[...seenAssets].sort(),
  };
}
