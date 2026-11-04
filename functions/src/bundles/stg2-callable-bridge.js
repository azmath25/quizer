// STG2.1 -- dedicated, DEFAULT-OFF staging callable/worker bridge.
// No network, secrets, initialization, background work, or active Firebase import.
// Only trusted server code may supply the runtime factory and project attestation.
// Never register with the existing production router/index/worker implicitly.
const STAGING_PROJECT="quizer-staging-az26";
const BAD="Quizer staging integration unavailable.";
function fail(){throw new Error(BAD);}
function validAuth(auth){
  return typeof auth?.uid==="string" && auth.uid.length>0 &&
    auth.token!==null && typeof auth.token==="object" &&
    !Array.isArray(auth.token);
}
function validateEnvelope(request){
  return !!request && typeof request==="object" &&
    !Array.isArray(request) && request.apiVersion===2 &&
    typeof request.action==="string" &&
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(request.action);
}
function checkedIdentity(identity){
  // This must come from a server-managed attestor, never request.data.
  if(identity?.projectId!==STAGING_PROJECT ||
      identity?.serverVerified!==true ||
      identity?.runtimeKind!=="firebase-functions-v2" ||
      identity?.appCheckPolicyReviewed!==true ||
      identity?.credentialsServerOnly!==true)fail();
}
export function createQuizerStg2Bridge({
  enabled=false,attestIdentity,makeRuntime,now=()=>new Date(),
  authorizeWorker,
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,
    async callable(){fail();},
    async worker(){fail();},
  });
  if(typeof attestIdentity!=="function" ||
      typeof makeRuntime!=="function" ||
      typeof authorizeWorker!=="function" ||
      typeof now!=="function")fail();
  let runtimePromise=null;
  async function trustedRuntime(){
    // Re-attest project for every request and before initializing any ports.
    checkedIdentity(await attestIdentity());
    if(!runtimePromise){
      runtimePromise=Promise.resolve().then(()=>makeRuntime())
        .then(runtime=>{
          if(runtime?.enabled!==true ||
              typeof runtime.handle!=="function" ||
              typeof runtime.runPrivateJob!=="function")fail();
          return runtime;
        })
        .catch(()=>{runtimePromise=null;fail();});
    }
    return runtimePromise;
  }
  async function callable(auth,request){
    if(!validAuth(auth) || !validateEnvelope(request))fail();
    const runtime=await trustedRuntime();
    // Never catch a failed Neon/private action and reissue it as legacy.
    const response=await runtime.handle(request.action,auth,request);
    // Legacy Firebase dispatch already emits a v2 envelope; new handlers
    // return the data body. Preserve both without nesting the envelope.
    if(response?.apiVersion===2 &&
       typeof response.serverTime==="string" &&
       Object.hasOwn(response,"data"))
      return response;
    const clock=now();
    if(!(clock instanceof Date)||!Number.isFinite(clock.getTime()))fail();
    return Object.freeze({apiVersion:2,serverTime:clock.toISOString(),
      data:response===undefined?null:response});
  }
  async function worker(context,job){
    if(!context || typeof context!=="object" ||
       context.firebaseProjectId!==STAGING_PROJECT ||
       context.trustedServerInvocation!==true ||
       typeof authorizeWorker!=="function" ||
       !job || typeof job!=="object" || Array.isArray(job))fail();
    // No client-selected worker execution. Worker authorization callback must
    // validate persisted lease, job kind and service identity for each call.
    const approved=await authorizeWorker({context,job});
    if(approved!==true)fail();
    const runtime=await trustedRuntime();
    return runtime.runPrivateJob(job);
  }
  return Object.freeze({enabled:true,callable,worker});
}
