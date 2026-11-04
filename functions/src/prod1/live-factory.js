// PROD1: server-only factory. Unmounted until separately authorized release.
// Cloud Functions must bind QUIZER_NEON_DATABASE_URL using defineSecret
// and supply the secret only INSIDE an invocation, never module scope.
import {assert} from "../../shared/schema.js";
import {dispatch as legacyDispatch,handlers}
  from "../domain/runtime.js";
import {createProd1BankRuntime,PROD1_BANK_ACTIONS} from "./bank-runtime.js";
import {createProd1PrivateRuntime,createProd1PublicationIdentityPort}
  from "./private-runtime.js";
import {createProd1LegacyPublicationSource}
  from "./legacy-publication-source.js";
import {createProd1PublicationGateway}
  from "./publication-gateway.js";
import {createProd1WorkerRouter}
  from "./worker-router.js";
import {createProd1ImportFinisher} from "./import-finisher.js";
import {createProd1FirebaseBankPorts} from "./firebase-bank-ports.js";
import {createProd1DraftReader} from "./draft-reader.js";
import {createProd1DraftMutationGateway} from "./draft-mutations.js";
const PROJECT="sat-quiz-fd317";
const STORAGE="sat-quiz-fd317.firebasestorage.app";
const PRIVATE=new Set(["startAttempt","getAttemptQuestions",
  "saveAnswers","navigateAttempt","getAttemptResult",
  "getTeacherAttempt","getAdminAttempt","getAssetLinks",
  "getExportLink","saveManualGrade","releaseResults"]);
const NONLEGACY=new Set([...PROD1_BANK_ACTIONS,
  "importProblemBatch",...PRIVATE]);
// A single trusted invocation boundary for both direct worker dispatch and
// the leased worker adapter. The security context MUST NOT be mistaken for
// the private job payload (which must still contain kind + jobId).
export function createProd1TrustedWorkerInvoker({firebaseProjectId="",privateRuntime}={}){
  assert(firebaseProjectId===PROJECT&&
    typeof privateRuntime?.runPrivateJob==="function",
    "FAILED_PRECONDITION","Trusted private worker gateway required.");
  return async(context,job)=>{
    assert(context?.firebaseProjectId===PROJECT&&
      context?.trustedServerInvocation===true,
      "AUTH_REQUIRED","Trusted PROD1 worker required.");
    assert(job&&typeof job.kind==="string"&&typeof job.jobId==="string",
      "INVALID_FIELDS","Private job payload required.");
    return privateRuntime.runPrivateJob(job);
  };
}
export async function createProd1LiveRuntime({
  enabled=false,db,firebaseProjectId="",connectionString,
  cursorSecret="",firebaseAuth,storageBucket,createPool,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,
    dispatch:async()=>({disabled:true}),
    runPrivateJob:async()=>({disabled:true}),
    close:async()=>{}});
  assert(firebaseProjectId===PROJECT&&db?.doc&&
    typeof db.runTransaction==="function"&&
    typeof connectionString==="string"&&
    typeof cursorSecret==="string"&&cursorSecret.length>=32&&
    handlers.size>10&&handlers.has("createQuiz"),
    "FAILED_PRECONDITION","Trusted PROD1 preflight not satisfied.");
  const auth=firebaseAuth??(await import("firebase-admin/auth")).getAuth();
  const bucket=storageBucket??(await import("firebase-admin/storage"))
    .getStorage().bucket();
  assert(auth?.getUser&&bucket?.file&&bucket.name===STORAGE,
    "FAILED_PRECONDITION","Expected SAT QUIZ Auth and Storage required.");
  const authFor=async uid=>{
    const user=await auth.getUser(uid);
    assert(user&&!user.disabled,"ACCOUNT_DISABLED",
      "Publisher account disabled.");
    return {uid,token:{email:user.email??"",
      email_verified:user.emailVerified===true,
      name:user.displayName??""}};
  };
  const bank=createProd1BankRuntime({
    enabled:true,firebaseProjectId,db,connectionString,cursorSecret,
    legacyDispatch,createPool});
  try{
    const ports=createProd1FirebaseBankPorts({
      enabled:true,db,legacyDispatch});
    const draftReader=createProd1DraftReader({
      enabled:true,db,resolveActor:ports.resolveFirebaseActor,
      resolveProblemOrigin:ports.resolveProblemOrigin,
      neonReader:bank.read});
    const draftMutations=createProd1DraftMutationGateway({
      enabled:true,db,resolveActor:ports.resolveFirebaseActor,
      resolveOrigin:ports.resolveProblemOrigin,
      neonReader:bank.read,legacyDispatch,
      verifyAssets:ports.verifyAssets});
    const legacySource=createProd1LegacyPublicationSource({
      enabled:true,db,
      resolvePublicationActor:createProd1PublicationIdentityPort({
        db,authFor,resolveFirebaseActor:ports.resolveFirebaseActor}),
      verifyAssets:ports.verifyAssets});
    const publication=createProd1PublicationGateway({
      enabled:true,db,resolveActor:ports.resolveFirebaseActor,
      resolveOrigin:ports.resolveProblemOrigin,neonReader:bank.read,
      verifyAssets:ports.verifyAssets,legacyDispatch,
      legacySource});
    const finisher=createProd1ImportFinisher({
      enabled:true,db,resolveActor:ports.resolveFirebaseActor,
      legacyDispatch});
    const runtime=createProd1PrivateRuntime({
      enabled:true,firebaseProjectId,db,bucket,authFor,
      bankRuntime:bank,legacyDispatch,
      legacyActions:[...handlers.keys()].filter(k=>!NONLEGACY.has(k)),
    });
    const invokeTrustedJob=createProd1TrustedWorkerInvoker({
      firebaseProjectId,privateRuntime:runtime});
    return Object.freeze({
      enabled:true,
      async dispatch(verifiedAuth,request){
        assert(request?.apiVersion===2&&
          typeof request.action==="string",
          "INVALID_FIELDS","Invalid PROD1 API envelope.");
        if(!verifiedAuth?.uid){
          const def=handlers.get(request.action);
          assert(def?.permission==="guest"&&!NONLEGACY.has(request.action),
            "AUTH_REQUIRED","Sign in to continue.");
          return legacyDispatch(db,null,request);
        }
        // Existing draft metadata-only saves take the original efficient
        // Firestore route. Pinned Neon slot upserts are verified outside the
        // retryable Firebase transaction and committed as references only.
        // These interceptions exist in an UNMOUNTED factory, not the API.
        if(request.action==="saveQuizDraft"){
          const data=await draftMutations.handle(verifiedAuth,request);
          return {apiVersion:2,serverTime:new Date().toISOString(),
            data:data===undefined?null:data};
        }
        if(request.action==="finishImportJob"){
          const data=await finisher.finish(verifiedAuth,request);
          return {apiVersion:2,serverTime:new Date().toISOString(),
            data};
        }
        if(request.action==="publishQuiz"){
          const data=await publication.publish(verifiedAuth,request);
          return {apiVersion:2,serverTime:new Date().toISOString(),
            data};
        }
        if(request.action==="getQuizDraftItems"){
          const data=await draftReader.getItems({
            auth:verifiedAuth,quizId:request.quizId,
            itemIds:request.itemIds});
          return {apiVersion:2,serverTime:new Date().toISOString(),data};
        }
        const data=await runtime.handle(request.action,verifiedAuth,request);
        return {apiVersion:2,serverTime:new Date().toISOString(),
          data:data===undefined?null:data};
      },
      runPrivateJob:invokeTrustedJob,
      // This adapter owns its lease and never calls the legacy worker for
      // private publish jobs. It is NOT registered in index.js yet.
      createWorker({runLegacy,now}={}){
        return createProd1WorkerRouter({
          enabled:true,db,runLegacy,now,
          runPrivateJob:args=>invokeTrustedJob({
            firebaseProjectId:PROJECT,trustedServerInvocation:true,
          },args),
        });
      },
      close:()=>runtime.close(),
    });
  }catch(error){
    await bank.close();
    throw error;
  }
}
