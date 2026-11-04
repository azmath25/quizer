import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
const root=new URL("../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
const ai=read("ai.html");
const shell=read("js/components/shell.js");
const home=read("js/pages/home.js");
const profile=read("js/pages/profile.js");

test("AI Studio's standalone inline script parses and keeps its existing actions",()=>{
  const scripts=[...ai.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m=>m[1]).filter(s=>s.trim());
  assert.equal(scripts.length,1);
  assert.doesNotThrow(()=>new Script(scripts[0],{filename:"ai.html:inline"}));
  for(const action of ["send","new","attach","snip","inspector","settings","theme",
    "rename","export","pin","select-chat","select-job","choose-type"])
    assert.match(ai,new RegExp('(?:data-act="' + action + '"|kind==="' + action + '")'));
});

test("AI Studio starts focused and keeps optional controls on demand",()=>{
  assert.match(ai,/active:"start"[^\n]*inspector:false/);
  assert.match(ai,/o\.inspector=false;o\.side=false/);
  assert.match(ai,/class="chat-options"/);
  assert.match(ai,/class="more-prompts"/);
  assert.match(ai,/prompts\.slice\(0,2\)/);
  assert.match(ai,/prompts\.slice\(2\)/);
  assert.match(ai,/aria-expanded",String\(state\.inspector\)/);
  assert.match(ai,/\.chat-actions button/);
  assert.match(ai,/Preview · no live AI/);
});

test("AI Studio is linked to teacher navigation and quick home links",()=>{
  assert.match(shell,/\["ai", "ai\.html", "AI Studio"\]/);
  assert.match(home,/href="ai\.html"/);
  assert.match(profile,/AI Studio \(preview\)/);
  assert.match(ai,/<a[^>]*href="index\.html"[^>]*class="brand"/);
});
