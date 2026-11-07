import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root = new URL("../../", import.meta.url);
const popupSource = readFileSync(new URL("js/components/ask-ai-popup.js", root), "utf8");
const source = popupSource.replace(/^import .*;$/gm, "");
assert.notEqual(source, popupSource, "popup imports should be mocked in isolated DOM tests");

class FakeNode {
  constructor(tag, doc) {
    this.tag = tag; this.doc = doc; this.children = []; this.parent = null;
    this.attributes = {}; this.listeners = {}; this._text = "";
    this.className = ""; this.value = ""; this.disabled = false;
    this.readOnly = false; this.scrollTop = 0; this.scrollHeight = 200;
    this.classList = {
      add: name => { this.className = (this.className + " " + name).trim(); },
      contains: name => this.className.split(/\s+/).includes(name),
    };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(""); }
  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === "string") throw new Error("Unexpected text HTML");
      node.parent = this; this.children.push(node);
    }
  }
  replaceChildren(...nodes) { this.children = []; this._text = ""; this.append(...nodes); }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(c => c !== this);
    this.parent = null;
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter(x => x !== fn);
  }
  async fire(type, event = {}) {
    const e = {preventDefault() {this.prevented = true;}, target: this, ...event};
    return Promise.all((this.listeners[type] || []).map(fn => fn(e)));
  }
  focus() { this.doc.activeElement = this; }
  contains(other) {
    return this === other || this.children.some(c => c.contains(other));
  }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
  querySelector(selector) {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.find(n => n.className.split(/\s+/).includes(className));
    }
    return this.find(n => n.tag === selector);
  }
  requestSubmit() { return this.fire("submit"); }
}
function createDocument() {
  const doc = {
    activeElement: null,
    createElement(tag) {return new FakeNode(tag, doc);},
    createTextNode(text) {const n = new FakeNode("#text", doc); n.textContent = text; return n;},
    createDocumentFragment() {return new FakeNode("#fragment", doc);},
    getElementById(id) {return doc.head.find(n => n.id === id) || doc.body.find(n => n.id === id);},
    listeners: {},
    addEventListener(type, fn) {(this.listeners[type] ??= []).push(fn);},
    removeEventListener(type, fn) {this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn);},
    async fire(type, event = {}) {
      const e = {preventDefault() {}, ...event};
      return Promise.all((this.listeners[type] || []).map(fn => fn(e)));
    },
  };
  doc.head = doc.createElement("head");
  doc.body = doc.createElement("body");
  doc.activeElement = doc.createElement("button");
  return doc;
}
let session, calls, responder;
const allowed = () => ({
  roleResolved: true, accountStatus: "active", epoch: 1,
  user: {uid: "teacher", emailVerified: true}, capabilities: {teach: true},
});
const mock = {
  getSession: () => session,
  canUseMimoTeacherChat: value => !!(value.roleResolved && value.accountStatus === "active" &&
    value.user?.emailVerified && (value.capabilities?.teach || value.capabilities?.admin)),
  mimoChatErrorMessage: error => error.details?.reason === "MIMO_OUTCOME_UNKNOWN"
    ? "Outcome unknown; do not resend." : "The AI service is unavailable.",
  sendTeacherChatMessage: async payload => {calls.push(payload); return responder(payload);},
  renderChatMarkdown: (node, value) => {node.textContent = value;},
  typeset: async () => {},
  typesetChatMarkdown: async () => {},
};
globalThis.__popupMocks = mock;
const injection = "const {getSession, canUseMimoTeacherChat, mimoChatErrorMessage, sendTeacherChatMessage, renderChatMarkdown, typeset, typesetChatMarkdown} = globalThis.__popupMocks;\n";
const {openAskAIPopup} = await import("data:text/javascript;base64," + Buffer.from(injection + source).toString("base64"));

function setup() {
  globalThis.document = createDocument();
  session = allowed();
  calls = [];
  responder = async () => ({reply: "Solved: \\(x=2\\)."});
  const prior = document.activeElement;
  const popup = openAskAIPopup({title: "Ask AI", context: "Visible question only"});
  const find = selector => document.body.querySelector(selector);
  return {popup, prior, find,
    form: find("form"), input: find("textarea"), send: find(".qa-send"),
    newChat: find(".qa-action"), log: find(".qa-log")};
}

test("verified teacher can send once, clears submitted draft immediately and sends completed history", async () => {
  const h = setup();
  let resolve;
  responder = () => new Promise(r => {resolve = r;});
  h.input.value = "First question";
  const sending = h.form.fire("submit");
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context, "Visible question only");
  assert.deepEqual(calls[0].history, []);
  assert.equal(h.input.value, "");
  assert.equal(h.input.readOnly, false);
  assert.equal(h.send.disabled, true);
  assert.equal(h.newChat.disabled, true);
  assert.equal(h.form.getAttribute("aria-busy"), "true");
  assert.ok(h.log.querySelector(".qa-pending"));
  await h.form.fire("submit");
  assert.equal(calls.length, 1, "duplicate submission blocked");
  resolve({reply: "Solved: \\(x=2\\)."});
  await sending;
  assert.equal(h.input.value, "");
  assert.equal(h.input.readOnly, false);
  assert.equal(h.send.disabled, false);
  assert.equal(h.log.querySelector(".qa-pending"), null);
  assert.match(h.log.textContent, /Solved/);
  responder = async () => ({reply: "Follow-up"});
  h.input.value = "Why?";
  await h.form.fire("submit");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].history, [
    {role: "user", content: "First question"},
    {role: "assistant", content: "Solved: \\(x=2\\)."},
  ]);
  assert.notEqual(calls[0].requestId, calls[1].requestId);
  await h.newChat.fire("click");
  h.input.value = "Fresh";
  await h.form.fire("submit");
  assert.deepEqual(calls[2].history, []);
  h.popup.close();
});

test("every message has a working copy button and a new draft survives a pending reply",async()=>{
  const h=setup(),original=globalThis.navigator;
  let resolve,copied=null;
  Object.defineProperty(globalThis,"navigator",{configurable:true,
    value:{clipboard:{writeText:async text=>{copied=text;}}}});
  try{
    responder=()=>new Promise(r=>{resolve=r;});
    h.input.value="Solve \\(x+2=4\\)";
    const pending=h.form.fire("submit");
    await Promise.resolve();
    const copy=h.log.querySelector(".qa-copy");
    assert.ok(copy);
    await copy.fire("click");
    assert.equal(copied,"Solve \\(x+2=4\\)");
    h.input.value="Next draft";
    resolve({reply:"x=2",saved:true});
    await pending;
    assert.equal(h.input.value,"Next draft");
    assert.ok(h.log.find(n=>n.className==="qa-copy"&&n.textContent==="Copy message"));
    h.popup.close();
  }finally{
    if(original===undefined)delete globalThis.navigator;
    else Object.defineProperty(globalThis,"navigator",{configurable:true,value:original});
  }
});

test("unknown outcomes preserve the draft, show request reference and never retry", async () => {
  const h = setup();
  responder = async () => {throw {details: {reason: "MIMO_OUTCOME_UNKNOWN"}};};
  h.input.value = "Please explain";
  await h.form.fire("submit");
  assert.equal(calls.length, 1);
  assert.equal(h.input.value, "Please explain");
  assert.equal(h.send.disabled, false);
  assert.match(h.log.textContent, /Outcome unknown/);
  assert.match(h.log.textContent, /Request reference:/);
  assert.ok(h.log.querySelector(".failed"));
  h.popup.close();
});

test("students cannot submit, and dialog traps keyboard focus and restores it on close", async () => {
  const h = setup();
  assert.equal(h.find(".qa-window").getAttribute("role"), "dialog");
  assert.equal(h.find(".qa-window").getAttribute("aria-modal"), "true");
  assert.equal(document.activeElement, h.input);
  await document.fire("keydown", {key: "Escape"});
  assert.equal(document.activeElement, h.prior);
  session = {...allowed(), capabilities: {teach: false}};
  calls = [];
  const popup = openAskAIPopup({title: "Ask AI", context: "Question"});
  const input = document.body.querySelector("textarea");
  assert.equal(input.disabled, true);
  assert.equal(document.body.querySelector(".qa-send").disabled, true);
  await document.body.querySelector("form").fire("submit");
  assert.equal(calls.length, 0);
  assert.match(document.body.textContent, /teacher or administrator/i);
  popup.close();
});

test("keyboard composition and Shift+Enter do not submit", async () => {
  const h = setup();
  h.input.value = "Question";
  await h.input.fire("keydown", {key: "Enter", shiftKey: true});
  await h.input.fire("keydown", {key: "Enter", isComposing: true});
  assert.equal(calls.length, 0);
  h.popup.close();
});

test("responsive CSS, reduced motion and accessible focus styles are present", () => {
  const css = readFileSync(new URL("assets/css/ask-ai-popup.css", root), "utf8");
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /overflow-x:auto/);
});

test("results and problem-bank entry points are teacher gated and exclude hidden answer details", () => {
  const results = readFileSync(new URL("js/pages/results.js", root), "utf8");
  const problems = readFileSync(new URL("js/pages/problems.js", root), "utf8");
  assert.match(results, /canUseMimoTeacherChat\(session\)/);
  assert.match(problems, /canUseMimoTeacherChat\(session\)/);
  const segment = results.split('const visible = [')[1]?.split('].filter(Boolean)')[0] || "";
  assert.ok(segment.includes("Statement: "));
  assert.doesNotMatch(segment, /item\.solution|item\.grade|item\.answer|feedbackLatex/);
  assert.doesNotMatch(popupSource, /askAssistant|AI_CONNECTED|html\s*=/);
});
