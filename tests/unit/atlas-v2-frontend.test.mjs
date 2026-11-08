import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8");
const htmlPages = [
  "index", "quizzes", "login", "profile", "activity", "teaching",
  "quiz-manage", "problems", "problem-edit", "upload", "quiz",
  "results", "access", "admin", "guide", "settings", "documents", "ai",
];

test("Atlas v2 is linked in all public entrypoints, once and before body", () => {
  for (const name of htmlPages) {
    const html = read(name + ".html");
    const ref = 'assets/css/atlas-v2.css?v=atlas-20261108';
    assert.equal(html.split(ref).length - 1, 1, name + " missing/duplicate CSS");
    assert.ok(html.indexOf(ref) < html.indexOf("</head>"), name);
    if (name === "ai") assert.match(html, /ai-studio-atlas-v2\.css\?v=atlas-20261108/);
  }
});

test("Atlas typography, light/dark tokens, accessible focus and responsive layout", () => {
  const tokens = read("assets/css/tokens.css");
  const global = read("assets/css/atlas-v2.css");
  const studio = read("assets/css/ai-studio-atlas-v2.css");
  assert.match(tokens, /--brand: #335bc8/);
  assert.match(tokens, /--font-sans: "Plus Jakarta Sans"/);
  assert.match(tokens, /:root\[data-theme="dark"\]/);
  assert.match(tokens, /:root\[data-theme="system"\]/);
  assert.match(global, /:focus-visible/);
  assert.match(global, /prefers-reduced-motion:reduce/);
  assert.match(global, /@media\(max-width:760px\)/);
  assert.match(studio, /--studio-nav:/);
  assert.match(studio, /\.studio-jobs-content\.axiom-docs/);
  assert.match(studio, /\.conversation\.axiom-thread/);
  assert.match(studio, /\.composer-area\.axiom-composer-area/);
  assert.match(studio, /\.message\.user \.msg-body/);
  // Simple regression gate: no unbalanced CSS blocks when editing adapters.
  for (const css of [global, studio]) {
    assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
  }
});

test("Home has new working dashboard layout but no new API calls", () => {
  const home = read("js/pages/home.js");
  assert.match(home, /apiSWR\("getDashboard"/);
  assert.equal((home.match(/apiSWR\(/g) || []).length, 1);
  assert.doesNotMatch(home, /fetch\(|firebase\.functions|localStorage/);
  for (const cls of ["home-hero", "home-metrics", "home-content", "home-rail",
    "home-action-list", "home-feed", "home-continue"]) {
    assert.ok(home.includes(cls), "Missing dashboard " + cls);
  }
  assert.match(home, /session\.capabilities\.teach/);
  assert.match(home, /quizCard\(q, \{management: teacher\}\)/);
  assert.match(home, /Continue unfinished quizzes/);
  assert.match(home, /Verify your email address/);
});

test("Mobile navigation exposes AI Studio and Teaching without bypassing roles", () => {
  const shell = read("js/components/shell.js");
  assert.match(shell, /s\.capabilities\.teach \|\| s\.capabilities\.admin/);
  assert.match(shell, /\["teach", "teaching\.html", "Teaching"\]/);
  assert.match(shell, /\["ai", "ai\.html", "AI Studio"\]/);
  assert.match(shell, /\["profile", "profile\.html", "Profile"\]/);
  assert.match(shell, /--mobile-items/);
  assert.match(shell, /watchSession\(draw\)/);
  assert.match(shell, /applyAppearance\(/);
});

test("AI Studio retains live history, math snip, T1 figure and PDF jobs", () => {
  const ui = read("js/pages/ai-studio.js");
  const page = read("ai.html");
  const viewer = read("js/components/mimo-png-viewer.js");
  for (const id of ["ai-chat-panel", "ai-jobs-panel", "ai-job-form",
    "ai-threads", "ai-chat-form", "ai-prompt", "ai-job-result",
    "ai-job-list", "ai-snip-math"]) {
    assert.ok(page.includes('id="' + id + '"'), "Missing UI " + id);
  }
  assert.match(ui, /teacherChatHistory\("chat\.list"/);
  assert.match(ui, /sendTeacherChatMessage\(/);
  assert.match(ui, /readMimoBatchImage/);
  assert.match(ui, /snipPageContent\(/);
  assert.match(ui, /submitMimoBatch\(/);
  assert.match(ui, /mountShell\(\{showAssistant:false,showBackdrop:false\}\)/);
  assert.match(viewer, /Retry PNG retrieval/);
  assert.doesNotMatch(ui, /localStorage\.setItem\(STORE/);
});

test("Quiz runner, problem bank and editor keep operational selector contracts", () => {
  const css = read("assets/css/atlas-v2.css");
  for (const name of [".runner-layout", ".runner-question", ".choice:has(input:checked)",
    ".runner-sidebar", ".bank-layout", ".selection-panel", ".editor-grid",
    ".editor-preview"]) assert.ok(css.includes(name), "Missing "+name);
  const quiz = read("js/pages/quiz.js");
  assert.match(quiz, /runner-question/);
  assert.match(quiz, /runner-sidebar-timer/);
  const bank = read("js/pages/problems.js");
  assert.match(bank, /bank-layout/);
  assert.match(bank, /selection-panel/);
  const editor = read("js/pages/quiz-editor.js");
  assert.match(editor, /editor-preview/);
  assert.match(editor, /mathquiz\.aiImport/);
});
