import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const ai=read("ai.html");
const shell=read("js/components/shell.js");
const shellLinks=[...shell.matchAll(/\["[^"]+",\s*"([^"]+)",\s*"([^"]+)"\]/g)]
  .slice(0,6).map(([,href,label])=>({href,label}));
function navLinks(cls){
  const html=ai.match(new RegExp('<nav class="'+cls+'"[^>]*>([\\s\\S]*?)</nav>'))?.[1];
  assert(html,"Missing nav: "+cls);
  return [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
    .map(([,href,label])=>({href,label}));
}
test("AI Studio desktop nav matches website menu and order exactly",()=>{
  assert.equal(shellLinks.length,6);
  assert.deepEqual(navLinks("studio-global-nav"),shellLinks);
  assert.match(ai,/<nav class="studio-global-nav" aria-label="Main navigation">/);
  assert.match(ai,/<a href="ai.html" aria-current="page">AI Studio<\/a>/);
});
test("AI Studio compact menu matches website menu, with Profile",()=>{
  const menu=ai.match(/<details class="studio-nav-dropdown" id="studio-nav-dropdown">[\s\S]*?<nav aria-label="Quizer navigation menu">([\s\S]*?)<\/nav>/)?.[1];
  assert(menu,"Compact menu missing");
  const links=[...menu.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
    .map(([,href,label])=>({href,label}));
  assert.deepEqual(links,[...shellLinks,{href:"profile.html",label:"Profile"}]);
  assert.match(ai,/@media\(max-width:1200px\)/);
  assert.match(ai,/\.studio-nav-dropdown>summary/);
});
test("AI Studio remains offline preview, no account or permission network introduced",()=>{
  assert.match(ai,/No Firebase, Neon, Mimo, network inference/);
  assert.doesNotMatch(ai,/import\s+.*firebase-client|initFirebase\(|watchSession\(|api\("getSession/);
  assert.match(ai,/Preview · no live AI/);
});
