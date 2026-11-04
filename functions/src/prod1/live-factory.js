// PROD1: server-only factory. Unmounted until separately authorized release.
// Cloud Functions must bind QUIZER_NEON_DATABASE_URL using defineSecret
// and supply the secret only INSIDE an invocation, never module scope.
import {assert} from "../../shared/schema.js";
import {dispatch as legacyDispatch,handlers}
  from "../domain/runtime.js";
import {createProd1BankRuntime,PROD1_BANK_ACTIONS} from "./bank-runtime.js";
import {createProd1PrivateRuntime} from "./private-runtime.js";
const PROJECT="sat-quiz-fd317";
const STORAGE="sat-quiz-fd317.firebasestorage.app";
const PRIVATE=new Set(["startAttempt","getAttemptQuestions",
  "saveAnswers","navigateAttempt","getAttemptResult",
  "getTeacherAttempt","getAdminAttempt","getAssetLinks",
  "getExportLink","saveManualGrade","releaseResults"]);
const NONLEGACY=new Set([...PROD1_BANK_ACTIONS,
  "importProblemBatch",...PRIVATE]);
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
    const runtime=createProd1PrivateRuntime({
      enabled:true,firebaseProjectId,db,bucket,authFor,
      bankRuntime:bank,legacyDispatch,
      legacyActions:[...handlers.keys()].filter(k=>!NONLEGACY.has(k)),
    });
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
        const data=await runtime.handle(request.action,verifiedAuth,request);
        return {apiVersion:2,serverTime:new Date().toISOString(),
          data:data===undefined?null:data};
      },
      async runPrivateJob(context,job){
        assert(context?.firebaseProjectId===PROJECT&&
          context?.trustedServerInvocation===true,
          "AUTH_REQUIRED","Trusted PROD1 worker required.");
        return runtime.runPrivateJob(job);
      },
      close:()=>runtime.close(),
    });
  }catch(error){
    await bank.close();
    throw error;
  }
}
