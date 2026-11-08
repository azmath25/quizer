import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path,root), "utf8");
const html = read("ai.html");
const ui = read("js/pages/ai-studio.js");
const styles = read("assets/css/ai-studio-native-m1.css");
const shell = read("js/components/shell.js");
const png = read("js/components/mimo-png-viewer.js");

test("M1: only Quizer shared shell supplies global site branding/account/navigation", () => {
  assert.match(html,/<header id="site-header"><\/header>/);
  assert.match(html,/<nav id="mobile-nav"/);
  assert.match(ui,/mountShell\(\{showAssistant:false,showBackdrop:false\}\)/);
  assert.match(shell,/id="desktop-nav"/);
  assert.match(html,/class="ai-chat-sidebar-primary"/);
  assert.match(html,/id="ai-new-chat"/);
  assert.doesNotMatch(html,/class="axiom-brand-link"/);
  assert.doesNotMatch(html,/Quizer <em>AI<\/em>/);
  assert.doesNotMatch(html,/Signed-in teacher \/ admin/);
  assert.match(html,/class="studio-mode-tabs" role="tablist"/);
});

test("M1: chat, old threads, PDF jobs and T1 visual artifact remain in one document", () => {
  for (const id of ["ai-chat-panel","ai-jobs-panel","ai-threads",
    "ai-chat-form","ai-prompt","ai-messages","ai-snip-math",
    "ai-job-form","ai-job-result","ai-local-source-preview",
    "ai-job-list","ai-tab-chat","ai-tab-jobs","ai-workbench-jobs",
    "ai-workbench-extract","ai-upload-consent","ai-job-budget"]) {
    assert.match(html, new RegExp('id="' + id + '"'), "missing "+id);
  }
  assert.match(ui,/teacherChatHistory\("chat.list"/);
  assert.match(ui,/teacherChatHistory\("chat.get"/);
  assert.match(ui,/sendTeacherChatMessage\(/);
  assert.match(ui,/readMimoBatchImage/);
  assert.match(ui,/makeBatchPngViewer\(/);
  assert.match(ui,/reconcileMimoBatch\(/);
  assert.match(ui,/mountLocalSourcePreview\(/);
  assert.match(ui,/snipPageContent\(/);
  assert.match(html,/assets\/css\/ai-studio-native-m1.css\?v=m1-20261108/);
  assert.match(html,/js\/pages\/ai-studio.js\?v=m1-native-20261108/);
});

test("M1: completed PNG viewer exposes download and clear failure state without AI POST", () => {
  assert.match(png,/fetchImage\(jobId, pageNumber\)/);
  assert.match(png,/download\.download = "page-" \+ pageNumber \+ "-tikz.png"/);
  assert.match(png,/Retry PNG retrieval/);
  assert.match(png,/No new AI job was started/);
  assert.match(styles,/\.ai-compiled-png img/);
  assert.match(styles,/\.ai-compiled-png a/);
  assert.doesNotMatch(png,/submitMimoBatch|submitMimoExtraction|startRun/);
});

test("M1: mobile viewport reserves shared header and bottom mobile navigation", () => {
  assert.match(styles,/@media\(max-width:760px\)/);
  assert.match(styles,/100dvh - 64px - 72px - env\(safe-area-inset-bottom\)/);
  assert.match(styles,/\.axiom-studio \.ai-native-context-label/);
  assert.match(styles,/prefers-reduced-motion:reduce/);
});

test("M1: original operational behavior and auth boundaries still intact", () => {
  const client = read("js/services/mimo-chat.js");
  const backend = read("functions/src/mimo/batch.js");
  const normalImporter = read("js/pages/quiz-editor.js");
  const tex = read("js/components/ai-chat-markdown.js");
  assert.match(client,/canUseMimoTeacherChat/);
  assert.match(client,/requestId = crypto.randomUUID\(\)/);
  assert.match(backend,/hasReconstruction/);
  assert.match(backend,/completedPageForReview/);
  assert.match(normalImporter,/sessionStorage.getItem\("mathquiz.aiImport"\)/);
  assert.match(tex,/qa-tex-source/);
  assert.match(tex,/qaOriginalTex/);
  assert.doesNotMatch(html,/Simulated jobs|Preview · no live AI/);
});
