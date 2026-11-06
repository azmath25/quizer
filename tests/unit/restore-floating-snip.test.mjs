import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { intersects, normalizeSnipText, MAX_SNIP_TEXT } from "../../js/components/page-snip.js";

const read=p=>readFileSync(new URL("../../"+p, import.meta.url),"utf8");
const page=read("js/components/page-snip.js");
const screenshot=read("js/components/snip.js");
const assistant=read("js/components/assistant.js");
const css=read("assets/css/assistant.css");
const shell=read("js/components/shell.js");
const provider=read("js/services/ai.js");

test("text/MathJax snip selects only overlapping visible content",()=>{
  assert.equal(intersects(
    {left:10,top:10,right:90,bottom:90},
    {left:30,top:40,right:120,bottom:80}),true);
  assert.equal(intersects(
    {left:10,top:10,right:90,bottom:90},
    {left:90,top:40,right:120,bottom:80}),false);
  assert.equal(normalizeSnipText(" A\u00a0 B\n\n\nC  "),"A B\n\nC");
  assert.equal(normalizeSnipText("x".repeat(MAX_SNIP_TEXT+100)).length,MAX_SNIP_TEXT);
  assert.match(page,/document\.createTreeWalker/);
  assert.match(page,/MathJax\?\.startup\?\.document\?\.math/);
  assert.match(page,/details:not\(\[open\]\)/);
  assert.match(page,/event\.key === "Escape"/);
  assert.doesNotMatch(page,/getDisplayMedia|showOpenFilePicker|html2canvas/);
});
test("tab pixel snip requires explicit browser capture and stops the stream",()=>{
  assert.match(screenshot,/navigator\.mediaDevices\.getDisplayMedia/);
  assert.match(screenshot,/monitorTypeSurfaces:\s*"exclude"/);
  assert.match(screenshot,/preferCurrentTab:\s*true/);
  assert.match(screenshot,/displaySurface !== "browser"/);
  assert.match(screenshot,/stream\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
});
test("restored assistant dock is draggable and has three distinct controls",()=>{
  assert.match(assistant,/class="ai-dock"/);
  assert.match(assistant,/class="ai-dock-handle"/);
  assert.match(assistant,/class="ai-fab ai-snip-fab"/);
  assert.match(assistant,/class="ai-fab ai-pixel-fab"/);
  assert.match(assistant,/data-ai="snip-page"/);
  assert.match(assistant,/data-ai="snip"/);
  assert.match(assistant,/initDockDrag\(/);
  assert.match(assistant,/mathquiz\.assistantDock/);
  assert.match(css,/\.ai-dock \.ai-fab\s*\{\s*position: static;/);
  assert.match(css,/#ai-assistant\.is-open \.ai-dock\s*\{\s*display: none;/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/\.ai-dock \.ai-pixel-fab\s*\{\s*display: none;/);
});
test("snipping prepares local composer content; it never sends implicitly",()=>{
  const selection = assistant.slice(assistant.indexOf("  const appendClip ="),
    assistant.indexOf("  root.querySelector(\".ai-snip-fab\")"));
  assert.match(selection,/await snipPageContent\(\)/);
  assert.match(selection,/title: "Add selected page material\?"/);
  assert.match(selection,/e\(clipped\)/);
  assert.match(selection,/if \(!accepted\) return;/);
  assert.match(selection,/input\.value = \[input\.value\.trim\(\), "Selected material:/);
  assert.match(selection,/pendingFiles\.push\(file\)/);
  assert.match(selection,/drawFiles\(\)/);
  assert.doesNotMatch(selection,/await send\(|api\(|fetch\(/);
});
test("no provider or student exam bypass is introduced",()=>{
  assert.match(assistant,/const allowed = !!session\?\.capabilities\?\.teach;/);
  assert.match(assistant,/if \(!allowed\)/);
  assert.match(provider,/export const AI_CONNECTED = false;/);
  assert.match(shell,/import\("\.\/assistant\.js\?v=16"\)/);
});
