import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
const html=read("ai.html");
const ui=read("js/pages/ai-studio.js");
const css=read("assets/css/ai-studio-atlas-v2.css");

test("New Chat is unique, empty chat has no redundant welcome/command chrome",()=>{
  for(const id of ["ai-new-chat","ai-chat-form","ai-prompt","ai-send",
    "ai-chat-search","ai-threads","ai-pin-filter"]){
    assert.equal(html.split('id="'+id+'"').length-1,1,"duplicate/missing "+id);
  }
  assert.doesNotMatch(html,/class="axiom-composer-eyebrow"|class="composer-note"|class="compose-btn axiom-command"/);
  assert.match(html,/> New chat<\/button>/);
  assert.doesNotMatch(html,/Recent chats<\/strong>|class="axiom-brand ai-native-context"/);
  assert.doesNotMatch(ui,/function studioWelcome\(/);
  assert.match(ui,/head\.hidden=!threadId/);
  assert.match(css,/\.conversation-head\.axiom-conversation-head\[hidden\]/);
});

test("Waiting indicator appears on send, uses accessible role, clears in all outcomes",()=>{
  assert.match(ui,/let pendingReply=false,chatViewEpoch=0,pendingViewEpoch=-1/);
  assert.match(ui,/pendingReply=true;pendingViewEpoch=chatViewEpoch/);
  assert.match(ui,/const pending=node\("article","","message assistant ai-reply-pending"\)/);
  assert.match(ui,/pending\.id="ai-pending-reply"/);
  assert.match(ui,/pending\.setAttribute\("role","status"\)/);
  assert.match(ui,/pending\.setAttribute\("aria-label","Assistant is generating a reply"\)/);
  assert.match(ui,/node\("span","Generating reply…","ai-reply-progress-label"\)/);
  assert.match(ui,/pendingReply&&pendingViewEpoch===chatViewEpoch/);
  assert.match(ui,/pendingReply=false;\s*drawMessages\(\)/);
  assert.match(ui,/\}catch\(error\)\{\s*pendingReply=false;/);
  assert.match(ui,/\$\("ai-pending-reply"\)\?\.remove\(\)/);
  assert.match(ui,/chatViewEpoch\+\+;\s*threadId=null/);
  assert.match(ui,/chatViewEpoch\+\+;\s*threadId=id/);
  assert.equal((ui.match(/sendTeacherChatMessage\(\{/g)||[]).length,1);
  assert.doesNotMatch(ui,/setInterval\(.*(pending|reply|dots)/);
});

test("Dots animate in Quizer's existing palette and respect reduced motion",()=>{
  assert.match(css,/\.ai-reply-pending/);
  assert.match(css,/\.ai-reply-dots i\{/);
  assert.match(css,/animation:ai-reply-pulse/);
  assert.match(css,/@keyframes ai-reply-pulse/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/\.ai-reply-dots i\{\s*animation:none/);
  assert.match(css,/background:var\(--brand\)/);
  assert.doesNotMatch(css,/#(?:335bc8|192640|283853)\b/i);
});

test("Composer is a single rectangle and chat sidebar avoids repeated time errors",()=>{
  assert.match(css,/\.composer\.axiom-composer\{/);
  assert.match(css,/\.composer\.axiom-composer \.composer-tools\{/);
  assert.match(css,/border-top:0!important/);
  assert.match(css,/\.history-row \.pin-btn\{/);
  assert.match(css,/opacity:0;color:var\(--muted\)/);
  assert.match(ui,/const compactChatDate=value=>/);
  assert.match(ui,/if\(updated\)label\.append\(node\("small",updated\)\)/);
  assert.doesNotMatch(ui,/node\("small","General chat · "\+humanTime/);
  const start=ui.indexOf("const compactChatDate=value=>");
  const end=ui.indexOf("function status(",start);
  assert.ok(start>=0&&end>start);
  const getDate=Function(ui.slice(start,end)+"return compactChatDate;")();
  assert.equal(getDate(null),"");
  assert.equal(getDate("bad timestamp"),"");
  assert.ok(getDate("2026-11-08T08:00:00Z"));
  assert.ok(getDate(1794124800));
  assert.ok(getDate("1794124800000"));
  assert.ok(getDate({seconds:1794124800}));
});
