// Touch cards use a native link rather than a click handler: a scroll
// gesture is cancelled by the browser and the title/footer remain functional.
// This is a static markup/CSS regression test, not a device-browser test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const ui = read("js/components/ui.js");
const css = read("assets/css/math.css");
const app = read("js/app.js");
const functionSource = ui.slice(
  ui.indexOf("export function quizCard("),
  ui.indexOf("\nexport function pagination(", ui.indexOf("export function quizCard(")),
);
const quizCard = new Function(
  "e", "badge", "icon", "duration", "points",
  functionSource.replace("export function quizCard", "function quizCard") +
    "\nreturn quizCard;",
)(
  value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
  value => "<span>" + value + "</span>",
  () => "<svg></svg>",
  n => n ? n + " min" : "Untimed",
  n => String(n ?? 0),
);

test("student cards have a full-front native link and keep View quiz visible", () => {
  const html = quizCard({
    quizId: "student-1", title: "Algebra", subject: "Mathematics",
    questionCount: 12, durationSeconds: 300,
  });
  assert.match(html, /class="qc-front"><a class="qc-tap-target" href="quiz.html\?id=student-1" aria-hidden="true" tabindex="-1"><\/a>/);
  assert.match(html, /<h3><a href="quiz.html\?id=student-1">Algebra<\/a><\/h3>/);
  assert.match(html, /<a class="text-link" href="quiz.html\?id=student-1">View quiz /);
  assert.doesNotMatch(html, /onclick=|ontouchstart=/);
});

test("teacher cards use Manage for all three links", () => {
  const html = quizCard({ quizId: "teacher-2", title: "Draft" }, { management: true });
  assert.match(html, /class="qc-tap-target" href="quiz-manage.html\?id=teacher-2"/);
  assert.match(html, /<h3><a href="quiz-manage.html\?id=teacher-2">Draft<\/a>/);
  assert.match(html, /<a class="text-link" href="quiz-manage.html\?id=teacher-2">Manage /);
  assert.doesNotMatch(html, /href="quiz.html\?id=teacher-2"/);
});

test("touch overlay is hidden for desktop and sits below existing controls", () => {
  assert.match(css, /\.qc-tap-target\s*\{\s*display:\s*none;/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\)\s*\{[\s\S]*?\.qc-front \.qc-tap-target\s*\{[\s\S]*?display:\s*block;[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?z-index:\s*1;/);
  assert.match(css, /\.qc-front :is\(a, button, input, select, textarea, \[role="button"\]\):not\(\.qc-tap-target\)\s*\{[\s\S]*?z-index:\s*2;/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.quiz-card:hover \.qc-inner/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\), \(prefers-reduced-motion: reduce\)\s*\{\s*\.qc-back\s*\{\s*display:\s*none/);
});

test("desktop back-face click still navigates and touch does not use synthetic click navigation", () => {
  assert.match(app, /const back = event.target.closest\("\.qc-back"\)/);
  assert.match(app, /go\(back.closest\("\.quiz-card"\).querySelector\("a\[href\]"\)/);
  assert.doesNotMatch(app, /touchend[^\n]*\.quiz-card|pointerup[^\n]*\.quiz-card/);
});
