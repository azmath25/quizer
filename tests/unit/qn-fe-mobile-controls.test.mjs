// QN-FE micro-regressions: static frontend contract, not an actual browser test.
// Full screenshot/device matrix belongs to QN12.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const js=readFileSync(new URL("../../js/pages/quiz.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../../assets/css/pages/quiz.css",import.meta.url),"utf8");
const layout=readFileSync(new URL("../../assets/css/layout.css",import.meta.url),"utf8");

test("flag and star keep constant visible captions instead of resizing when toggled",()=>{
  assert.match(js,/const flagLabel\s*=\s*\(\)\s*=>\s*icon\("flag"\)\s*\+\s*"Flag"/);
  assert.match(js,/const starLabel\s*=\s*\(\)\s*=>\s*icon\("star"\)\s*\+\s*"Star"/);
  assert.doesNotMatch(js,/on\s*\?\s*"Flagged"\s*:\s*"Flag"/);
  assert.doesNotMatch(js,/on\s*\?\s*"Starred"\s*:\s*"Star"/);
});

test("pressed states update visual icon AND meaningful accessible toggle actions",()=>{
  assert.match(js,/flagBtn\.setAttribute\("aria-pressed", String\(on\)\)/);
  assert.match(js,/flagBtn\.setAttribute\("aria-label", on \? "Remove flag from problem" : "Flag problem"\)/);
  assert.match(js,/b\.setAttribute\("aria-pressed", String\(on\)\)/);
  assert.match(js,/b\.setAttribute\("aria-label", on \? "Remove star from problem" : "Star problem"\)/);
  assert.match(css,/#star\[aria-pressed="true"\] \.icon, #flag\[aria-pressed="true"\] \.icon/);
});

test("quiz action buttons stay 44px high and stable with narrow mobile header",()=>{
  assert.match(css,/\.question-meta #flag,\s*\.question-meta #star\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*84px;[^}]*white-space:\s*nowrap/s);
  assert.match(css,/@media \(max-width: 520px\)\s*\{\s*\.question-meta\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css,/\.runner-title\s*\{\s*min-width:\s*0;/);
  assert.match(css,/\.runner-title h1\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css,/\.timer\s*\{[^}]*flex-shrink:\s*0/s);
});

test("numbered navigation buttons have at least 44px targets on narrow and zoomed screens",()=>{
  assert.match(css,/@media \(max-width: 420px\)\s*\{[^}]*\.runner-sidebar \.question-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(44px,\s*1fr\)\)/s);
  const narrow = css.slice(css.lastIndexOf("@media (max-width: 420px)"));
  assert.match(narrow,/\.runner-sidebar \.question-grid button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css,/\.question-grid button\s*\{[^}]*aspect-ratio:\s*1/s);
});

test("hover scaling only applies to actual fine mouse pointers, not sticky touch hover",()=>{
  assert.match(css,/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.question-grid button:hover:not\(:disabled\)/);
  assert.match(css,/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.choice:hover/);
});

test("sticky runner controls clear bottom mobile navigation and safe area",()=>{
  assert.match(layout,/#mobile-nav\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*0;/s);
  assert.match(css,/\.runner-footer\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*var\(--runner-mobile-nav-clearance,/s);
  assert.match(js,/new ResizeObserver\(syncMobileClearance\)/);
  assert.match(js,/getBoundingClientRect\(\)/);
});

test("quiz timer remains server-offset-based, and aria live announcement is retained",()=>{
  assert.match(js,/serverBase\s*=\s*Date\.parse\(a\._serverTime\)/);
  assert.match(js,/basePerf\s*=\s*performance\.now\(\)/);
  assert.match(js,/id="timer-announcement"/);
  assert.match(js,/timerNode\.classList\.toggle\("urgent"/);
});
