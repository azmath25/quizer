// Quizer STG1-F.3 — offline identity/cost review gate, never an executor.
// Values passed here are UNTRUSTED METADATA, not live Google Cloud evidence.
export const STG1F3_SCOPE=Object.freeze({
  firebaseProjectId:"quizer-staging-az26",
  firebaseProjectNumber:"509423933910",
  neonProjectId:"soft-grass-35754518",
  neonBranchId:"br-sweet-rice-b9ehdv9i",
  neonDatabase:"quizer",
  spendingTargetUsd:1,
});
const RUNTIME_SA=/^quizer-stg-[a-z0-9-]{1,23}@quizer-staging-az26\.iam\.gserviceaccount\.com$/;
const SECRET_RESOURCE=
  "projects/quizer-staging-az26/secrets/quizer-staging-neon-url";
const DENIED_FIELD=/password|private.?key|client.?secret|access.?token|database.?url|connection.?string|secret.?payload|credential.?value|api.?key/i;
function noSecretValues(value,depth=0){
  if(depth>8)throw new Error("STG1-F.3 refused deeply nested metadata.");
  if(typeof value==="string"&&/^(postgres(?:ql)?:\/\/|-----BEGIN .*PRIVATE KEY)/i.test(value))
    throw new Error("STG1-F.3 refused a credential value.");
  if(!value||typeof value!=="object")return;
  if(Array.isArray(value)&&value.length>100)
    throw new Error("STG1-F.3 refused oversized metadata.");
  for(const [key,item] of Object.entries(value)){
    if(DENIED_FIELD.test(key))
      throw new Error("STG1-F.3 refused credential-shaped input.");
    noSecretValues(item,depth+1);
  }
}
function matchesScope(scope){
  return scope&&Object.entries(STG1F3_SCOPE).every(([k,v])=>scope[k]===v) &&
    Object.keys(scope).length===Object.keys(STG1F3_SCOPE).length;
}
const unique=a=>Object.freeze([...new Set(a)]);
export function inspectQuizerStg1f3({
  scope,cloud=null,runtime=null,secretStore=null,costs=null,
}={}){
  noSecretValues({scope,cloud,runtime,secretStore,costs});
  if(!matchesScope(scope))throw new Error("STG1-F.3 wrong staging scope.");
  const blockers=[];
  if(cloud?.projectId!==scope.firebaseProjectId ||
      cloud?.projectNumber!==scope.firebaseProjectNumber)
    blockers.push("CLOUD_PROJECT_IDENTITY_UNVERIFIED");
  if(cloud?.billingEnabled!==false)
    blockers.push("STAGING_BILLING_STATE_NOT_SAFE");
  if(cloud?.functionsDeployed===true)
    blockers.push("UNAPPROVED_FUNCTIONS_PRESENT_REVIEW_REQUIRED");
  // Existing Quizer functions are gen2. No deployment or custom SA is
  // inferred from static source configuration.
  if(runtime?.kind!=="firebase-functions-v2")
    blockers.push("RUNTIME_PLATFORM_UNVERIFIED");
  if(!RUNTIME_SA.test(runtime?.serviceAccountEmail??"") ||
      runtime?.customIdentityVerified!==true ||
      runtime?.serviceAccountBoundToRuntime!==true)
    blockers.push("DEDICATED_RUNTIME_IDENTITY_UNVERIFIED");
  if(runtime?.defaultIdentityUsed!==false)
    blockers.push("DEFAULT_SERVICE_ACCOUNT_NOT_RULED_OUT");
  if(runtime?.region!=="europe-west1")
    blockers.push("RUNTIME_REGION_NOT_CONFIRMED");
  // Quizer currently schedules a maintenance function every minute. Do not
  // roll it into a $1/month staging environment by default.
  if(runtime?.stagingSchedulerDisabled!==true)
    blockers.push("STAGING_SCHEDULER_NOT_DISABLED");
  if(runtime?.explicitStagingScalingReviewed!==true)
    blockers.push("STAGING_SCALING_NOT_REVIEWED");
  if(runtime?.crossRegionCostsReviewed!==true)
    blockers.push("CROSS_REGION_COSTS_NOT_REVIEWED");
  if(secretStore?.resourceName!==SECRET_RESOURCE ||
      secretStore?.existsVerified!==true)
    blockers.push("DEDICATED_SECRET_NOT_VERIFIED");
  const identity=runtime?.serviceAccountEmail;
  const grants=secretStore?.iamBindings;
  if(!Array.isArray(grants) || grants.length!==1 ||
      grants[0]?.role!=="roles/secretmanager.secretAccessor" ||
      grants[0]?.member!==("serviceAccount:"+identity) ||
      !RUNTIME_SA.test(identity??""))
    blockers.push("SECRET_SCOPED_ACCESSOR_UNVERIFIED");
  if(secretStore?.noPublicAccessVerified!==true ||
      secretStore?.noBroaderInheritedAccessVerified!==true)
    blockers.push("SECRET_WIDER_ACCESS_NOT_EXCLUDED");
  if(secretStore?.noPayloadReadConfirmed!==true)
    blockers.push("SECRET_METADATA_ONLY_CHECK_REQUIRED");
  if(costs?.monthlyTargetUsd!==1 ||
      costs?.scopeProjectId!==scope.firebaseProjectId ||
      !Array.isArray(costs?.alertPercents) ||
      costs.alertPercents.join(",")!=="25,50,80,100")
    blockers.push("ONE_DOLLAR_ALERT_PLAN_NOT_VERIFIED");
  if(costs?.hardGlobalCapClaimed===true)
    blockers.push("FALSE_GLOBAL_HARD_CAP_CLAIM");
  if(costs?.actualBudgetVerified!==true)
    blockers.push("ACTUAL_BUDGET_NOT_VERIFIED");
  if(costs?.billingActivationApproved===true &&
      cloud?.billingEnabled===false)
    blockers.push("BILLING_APPROVAL_CONTRADICTS_DISABLED_STATE");
  // Never derive rollout authorization from caller-supplied metadata.
  return Object.freeze({
    stagingProject:scope.firebaseProjectId,
    blockers:unique(blockers),
    readyForStg2:false,
    authorizesIAMChanges:false,
    authorizesSecretCreation:false,
    authorizesCredentialProvisioning:false,
    authorizesBillingChange:false,
    authorizesDeployment:false,
    authorizesMerge:false,
    nextGate:"Independent live Google Cloud read-only evidence and explicit separate approval.",
  });
}
