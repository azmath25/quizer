import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {audit} from "../../scripts/prod1/p1-cloud-audit.mjs";
import {PROD1_RELEASE_APPROVED}
  from "../../functions/src/prod1/release-gate.js";
const PROJECT="sat-quiz-fd317",ROLE="serviceAccount:quizer-runtime@example.iam.gserviceaccount.com";
function fake({missingSecret=false,wrongProject=false,missingIamForCursor=false}={}){
  const calls=[];
  const exec=args=>{
    calls.push([...args]);
    const [action,verb,name]=args;
    const raw=(x)=>({ok:true,text:typeof x==="string"?x:JSON.stringify(x)});
    if(action==="projects"&&verb==="describe")
      return raw(wrongProject?"000000":"476816329871");
    if(action==="secrets"&&verb==="describe")
      return missingSecret?{ok:false,text:""}:raw("projects/476816329871/secrets/"+name);
    if(action==="secrets"&&verb==="versions")
      return raw("versions/1");
    if(action==="functions"&&verb==="describe"){
      if(args.includes("--format=json"))return raw({
        serviceConfig:{
          serviceAccountEmail:"quizer-runtime@example.iam.gserviceaccount.com",
          secretEnvironmentVariables:[],
        },
      });
      return raw("quizer-runtime@example.iam.gserviceaccount.com");
    }
    if(action==="storage"&&verb==="buckets")
      return raw({name:"sat-quiz-fd317.firebasestorage.app"});
    if(action==="secrets"&&verb==="get-iam-policy")
      return raw({bindings:missingIamForCursor &&
        name==="QUIZER_BANK_CURSOR_KEY"?[]:[
        {role:"roles/secretmanager.secretAccessor",members:[ROLE]}]});
    if(action==="projects"&&verb==="get-iam-policy")
      return raw({bindings:[]});
    throw Error("Unexpected read-only request: "+args.join(" "));
  };
  return {calls,exec};
}
test("source release gate stays hard off even with secrets configured",()=>{
  assert.equal(PROD1_RELEASE_APPROVED,false);
  const index=readFileSync("functions/src/index.js","utf8");
  const sweep=readFileSync("functions/src/jobs/sweeper.js","utf8");
  assert(index.includes("defineSecret(\"QUIZER_NEON_DATABASE_URL\")"));
  assert(index.includes("defineSecret(\"QUIZER_BANK_CURSOR_KEY\")"));
  assert(index.includes("PROD1_ACTIVE"));
  assert(index.includes("secrets: PROD1_BOUND_SECRETS"));
  assert(index.includes("prod1.dispatch(request.auth, request.data)"));
  assert(index.includes("prod1.runJob(db, event.params.jobId)"));
  assert(index.includes("runJobImpl:prod1.runJob"));
  assert(sweep.includes("runJobImpl=runJob"));
});
test("P1 Cloud audit inspects exactly Quizer metadata without revealing secrets",()=>{
  const f=fake(),r=audit({exec:f.exec,
    getBranch:()=>"work/quizer-audit-optimization-2026-11"});
  assert.equal(r.verifiedProject,true);
  assert.equal(r.verifiedBranch,true);
  assert.equal(r.storage,true);
  assert.equal(r.secrets.QUIZER_NEON_DATABASE_URL.enabledVersion,true);
  assert.equal(r.secrets.QUIZER_BANK_CURSOR_KEY.valueAccessed,false);
  assert.equal(r.serviceAccountsReviewed,true);
  assert.equal(r.iamUnconditionalAccessor.api,true);
  assert.equal(r.deploy,false);
  assert.equal(r.activate,false);
  const all=f.calls.flat().join(" ");
  assert(!all.includes("mimo-backend"));
  assert(!all.includes("versions access"));
  assert(!all.includes("--data-file"));
  for(const verb of ["deploy","create","enable","disable","delete","add-iam-policy-binding"])
    assert(!f.calls.some(c=>c.includes(verb)));
});
test("wrong project or missing secret is reported, never repaired",()=>{
  const wrong=fake({wrongProject:true});
  const x=audit({exec:wrong.exec,
    getBranch:()=> "work/quizer-audit-optimization-2026-11"});
  assert.equal(x.verifiedProject,false);
  assert(x.blockedBy.some(s=>s.includes("Wrong")));
  assert.equal(wrong.calls.length,1);
  const missing=fake({missingSecret:true});
  const y=audit({exec:missing.exec,
    getBranch:()=> "work/quizer-audit-optimization-2026-11"});
  assert(y.blockedBy.some(s=>s.includes("Missing enabled secret")));
  assert.equal(y.activate,false);
});

test("grant on Neon URL alone does not pass cursor-key IAM check",()=>{
  const f=fake({missingIamForCursor:true});
  const result=audit({exec:f.exec,
    getBranch:()=>"work/quizer-audit-optimization-2026-11"});
  assert.equal(result.iamUnconditionalAccessor.api,false);
  assert.equal(result.iamUnconditionalAccessor.processJob,false);
  assert.equal(result.iamUnconditionalAccessor.scheduledMaintenance,false);
});

test("transient gcloud project lookup failures are retried without mutation",()=>{
  const f=fake();
  let attempts=0;
  const exec=args=>{
    if(args[0]==="projects"&&args[1]==="describe"&&++attempts<=2)
      return {ok:false,text:""};
    return f.exec(args);
  };
  const report=audit({exec,
    getBranch:()=>"work/quizer-audit-optimization-2026-11"});
  assert.equal(attempts,3);
  assert.equal(report.verifiedProject,true);
  assert.equal(report.activate,false);
  assert.equal(report.deploy,false);
});
test("persistent gcloud project lookup failure aborts Cloud audit safely",()=>{
  let attempts=0;
  const report=audit({
    exec:args=>{
      attempts++;
      assert.deepEqual(args,["projects","describe","sat-quiz-fd317",
        "--format=value(projectNumber)"]);
      return {ok:false,text:""};
    },
    getBranch:()=>{throw Error("must not check any other scope");},
  });
  assert.equal(attempts,3);
  assert.equal(report.verifiedProject,false);
  assert(report.blockedBy[0].includes("lookup failed after retries"));
  assert.deepEqual(report.secrets,{});
});
