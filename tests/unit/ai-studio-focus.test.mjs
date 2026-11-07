import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
const page=read("ai.html"),client=read("js/pages/ai-studio.js");
const shell=read("js/components/shell.js"),home=read("js/pages/home.js");

test("AI Studio is a real module, not the old simulated localStorage demo",()=>{
  assert.match(page,/src="js\/pages\/ai-studio\.js"/);
  assert.match(client,/sendTeacherChatMessage/);
  assert.match(client,/teacherChatHistory\("chat\.list"/);
  assert.match(client,/listMimoExtractions\(/);
  assert.match(client,/readMimoExtraction\(/);
  assert.match(client,/importApprovedExtraction\(/);
  assert.doesNotMatch(page,/Preview · no live AI|Synthetic artifact|Browser demo|Simulated jobs/);
  assert.doesNotMatch(client,/setInterval\(advance|localStorage\.setItem\(STORE/);
});

test("teacher-only shell, shared navigation and appearance remain intact",()=>{
  assert.match(shell,/\["ai", "ai\.html", "AI Studio"\]/);
  assert.match(home,/href="ai\.html"/);
  assert.match(page,/<header id="site-header"/);
  assert.match(page,/<nav id="mobile-nav"/);
  assert.match(client,/mountShell\(\{showAssistant:false,showBackdrop:false\}\)/);
  assert.match(client,/mountShell\(\{showAssistant:false,showBackdrop:false\}\)/);
  assert.match(client,/mimoHistoryErrorMessage\(error\)/);
  assert.match(page,/id="ai-access-gate" role="status" hidden/);
  assert.doesNotMatch(page,/class="quizer-site-menu"|data-act="theme"/);
  assert.match(shell,/showAssistant = true, showBackdrop = true/);
});

test("separate accessible assistant and background jobs with explicit user consent",()=>{
  assert.match(page,/id="ai-chat-panel"/);
  assert.match(page,/id="ai-jobs-panel"/);
  assert.match(page,/aria-selected="true"/);
  assert.match(page,/aria-label="Saved jobs and progress"/);
  assert.match(page,/id="ai-upload-consent" type="checkbox" required/);
  assert.match(page,/id="ai-chat-photo" type="file"/);
  assert.match(page,/id="ai-job-budget"/);
  assert.match(client,/verifySource/);
  assert.match(client,/exportTeacherReview\(/);
  assert.match(client,/teacher-approved|teacher-reviewed|approved questions/i);
});

test("P1 Axiom-inspired single-page layout retains real services",()=>{
  const css=read("assets/css/ai-studio-axiom-p1.css");
  assert.match(page,/class="shell axiom-shell" id="shell"/);
  assert.match(page,/class="sidebar axiom-sidebar"/);
  assert.match(page,/class="axiom-center"/);
  assert.match(page,/class="inspector axiom-workbench"/);
  assert.match(page,/class="stage axiom-stage" id="workspace"/);
  assert.match(page,/id="ai-command-dialog"/);
  assert.match(page,/id="ai-workbench-extract"/);
  assert.match(page,/id="ai-workbench-jobs"/);
  assert.match(page,/id="ai-job-form"/);
  assert.match(page,/id="ai-messages"/);
  assert.match(page,/assets\/css\/ai-studio-axiom-p1\.css/);
  assert.match(css,/270px minmax\(0,1fr\)/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(client,/function openCommands\(/);
  assert.match(client,/STUDIO_COMMANDS/);
  assert.match(client,/submitMimoBatch\(/);
  assert.match(client,/readMimoBatchPage\(/);
  assert.match(client,/readMimoPng\(/);
  assert.doesNotMatch(page,/Local design mode|DEMO|Simulated job/);
});

test("selected job detail refresh corrects stale inspector list state",()=>{
  assert.match(client,/const job=await readMimoBatch\(id\)/);
  assert.match(client,/state:job\.state/);
  assert.match(client,/state:result\.state/);
  assert.match(client,/drawJobs\(\)/);
});
