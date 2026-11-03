// QN12.1 source contract; actual browser geometry uses mobile-runner-browser.py.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const js=readFileSync(new URL("../../js/pages/quiz.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../../assets/css/pages/quiz.css",import.meta.url),"utf8");
const layout=readFileSync(new URL("../../assets/css/layout.css",import.meta.url),"utf8");
const device=readFileSync(new URL("../../js/core/device.js",import.meta.url),"utf8");

test("QN12.1 saving, errors and retry feedback remain visible on touch",()=>{
  assert.match(js,/class="runner-save-feedback"/);
  assert.match(js,/id="save-status" role="status" aria-live="polite"/);
  assert.match(js,/id="retry-save"/);
  assert.match(js,/id="resolve-conflict"/);
  assert.match(css,/\.runner-save-feedback \.save-indicator\s*\{[^}]*display:\s*flex;/s);
  assert.doesNotMatch(css,/\.runner-footer \.save-indicator\s*\{\s*display:\s*none/s);
  assert.match(js,/saveStatus\.textContent !== text/);
});

test("QN12.1 retry and conflict controls follow actual save-state",()=>{
  assert.match(js,/root\.querySelector\("#save-actions"\)\.hidden\s*=\s*!failed/);
  assert.match(js,/root\.querySelector\("#retry-save"\)\.hidden\s*=\s*!failed \|\| conflict/);
  assert.match(js,/root\.querySelector\("#resolve-conflict"\)\.hidden\s*=\s*!failed \|\| !conflict/);
  assert.match(css,/\.runner-save-feedback \[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css,/\.runner-save-feedback \.actions\s*\{[^}]*flex-wrap:\s*wrap/s);
});

test("QN12.1 mobile footer separates status and navigation into stable grid rows",()=>{
  assert.match(css,/\.runner-footer\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css,/\.runner-save-feedback\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*1;/s);
  assert.match(css,/\.runner-footer #previous\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;/s);
  assert.match(css,/\.runner-footer #next\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;/s);
  assert.match(layout,/#mobile-nav\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*0/s);
});

test("QN12.1 resize observer measures navbar and removes listeners on teardown",()=>{
  assert.match(js,/mobileNav\.getBoundingClientRect\(\)/);
  assert.match(js,/new ResizeObserver\(syncMobileClearance\)/);
  assert.match(js,/window\.visualViewport\?\.addEventListener\("resize", syncMobileClearance\)/);
  assert.match(js,/mobileNavObserver\?\.disconnect\(\)/);
  assert.match(js,/window\.visualViewport\?\.removeEventListener\("resize", syncMobileClearance\)/);
  assert.match(css,/bottom:\s*var\(--runner-mobile-nav-clearance,/);
});

test("QN12.1 flags keep steady geometry and no-back flagged links are disabled",()=>{
  assert.match(js,/const flagLabel = \(\) => icon\("flag"\) \+ "Flag";/);
  assert.match(js,/const starLabel = \(\) => icon\("star"\) \+ "Star";/);
  assert.match(css,/\.question-meta #flag,\s*\.question-meta #star\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*84px;[^}]*flex:\s*0 0 auto/s);
  assert.match(js,/flagged\.has\(id\)/);
  assert.match(js,/\!a\.settings\.allowBack && i !== a\.currentFrontier \? "disabled" : ""/);
});

test("QN12.1 timer digits remain fixed width",()=>{
  assert.match(css,/\.timer > span\s*\{[^}]*min-width:\s*7ch;[^}]*text-align:\s*end;/s);
  assert.match(css,/\.timer\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
  assert.match(js,/timerNode\.querySelector\("span"\)\.textContent/);
});

test("QN12.1 gesture navigation excludes inputs, buttons and horizontally scrolling math",()=>{
  assert.match(js,/event\.target\.closest\([\s\S]*"button, a, input, textarea, select, label, \[contenteditable\], \.math-content, \[role=button\]"/);
  assert.match(js,/Math\.abs\(dx\) > 90/);
  assert.match(js,/document\.documentElement\.dataset\.input !== "touch"/);
});

test("QN12.1 44px grid targets, narrow timer wrap and long-title bounds",()=>{
  assert.match(css,/\.question-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(44px,\s*1fr\)\)/s);
  assert.doesNotMatch(css,/\.question-grid button\s*\{[^}]*min-height:\s*0\s*;/s);
  assert.match(css,/\.question-grid button\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*0;/s);
  assert.match(css,/repeat\(auto-fill,\s*minmax\(44px,\s*1fr\)\)/);
  assert.match(css,/\.runner-top\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(css,/\.runner-title h1\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css,/\.runner-question\s*\{[^}]*scroll-margin-top:\s*82px;/s);
});

test("QN12.1 hybrid input detection rejects synthetic mousemove after touch",()=>{
  assert.match(device,/lastTouchAt/);
  assert.match(device,/event\.sourceCapabilities\?\.firesTouchEvents/);
  assert.match(device,/performance\.now\(\) - lastTouchAt <= 1200/);
  assert.match(device,/event\.pointerType === "touch"/);
  assert.match(device,/event\.pointerType === "mouse"/);
});
