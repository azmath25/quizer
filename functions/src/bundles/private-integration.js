// QN11.5: default-OFF private publication/student action bridge.
// Existing apiVersion:2 names only. NOT imported by live Firebase dispatcher.
// Legacy routing is selected ONLY by a trusted pinned revision origin lookup,
// never by catching Neon/Storage errors or by a browser-supplied mode.
import {assert,fields,id} from "../../shared/schema.js";
import {requireRole} from "../domain/runtime.js";
const ORIGINS=new Set(["private_bundle_v1","firestore_legacy"]);
const ALLOWED=Object.freeze({
  startAttempt:["quizId","sourceAttemptId","requestId"],
  getAttemptQuestions:["attemptId","itemIds"],
  saveAnswers:["attemptId","expectedAnswerVersion","changes","requestId"],
  navigateAttempt:["attemptId","targetIndex","requestId"],
  getAttemptResult:["attemptId","offset","limit"],
  getTeacherAttempt:["attemptId","offset","limit"],
  getAdminAttempt:["attemptId","offset","limit"],
  getAssetLinks:["context","assetIds"],
  getExportLink:["jobId"],
  saveManualGrade:["attemptId","itemId","points","feedback","reason",
    "expectedGradeVersion","requestId"],
  releaseResults:["quizId","attemptIds","score","solutions","requestId"],
});
const fail=(reason,message)=>assert(false,reason,message);
export function createQuizerPrivateIntegration({
  enabled=false,resolveFirebaseActor,resolveAttemptOrigin,
  resolveQuizOrigin,legacy,secureAttempts,startExport,
  attemptCommits,gradeFinalization,publisher,resolveImageScope,signReadyAssets,
  authorizeAuthorAssets=null,resolveExportOrigin=null,
  exportStore=null,zipWorker=null,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    handle:async()=>({disabled:true}),publishJob:async()=>({disabled:true}),
    gradeJobBatch:async()=>({disabled:true}),
    finalizeGradeJob:async()=>({disabled:true}),
    exportSource:async()=>({disabled:true}),
    exportJob:async()=>({disabled:true})});
  const checks=[resolveFirebaseActor,resolveAttemptOrigin,resolveQuizOrigin,
    legacy?.handle,secureAttempts?.questions,secureAttempts?.validateAnswers,
    secureAttempts?.navigationPreview,secureAttempts?.resultPage,
    secureAttempts?.gradeBatch,secureAttempts?.previewManualGrade,
    secureAttempts?.allowedAssetIds,
    startExport?.start,startExport?.exportSource,
    attemptCommits?.saveAnswers,attemptCommits?.navigate,
    attemptCommits?.gradeBatch,
    gradeFinalization?.finalizeGradeJob,
    gradeFinalization?.completedManualGrade,
    gradeFinalization?.saveManualGrade,
    gradeFinalization?.releaseResults,
    publisher?.publish,
    resolveImageScope,signReadyAssets];
  assert(checks.every(fn=>typeof fn==="function") &&
    secureAttempts.enabled===true && attemptCommits.enabled===true &&
    startExport.enabled===true && publisher.enabled===true &&
    gradeFinalization.enabled===true,
    "INVALID_FIELDS","Verified, enabled, server-only QN11.5 ports required.");
  async function originForAttempt(firebaseAuth,attemptId){
    const source=await resolveAttemptOrigin({
      firebaseAuth,attemptId:id(attemptId)});
    assert(ORIGINS.has(source),"RESOURCE_UNAVAILABLE",
      "Unknown pinned attempt provenance.");
    return source;
  }
  async function originForQuiz(firebaseAuth,quizId,sourceAttemptId=null){
    // A retry may pin an older legacy revision even when the quiz's current
    // published pointer is private. The trusted lookup must inspect the
    // source attempt's immutable pinned revision before choosing a route.
    const source=await resolveQuizOrigin({
      firebaseAuth,quizId:id(quizId),
      sourceAttemptId:sourceAttemptId==null?null:id(sourceAttemptId)});
    assert(ORIGINS.has(source),"RESOURCE_UNAVAILABLE",
      "Unknown published quiz provenance.");
    return source;
  }
  const callLegacy=(action,auth,request)=>
    legacy.handle(action,auth,request);
  async function imageLinks(firebaseAuth,request){
    const {context,assetIds}=request;
    assert(context && typeof context==="object" &&
      ["attempt","result","problem","quiz_draft","source","owned_upload"]
        .includes(context.kind) &&
      typeof context.id==="string",
      "INVALID_FIELDS","Authorized image context required.");
    fields(context,["kind","id","revisionId"],"image context");
    assert(Array.isArray(assetIds) && assetIds.length<=20 &&
      new Set(assetIds).size===assetIds.length,
      "INVALID_FIELDS","Request at most 20 distinct images.");
    const targetId=id(context.id);
    if(["source","owned_upload"].includes(context.kind))
      return callLegacy("getAssetLinks",firebaseAuth,request);
    if(["problem","quiz_draft"].includes(context.kind)){
      assert(typeof authorizeAuthorAssets==="function",
        "RESOURCE_UNAVAILABLE",
        "Trusted hybrid author image access not configured.");
      const auth=await authorizeAuthorAssets({firebaseAuth,context});
      assert(auth?.route==="legacy"||auth?.route==="private",
        "RESOURCE_UNAVAILABLE","Unknown author image provenance.");
      if(auth.route==="legacy")
        return callLegacy("getAssetLinks",firebaseAuth,request);
      assert(Array.isArray(auth.assetIds),
        "RESOURCE_UNAVAILABLE","Authorized author image set unavailable.");
      const allowed=new Set(auth.assetIds.map(v=>id(v)));
      for(const raw of assetIds)
        assert(allowed.has(id(raw)),"RESOURCE_UNAVAILABLE",
          "Image does not belong to the authorized author content.");
      // Recheck the draft/owner and exact allowed assets after cross-store
      // reads, before issuing any irrevocable short-lived signatures.
      const fresh=await authorizeAuthorAssets({firebaseAuth,context});
      assert(fresh?.route==="private" &&
        Array.isArray(fresh.assetIds) &&
        assetIds.every(v=>fresh.assetIds.includes(v)),
        "VERSION_CONFLICT","Author content changed before image signing.");
      return signReadyAssets({firebaseAuth,context,assetIds});
    }
    const attemptId=targetId;
    const origin=await originForAttempt(firebaseAuth,attemptId);
    if(origin==="firestore_legacy")
      return callLegacy("getAssetLinks",firebaseAuth,request);
    // Scope must be derived from a verified Firestore attempt and its
    // current frontier, NEVER the browser-requested question IDs.
    const scope=await resolveImageScope({firebaseAuth,attemptId,
      kind:context.kind});
    assert(scope?.authorized===true &&
      Array.isArray(scope.itemIds) &&
      scope.itemIds.length>0 && scope.itemIds.length<=500 &&
      new Set(scope.itemIds).size===scope.itemIds.length,
      "RESOURCE_UNAVAILABLE","Image scope unavailable.");
    const allowed=new Set();
    for(let offset=0;offset<scope.itemIds.length;offset+=20){
      const subset=scope.itemIds.slice(offset,offset+20);
      const found=await secureAttempts.allowedAssetIds({
        firebaseAuth,attemptId,itemIds:subset,
        result:context.kind==="result",
      });
      for(const imageId of found.assetIds)allowed.add(imageId);
    }
    for(const raw of assetIds){
      const assetId=id(raw);
      assert(allowed.has(assetId),"RESOURCE_UNAVAILABLE",
        "Image is not in the authorized question or released solution.");
    }
    // Recheck the verified attempt's frontier and revision after the
    // protected bundle was scanned. No-back changes fail closed.
    const fresh=await resolveImageScope({firebaseAuth,attemptId,
      kind:context.kind});
    assert(fresh?.authorized===true &&
      fresh.pinnedRevisionId===scope.pinnedRevisionId &&
      fresh.itemIds?.length===scope.itemIds.length &&
      fresh.itemIds.every((v,i)=>v===scope.itemIds[i]) &&
      fresh.solutionVisible===scope.solutionVisible,
      "VERSION_CONFLICT","Attempt image scope changed before signing.");
    // The signer rechecks ready/generation and retained references.
    const signed=await signReadyAssets({firebaseAuth,attemptId,
      context,assetIds});
    assert(signed && Array.isArray(signed.links) &&
      signed.links.length===assetIds.length &&
      signed.links.every((link,i)=>link.assetId===assetIds[i] &&
        typeof link.url==="string" &&
        !link.url.includes("published-bundles") &&
        !link.url.includes("firebaseStorageDownloadTokens")),
      "RESOURCE_UNAVAILABLE","Invalid authorized image signature.");
    return {links:signed.links};
  }
  async function handle(action,firebaseAuth,request){
    assert(Object.hasOwn(ALLOWED,action),"INVALID_FIELDS",
      "Unsupported private integration action.");
    fields(request,["apiVersion","action",...ALLOWED[action]]);
    assert(request.apiVersion===2 && request.action===action,
      "API_VERSION","Invalid callable action envelope.");
    assert(firebaseAuth?.uid && firebaseAuth.token &&
      typeof firebaseAuth.token==="object",
      "AUTH_REQUIRED","Verified Firebase callable identity required.");
    const actor=await resolveFirebaseActor(firebaseAuth);
    requireRole(actor,"user");
    assert(actor.uid===firebaseAuth.uid,"AUTH_REQUIRED",
      "Authenticated actor mismatch.");
    if(action==="getAssetLinks")return imageLinks(firebaseAuth,request);
    if(action==="getExportLink"){
      assert(typeof resolveExportOrigin==="function",
        "RESOURCE_UNAVAILABLE","Trusted export origin unavailable.");
      const origin=await resolveExportOrigin({
        firebaseAuth,jobId:id(request.jobId,"export job ID")});
      assert(ORIGINS.has(origin),"RESOURCE_UNAVAILABLE",
        "Export provenance unavailable.");
      if(origin==="firestore_legacy")
        return callLegacy(action,firebaseAuth,request);
      assert(exportStore?.enabled===true &&
        typeof exportStore.getLink==="function",
        "RESOURCE_UNAVAILABLE","Private export link service unavailable.");
      return exportStore.getLink({
        firebaseAuth,jobId:request.jobId});
    }
    if(action==="releaseResults"){
      assert(typeof request.requestId==="string" &&
        /^[A-Za-z0-9_-]{16,100}$/.test(request.requestId),
        "INVALID_FIELDS","Unique release request ID required.");
      assert(Array.isArray(request.attemptIds) &&
        request.attemptIds.length>0 && request.attemptIds.length<=25,
        "INVALID_FIELDS","Choose 1–25 attempts.");
      const origins=await Promise.all(request.attemptIds.map(attemptId=>
        originForAttempt(firebaseAuth,attemptId)));
      if(origins.every(origin=>origin==="firestore_legacy"))
        return callLegacy(action,firebaseAuth,request);
      assert(origins.every(origin=>origin==="private_bundle_v1"),
        "FAILED_PRECONDITION",
        "Mixed legacy/private release must be split into separate batches.");
      return gradeFinalization.releaseResults({
        firebaseAuth,quizId:request.quizId,
        attemptIds:request.attemptIds,score:request.score??false,
        solutions:request.solutions??false,
        requestId:request.requestId,
      });
    }
    if(action==="startAttempt"){
      const source=await originForQuiz(
        firebaseAuth,request.quizId,request.sourceAttemptId??null);
      return source==="firestore_legacy"
        ? callLegacy(action,firebaseAuth,request)
        : startExport.start({firebaseAuth,quizId:request.quizId,
            sourceAttemptId:request.sourceAttemptId??null,
            requestId:request.requestId??null});
    }
    const source=await originForAttempt(firebaseAuth,request.attemptId);
    if(source==="firestore_legacy")
      return callLegacy(action,firebaseAuth,request);
    const attemptId=request.attemptId;
    if(action==="getAttemptQuestions")
      return secureAttempts.questions({firebaseAuth,attemptId,
        itemIds:request.itemIds});
    if(action==="getAttemptResult"||action==="getTeacherAttempt"||
      action==="getAdminAttempt"){
      if(action==="getAdminAttempt")requireRole(actor,"admin");
      if(action==="getTeacherAttempt")requireRole(actor,"teacher");
      return secureAttempts.resultPage({firebaseAuth,attemptId,
        offset:request.offset??0,limit:request.limit??10,
        staffOnly:action!=="getAttemptResult"});
    }
    if(action==="saveManualGrade"){
      assert(typeof request.requestId==="string" &&
        /^[A-Za-z0-9_-]{16,100}$/.test(request.requestId),
        "INVALID_FIELDS","Unique manual-grade request ID required.");
      const completed=await gradeFinalization.completedManualGrade({
        firebaseAuth,attemptId,itemId:request.itemId,
        points:request.points,feedback:request.feedback??"",
        reason:request.reason??"",
        expectedGradeVersion:request.expectedGradeVersion,
        requestId:request.requestId,
      });
      if(completed?.completed===true)return completed.result;
      const proof=await secureAttempts.previewManualGrade({
        firebaseAuth,attemptId,itemId:request.itemId,points:request.points,
        feedback:request.feedback??"",reason:request.reason??"",
        expectedGradeVersion:request.expectedGradeVersion,
      });
      return gradeFinalization.saveManualGrade({
        firebaseAuth,attemptId,itemId:request.itemId,points:request.points,
        feedback:request.feedback??"",reason:request.reason??"",
        expectedGradeVersion:request.expectedGradeVersion,
        proof,requestId:request.requestId,
      });
    }
    if(action==="saveAnswers"){
      assert(typeof request.requestId==="string" &&
        /^[A-Za-z0-9_-]{16,100}$/.test(request.requestId),
        "INVALID_FIELDS","Unique request ID required.");
      const proof=await secureAttempts.validateAnswers({
        firebaseAuth,attemptId,changes:request.changes});
      return attemptCommits.saveAnswers({firebaseAuth,attemptId,
        expectedAnswerVersion:request.expectedAnswerVersion,
        changes:request.changes,proof,requestId:request.requestId});
    }
    if(action==="navigateAttempt"){
      assert(typeof request.requestId==="string" &&
        /^[A-Za-z0-9_-]{16,100}$/.test(request.requestId),
        "INVALID_FIELDS","Unique request ID required.");
      const proof=await secureAttempts.navigationPreview({
        firebaseAuth,attemptId,targetIndex:request.targetIndex});
      return attemptCommits.navigate({firebaseAuth,attemptId,
        targetIndex:request.targetIndex,proof,requestId:request.requestId});
    }
    fail("INVALID_FIELDS","Unknown staged integration action.");
  }
  async function gradeJobBatch({jobId,attemptId,itemIds}={}){
    // The trusted worker MUST select the bundle path from persisted attempt
    // provenance, not grade old legacy attempts through the new writer.
    const source=await resolveAttemptOrigin({
      attemptId:id(attemptId),worker:true});
    assert(source==="private_bundle_v1","FAILED_PRECONDITION",
      "Legacy grading remains with the existing worker.");
    // Worker-only. The secure service verifies persisted lease and keys;
    // the Firebase write checks the lease again before committing grades.
    const proof=await secureAttempts.gradeBatch({jobId,attemptId,itemIds});
    return attemptCommits.gradeBatch({jobId,attemptId,proof});
  }
  async function finalizeGradeJob({jobId,attemptId,leaseOwner}={}){
    const source=await resolveAttemptOrigin({
      attemptId:id(attemptId),worker:true});
    assert(source==="private_bundle_v1","FAILED_PRECONDITION",
      "Legacy grading completion remains on the original worker.");
    return gradeFinalization.finalizeGradeJob({jobId,attemptId,leaseOwner});
  }
  return Object.freeze({enabled:true,handle,
    publishJob:({jobId,leaseOwner})=>publisher.publish({jobId,leaseOwner}),
    gradeJobBatch,finalizeGradeJob,
    exportSource:({jobId})=>startExport.exportSource({jobId}),
    exportJob:async({jobId})=>{
      assert(zipWorker?.enabled===true &&
        typeof zipWorker.exportJob==="function",
        "RESOURCE_UNAVAILABLE","Trusted ZIP writer unavailable.");
      return zipWorker.exportJob({jobId});
    }});
}
