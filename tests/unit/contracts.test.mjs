import test from "node:test";
import assert from "node:assert/strict";
import {
  validateProblem,
  validateSettings,
  validateMetadata,
  fields,
  id,
  fromLegacyQuestion,
} from "../../shared/schema.js";
import {
  gradeSnapshotAnswer,
  summarize,
  csvCell,
} from "../../shared/grading.js";
import { safeReturnURL } from "../../js/core/navigation.js";
import { latexHTML } from "../../js/render.js";
const content = {
  type: "open",
  answerMode: "auto",
  statementLatex: "Compute $3/2$.",
  options: [],
  defaultPoints: 3,
  questionAssetBindings: {},
};
const key = {
  correctOptionId: null,
  acceptedAnswers: ["3/2"],
  tolerance: 0.000001,
  explanationLatex: "",
  rubricLatex: "",
  solutionAssetBindings: {},
};
test("Strict v2 contracts reject spoofed fields, invalid enums, keys and limits", () => {
  assert.throws(() => validateProblem({ ...content, ownerId: "another" }, key));
  assert.throws(() =>
    validateProblem({ ...content, statementLatex: "x".repeat(30001) }, key),
  );
  assert.throws(() =>
    validateProblem({ ...content, statementLatex: "\\input{private}" }, key),
  );
  assert.throws(() =>
    validateProblem(
      { ...content, statementLatex: "\\includegraphics{missing.png}" },
      key,
    ),
  );
  assert.throws(() =>
    validateProblem(content, { ...key, acceptedAnswers: [] }),
  );
  assert.throws(() => validateSettings({ durationSeconds: 86401 }));
  assert.throws(
    () =>
      validateProblem(
        { ...content, questionAssetBindings: { "diagram.png": "asset_one" } },
        { ...key, solutionAssetBindings: { "diagram.png": "asset_two" } },
      ),
    /different filenames/,
  );
  assert.doesNotThrow(() =>
    validateProblem(
      { ...content, questionAssetBindings: { "diagram.png": "asset_one" } },
      { ...key, solutionAssetBindings: { "diagram.png": "asset_one" } },
    ),
  );
  assert.throws(() => id("__proto__"));
  assert.throws(() => id("../private"));
  assert.throws(() => validateMetadata({ title: "Valid", role: "admin" }));
  assert.throws(() =>
    validateProblem(
      {
        ...content,
        type: "choice",
        options: [
          { id: "a", textLatex: "A" },
          { id: "a", textLatex: "B" },
        ],
      },
      { ...key, correctOptionId: "a" },
    ),
  );
});
test("Server grading adapter preserves fractions, manual penalties and negative score clamp", () => {
  const item = { ...content, itemId: "itm_1", points: 3 };
  assert.equal(gradeSnapshotAnswer(item, key, "1.5").status, "correct");
  assert.equal(gradeSnapshotAnswer(item, key, "8", null, 1).awarded, -1);
  assert.equal(
    gradeSnapshotAnswer(
      { ...item, answerMode: "manual" },
      key,
      "proof",
      null,
      1,
    ).status,
    "pending",
  );
  assert.equal(
    gradeSnapshotAnswer({ ...item, answerMode: "manual" }, key, "proof", 0, 1)
      .awarded,
    -1,
  );
  const total = summarize([gradeSnapshotAnswer(item, key, "8", null, 1)]);
  assert.equal(total.score, -1);
  assert.equal(total.percentage, 0);
});
test("Navigation contains return destinations within root and project Pages base", () => {
  for (const base of [
    "https://example.github.io/login.html",
    "https://example.github.io/sat-quiz/login.html",
  ]) {
    const expected = new URL("profile.html", base).href;
    for (const bad of [
      "javascript:alert(1)",
      "//evil.example",
      "https://evil.example",
      "../sibling/index.html",
      "js/firebase-config.js",
      "login.html",
      "profile.html/extra",
      "%2e%2e/other.html",
    ])
      assert.equal(safeReturnURL(bad, base), expected);
    assert.equal(
      safeReturnURL("quiz.html?id=cloud-one", base),
      new URL("quiz.html?id=cloud-one", base).href,
    );
  }
});
test("Content rendering escapes HTML, strips dangerous math commands and keeps diagrams", () => {
  const html = latexHTML(
    "<img src=x onerror=alert(1)> $\\href{javascript:evil}{x}$ \\includegraphics{image.png}",
    { "image.png": "https://storage.example/image" },
  );
  assert(!html.includes("<img src=x"));
  assert(!html.includes("\\href"));
  assert(html.includes('referrerpolicy="no-referrer"'));
  assert(html.includes('src="https://storage.example/image"'));
});
test("CSV cells cannot execute spreadsheet formulas; quotes and newlines survive", () => {
  for (const value of ["=SUM(A1:A2)", " +1", "@evil", "-cmd"])
    assert(csvCell(value).startsWith("\"'"));
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell("one\ntwo"), '"one\ntwo"');
});
test("Legacy diagram aliases resolve basenames and omitted extensions without losing math", () => {
  const value = fromLegacyQuestion(
    {
      id: "q1",
      type: "open",
      answerMode: "auto",
      prompt: "\\includegraphics{folder/triangle} $x^2$",
      points: 3,
      options: [],
      answers: ["4"],
      explanation: "",
      tolerance: 0,
    },
    { "triangle.png": "ast_valid" },
  );
  assert.equal(
    value.content.questionAssetBindings["folder/triangle"],
    "ast_valid",
  );
  validateProblem(value.content, value.grading);
});
