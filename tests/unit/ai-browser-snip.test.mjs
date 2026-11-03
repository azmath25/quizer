import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { intersects, normalizeSnipText, MAX_SNIP_TEXT } from "../../js/components/page-snip.js";

const read = path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const pageSnip=read("js/components/page-snip.js");
const pixel=read("js/components/snip.js");
const assistant=read("js/components/assistant.js");
const aiPage=read("js/pages/ai.js");
const quiz=read("js/pages/quiz.js");
const detail=read("js/pages/problem-edit.js");
const bank=read("js/pages/problems.js");
const chats=read("js/services/chats.js");

test("AI clip geometry does not treat touching edges as overlap",()=>{
  const a={left:10,top:10,right:100,bottom:80};
  assert.equal(intersects(a,{left:40,top:20,right:120,bottom:50}),true);
  assert.equal(intersects(a,{left:100,top:20,right:120,bottom:50}),false);
  assert.equal(intersects(a,{left:10,top:80,right:20,bottom:100}),false);
  assert.equal(intersects(null,a),false);
});
test("AI clip normalizes text and has a strict content length ceiling",()=>{
  assert.equal(normalizeSnipText("  A\u00a0 B   C\n\n\nD  "),"A B C\n\nD");
  assert.equal(normalizeSnipText("z".repeat(MAX_SNIP_TEXT+300)).length,MAX_SNIP_TEXT);
});
test("AI content snip is in-browser DOM-only, no OS picker or screen sharing",()=>{
  assert.match(pageSnip,/document\.createTreeWalker/);
  assert.match(pageSnip,/document\.createRange/);
  assert.match(pageSnip,/MathJax\?\.startup\?\.document\?\.math/);
  assert.match(pageSnip,/pointerdown/);
  assert.match(pageSnip,/pointercancel/);
  assert.match(pageSnip,/event\.key === "Escape"/);
  assert.doesNotMatch(pageSnip,/getDisplayMedia|showOpenFilePicker|<input type="file"|navigator\.clipboard|html2canvas/);
});
test("visual snip only permits browser-tab capture, not entire desktop or OS image picker",()=>{
  assert.match(pixel,/navigator\.mediaDevices\.getDisplayMedia/);
  assert.match(pixel,/preferCurrentTab:\s*true/);
  assert.match(pixel,/monitorTypeSurfaces:\s*"exclude"/);
  assert.match(pixel,/track\.getSettings\(\)\.displaySurface !== "browser"/);
  assert.doesNotMatch(pixel,/pickImage|input\.type = "file"/);
});
test("both assistant surfaces offer separate content snip and visual snip",()=>{
  assert.match(assistant,/data-ai="snip-page"/);
  assert.match(assistant,/data-ai="snip"/);
  assert.match(aiPage,/data-snip-page/);
  assert.match(aiPage,/data-snip title=/);
  assert.match(assistant,/snipPageContent\(\)/);
  assert.match(aiPage,/snipPageContent\(\)/);
});
test("permission-free clip previews exact escaped text before optional send",()=>{
  assert.match(assistant,/title: "Send selected page content to AI\?"/);
  assert.match(assistant,/ai-clip-preview/);
  assert.match(assistant,/\$\{e\(text\)\}/);
  assert.match(aiPage,/\$\{e\(clipped\)\}/);
  assert.match(assistant,/if \(!approved\) return/);
});
test("Ask AI on quiz overview only for teacher who may manage the quiz",()=>{
  assert.match(quiz,/if \(q\.canManage && session\.capabilities\?\.teach\)/);
  assert.match(quiz,/button\.textContent = "Ask AI"/);
  assert.match(chats,/Do not assume access to hidden questions or answer keys/);
  assert.doesNotMatch(chats,/quiz\.grading|quiz\.attempts|quiz\.answerKey/);
});
test("teacher-only Ask AI at problem bank, detail and visible quiz item",()=>{
  assert.match(quiz,/getSession\(\)\.capabilities\?\.teach \?/);
  assert.match(quiz,/>Ask AI<\/span>/);
  assert.match(bank,/Ask AI about this problem/);
  assert.match(detail,/session\.capabilities\?\.teach/);
  assert.match(detail,/askButton\.textContent = "Ask AI"/);
});
test("AI provider remains a preview, not an implemented solver",()=>{
  const provider=read("js/services/ai.js");
  assert.match(provider,/export const AI_CONNECTED = false/);
});
