import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertDisposableTarget } from "../../scripts/qn4-local-rehearsal.mjs";

const local = "postgresql://local_tester:fake@127.0.0.1:5432/quizer_qn4_disposable_test";
test("QN4 allows ONLY explicitly approved loopback disposable database", () => {
  const a = assertDisposableTarget(local, "YES_LOCAL_DISPOSABLE");
  assert.equal(a.host, "127.0.0.1");
  assert.equal(a.database, "quizer_qn4_disposable_test");
  assert.equal(a.user, "local_tester");
});
for (const u of [
  "postgresql://tester:fake@neon.example.com:5432/quizer_qn4_disposable_test",
  "postgresql://tester:fake@127.0.0.1:5432/mimo",
  "postgresql://tester:fake@127.0.0.1:5432/quizer_production",
  "postgresql://tester:fake@127.0.0.1:5432/quizer_qn4_disposable_test?host=production",
  "https://tester:fake@127.0.0.1:5432/quizer_qn4_disposable_test",
]) test("QN4 rejects unsafe database target: " + u.split("@").at(-1), () =>
  assert.throws(() => assertDisposableTarget(u, "YES_LOCAL_DISPOSABLE")));
test("QN4 refuses execution without an explicit local-disposable approval", () => {
  assert.throws(() => assertDisposableTarget(local, ""), /requires QUIZER_QN4_APPROVAL/);
});
test("QN4 SQL verifies FK, immutable revisions, tags, receipts, indexes, and reversal", () => {
  const sql = readFileSync(new URL("../sql/qn4_disposable_rehearsal.sql", import.meta.url), "utf8");
  const up = readFileSync(new URL("../../db/quizer/001_initial_schema.sql", import.meta.url), "utf8");
  const down = readFileSync(new URL("../../db/quizer/001_rollback_DISPOSABLE_ONLY.sql", import.meta.url), "utf8");
  assert.match(sql, /\bBEGIN;/);
  assert.match(sql, /\bCOMMIT;/);
  for (const term of ["foreign_key_violation", "revision UPDATE not blocked", "revision DELETE not blocked",
    "tag uniqueness failed", "import receipt uniqueness failed",
    "event uniqueness failed", "keyset paging predicate incorrect"])
    assert(sql.includes(term), term);
  assert.match(up, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(up, /BEFORE UPDATE OR DELETE ON quizer.problem_revisions/);
  assert.match(up, /RETURNS trigger LANGUAGE plpgsql AS \$\$/);
  assert.match(up, /\$\$;\s*CREATE TRIGGER quizer_problem_revision_immutable/);
  assert.match(down, /DROP SCHEMA quizer CASCADE/);
});
test("QN4 refuses schema clobbering before any test SQL", () => {
  const source = readFileSync(new URL("../../scripts/qn4-local-rehearsal.mjs", import.meta.url), "utf8");
  assert(source.indexOf("refuseExistingSchema(target);") < source.indexOf("let started = false;"));
  assert.match(source, /finally \{/);
});
