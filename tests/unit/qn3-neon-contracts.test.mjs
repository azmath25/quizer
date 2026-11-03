import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NeonContractError, requireId, requireHash, requireTeacher,
  requirePageSize, asIso, safeSource,
} from "../../functions/src/neon/contracts.js";
import { createQuizerNeonReadRepository } from "../../functions/src/neon/repository.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/neon/qn3-synthetic-problem.json", import.meta.url), "utf8"));
const { owner, collaborator, student, admin } = fixture.actors;
function fakePort({ header = fixture.header, revision = fixture.revision, listRows = null } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("FROM quizer.problem_revisions"))
        return { rows: revision ? [structuredClone(revision)] : [] };
      return { rows: listRows !== null ? structuredClone(listRows) : header ? [structuredClone(header)] : [] };
    },
  };
}
const reason = (code) => (err) => err instanceof NeonContractError && err.reason === code;

test("IDs, hashes and pagination inputs are strictly validated", () => {
  assert.equal(requireId("prb_12"), "prb_12");
  assert.throws(() => requireId("p';DROP TABLE x--"), reason("INVALID_FIELDS"));
  assert.throws(() => requireId("__proto__"), reason("INVALID_FIELDS"));
  assert.throws(() => requireHash("f".repeat(63)), reason("INVALID_FIELDS"));
  assert.equal(requireHash("a".repeat(64)), "a".repeat(64));
  assert.throws(() => requirePageSize(101), reason("INVALID_FIELDS"));
  assert.equal(requirePageSize(100), 100);
  assert.throws(() => asIso("not-a-time"), reason("INVALID_FIELDS"));
});
test("students, disabled and unverified actors cannot access bank repositories", async () => {
  const port = fakePort(), repo = createQuizerNeonReadRepository(port);
  await assert.rejects(repo.getProblemForTeacher({ actor: student, problemId: fixture.header.problem_id }), reason("ROLE_REQUIRED"));
  await assert.rejects(repo.getProblemForTeacher({ actor: {...owner, emailVerified:false}, problemId: fixture.header.problem_id }), reason("EMAIL_UNVERIFIED"));
  await assert.rejects(repo.listProblemHeaders({ actor: {...owner, accountStatus:"disabled"} }), reason("ACCOUNT_DISABLED"));
  assert.equal(port.queries.length, 0);
});
test("factory requires injected trusted query port and has no external DB driver", () => {
  assert.throws(() => createQuizerNeonReadRepository(), reason("INVALID_FIELDS"));
  assert.equal(typeof createQuizerNeonReadRepository(fakePort()).getProblemForTeacher, "function");
});
test("owner read returns protected grading and original source references", async () => {
  const port = fakePort(), repo = createQuizerNeonReadRepository(port);
  const r = await repo.getProblemForTeacher({ actor: owner, problemId: fixture.header.problem_id });
  assert.equal(r.revisionId, fixture.revision.revision_id);
  assert.equal(r.problem.ownerId, owner.uid);
  assert.equal(r.content.source.sourceAssetId, fixture.revision.source_json.sourceAssetId);
  assert.equal(r.grading.correctOptionId, "b");
  assert.equal(port.queries.length, 2);
  assert.deepEqual(port.queries[0].values, [fixture.header.problem_id, owner.uid, "teacher"]);
  assert.deepEqual(port.queries[1].values, [fixture.header.problem_id, fixture.revision.revision_id]);
});
test("shared teacher sees problem and grading, but never original TeX source asset", async () => {
  const port = fakePort(), repo = createQuizerNeonReadRepository(port);
  const r = await repo.getProblemForTeacher({ actor: collaborator, problemId: fixture.header.problem_id });
  assert.equal(r.content.source.sourceAssetId, null);
  assert.equal(r.content.source.importJobId, null);
  assert.equal(r.content.source.originalQuestionId, "q1");
  assert.equal(r.grading.correctOptionId, "b");
  assert.match(port.queries[0].sql, /bank_visibility = 'teachers'/);
});
test("admin may see authorized source details", async () => {
  const repo = createQuizerNeonReadRepository(fakePort());
  const r = await repo.getProblemForTeacher({ actor: admin, problemId: fixture.header.problem_id });
  assert.equal(r.content.source.sourceAssetId, "ast_source_tex");
});
test("missing or private bank row never triggers a grading query", async () => {
  const port = fakePort({ header: null }), repo = createQuizerNeonReadRepository(port);
  await assert.rejects(repo.getProblemForTeacher({ actor: collaborator, problemId: "prb_private" }), reason("RESOURCE_UNAVAILABLE"));
  assert.equal(port.queries.length, 1);
});
test("missing historical revision is unavailable without revealing other records", async () => {
  const port = fakePort({ revision: null }), repo = createQuizerNeonReadRepository(port);
  await assert.rejects(repo.getProblemForTeacher({ actor: owner, problemId: fixture.header.problem_id, revisionId: "prv_missing" }), reason("RESOURCE_UNAVAILABLE"));
  assert.deepEqual(port.queries[1].values, [fixture.header.problem_id, "prv_missing"]);
});
test("SQL injection strings are never interpolated into a query", async () => {
  const port = fakePort({ listRows: [] }), repo = createQuizerNeonReadRepository(port);
  const attack = "%' OR TRUE --";
  await repo.listProblemHeaders({ actor: owner, search: attack, tag: "test' OR 1=1 --" });
  assert(!port.queries[0].sql.includes(attack));
  const literalPrefix = attack.toLowerCase().replace(/[!%_]/g, (ch) => "!" + ch) + "%";
  assert(port.queries[0].values.includes(literalPrefix));
  assert(port.queries[0].values.includes("test' OR 1=1 --"));
  assert.match(port.queries[0].sql, /p.search_title LIKE/);
  assert.match(port.queries[0].sql, /ESCAPE '!'/);
});
test("mine page is scoped to owner, returns headers only and a deterministic cursor", async () => {
  const a = { ...fixture.header, problem_id:"prb_a" };
  const b = { ...fixture.header, problem_id:"prb_b" };
  const c = { ...fixture.header, problem_id:"prb_c" };
  const port = fakePort({ listRows: [a,b,c] }), repo = createQuizerNeonReadRepository(port);
  const page = await repo.listProblemHeaders({ actor: owner, limit: 2, tag: "parity" });
  assert.equal(page.items.length, 2);
  assert.deepEqual(page.next, {updatedAt:fixture.header.updated_at, problemId:"prb_b"});
  assert(!JSON.stringify(page).includes("correctOptionId"));
  assert(!JSON.stringify(page).includes("statementLatex"));
  assert.match(port.queries[0].sql, /p.owner_uid/);
  assert.match(port.queries[0].sql, /ORDER BY p.updated_at DESC, p.problem_id DESC/);
  assert(port.queries[0].values.includes(3));
});
test("shared view filters only active teacher-shared problems", async () => {
  const port = fakePort({ listRows: [] }), repo = createQuizerNeonReadRepository(port);
  await repo.listProblemHeaders({ actor: collaborator, view:"shared" });
  assert.match(port.queries[0].sql, /p.bank_visibility = 'teachers'/);
  assert.match(port.queries[0].sql, /p.lifecycle = 'active'/);
});
test("cursor timestamp and ID are bound, not injected", async () => {
  const port = fakePort({ listRows: [] }), repo = createQuizerNeonReadRepository(port);
  await repo.listProblemHeaders({
    actor: owner, after: { updatedAt:"2026-11-01T00:00:00.000Z", problemId:"prb_prev" },
  });
  assert.match(port.queries[0].sql, /p.updated_at, p.problem_id/);
  assert(port.queries[0].values.includes("prb_prev"));
  await assert.rejects(repo.listProblemHeaders({
    actor: owner, after: { updatedAt:"bad", problemId:"prb_prev" },
  }), reason("INVALID_FIELDS"));
  assert.equal(port.queries.length, 1);
});
test("invalid bank filters and sizes fail before querying", async () => {
  const port = fakePort({ listRows: [] }), repo = createQuizerNeonReadRepository(port);
  await assert.rejects(repo.listProblemHeaders({ actor: owner, limit:500 }), reason("INVALID_FIELDS"));
  await assert.rejects(repo.listProblemHeaders({ actor: owner, view:"public" }), reason("INVALID_FIELDS"));
  assert.equal(port.queries.length, 0);
});
test("synthetic fixture has internally consistent identifiers and no real personal data", () => {
  assert.equal(fixture.importReceipt.problem_id, fixture.header.problem_id);
  assert.equal(fixture.importReceipt.revision_id, fixture.revision.revision_id);
  assert.equal(fixture.activityEvent.target_id, fixture.header.problem_id);
  assert.equal(requireHash(fixture.revision.content_hash), fixture.revision.content_hash);
  assert.deepEqual(safeSource(fixture.revision.source_json, false),
    {importJobId:null, sourceAssetId:null, originalQuestionId:"q1"});
});
test("schema is migration-only and documents strong uniqueness/foreign keys", () => {
  const sql = readFileSync(new URL("../../db/quizer/001_initial_schema.sql", import.meta.url), "utf8");
  for (const table of ["problems","problem_revisions","problem_tags","import_receipts","activity_events","quiz_revision_mirrors"])
    assert.match(sql, new RegExp("CREATE TABLE quizer\\." + table));
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON quizer.problem_revisions/);
  assert.match(sql, /PRIMARY KEY \(job_id, import_item_key\)/);
  assert.match(sql, /event_id varchar\(128\) PRIMARY KEY/);
  assert.match(sql, /REVOKE ALL ON SCHEMA quizer FROM PUBLIC/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP SCHEMA/);
});
