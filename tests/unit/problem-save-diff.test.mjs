import test from "node:test";
import assert from "node:assert/strict";
import { problemSavePayload } from "../../js/components/problem-save-diff.js";

const sample = () => ({
  metadata: { title: "Original", subject: "Math", difficulty: "Practice", tags: ["linear"], bankVisibility: "private" },
  content: { type: "open", answerMode: "auto", statementLatex: "Compute $1+1$.",
    options: [], defaultPoints: 1, questionAssetBindings: { "figure.png": "ast_1" } },
  grading: { correctOptionId: null, acceptedAnswers: ["2"], tolerance: 0,
    explanationLatex: "", rubricLatex: "", solutionAssetBindings: {} },
});

test("metadata-only change sends no content, grading, or image payload", () => {
  const before = sample();
  const edited = structuredClone(before);
  edited.metadata.title = "Renamed";
  const data = problemSavePayload(edited, before, true);
  assert.deepEqual(data, { metadata: edited.metadata });
  assert(!("content" in data));
  assert(!("grading" in data));
  assert(Buffer.byteLength(JSON.stringify(data)) < Buffer.byteLength(JSON.stringify(edited)));
});

test("unchanged save sends only metadata for server-side no-op", () => {
  const before = sample();
  assert.deepEqual(problemSavePayload(structuredClone(before), before), { metadata: before.metadata });
});
test("new unsaved problem sends all fields even when baseline exists", () => {
  const before = sample();
  assert.deepEqual(problemSavePayload(before, before, false), before);
});
test("no baseline sends all fields", () => {
  const before = sample();
  assert.deepEqual(problemSavePayload(before, null), before);
});
test("statement or points changes send full validated revision", () => {
  for (const key of ["statementLatex", "defaultPoints"]) {
    const before = sample(), edited = structuredClone(before);
    edited.content[key] = key === "statementLatex" ? "Compute $7+9$." : 5;
    assert.deepEqual(problemSavePayload(edited, before), edited);
  }
});
test("answer/solution changes send the full revision", () => {
  for (const key of ["acceptedAnswers", "explanationLatex"]) {
    const before = sample(), edited = structuredClone(before);
    edited.grading[key] = key === "acceptedAnswers" ? ["3"] : "Changed solution";
    assert.deepEqual(problemSavePayload(edited, before), edited);
  }
});
test("image binding changes send full revision to retain asset reference", () => {
  const before = sample(), edited = structuredClone(before);
  edited.content.questionAssetBindings["second.png"] = "ast_2";
  assert.deepEqual(problemSavePayload(edited, before), edited);
});
test("metadata tag and visibility changes do not create a content payload", () => {
  const before = sample(), edited = structuredClone(before);
  edited.metadata.tags = ["linear", "advanced"];
  edited.metadata.bankVisibility = "teachers";
  assert.deepEqual(problemSavePayload(edited, before), { metadata: edited.metadata });
});
test("deep-cloned baseline catches in-place choice edits", () => {
  const before = sample();
  before.content.type = "choice";
  before.content.options = [{ id: "choice_a", textLatex: "A" }, { id: "choice_b", textLatex: "B" }];
  before.grading.correctOptionId = "choice_b";
  const baseline = structuredClone(before);
  before.content.options[1].textLatex = "Updated B";
  assert.deepEqual(problemSavePayload(before, baseline), before);
});
