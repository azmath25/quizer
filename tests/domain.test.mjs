import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseLatex, readGroup, stripComments } from "../js/parser.js";
import {
  validateQuiz,
  numericValue,
  gradeQuestion,
  gradeAttempt,
  makeAttempt,
  remainingSeconds,
  totalPoints,
  imageReferences,
  resolveAsset,
} from "../js/core.js";
import { latexHTML } from "../js/render.js";
const starter = await readFile(
  new URL("../examples/starter.tex", import.meta.url),
  "utf8",
);
const sample = () => parseLatex(starter).quiz;
test("imports eight problems, metadata, nested math, choices, answers, and explanations", () => {
  const { quiz, warnings } = parseLatex(starter);
  assert.equal(quiz.questions.length, 8);
  assert.equal(totalPoints(quiz), 20);
  assert.equal(quiz.title, "Mixed mathematics");
  assert.equal(quiz.questions[0].answer, "o2");
  assert.equal(quiz.questions[7].answers[1], "\\frac{1}{6}");
  assert.ok(quiz.questions[2].explanation.includes("36-16=20"));
  assert.equal(warnings.length, 0);
});
test("reads nested groups and escaped braces", () => {
  assert.equal(readGroup(" {a{b}\\{c}", 0).value, "a{b}\\{c");
  assert.equal(readGroup("{unclosed", 0), null);
});
test("comments preserve escaped percent signs", () => {
  assert.equal(stripComments("a\\%b % c\nx"), "a\\%b \nx");
});
test("supports exam-class question syntax and manual proof fallback", async () => {
  const source = await readFile(
    new URL("../examples/exam-format.tex", import.meta.url),
    "utf8",
  );
  const { quiz, warnings } = parseLatex(source);
  assert.equal(quiz.questions.length, 3);
  assert.equal(quiz.questions[0].answer, "o2");
  assert.equal(quiz.questions[1].answers[0], "sqrt(2)");
  assert.equal(quiz.questions[2].answerMode, "manual");
  assert.equal(warnings.length, 1);
});
test("top-level enumerate does not split nested lists into questions", () => {
  const q = parseLatex(
    String.raw`\begin{enumerate}\item Compute $2+2$.\begin{enumerate}\item Think.\item Add.\end{enumerate}\answer{4}\item Compute $3+3$.\answer{6}\end{enumerate}`,
  ).quiz;
  assert.equal(q.questions.length, 2);
  assert.equal(q.questions[0].answers[0], "4");
});
test("rejects missing choice keys, duplicate correct choices, and unmatched environments", () => {
  assert.throws(
    () =>
      parseLatex(
        String.raw`\begin{problem}Q\begin{choices}\choice A\choice B\end{choices}\end{problem}`,
      ),
    /correctchoice/,
  );
  assert.throws(
    () =>
      parseLatex(
        String.raw`\begin{problem}Q\begin{choices}\correctchoice A\correctchoice B\end{choices}\end{problem}`,
      ),
    /one correct/,
  );
  assert.throws(() => parseLatex(String.raw`\begin{problem}Q`), /not closed/);
});
test("choice answer letters and explicit point commands are understood", () => {
  const q = parseLatex(
    String.raw`\begin{problem}\points{2.5}Q\begin{choices}\choice One\choice Two\end{choices}\answer{B}\end{problem}`,
  ).quiz.questions[0];
  assert.equal(q.answer, "o2");
  assert.equal(q.points, 2.5);
});
test("numeric parser handles arithmetic, roots, LaTeX fractions, pi, and scientific notation", () => {
  for (const [input, want] of [
    ["1/6", 1 / 6],
    [String.raw`\frac{1}{\frac{2}{3}}`, 1.5],
    ["-2^2", -4],
    ["2^-2", 0.25],
    ["2^3^2", 512],
    ["sqrt(2)^2", 2],
    [String.raw`\sqrt{\frac{9}{4}}`, 1.5],
    ["2pi", 2 * Math.PI],
    ["(1+1)(2+2)", 8],
    ["1e-3", 0.001],
    ["abs(-4)", 4],
  ])
    assert.ok(Math.abs(numericValue(input) - want) < 1e-10, input);
});
test("arithmetic rejects JavaScript, infinity, invalid terms, and excessive nesting", () => {
  for (const input of [
    "alert(1)",
    "globalThis.process",
    "1/0",
    "sqrt(-1)",
    "2abc",
    "12junk",
    "1..2",
    "(".repeat(100) + "1" + ")".repeat(100),
  ])
    assert.equal(numericValue(input), null, input);
});
test("open answer scoring respects equivalent fractions and numeric tolerance", () => {
  const q = sample().questions[7];
  assert.equal(gradeQuestion(q, "2/12").status, "correct");
  assert.equal(gradeQuestion(q, "0.166667").status, "correct");
  assert.equal(gradeQuestion(q, "0.17").status, "incorrect");
  assert.equal(gradeQuestion(q, "").status, "skipped");
  const exact = { ...q, answers: ["12"], tolerance: 0 };
  assert.equal(gradeQuestion(exact, "1{2}").status, "incorrect");
  assert.equal(gradeQuestion(exact, "24/2").status, "correct");
});
test("accepted text answers ignore surrounding math delimiters, case, and spaces", () => {
  const q = { ...sample().questions[1], answers: ["No", "Impossible"] };
  assert.equal(gradeQuestion(q, " $ NO $ ").status, "correct");
  assert.equal(gradeQuestion(q, "yes").status, "incorrect");
});
test("manual answers stay pending until scored, then support partial credit", () => {
  const q = { ...sample().questions[1], answerMode: "manual", points: 5 };
  assert.equal(gradeQuestion(q, "proof").status, "pending");
  assert.equal(gradeQuestion(q, "proof", 2.5).status, "partial");
  assert.equal(gradeQuestion(q, "proof", 5).status, "correct");
  assert.equal(gradeQuestion(q, "proof", 0).status, "incorrect");
  assert.equal(gradeQuestion(q, "").status, "skipped");
});
test("summary counts correct, wrong, unanswered and applies only wrong-answer penalties", () => {
  const quiz = sample();
  quiz.settings.penalty = 0.5;
  const result = gradeAttempt(quiz, {
    answers: { q1: "o2", q2: "3", q3: "o1" },
    manualScores: {},
  });
  assert.equal(result.correct, 2);
  assert.equal(result.incorrect, 1);
  assert.equal(result.skipped, 5);
  assert.equal(result.score, 4.5);
});
test("deadline survives serialization and wall-clock changes while hidden", () => {
  const a = makeAttempt(sample(), { durationMinutes: 2 }, 1000);
  assert.equal(remainingSeconds(a, 1000), 120);
  assert.equal(remainingSeconds(JSON.parse(JSON.stringify(a)), 91000), 30);
  assert.equal(remainingSeconds(a, 999999), 0);
  assert.equal(
    remainingSeconds(
      makeAttempt(sample(), { durationMinutes: 0 }, 1000),
      999999,
    ),
    null,
  );
});
test("shuffle retains answer IDs and every question exactly once", () => {
  const q = sample();
  q.settings.shuffleQuestions = true;
  q.settings.shuffleOptions = true;
  const a = makeAttempt(q, {}, 0, () => 0.1);
  assert.equal(new Set(a.order).size, 8);
  assert.notDeepEqual(
    a.order,
    q.questions.map((q) => q.id),
  );
  assert.deepEqual(
    new Set(a.optionOrder.q1),
    new Set(q.questions[0].options.map((o) => o.id)),
  );
  assert.equal(q.questions[0].answer, "o2");
});
test("validation rejects unknown schemas, duplicate IDs, missing keys, and strips unsafe assets", () => {
  assert.throws(() => validateQuiz({ schemaVersion: 2 }), /version/);
  const q = sample();
  q.questions[1].id = q.questions[0].id;
  assert.throws(() => validateQuiz(q), /duplicate/);
  const clean = sample();
  clean.assets = {
    evil: "javascript:alert(1)",
    svg: "data:image/svg+xml,<svg/>",
  };
  assert.deepEqual(validateQuiz(clean).assets, {});
});
test("image references are found in prompts, options, and explanations and resolve by basename", () => {
  const q = sample();
  assert.deepEqual(imageReferences(q), ["triangle.png"]);
  assert.equal(
    resolveAsset({ "triangle.png": "data" }, "figures/triangle.png"),
    "data",
  );
  assert.equal(resolveAsset({ "triangle.png": "data" }, "triangle"), "data");
});
test("quiz JSON round trip keeps scores, settings, and math intact", () => {
  const q = sample();
  assert.deepEqual(validateQuiz(JSON.parse(JSON.stringify(q))), q);
});
test("JSON validation rejects invalid scores, timing, and inherited object-property IDs", () => {
  for (const value of [-1, 0, Infinity, "oops"]) {
    const q = sample();
    q.questions[0].points = value;
    assert.throws(() => validateQuiz(q), /points/);
  }
  const q = sample();
  q.questions[0].id = "constructor";
  assert.throws(() => validateQuiz(q), /ID/);
  const time = sample();
  time.durationMinutes = -5;
  assert.throws(() => validateQuiz(time), /Time limit/);
});
test("rendering escapes raw HTML, preserves math, and bounds nested formatting", () => {
  const html = latexHTML("<img src=x onerror=alert(1)> $x^2$");
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("$x^2$"));
  assert.ok(!html.includes("<img "));
  assert.ok(
    latexHTML(String.raw`\textbf{Outer \emph{inner}}`).includes(
      "<strong>Outer <em>inner</em></strong>",
    ),
  );
  assert.doesNotThrow(() =>
    latexHTML("\\textbf{".repeat(500) + "x" + "}".repeat(500)),
  );
});
test("bundled quiz files contain valid keys and every referenced image", async () => {
  const catalog = JSON.parse(
    await readFile(new URL("./fixtures/quizzes/index.json", import.meta.url), "utf8"),
  );
  for (const item of catalog.quizzes) {
    const q = validateQuiz(
      JSON.parse(
        await readFile(
          new URL(`./fixtures/quizzes/${item.file}`, import.meta.url),
          "utf8",
        ),
      ),
    );
    assert.equal(q.id, item.id);
    assert.equal(q.questions.length, item.questionCount);
    assert.equal(totalPoints(q), item.points);
    for (const name of imageReferences(q))
      assert.ok(resolveAsset(q.assets, name));
  }
});
