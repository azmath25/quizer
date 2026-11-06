import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const bank = read("js/pages/problems.js");
const ui = read("js/components/ui.js");
const css = read("assets/css/problem-card.css");
const actions = bank.slice(bank.indexOf("    const flipButton ="), bank.indexOf("    const chips = ["));
const normal = actions.slice(actions.indexOf('      : btn("copy"'));

test("Ask AI and Solution have different icons, text and accessible names", () => {
  assert(normal.includes('btn("ai", "sparkles", "Ask AI about this problem", "data-ask-ai", "AI")'));
  assert(normal.includes('btn("solve", "book", "Answer and solution", "data-solve", "Solution")'));
  assert(ui.includes('sparkles: "'));
  assert(bank.includes('class="action-btn-caption"'));
  assert(bank.includes('${tip(label)}'));
  assert(css.includes(".action-btn--ai {"));
  assert(css.includes(".action-btn--solve {"));
});

test("actions are in intentional order with Solution furthest right", () => {
  const ordered = [
    "data-copy-latex", "data-download", "data-pop", "data-star",
    "flipButton +", "action-btn--external", "data-ask-ai", "data-solve",
  ];
  const offsets = ordered.map((name) => normal.indexOf(name));
  assert(offsets.every((n) => n >= 0));
  assert(offsets.every((n, i) => i === 0 || offsets[i - 1] < n));
  assert(bank.includes('${actions}</div></div><article'));
  assert(!bank.includes('${actions}<button type="button" class="action-btn action-btn--flip"'));
});

test("trash actions end with Restore and narrow-screen targets remain usable", () => {
  const trash = actions.slice(actions.indexOf("    const actions = trash"), actions.indexOf('      : btn("copy"'));
  assert(trash.indexOf("data-copy-latex") < trash.indexOf("flipButton +"));
  assert(trash.indexOf("flipButton +") < trash.indexOf("data-restore"));
  assert(css.includes(".tab-actions .action-btn--restore { margin-left: auto; }"));
  assert(css.includes("margin-left: auto;"));
  assert(css.includes("min-height: 44px;"));
});
