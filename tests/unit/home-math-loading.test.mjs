import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const html = read("index.html");
const shell = read("js/components/shell.js");
const render = read("js/render.js");
const functionSource = shell.slice(
  shell.indexOf("const EQUATIONS = "),
  shell.indexOf("export function mountShell("),
);

function fixture(page="home") {
  const styles = [], scripts = [];
  let backdrop = null;
  const document = {
    head: {
      append(node) {
        if (node.tagName === "link") styles.push(node);
        else if (node.tagName === "script") scripts.push(node);
        else throw new Error("Unexpected node: " + node.tagName);
      },
    },
    body: {
      dataset: { page },
      prepend(node) { backdrop = node; },
    },
    createElement(tagName) {
      return { tagName, attributes: {}, setAttribute(k,v) {
        this.attributes[k] = v;
      } };
    },
    querySelector(selector) {
      return selector === "#math-bg" ? backdrop : null;
    },
  };
  const window = { MathJax: { startup: { typeset: false } } };
  const mountBackdrop = new Function(
    "document", "window", functionSource + "\nreturn mountBackdrop;",
  )(document, window);
  return {document, window, styles, scripts, mountBackdrop,
    get backdrop() { return backdrop; }};
}
const settle = async () => {
  for (let i=0; i<8; i++) await Promise.resolve();
};

test("Home no longer starts 2 MB MathJax download during HTML parsing",()=>{
  assert.match(html,/<script src="js\/math-config\.js"><\/script>/);
  assert.doesNotMatch(html,/<script[^>]+src="assets\/mathjax\.js"/);
  assert.match(html,/src="js\/app\.js\?v=15"/);
  assert.match(shell,/script\.src = "assets\/mathjax\.js"/);
  assert.match(render,/await window\.mathQuizMathJaxReady/);
});

test("background remains absent while either CSS file is pending; MathJax waits for both",async()=>{
  const f = fixture();
  f.mountBackdrop();
  assert.equal(f.styles.length, 2);
  assert.equal(f.styles[0].href,"assets/css/math.css?v=15");
  assert.equal(f.styles[1].href,"assets/css/polish.css?v=15");
  assert.equal(f.backdrop,null, "unstyled equations must not exist in DOM");
  assert.equal(f.scripts.length,0, "MathJax must not be requested early");

  f.styles[0].onload();
  await settle();
  assert.equal(f.backdrop,null);
  assert.equal(f.scripts.length,0);

  f.styles[1].onload();
  await settle();
  assert.equal(f.backdrop?.id,"math-bg");
  assert.equal(f.backdrop.attributes["aria-hidden"],"true");
  assert.match(f.backdrop.innerHTML,/e\^\{iπ\}/);
  assert.equal(f.scripts.length,1);
  assert.equal(f.scripts[0].src,"assets/mathjax.js");

  f.window.MathJax.startup.promise=Promise.resolve();
  f.scripts[0].onload();
  await f.window.mathQuizMathJaxReady;
});

test("failed decorative CSS never flashes equations and never blocks quiz MathJax",async()=>{
  const f = fixture();
  f.mountBackdrop();
  f.styles[0].onerror();
  await settle();
  assert.equal(f.backdrop,null);
  assert.equal(f.scripts.length,0);
  f.styles[1].onload();
  await settle();
  assert.equal(f.backdrop,null);
  assert.equal(f.scripts.length,1);
  f.window.MathJax.startup.promise=Promise.resolve();
  f.scripts[0].onload();
  await f.window.mathQuizMathJaxReady;
});

test("non-Home direct entries use the existing MathJax script, without duplication",async()=>{
  const f = fixture("quiz");
  f.mountBackdrop();
  f.styles.forEach(style=>style.onload());
  await settle();
  assert.equal(f.scripts.length,0);
  assert.equal(f.window.mathQuizMathJaxReady,undefined);
  assert.match(read("quiz.html"),/<script defer src="assets\/mathjax\.js"><\/script>/);
});
