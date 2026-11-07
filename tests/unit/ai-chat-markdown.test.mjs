import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

class Node {
  constructor(tag, text = "") { this.tag = tag; this.children = []; this._text = text; this.href = ""; this.parent=null; this.isConnected=true; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(""); }
  append(...items) { for(const item of items){item.parent=this;this.children.push(item);} }
  replaceChildren(...items) { this._text = ""; this.children = [];this.append(...items); }
  querySelectorAll(selector) {
    const descendants=this.children.flatMap(child=>[child,...child.querySelectorAll("*")]);
    if(selector==="*")return descendants;
    if(selector===".qa-math")return descendants.filter(node=>
      node.className?.split(" ").includes("qa-math"));
    return descendants.filter(node=>node.tag==="mjx-merror");
  }
  querySelector(selector) {
    if(selector.includes("mjx-merror"))
      return this.simulatedMathError ? new Node("mjx-merror") : null;
    return null;
  }
  after(other) {
    if(!this.parent)return;
    const index=this.parent.children.indexOf(this);
    other.parent=this.parent;
    this.parent.children.splice(index+1,0,other);
  }
}
globalThis.document = {
  createElement: tag => new Node(tag),
  createTextNode: text => new Node("#text", String(text)),
  createDocumentFragment: () => new Node("#fragment"),
};

const src = readFileSync(new URL("../../js/components/ai-chat-markdown.js", import.meta.url), "utf8");
const {renderChatMarkdown,typesetChatMarkdown} = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

const flatten = node => [node, ...node.children.flatMap(flatten)];
const render = value => {
  const root = new Node("main");
  renderChatMarkdown(root, value);
  return flatten(root);
};

test("math is preserved for local MathJax and unsafe TeX extensions are neutralized", () => {
  const nodes = render("Compute \\(x^2 + 1\\).\n\n$$\\frac{1}{2}$$\n\n\\(\\href{https://evil.test}{click}\\)");
  const math = nodes.filter(node => node.className?.includes("qa-math"));
  assert.equal(math.length, 3);
  assert.match(math[0].textContent, /x\^2/);
  assert.match(math[1].textContent, /\\frac/);
  assert.doesNotMatch(math[2].textContent, /\\href/);
  assert.match(math[2].textContent, /\\text/);
});

test("Markdown uses safe nodes rather than parsing model HTML", () => {
  const nodes = render("# Explanation\n\n**Bold** and *italic* and \x60code\x60\n\n- First\n- Second\n\n\x60\x60\x60js\nalert('hello')\n\x60\x60\x60");
  assert.ok(nodes.some(node => node.tag === "h3"));
  assert.ok(nodes.some(node => node.tag === "strong"));
  assert.ok(nodes.some(node => node.tag === "em"));
  assert.ok(nodes.some(node => node.tag === "ul"));
  assert.ok(nodes.some(node => node.tag === "pre"));
  assert.ok(nodes.some(node => node.tag === "code" && node.textContent.includes("alert")));
});

test("script markup and javascript URLs cannot produce executable elements", () => {
  const nodes = render("<script>alert('x')</script> \n\n[run](javascript:alert(1)) and [safe](https://example.org/math)");
  assert.ok(!nodes.some(node => ["script", "iframe", "img", "style"].includes(node.tag)));
  const anchors = nodes.filter(node => node.tag === "a");
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].href, "https://example.org/math");
  assert.equal(anchors[0].rel, "noopener noreferrer");
  assert.match(nodes.map(n => n.textContent).join(" "), /<script>/);
});

test("long untrusted model output is bounded", () => {
  const nodes = render("a".repeat(24000));
  assert.equal(nodes[0].textContent.length, 16000);
});

test("unknown MathJax command leaves original pasted TeX available with error",async()=>{
  const root=new Node("main");
  renderChatMarkdown(root,"Check \\(\\unknowncommand{x}\\) now");
  const math=flatten(root).find(x=>x.className==="qa-math");
  assert.ok(math);
  math.simulatedMathError=true;
  await typesetChatMarkdown(root,async()=>{});
  const source=flatten(root).find(x=>x.className==="qa-tex-source");
  assert.ok(source);
  assert.equal(source.open,true);
  assert.equal(source.children[1].children[0].textContent,"\\(\\unknowncommand{x}\\)");
  await typesetChatMarkdown(root,async()=>{});
  assert.equal(flatten(root).filter(x=>x.className==="qa-tex-source").length,1);
});
test("valid math can reveal original LaTeX; MathJax rejection expands it",async()=>{
  const root=new Node("main");
  renderChatMarkdown(root,"\\(x^2+1\\)");
  await typesetChatMarkdown(root,async()=>{throw Error("renderer failed");});
  const toggle=flatten(root).find(x=>x.className==="qa-tex-source");
  assert.equal(toggle.open,true);
  assert.match(toggle.textContent,/x\^2/);
});
test("unterminated display math is printed instead of swallowing the next paragraph",()=>{
  const nodes=render("\\[\\frac{x}{2}\n\nFollowing plain text.");
  const uncompiled=nodes.find(x=>x.className==="qa-tex-uncompiled");
  assert.ok(uncompiled);
  assert.match(uncompiled.textContent,/missing/);
  assert.match(uncompiled.textContent,/frac/);
  assert.ok(nodes.some(x=>x.tag==="p"&&x.textContent.includes("Following plain text")));
});
