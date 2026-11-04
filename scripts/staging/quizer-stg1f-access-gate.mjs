// STG1-F.1: offline, fail-closed preflight only. This module does not connect,
// provision roles, accept credentials, validate source authenticity or deploy.
export const STG1F_TARGET=Object.freeze({
  projectId:"soft-grass-35754518",
  branchId:"br-sweet-rice-b9ehdv9i",
  parentId:"br-wispy-night-b9ug6kub",
  branchName:"stg1b-disposable-2026-11-04",
  database:"quizer",
});
const BAD_FLAGS=Object.freeze([
  "rolsuper","rolcreatedb","rolcreaterole","rolreplication","rolbypassrls",
  "inherited_neon_superuser","schema_create",
]);
const ROLE_ATTESTATION_FIELDS=Object.freeze([
  "role_name","database_name","rolcanlogin","tls_verified","endpoint_attested",
  "schema_usage",...BAD_FLAGS,
]);
function verifyTarget(target){
  if(!target || typeof target!=="object" ||
      target.projectId!==STG1F_TARGET.projectId ||
      target.branchId!==STG1F_TARGET.branchId ||
      target.parentId!==STG1F_TARGET.parentId ||
      target.branchName!==STG1F_TARGET.branchName ||
      target.database!==STG1F_TARGET.database ||
      target.default!==false || target.primary!==false)
    throw new Error("STG1-F refuses an unverified disposable Quizer target.");
}
function rejectSecrets(obj){
  if(!obj || typeof obj!=="object")return;
  for(const [k,v] of Object.entries(obj)){
    if(/password|secret|token|connection.?string|database.?url|api.?key/i.test(k))
      throw new Error("STG1-F refuses credential-like fields.");
    if(v && typeof v==="object")rejectSecrets(v);
  }
}
export function inspectQuizerStg1f({
  target, roles, attestation=null, firebase=null,
}={}){
  rejectSecrets({target,roles,attestation,firebase});
  verifyTarget(target);
  if(!Array.isArray(roles) ||
      roles.some(r=>!r || typeof r.name!=="string" ||
        typeof r.authentication_method!=="string"))
    throw new Error("STG1-F requires read-only role inventory.");
  const seen=new Set();
  for(const r of roles){
    if(seen.has(r.name))throw new Error("STG1-F duplicate role inventory.");
    seen.add(r.name);
  }
  const blockers=[];
  const app=roles.find(r=>r.name==="quizer_app");
  if(!app)blockers.push("MISSING_RUNTIME_SQL_LOGIN");
  else if(app.authentication_method!=="password")
    blockers.push("RUNTIME_ROLE_NOT_LOGIN");
  if(roles.some(r=>r.name==="quizer_app_limited" &&
      r.authentication_method!=="no_login"))
    blockers.push("TEST_FIXTURE_IS_LOGIN");
  if(roles.some(r=>r.name==="quizer_reader_limited" &&
      r.authentication_method!=="no_login"))
    blockers.push("READER_FIXTURE_IS_LOGIN");
  // Values are caller-supplied metadata, not a substitute for independent
  // server-side SQL evidence from a real quizer_app login.
  if(attestation!==null){
    if(typeof attestation!=="object" || Array.isArray(attestation) ||
        ROLE_ATTESTATION_FIELDS.some(k=>!(k in attestation)))
      throw new Error("STG1-F SQL attestation is incomplete.");
    if(attestation.role_name!=="quizer_app" ||
        attestation.database_name!=="quizer" ||
        attestation.rolcanlogin!==true ||
        attestation.schema_usage!==true ||
        attestation.tls_verified!==true ||
        attestation.endpoint_attested!==true ||
        BAD_FLAGS.some(k=>attestation[k]!==false))
      blockers.push("SQL_LEAST_PRIVILEGE_NOT_PROVEN");
    // A permissions matrix must be checked independently against the SQL
    // report, including immutability and denied DDL.
    if(attestation.permission_matrix_pass!==true)
      blockers.push("SQL_PERMISSION_MATRIX_NOT_PROVEN");
  } else blockers.push("SQL_ATTESTATION_NOT_EXECUTED");
  if(!firebase || firebase.projectId!=="quizer-staging-az26")
    blockers.push("FIREBASE_PROJECT_NOT_VERIFIED");
  else {
    if(firebase.firestoreFinalRulesVerified!==true)
      blockers.push("FIRESTORE_FINAL_RULES_NOT_VERIFIED");
    if(firebase.authLoginVerified!==true)
      blockers.push("REAL_AUTH_LOGIN_NOT_VERIFIED");
    if(firebase.runtimeIntegrationVerified!==true)
      blockers.push("REAL_CROSS_STORE_TESTS_NOT_VERIFIED");
    if(firebase.billingApproved!==true)
      blockers.push("BILLING_NOT_APPROVED");
    if(firebase.costControlsVerified!==true)
      blockers.push("COST_CONTROLS_NOT_VERIFIED");
    if(firebase.rollbackDrillVerified!==true)
      blockers.push("ROLLBACK_NOT_VERIFIED");
  }
  return Object.freeze({
    target:Object.freeze({...STG1F_TARGET}),
    blockers:Object.freeze([...new Set(blockers)]),
    // Never authorize deployment from user-supplied booleans or role listing.
    // Human-reviewed cloud evidence + a new explicit approval are mandatory.
    readyForDeployment:false,
    authorizesRoleCreation:false,
    authorizesSecretDelivery:false,
    authorizesBilling:false,
    authorizesSqlExecution:false,
    authorizesMerge:false,
    nextGate:"Independent real service evidence and explicit STG2 approval required.",
  });
}
