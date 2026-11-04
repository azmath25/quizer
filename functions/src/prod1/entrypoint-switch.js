// PROD1 P1: pure, dependency-injected Cloud Functions dispatch bridge.
// Never reads a database password or initializes SQL unless a separately
// approved, server-side gate is ON. Browser payloads cannot choose a backend.
import {assert,id} from "../../shared/schema.js";
import {classifyProd1Job} from "./worker-router.js";
export const PROD1_PROJECT="sat-quiz-fd317";
export const PROD1_SECRET_NAMES=Object.freeze([
  "QUIZER_NEON_DATABASE_URL","QUIZER_BANK_CURSOR_KEY",
]);
export function isProd1Enabled({
  releaseApproved=false,env=process.env,
}={}){
  // Requires deliberate code-review approval AND server-only runtime config.
  return releaseApproved===true &&
    env.QUIZER_PROD1_ENABLED==="true" &&
    (env.GCLOUD_PROJECT??env.GCP_PROJECT)===PROD1_PROJECT;
}
export function createProd1EntrypointBridge({
  enabled=false,db,legacyDispatch,legacyRunJob,
  runtimeFactory,readSecrets,environment=process.env,
}={}){
  assert(db?.doc&&typeof legacyDispatch==="function"&&
    typeof legacyRunJob==="function",
    "FAILED_PRECONDITION","Trusted Quizer legacy handlers required.");
  if(enabled!==true)return Object.freeze({
    enabled:false,
    dispatch:(auth,request)=>legacyDispatch(db,auth,request),
    runJob:(_db,jobId)=>legacyRunJob(db,jobId),
  });
  assert(typeof runtimeFactory==="function"&&
    typeof readSecrets==="function"&&
    (environment.GCLOUD_PROJECT??environment.GCP_PROJECT)===PROD1_PROJECT,
    "FAILED_PRECONDITION","Wrong Firebase project or PROD1 runtime port.");
  let runtimePromise;
  const getRuntime=async()=>{
    if(!runtimePromise){
      runtimePromise=Promise.resolve().then(async()=>{
        // Secret getters are called only inside a bound function invocation.
        const secrets=await readSecrets();
        assert(typeof secrets?.databaseUrl==="string"&&
          typeof secrets?.cursorKey==="string"&&
          secrets.cursorKey.length>=32,
          "FAILED_PRECONDITION","Bound Quizer secrets unavailable.");
        return runtimeFactory({
          enabled:true,db,firebaseProjectId:PROD1_PROJECT,
          connectionString:secrets.databaseUrl,
          cursorSecret:secrets.cursorKey,
        });
      }).catch(error=>{runtimePromise=null;throw error;});
    }
    return runtimePromise;
  };
  return Object.freeze({
    enabled:true,
    async dispatch(auth,request){
      return (await getRuntime()).dispatch(auth,request);
    },
    async runJob(_db,jobId){
      id(jobId,"job ID");
      const snap=await db.doc("jobs/"+jobId).get();
      if(!snap.exists)return false;
      const job=snap.data();
      // Legacy publication and other jobs never allocate a Neon pool.
      // Private publication must never fall back when the runtime fails.
      if(classifyProd1Job(job)==="legacy" &&
        !["grade_attempt","export_quiz"].includes(job.kind))
        return legacyRunJob(db,jobId);
      return (await getRuntime()).createWorker({
        runLegacy:legacyRunJob,
      }).runJob(jobId);
    },
  });
}
