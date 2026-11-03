// QN11.5: default-OFF private publication/student action bridge.
// Existing apiVersion:2 names only. NOT imported by live Firebase dispatcher.
// Legacy routing is selected ONLY by a trusted pinned revision origin lookup,
// never by catching Neon/Storage errors or by a browser-supplied mode.
import {assert,fields,id} from "../../shared/schema.js";
import {requireRole} from "../domain/runtime.js";
const ORIGINS=new Set(["private_bundle_v1","firestore_legacy"]);
const ALLOWED=Object.freeze({
  startAttempt:["quizId","sourceAttemptId"],
  getAttemptQuestions:["attemptId","itemIds"],
  saveAnswers:["attemptId","expectedAnswerVersion","changes","requestId"],
  navigateAttempt:["attemptId","targetIndex","requestId"],
  getAttemptResult:["attemptId","offset","limit"],
  getTeacherAttempt:["attemptId","offset","limit"],
  getAdminAttempt:["attemptId","offset","limit"],
  getAssetLinks:["context","assetIds"],
});
const fail=(reason,message)=>assert(false,reason,message);
export function createQuizerPrivateIntegration({
  enabled=false,resolveFirebaseActor,resolveAttemptOrigin,
  resolveQuizOrigin,legacy,secureAttempts,startExport,
  attemptCommits,publisher,resolveImageScope,signReadyAssets,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    handle:async()=>({disabled:true}),publishJob:async()=>({disabled:true}),
    gradeJobBatch:async()=>({disabled:true}),
    exportSource:async()=>({disabled:true})});
  const checks=[resolveFirebaseActor,resolveAttemptOrigin,resolveQuizOrigin,
    legacy?.handle,secureAttempts?.questions,secureAttempts?.validateAnswers,
    secureAttempts?.navigationPreview,secureAttempts?.resultPage,
    secureAttempts?.gradeBatch,secureAttempts?.allowedAssetIds,
    startExport?.start,startExport?.exportSource,
    attemptCommits?.saveAnswers,attemptCommits?.navigate,
    attemptCommits?.gradeBatch,publisher?.publish,
    resolveImageScope,signReadyAssets];
  assert(checks.every(fn=>typeof fn==="function") &&
    secureAttempts.enabled===true && attemptCommits.enabled===true &&
    startExport.enabled===true && publisher.enabled===true,
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
      ["attempt","result"].includes(context.kind) &&
      typeof context.id==="string",
      "INVALID_FIELDS","Authorized attempt image context required.");
    fields(context,["kind","id","revisionId"],"image context");
    assert(Array.isArray(assetIds) && assetIds.length<=20 &&
      new Set(assetIds).size===assetIds.length,
      "INVALID_FIELDS","Request at most 20 distinct images.");
    const attemptId=id(context.id);
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
    // The signing callback must recheck ready/generation and refuse all
    // published-bundles/ Storage paths, with short-lived per-asset URLs only.
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
    if(action==="startAttempt"){
      const source=await originForQuiz(
        firebaseAuth,request.quizId,request.sourceAttemptId??null);
      return source==="firestore_legacy"
        ? callLegacy(action,firebaseAuth,request)
        : startExport.start({firebaseAuth,quizId:request.quizId,
            sourceAttemptId:request.sourceAttemptId??null});
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
    // Worker-only. The secure service verifies persisted lease and keys;
    // the Firebase write checks the lease again before committing grades.
    const proof=await secureAttempts.gradeBatch({jobId,attemptId,itemIds});
    return attemptCommits.gradeBatch({jobId,attemptId,proof});
  }
  return Object.freeze({enabled:true,handle,
    publishJob:({jobId})=>publisher.publish({jobId}),
    gradeJobBatch,
    exportSource:({jobId})=>startExport.exportSource({jobId})});
}
