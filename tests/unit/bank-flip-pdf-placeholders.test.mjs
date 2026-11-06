import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL("../../" + name, import.meta.url), "utf8");
const editor = read("assets/css/pages/editor.css");
const bankCss = read("assets/css/problem-card.css");
const flipCss = read("assets/css/math.css");
const bank = read("js/pages/problems.js");
const ui = read("js/components/ui.js");
const manager = read("js/pages/quiz-manage.js");

const quizSource = ui.slice(ui.indexOf("export function quizCard("),
  ui.indexOf("\nexport function pagination(", ui.indexOf("export function quizCard(")));
const renderQuiz = new Function("e", "badge", "icon", "duration", "points",
  quizSource.replace("export function quizCard", "function quizCard") + "\nreturn quizCard;"
)(
  v => String(v).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
  text => "<span>" + text + "</span>",
  () => "<svg></svg>",
  seconds => String(seconds ?? 0) + " min",
  value => String(value ?? 0),
);

test("empty bank keeps 820px maximum and selection layout remains contextual", () => {
  assert.match(editor, /body\[data-page="problems"\] \.bank-layout:not\(:has\(\.selection-panel:not\(\[hidden\]\)\)\) #bank-list\s*\{\s*max-width:\s*820px;\s*width:\s*100%;/);
  assert.match(editor, /body\[data-page="problems"\] \.bank-layout:has\(\.selection-panel:not\(\[hidden\]\)\)\s*\{\s*grid-template-columns:/);
  assert.match(bank, /panel\.hidden = values\.length === 0;/);
  assert.match(bank, /panelHome\.prepend\(panel\)/);
});

test("bank flip container and both faces share the card width", () => {
  assert.match(bankCss, /body\[data-page="problems"\] \.flip-container\s*\{\s*display:\s*block;/);
  assert.match(bankCss, /body\[data-page="problems"\] \.prob-card-box,[\s\S]*?body\[data-page="problems"\] \.flip-face\s*\{\s*width:\s*100%;/);
  assert.match(bankCss, /body\[data-page="problems"\] \.problem-wrapper,[\s\S]*?box-sizing:\s*border-box;/);
  assert.match(bankCss, /\.flip-card\.is-flipped\s*\{\s*transform:\s*rotateY\(180deg\);/);
});

test("teacher card shows disabled Download PDF after Manage and on touch", () => {
  const teacher = renderQuiz({ quizId:"quiz-123", title:"Teacher quiz" }, { management:true });
  const student = renderQuiz({ quizId:"quiz-123", title:"Student quiz" });
  const back = teacher.slice(teacher.indexOf('class="qc-face qc-back"'));
  assert.match(back, /<span class="qc-go">Manage[\s\S]*?<button class="qc-pdf-soon" type="button" disabled/);
  assert.match(teacher, /class="qc-pdf-soon qc-pdf-front" type="button" disabled/);
  assert.equal((teacher.match(/title="PDF download coming soon"/g) || []).length, 2);
  assert.doesNotMatch(student, /qc-pdf-soon|Download PDF/);
  assert.match(flipCss, /\.qc-pdf-front\s*\{\s*display:\s*none;/);
  assert.match(flipCss, /@media \(hover: none\), \(pointer: coarse\), \(prefers-reduced-motion: reduce\)\s*\{\s*\.qc-pdf-front\s*\{\s*display:\s*inline-flex;/);
});

test("management header has a placeholder, not a fake download", () => {
  assert.match(manager, /linkButton\("View quiz"[\s\S]*?<button type="button" class="button secondary" disabled title="PDF download coming soon"/);
  assert.doesNotMatch(manager, /exportPdf|downloadQuizPdf|downloadPDF|generatePDF/);
});
