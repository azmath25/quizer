import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { changedQuizSlots, buildFinalQuizSaveRequest } from "../../js/pages/quiz-save-diff.js";

const draft = {
  title: "Original quiz", description: "Description", subject: "Math", difficulty: "Olympiad",
  settings: { durationSeconds: 3600, penalty: 0, shuffleQuestions: false,
    shuffleOptions: true, allowBack: false, scoreRelease: "manual", solutionRelease: "never" },
};
const items = (n) => Array.from({ length: n }, (_, i) => ({
  itemId: "itm_" + i, problemId: "prb_" + i, problemRevisionId: "prv_" + i, points: 1,
}));
const request = (n, current = draft, order = items(n).map((x) => x.itemId)) =>
  buildFinalQuizSaveRequest({ quizId: "quiz_1", expectedDraftVersion: 5,
    current, draft, order, currentOrder: items(n).map((x) => x.itemId) });

for (const n of [100, 500]) {
  test(n + "-question unchanged save has no request or changed items", () => {
    const slots = items(n);
    assert.equal(request(n), null);
    assert.deepEqual(changedQuizSlots(slots, slots, slots.map(x => x.itemId)), []);
  });
  test(n + "-question rename sends only the new title, no item list", () => {
    const r = request(n, { ...draft, title: "New title" });
    assert.deepEqual(r, { quizId: "quiz_1", expectedDraftVersion: 5, patch: { title: "New title" } });
    assert.ok(Buffer.byteLength(JSON.stringify(r)) < 180);
    assert.equal(JSON.stringify(r).includes("itemOrder"), false);
    assert.equal(JSON.stringify(r).includes("upsertItems"), false);
  });
  test(n + "-question settings change sends only the changed setting", () => {
    const r = request(n, { ...draft, settings: { ...draft.settings, durationSeconds: 1800 } });
    assert.deepEqual(r.patch, { settings: { durationSeconds: 1800 } });
    assert.equal(r.itemOrder, undefined);
  });
}
test("one points edit selects one existing slot without touching unrelated questions", () => {
  const saved = items(500), modified = saved.map((x) => ({ ...x }));
  modified[317].points = 4;
  const changed = changedQuizSlots(modified, saved, saved.map((x) => x.itemId));
  assert.deepEqual(changed, [modified[317]]);
  assert.equal(request(500), null);
});
test("one revision edit selects one slot; removing a slot does not upsert it", () => {
  const saved = items(100), modified = saved.map((x) => ({ ...x }));
  modified[45].problemRevisionId = "prv_new";
  const order = saved.map((x) => x.itemId);
  assert.deepEqual(changedQuizSlots(modified, saved, order), [modified[45]]);
  assert.deepEqual(changedQuizSlots(modified, saved, order.filter((id) => id !== "itm_45")), []);
});
test("order-only edits transmit only the changed order", () => {
  const order = items(100).map((x) => x.itemId);
  [order[0], order[1]] = [order[1], order[0]];
  const r = request(100, draft, order);
  assert.ok(Array.isArray(r.itemOrder));
  assert.equal(r.patch, undefined);
});
test("editor save handler remains separate from TeX imports and publish", {
  skip: !existsSync(new URL("../../js/pages/quiz-editor.js", import.meta.url)),
}, () => {
  const editor = readFileSync(new URL("../../js/pages/quiz-editor.js", import.meta.url), "utf8");
  const save = editor.split("  async function save() {")[1]?.split("  async function previewPage(")[0];
  assert.ok(save, "editor save handler exists");
  assert.match(save, /buildFinalQuizSaveRequest/);
  assert.match(save, /changedQuizSlots/);
  assert.doesNotMatch(save, /importProblemBatch|createImportJob|finishImportJob|uploadAsset|publishQuiz|parseLatex/);
});
