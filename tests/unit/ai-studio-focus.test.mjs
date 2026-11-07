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

test("saved-chat retries signal progress and do not duplicate concurrent requests",()=>{
  assert.match(client,/if\(historyLoading\)return false/);
  assert.match(client,/Checking saved conversations/);
  assert.match(client,/Still unavailable/);
  assert.match(client,/Attempt /);
  assert.match(client,/retry\.disabled=true/);
});
