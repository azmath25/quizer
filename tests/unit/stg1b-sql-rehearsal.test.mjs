import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read = (path) => readFileSync(new URL("../../"+path,import.meta.url),"utf8");

test("STG1-B staged migrations preserve immutable revisions and separate receipts",()=>{
  const first=read("db/quizer/001_initial_schema.sql");
  const second=read("db/quizer/002_mutation_receipts_DISPOSABLE_ONLY.sql");
  assert.match(first,/CREATE SCHEMA quizer;/);
  assert.match(first,/CREATE TRIGGER quizer_problem_revision_immutable/);
  assert.match(first,/BEFORE UPDATE OR DELETE ON quizer\.problem_revisions/);
  assert.match(first,/DEFERRABLE INITIALLY DEFERRED/);
  assert.match(second,/CREATE TABLE quizer\.mutation_receipts/);
  assert.match(second,/PRIMARY KEY \(actor_uid, request_id\)/);
  assert.match(second,/CHECK \(jsonb_typeof\(result_json\) = 'object'\)/);
  assert.match(second,/REVOKE ALL ON quizer\.mutation_receipts FROM PUBLIC/);
  assert.doesNotMatch(first+second,/CREATE ROLE|GRANT ALL|GRANT .* TO PUBLIC/i);
});

test("STG1-B QN4R role rehearsal is explicitly NOLOGIN and non-elevated",()=>{
  const roles=read("tests/sql/qn4r_least_privilege_DISPOSABLE_ONLY.sql");
  assert.match(roles,/CREATE ROLE quizer_app_limited NOLOGIN INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.match(roles,/CREATE ROLE quizer_reader_limited NOLOGIN INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.match(roles,/GRANT SELECT,INSERT ON quizer\.problem_revisions TO quizer_app_limited/);
  assert.match(roles,/GRANT SELECT ON quizer\.activity_events TO quizer_reader_limited/);
  assert.doesNotMatch(roles,/PASSWORD|GRANT neon_superuser|ALTER ROLE .* LOGIN/i);
});

test("STG1-B receipt collision fixture is transactionally self-cleaning",()=>{
  const sql=read("tests/sql/stg1b_mutation_receipts_DISPOSABLE_ONLY.sql");
  assert.match(sql,/STG1-B disposable Quizer CHILD branch ONLY/);
  assert.match(sql,/SAVEPOINT stg1b_synthetic;/);
  assert.match(sql,/ROLLBACK TO SAVEPOINT stg1b_synthetic;/);
  assert.match(sql,/ON CONFLICT DO NOTHING/);
  assert.match(sql,/EXCEPTION WHEN check_violation/);
  assert.match(sql,/EXCEPTION WHEN unique_violation/);
  assert.match(sql,/pg_has_role\(rolname,'neon_superuser','MEMBER'\)/);
  assert.doesNotMatch(sql,/DROP SCHEMA|CREATE ROLE|DELETE FROM|ALTER ROLE|SET ROLE/i);
});

test("STG1-B rollback is explicitly disposable and cannot run via CI",()=>{
  const rollback=read("db/quizer/001_rollback_DISPOSABLE_ONLY.sql");
  const workflow=read(".github/workflows/quizer-verify.yml");
  assert.match(rollback,/DISPOSABLE DATABASE ONLY/);
  assert.match(rollback,/DROP SCHEMA quizer CASCADE;/);
  assert.match(workflow,/permissions:\s*\n  contents: read/);
  assert.doesNotMatch(workflow,/neonctl sql|firebase deploy|gcloud run deploy|psql .*rollback/);
});
