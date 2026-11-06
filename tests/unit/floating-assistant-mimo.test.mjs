import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  floatingAssistantHistory, prepareFloatingAssistantRequest,
  isUncertainAssistantError,
} from "../../js/services/floating-assistant-chat.js";

const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path,root),"utf8");
const assistant = read("js/components/assistant.js");
const shell = read("js/components/shell.js");
const styles = read("assets/css/assistant.css");
const transport = read("js/services/mimo-chat.js");

test("confirmed assistant exchanges become bounded history, never pending/errors", () => {
  const input = [
    {role:"user",text:"  2x+3=7  ",confirmed:true},
    {role:"assistant",text:"x=2",confirmed:true},
    {role:"user",text:"Failed request",confirmed:false},
    {role:"assistant",text:"Timeout",confirmed:false,error:true},
    {role:"assistant",text:"How chat works",confirmed:false},
    {role:"user",text:"B".repeat(1800),confirmed:true},
    {role:"system",text:"secret",confirmed:true},
    {role:"assistant",text:"Next answer",confirmed:true},
  ];
  assert.deepEqual(floatingAssistantHistory(input),[
    {role:"user",content:"2x+3=7"},
    {role:"assistant",content:"x=2"},
    {role:"user",content:"B".repeat(1200)},
    {role:"assistant",content:"Next answer"},
  ]);
  assert.equal(floatingAssistantHistory(null).length,0);
  assert.equal(floatingAssistantHistory(
    Array.from({length:15},(_,i)=>({role:"user",text:String(i),confirmed:true}))
  ).length,8);
});

test("a new text request has exactly the deployed callable's message/history fields",()=>{
  const req=prepareFloatingAssistantRequest({
    message:" Solve \\(x^2=4\\) ",
    messages:[{role:"user",text:"Earlier",confirmed:true}],
    requestId:"a1234567890bcdef",
  });
  assert.deepEqual(req,{
    message:"Solve \\(x^2=4\\)",context:"",
    history:[{role:"user",content:"Earlier"}],requestId:"a1234567890bcdef",
  });
  assert.ok(!("files" in req));
  for(const x of ["", "  ", "x".repeat(3001)]) {
    assert.throws(()=>prepareFloatingAssistantRequest({
      message:x,requestId:"a1234567890bcdef"
    }),/Enter a message/);
  }
  assert.throws(()=>prepareFloatingAssistantRequest({
    message:"Check",requestId:"short"
  }),/reference/);
});

test("uncertain network failures retain request reference; limits do not imply a retry",()=>{
  assert.equal(isUncertainAssistantError({details:{reason:"MIMO_OUTCOME_UNKNOWN"}}),true);
  assert.equal(isUncertainAssistantError({code:"functions/deadline-exceeded"}),true);
  assert.equal(isUncertainAssistantError({code:"functions/unavailable"}),true);
  assert.equal(isUncertainAssistantError({details:{reason:"RATE_LIMITED"},code:"functions/resource-exhausted"}),false);
});

test("teacher-only floating button uses existing Mimo chat, not the old mock provider",()=>{
  assert.match(assistant,/const allowed = !!session\?\.capabilities\?\.teach && canUseMimoTeacherChat\(session\);/);
  assert.match(assistant,/await sendTeacherChatMessage\(payload\)/);
  assert.match(assistant,/requestId = crypto\.randomUUID\(\)/);
  assert.doesNotMatch(assistant,/askAssistant\(|AI_CONNECTED|directProvider|QUIZER_MIMO_PROJECT_KEY/);
  assert.match(assistant,/renderChatMarkdown\(node, message\.text\)/);
  assert.match(assistant,/void typeset\(log\)/);
  assert.match(assistant,/KEY \+ "\." \+ mountedUid/);
  assert.match(assistant,/generation !== myGeneration/);
  assert.match(assistant,/role:"assistant", error: true, confirmed: false/);
  assert.match(shell,/assistant\.js\?v=17/);
  assert.match(transport,/httpsCallable\(services\.functions, "mimoTeacherChat"/);
});

test("scissors and screenshot remain, file attachments cannot silently reach the text-only model",()=>{
  assert.match(assistant,/class="ai-fab ai-snip-fab"/);
  assert.match(assistant,/class="ai-fab ai-pixel-fab"/);
  assert.match(assistant,/await snipPageContent\(\)/);
  assert.match(assistant,/await snip\(\)/);
  assert.match(assistant,/if \(files\.length\) \{/);
  const blocked=assistant.indexOf('if (files.length) {',assistant.indexOf('async function send('));
  const paid=assistant.indexOf('await sendTeacherChatMessage(payload)');
  assert.ok(blocked>=0 && blocked<paid);
  assert.match(assistant,/Text chat cannot read attached images or PDFs yet/);
  assert.match(assistant,/pendingFiles\.push\(file\)/);
  assert.match(styles,/\.ai-rich/);
});
