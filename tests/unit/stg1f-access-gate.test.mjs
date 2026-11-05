import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectQuizerStg1f,STG1F_TARGET}
  from "../../scripts/staging/quizer-stg1f-access-gate.mjs";
const target={...STG1F_TARGET,default:false,primary:false};
const roles=[
  {name:"quizer_owner",authentication_method:"password"},
  {name:"quizer_app_limited",authentication_method:"no_login"},
  {name:"quizer_reader_limited",authentication_method:"no_login"},
];
const inspect=(p={})=>inspectQuizerStg1f({target,roles,...p});
test("STG1-F.1 live Neon metadata blocks runtime login and deployment",()=>{
  const result=inspect();
  assert.equal(result.readyForDeployment,false);
  assert.equal(result.authorizesSqlExecution,false);
  assert.equal(result.authorizesSecretDelivery,false);
  assert.equal(result.authorizesBilling,false);
  assert.equal(result.authorizesRoleCreation,false);
  assert.equal(result.authorizesMerge,false);
  assert.ok(result.blockers.includes("MISSING_RUNTIME_SQL_LOGIN"));
  assert.ok(result.blockers.includes("SQL_ATTESTATION_NOT_EXECUTED"));
});
test("STG1-F.1 refuses protected/default/wrong-project SQL targets",()=>{
  for(const t of [
    {...target,default:true}, {...target,primary:true},
    {...target,projectId:"mimo-backend-513412"},
    {...target,branchId:target.parentId},
    {...target,database:"mimo"},
    {...target,parentId:"another-parent"},
  ])assert.throws(()=>inspect({target:t}),/unverified disposable Quizer/);
});
test("STG1-F.1 rejects role drift, duplicate names, credentials",()=>{
  assert.throws(()=>inspect({roles:[...roles,roles[1]]}),/duplicate role/);
  assert.throws(()=>inspect({roles:null}),/read-only role/);
  assert.throws(()=>inspect({roles:[...roles,{name:"quizer_app",password:"foo",
      authentication_method:"password"}]}),/credential-like/);
  assert.ok(inspect({roles:roles.map(r=>r.name==="quizer_app_limited"?
      {...r,authentication_method:"password"}:r)})
    .blockers.includes("TEST_FIXTURE_IS_LOGIN"));
});
test("STG1-F.1 rejects unproven or privileged runtime SQL attestations",()=>{
  const attestation={
    role_name:"quizer_app",database_name:"quizer",
    rolcanlogin:true,tls_verified:true,endpoint_attested:true,
    schema_usage:true,rolsuper:false,rolcreatedb:false,
    rolcreaterole:false,rolreplication:false,rolbypassrls:false,
    inherited_neon_superuser:false,schema_create:false,
    permission_matrix_pass:true,
  };
  const liveRoles=[...roles,{name:"quizer_app",authentication_method:"password"}];
  assert.ok(inspect({roles:liveRoles,attestation:{...attestation,rolcreaterole:true}})
    .blockers.includes("SQL_LEAST_PRIVILEGE_NOT_PROVEN"));
  assert.ok(inspect({roles:liveRoles,attestation:{...attestation,
    permission_matrix_pass:false}})
    .blockers.includes("SQL_PERMISSION_MATRIX_NOT_PROVEN"));
  assert.throws(()=>inspect({roles:liveRoles,attestation:{role_name:"quizer_app"}}),
    /incomplete/);
  // The inspector does not turn synthetically supplied "PASS" values into
  // deployment authorization, even if every switch looks successful.
  const result=inspect({roles:liveRoles,attestation,firebase:{
    projectId:"quizer-staging-az26",firestoreFinalRulesVerified:true,
    authLoginVerified:true,runtimeIntegrationVerified:true,
    billingApproved:true,costControlsVerified:true,rollbackDrillVerified:true,
  }});
  assert.deepEqual(result.blockers,[]);
  assert.equal(result.readyForDeployment,false);
});
test("STG1-F.1 is offline-only and has no runtime/credential adapters",()=>{
  const src=readFileSync(new URL(
    "../../scripts/staging/quizer-stg1f-access-gate.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(src,/^import\s/m);
  assert.doesNotMatch(src,/\b(?:fetch|createPool|client\.query|process\.env|execSync)\s*\(/);
  assert.doesNotMatch(src,/\b(?:ALTER ROLE|CREATE ROLE|GRANT\s|DROP ROLE)\b/i);
});

test("STG1-F.1 SQL attestation remains a single read-only SELECT",()=>{
  const raw=readFileSync(new URL(
    "../sql/stg1f_runtime_access_attestation_READ_ONLY.sql",import.meta.url),
    "utf8");
  const sql=raw.split("\n").filter(l=>!l.trimStart().startsWith("--")).join("\n").trim();
  assert.match(sql,/^SELECT\b/i);
  assert.equal((sql.match(/;\s*$/g)||[]).length,1);
  assert.doesNotMatch(sql,/^\s*(CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|DELETE|INSERT|UPDATE)\b/im);
  for(const table of [
    "problems","problem_revisions","problem_tags","import_receipts",
    "activity_events","quiz_revision_mirrors","mutation_receipts",
  ])assert.ok(sql.includes("'quizer."+table+"'"));
  assert.match(sql,/pg_stat_ssl/);
  assert.match(sql,/rolbypassrls/);
  assert.match(sql,/inherited_neon_superuser/);
  assert.match(sql,/NULL::boolean AS endpoint_attested/);
});
