import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createQuizerStg2Bridge}
  from "../../functions/src/bundles/stg2-callable-bridge.js";

const goodIdentity=()=>({projectId:"quizer-staging-az26",
  serverVerified:true,runtimeKind:"firebase-functions-v2",
  appCheckPolicyReviewed:true,credentialsServerOnly:true});
const auth={uid:"teacher_1",token:{email_verified:true}};
const request=action=>({apiVersion:2,action,requestId:"request_1234567890"});
function fixture(props={}){
  let initialized=0,attested=0,authorized=0;
  const calls=[];
  const runtime={
    enabled:true,async handle(action){
      calls.push(action);
      if(action==="failNeon")throw Error("Neon outage");
      if(action==="getDashboard")return {apiVersion:2,
        serverTime:"2026-11-04T00:00:00.000Z",data:{old:true}};
      return {new:true,action};
    },
    async runPrivateJob(job){calls.push("worker:"+job.kind);return {ok:true};},
  };
  const bridge=createQuizerStg2Bridge({
    enabled:true,
    attestIdentity:async()=>{attested++;return goodIdentity();},
    makeRuntime:async()=>{initialized++;return runtime;},
    authorizeWorker:async()=>{authorized++;return true;},
    now:()=>new Date("2026-11-04T00:00:00.000Z"),...props,
  });
  return {bridge,calls,
    get initialized(){return initialized;},
    get attested(){return attested;},
    get authorized(){return authorized;}};
}
test("STG2.1 bridge default OFF and rejects missing trusted factory",async()=>{
  const off=createQuizerStg2Bridge();
  assert.equal(off.enabled,false);
  await assert.rejects(off.callable(auth,request("getProblem")),/unavailable/);
  await assert.rejects(off.worker({},{kind:"publishJob"}),/unavailable/);
  assert.throws(()=>createQuizerStg2Bridge({enabled:true}),/unavailable/);
});

test("STG2.1 stage callable maintains v2 response and legacy envelope",async()=>{
  const f=fixture();
  const response=await f.bridge.callable(auth,request("getProblem"));
  assert.deepEqual(response,{apiVersion:2,
    serverTime:"2026-11-04T00:00:00.000Z",
    data:{new:true,action:"getProblem"}});
  const legacy=await f.bridge.callable(auth,request("getDashboard"));
  assert.deepEqual(legacy,{apiVersion:2,
    serverTime:"2026-11-04T00:00:00.000Z",data:{old:true}});
  assert.equal(f.initialized,1);
  assert.equal(f.attested,2);
});

test("STG2.1 refuses unknown project/client-only identity before startup",async()=>{
  for(const identity of [
    {...goodIdentity(),projectId:"sat-quiz-fd317"},
    {...goodIdentity(),projectId:"mimo-backend-513412"},
    {...goodIdentity(),credentialsServerOnly:false},
    {...goodIdentity(),appCheckPolicyReviewed:false},
    {...goodIdentity(),serverVerified:false},
  ]){
    const f=fixture({attestIdentity:async()=>identity});
    await assert.rejects(f.bridge.callable(auth,request("getProblem")),
      /unavailable/);
    assert.equal(f.initialized,0);
  }
});

test("STG2.1 callable never trusts client-reported source or unauthenticated traffic",async()=>{
  const f=fixture();
  for(const [a,r] of [
    [null,request("getProblem")],
    [{uid:"no_token"},request("getProblem")],
    [auth,{apiVersion:1,action:"getProblem"}],
    [auth,{apiVersion:2,action:"invalid route"}],
    [auth,{apiVersion:2}],
  ]){
    await assert.rejects(f.bridge.callable(a,r),/unavailable/);
  }
  assert.equal(f.initialized,0);
  const fake=request("getProblem");
  fake.clientProjectId="mimo-backend-513412";
  const result=await f.bridge.callable(auth,fake);
  assert.equal(result.data.new,true);
  // Stage identity came from injected server verifier, never the client field.
  assert.equal(f.attested,1);
});

test("STG2.1 private failures never silently retry through legacy",async()=>{
  const f=fixture();
  await assert.rejects(f.bridge.callable(auth,request("failNeon")),
    /Neon outage/);
  assert.deepEqual(f.calls,["failNeon"]);
});

test("STG2.1 worker requires trusted server-origin + independent authorization",async()=>{
  const f=fixture();
  const job={kind:"publishJob",jobId:"job_1"};
  await assert.rejects(f.bridge.worker({firebaseProjectId:"sat-quiz-fd317",
    trustedServerInvocation:true},job),/unavailable/);
  await assert.rejects(f.bridge.worker({firebaseProjectId:"quizer-staging-az26",
    trustedServerInvocation:false},job),/unavailable/);
  assert.equal(f.initialized,0);
  const accepted=await f.bridge.worker({firebaseProjectId:"quizer-staging-az26",
    trustedServerInvocation:true},job);
  assert.deepEqual(accepted,{ok:true});
  assert.equal(f.authorized,1);
  assert.deepEqual(f.calls,["worker:publishJob"]);
});

test("STG2.1 worker refuses denied invocation without initializing runtime",async()=>{
  const f=fixture({authorizeWorker:async()=>false});
  await assert.rejects(f.bridge.worker({
    firebaseProjectId:"quizer-staging-az26",
    trustedServerInvocation:true,
  },{kind:"publishJob",jobId:"job_1"}),/unavailable/);
  assert.equal(f.initialized,0);
});

test("STG2.1 no source wiring to active production exports or secret reads",()=>{
  const paths=["router.js","index.js","jobs/worker.js"];
  const active=paths.map(p=>readFileSync(new URL(
    "../../functions/src/"+p,import.meta.url),"utf8")).join("\n");
  assert.doesNotMatch(active,/stg2-callable-bridge|private-full-staging/);
  const src=readFileSync(new URL(
    "../../functions/src/bundles/stg2-callable-bridge.js",import.meta.url),
    "utf8");
  assert.doesNotMatch(src,/^import\s/m);
  assert.doesNotMatch(src,/\b(?:process\.env|fetch\(|client\.query|createPool|gcloud)\b/);
});
