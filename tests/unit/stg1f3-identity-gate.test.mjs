import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  inspectQuizerStg1f3,STG1F3_SCOPE,
} from "../../scripts/staging/quizer-stg1f3-identity-gate.mjs";

const scope={...STG1F3_SCOPE};
const account="quizer-stg-runtime@quizer-staging-az26.iam.gserviceaccount.com";
const cloud={projectId:"quizer-staging-az26",projectNumber:"509423933910",
  billingEnabled:false,functionsDeployed:false};
const runtime={kind:"firebase-functions-v2",serviceAccountEmail:account,
  customIdentityVerified:true,serviceAccountBoundToRuntime:true,
  defaultIdentityUsed:false,region:"europe-west1",
  stagingSchedulerDisabled:true,explicitStagingScalingReviewed:true,
  crossRegionCostsReviewed:true};
const secretStore={
  resourceName:"projects/quizer-staging-az26/secrets/quizer-staging-neon-url",
  existsVerified:true,
  iamBindings:[{role:"roles/secretmanager.secretAccessor",
    member:"serviceAccount:"+account}],
  noPublicAccessVerified:true,noBroaderInheritedAccessVerified:true,
  noPayloadReadConfirmed:true,
};
const costs={monthlyTargetUsd:1,scopeProjectId:"quizer-staging-az26",
  alertPercents:[25,50,80,100],hardGlobalCapClaimed:false,
  actualBudgetVerified:true,billingActivationApproved:false};
const inspect=(extra={})=>inspectQuizerStg1f3({
  scope,cloud,runtime,secretStore,costs,...extra,
});

test("STG1-F.3 missing actual staging proofs fail closed",()=>{
  const r=inspect({runtime:null,secretStore:null,costs:null});
  assert.ok(r.blockers.includes("DEDICATED_RUNTIME_IDENTITY_UNVERIFIED"));
  assert.ok(r.blockers.includes("DEDICATED_SECRET_NOT_VERIFIED"));
  assert.ok(r.blockers.includes("ACTUAL_BUDGET_NOT_VERIFIED"));
  assert.equal(r.readyForStg2,false);
  assert.equal(r.authorizesIAMChanges,false);
  assert.equal(r.authorizesSecretCreation,false);
  assert.equal(r.authorizesCredentialProvisioning,false);
  assert.equal(r.authorizesBillingChange,false);
  assert.equal(r.authorizesDeployment,false);
  assert.equal(r.authorizesMerge,false);
});

test("STG1-F.3 rejects other project, branch or spending target",()=>{
  for(const bad of [
    {...scope,firebaseProjectId:"sat-quiz-fd317"},
    {...scope,neonProjectId:"mimo-backend-513412"},
    {...scope,neonBranchId:"br-wispy-night-b9ug6kub"},
    {...scope,spendingTargetUsd:10},
    {...scope,extra:"unexpected"},
  ])assert.throws(()=>inspect({scope:bad}),/wrong staging scope/);
});

test("STG1-F.3 prevents credentials or their payloads entering inspection",()=>{
  for(const extra of [
    {secretStore:{...secretStore,password:"leak"}},
    {runtime:{...runtime,accessToken:"leak"}},
    {costs:{...costs,privateKey:"leak"}},
    {cloud:{...cloud,connectionString:"not-a-secret"}},
    {runtime:{...runtime,serviceAccountEmail:"postgresql://example"}},
  ])assert.throws(()=>inspect(extra),/credential/);
});

test("STG1-F.3 checks dedicated identity and exact secret-scoped permissions",()=>{
  const defaultSA=scope.firebaseProjectNumber+
    "-compute@developer.gserviceaccount.com";
  const r=inspect({runtime:{...runtime,serviceAccountEmail:defaultSA,
    defaultIdentityUsed:true},secretStore:{...secretStore,
    iamBindings:[{role:"roles/secretmanager.secretAccessor",
      member:"serviceAccount:"+defaultSA}]}});
  assert.ok(r.blockers.includes("DEDICATED_RUNTIME_IDENTITY_UNVERIFIED"));
  assert.ok(r.blockers.includes("DEFAULT_SERVICE_ACCOUNT_NOT_RULED_OUT"));
  assert.ok(r.blockers.includes("SECRET_SCOPED_ACCESSOR_UNVERIFIED"));
  const wide=inspect({secretStore:{...secretStore,
    iamBindings:[...secretStore.iamBindings,{role:"roles/secretmanager.secretAccessor",
      member:"allUsers"}],
    noBroaderInheritedAccessVerified:false}});
  assert.ok(wide.blockers.includes("SECRET_SCOPED_ACCESSOR_UNVERIFIED"));
  assert.ok(wide.blockers.includes("SECRET_WIDER_ACCESS_NOT_EXCLUDED"));
});

test("STG1-F.3 budget alerts are not a spend cap",()=>{
  assert.ok(inspect({costs:{...costs,hardGlobalCapClaimed:true}})
    .blockers.includes("FALSE_GLOBAL_HARD_CAP_CLAIM"));
  assert.ok(inspect({costs:{...costs,alertPercents:[50,80,100]}})
    .blockers.includes("ONE_DOLLAR_ALERT_PLAN_NOT_VERIFIED"));
  assert.ok(inspect({cloud:{...cloud,billingEnabled:true}})
    .blockers.includes("STAGING_BILLING_STATE_NOT_SAFE"));
  assert.ok(inspect({costs:{...costs,billingActivationApproved:true}})
    .blockers.includes("BILLING_APPROVAL_CONTRADICTS_DISABLED_STATE"));
});

test("STG1-F.3 requires explicit scheduler, scaling, cross-region review",()=>{
  const r=inspect({runtime:{...runtime,
    stagingSchedulerDisabled:false,explicitStagingScalingReviewed:false,
    crossRegionCostsReviewed:false}});
  assert.ok(r.blockers.includes("STAGING_SCHEDULER_NOT_DISABLED"));
  assert.ok(r.blockers.includes("STAGING_SCALING_NOT_REVIEWED"));
  assert.ok(r.blockers.includes("CROSS_REGION_COSTS_NOT_REVIEWED"));
});

test("STG1-F.3 forged all-green metadata still never authorizes deployment",()=>{
  const r=inspect();
  assert.deepEqual(r.blockers,[]);
  assert.equal(r.readyForStg2,false);
  assert.equal(r.authorizesCredentialProvisioning,false);
  assert.equal(r.authorizesDeployment,false);
});

test("STG1-F.3 captures actual source baseline without modifying functions",()=>{
  const functions=readFileSync(new URL(
    "../../functions/src/index.js",import.meta.url),"utf8");
  const config=readFileSync(new URL(
    "../../functions/src/config.js",import.meta.url),"utf8");
  assert.match(functions,/onSchedule\s*\(/);
  assert.match(functions,/every 1 minutes/);
  assert.match(functions,/maxInstances:\s*10/);
  assert.match(functions,/maxInstances:\s*5/);
  assert.doesNotMatch(functions,/serviceAccount\s*:/);
  assert.match(config,/europe-west1/);
});

test("STG1-F.3 inspector has no network, driver or write execution",()=>{
  const source=readFileSync(new URL(
    "../../scripts/staging/quizer-stg1f3-identity-gate.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(source,/^import\s/m);
  assert.doesNotMatch(source,/\b(?:fetch|execSync|createPool|client\.query|process\.env|spawn)\s*\(/);
  assert.doesNotMatch(source,/\b(?:gcloud|firebase\s+deploy|CREATE\s+ROLE|GRANT\s+ROLE)\b/i);
});
