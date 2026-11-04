import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const bank=read("js/pages/problems.js");
const editor=read("assets/css/pages/editor.css");
const shell=read("js/components/shell.js");
const profile=read("js/pages/profile.js");
const ai=read("ai.html");
const build=read("scripts/build.mjs");

test("bank and inspector are the only direct grid children",()=>{
  assert.match(bank,/<div class="bank-layout"><div class="bank-main"><div class="grid" id="bank-list"><\/div><\/div><aside class="selection-panel" id="selection-panel"/);
  assert.match(bank,/list\.after\(pager\)/);
  assert.match(editor,/body\[data-page="problems"\] \.bank-layout:has\(\.selection-panel:not\(\[hidden\]\)\) > \.selection-panel\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;/s);
  assert.match(editor,/body\[data-page="problems"\] #bank-list\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
});

test("compact bank still places selected inspector above problem list",()=>{
  assert.match(editor,/body\[data-page="problems"\] \.bank-layout > \.bank-main\s*\{[^}]*grid-area:\s*bank;/s);
  assert.match(bank,/panelHome\.prepend\(panel\)/);
  assert.match(editor,/grid-template-areas:\s*"selection" "bank"/);
});

test("AI Studio prototype is published and discoverable to teachers and admins",()=>{
  assert.match(build,/n\.endsWith\("\.html"\)/);
  assert.match(ai,/AI Studio/);
  assert.match(shell,/\["ai", "ai\.html", "AI Studio"\]/);
  assert.match(shell,/key !== "ai" \|\| s\.capabilities\.teach \|\| s\.capabilities\.admin/);
  assert.match(profile,/linkButton\("AI Studio \(preview\)", "ai\.html"/);
});
