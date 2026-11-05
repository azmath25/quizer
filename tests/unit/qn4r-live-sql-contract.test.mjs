import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("QN4R migration uses valid PostgreSQL immutable trigger dollar quoting", () => {
  const migration = sql("../../db/quizer/001_initial_schema.sql");
  assert.match(migration, /CREATE FUNCTION quizer\.reject_revision_mutation/);
  assert.match(migration, /RETURNS trigger LANGUAGE plpgsql AS \$\$/);
  assert.match(migration, /\$\$;\s*CREATE TRIGGER quizer_problem_revision_immutable/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /REVOKE ALL ON ALL TABLES IN SCHEMA quizer FROM PUBLIC/);
});

test("QN4R idempotency rehearsal asserts replay uniqueness and collision", () => {
  const script = sql("../sql/qn4r_idempotency_disposable.sql");
  assert.match(script, /ON CONFLICT \(event_id\) DO NOTHING/g);
  assert.match(script, /ON CONFLICT \(job_id,import_item_key\) DO NOTHING/g);
  assert.match(script, /event_count <> 1/);
  assert.match(script, /receipt_count <> 1/);
  assert.match(script, /Event collision was not observable/);
  assert.match(script, /Import collision was not observable/);
  assert.match(script, /\$qn4r\$;/);
  assert.doesNotMatch(script, /DROP SCHEMA|DROP TABLE/);
});

test("QN4R restricted test roles are NOLOGIN and not Neon API-managed superusers", () => {
  const roles = sql("../sql/qn4r_least_privilege_DISPOSABLE_ONLY.sql");
  assert.match(roles, /CREATE ROLE quizer_app_limited NOLOGIN/);
  assert.match(roles, /CREATE ROLE quizer_reader_limited NOLOGIN/);
  assert.match(roles, /NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.match(roles, /GRANT SELECT ON quizer.activity_events TO quizer_reader_limited/);
  assert.doesNotMatch(roles, /GRANT (?:ALL|UPDATE).*problem_revisions TO quizer_app_limited/);
  assert.doesNotMatch(roles, /GRANT .*quiz_revision_mirrors/);
  assert.doesNotMatch(roles, /LOGIN PASSWORD|postgresql:\/\/|npg_/);
});

test("QN4R rollback remains explicitly destructive and disposable-only", () => {
  const down = sql("../../db/quizer/001_rollback_DISPOSABLE_ONLY.sql");
  assert.match(down, /DROP SCHEMA quizer CASCADE/);
  assert.match(down, /DISPOSABLE/);
});
