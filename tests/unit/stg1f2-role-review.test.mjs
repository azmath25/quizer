import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");
const raw=read("../sql/stg1f2_role_grants_DRY_RUN_ONLY.sql");
const sql=raw.split("\n").filter(line=>!line.trimStart().startsWith("--")).join("\n");
const statements=sql.split(";").map(s=>s.trim()).filter(Boolean);
const canonical=s=>s.replace(/\s+/g," ").trim().toUpperCase();

test("STG1-F.2 never creates a persistent role or secret",()=>{
  assert.equal(canonical(statements[0]),"BEGIN");
  assert.equal(canonical(statements.at(-1)),"ROLLBACK");
  assert.equal(statements.filter(s=>/^BEGIN$/i.test(s)).length,1);
  assert.equal(statements.filter(s=>/^ROLLBACK$/i.test(s)).length,1);
  assert.doesNotMatch(sql,/\bCOMMIT\b/i);
  assert.doesNotMatch(sql,/\bPASSWORD\b|\bVALID\s+UNTIL\b|\bCONNECTION\s+STRING\b|\bSECRET\s+DATA\b/i);
  assert.doesNotMatch(sql,/\b(ALTER\s+ROLE|DROP\s+ROLE|CREATE\s+SCHEMA|DROP\s+SCHEMA)\b/i);
  assert.doesNotMatch(sql,/mimo|sat-quiz-fd317|DATABASE\s+postgres\b/i);
});

test("STG1-F.2 role definition is explicit and non-elevated",()=>{
  const roles=statements.filter(s=>/^CREATE\s+ROLE\b/i.test(s));
  assert.equal(roles.length,1);
  assert.equal(canonical(roles[0]),
    "CREATE ROLE QUIZER_APP LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
  assert.doesNotMatch(sql,/\b(IN\s+ROLE|IN\s+GROUP|ADMIN\s+OPTION|CREATEROLE\s+ROLE|SUPERUSER\s+ROLE)\b/i);
});

test("STG1-F.2 grants only exact reviewed app permissions",()=>{
  const grants=statements.filter(s=>/^GRANT\b/i.test(s)).map(canonical).sort();
  const expected=[
    "GRANT CONNECT ON DATABASE QUIZER TO QUIZER_APP",
    "GRANT USAGE ON SCHEMA QUIZER TO QUIZER_APP",
    "GRANT SELECT, INSERT, UPDATE ON QUIZER.PROBLEMS TO QUIZER_APP",
    "GRANT SELECT, INSERT ON QUIZER.PROBLEM_REVISIONS TO QUIZER_APP",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON QUIZER.PROBLEM_TAGS TO QUIZER_APP",
    "GRANT SELECT, INSERT ON QUIZER.IMPORT_RECEIPTS TO QUIZER_APP",
    "GRANT SELECT, INSERT ON QUIZER.ACTIVITY_EVENTS TO QUIZER_APP",
    "GRANT SELECT, INSERT ON QUIZER.MUTATION_RECEIPTS TO QUIZER_APP",
  ].sort();
  assert.deepEqual(grants,expected);
  const revokes=statements.filter(s=>/^REVOKE\b/i.test(s)).map(canonical).sort();
  assert.deepEqual(revokes,[
    "REVOKE ALL ON ALL TABLES IN SCHEMA QUIZER FROM QUIZER_APP",
    "REVOKE ALL ON SCHEMA QUIZER FROM QUIZER_APP",
  ].sort());
  assert.doesNotMatch(sql,/\bGRANT[\s\S]*\bTO\s+(PUBLIC|QUIZER_OWNER|NEON_SUPERUSER)\b/i);
  assert.doesNotMatch(sql,/^\s*GRANT.+QUIZ_REVISION_MIRRORS/im);
});

test("STG1-F.2 dry-run has a narrow allowlist of SQL statement kinds",()=>{
  assert.equal(statements.length,12);
  for(const s of statements.slice(1,-1))
    assert.match(s,/^(CREATE\s+ROLE\s+quizer_app|GRANT\s|REVOKE\s)/i);
});

test("STG1-F.2 has no migration, deploy, driver or network integration",()=>{
  const gate=read("../../scripts/staging/quizer-migration-gate.mjs");
  const workflow=read("../../.github/workflows/quizer-verify.yml");
  const runtime=read("../../functions/src/neon/sql-port.js");
  for(const s of [gate,workflow,runtime])
    assert.doesNotMatch(s,/stg1f2_role_grants_DRY_RUN_ONLY/);
  assert.doesNotMatch(raw,/\b(?:curl|gcloud|firebase|neon\s+deploy|psql\s+-c|wget)\b/i);
});
