// QN11.6.5 — unmounted, DEFAULT-OFF combined Quizer v2 boundary.
// Do NOT import this module in router.js, index.js, jobs/worker.js until a
// separate approved staging cutover. The old Firestore router remains live.
import {assert,id,fields} from "../../shared/schema.js";
const BANK=new Set(["getProblem","listProblemRevisions","listProblems",
  "createProblem","saveProblemRevision","forkProblem",
  "setProblemSharing","trashProblem","restoreProblem","bulkUpdateProblems"]);
const PRIVATE=new Set(["startAttempt","getAttemptQuestions",
  "saveAnswers","navigateAttempt","getAttemptResult",
  "getTeacherAttempt","getAdminAttempt","getAssetLinks",
  "getExportLink","saveManualGrade","releaseResults"]);
const IMPORT="importProblemBatch";
const WORKERS=new Set(["publishJob","gradeJobBatch",
  "finalizeGradeJob","exportJob"]);
function validateEnvelope(action,request){
  assert(typeof action==="string"&&
    request&&typeof request==="object"&&!Array.isArray(request),
    "INVALID_FIELDS","Invalid Quizer API v2 request.");
  assert(request.apiVersion===2 && request.action===action,
    "API_VERSION","Invalid Quizer API version or action.");
}
export function createQuizerStagedIntegratedGateway({
  enabled=false,bankCompat,importGateway,privateRuntime,
  legacyActions=[],legacyHandle,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    handle:async()=>({disabled:true}),
    runPrivateJob:async()=>({disabled:true})});
  assert(bankCompat?.enabled===true&&
    typeof bankCompat.handle==="function"&&
    importGateway?.enabled===true&&
    typeof importGateway.handle==="function"&&
    privateRuntime?.enabled===true&&
    typeof privateRuntime.handle==="function"&&
    WORKERS.size===4&&
    [...WORKERS].every(k=>typeof privateRuntime[k]==="function")&&
    typeof legacyHandle==="function"&&
    Array.isArray(legacyActions)&&
    legacyActions.every(x=>typeof x==="string"&&
      /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(x))&&
    new Set(legacyActions).size===legacyActions.length &&
    legacyActions.every(x=>!BANK.has(x)&&!PRIVATE.has(x)&&x!==IMPORT),
    "INVALID_FIELDS","Trusted non-overlapping staged Quizer ports required.");
  const old=new Set(legacyActions);
  const handle=async(action,auth,request)=>{
    validateEnvelope(action,request);
    assert(auth?.uid&&auth?.token&&typeof auth.token==="object",
      "AUTH_REQUIRED","Verified Firebase callable auth required.");
    // This strict partition is deliberate: NEVER catch Neon/private errors
    // and silently reinterpret the same request as a Firestore legacy write.
    if(BANK.has(action))return bankCompat.handle(action,auth,request);
    if(action===IMPORT)return importGateway.handle(action,auth,request);
    if(PRIVATE.has(action))return privateRuntime.handle(action,auth,request);
    assert(old.has(action),"INVALID_FIELDS","Unknown staged Quizer action.");
    return legacyHandle(action,auth,request);
  };
  const runPrivateJob=async({kind,jobId,attemptId,
    itemIds,leaseOwner}={})=>{
    assert(WORKERS.has(kind),"INVALID_FIELDS",
      "Unknown staged private job kind.");
    id(jobId,"job ID");
    if(kind==="gradeJobBatch"){
      id(attemptId,"attempt ID");
      assert(Array.isArray(itemIds)&&itemIds.length>0&&
        itemIds.length<=20,"INVALID_FIELDS",
        "Private grade batch must be bounded.");
      return privateRuntime.gradeJobBatch({jobId,attemptId,itemIds});
    }
    if(kind==="finalizeGradeJob"){
      id(attemptId,"attempt ID");
      assert(typeof leaseOwner==="string"&&leaseOwner.length>0,
        "INVALID_FIELDS","Verified private grading lease required.");
      return privateRuntime.finalizeGradeJob({
        jobId,attemptId,leaseOwner});
    }
    return privateRuntime[kind]({jobId});
  };
  return Object.freeze({enabled:true,handle,runPrivateJob,
    actionCounts:Object.freeze({
      bank:BANK.size,private:PRIVATE.size,import:1,legacy:old.size,
    })});
}
