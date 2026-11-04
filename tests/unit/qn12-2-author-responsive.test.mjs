// QN12.2 — no visual snapshot can replace the real Chromium QA,
 // but these contracts prevent regressions in author mobile controls.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root = new URL("../../",import.meta.url);
const read = p => readFileSync(new URL(p,root),"utf8");
const editor=read("assets/css/pages/editor.css");
const bank=read("js/pages/problems.js");
const quiz=read("js/pages/quiz-editor.js");
const form=read("js/components/problem-form.js");
const device=read("js/core/device.js");
const layout=read("assets/css/layout.css");
const shell=read("js/components/shell.js");
const cards=read("assets/css/problem-card.css");

test("QN12.2 removes original 26px selected-problem buttons everywhere",()=>{
  assert.doesNotMatch(editor,/\.sel-ctl \.icon-button\s*\{[^}]*width:\s*26px/s);
  assert.match(editor,/\.sel-ctl \.icon-button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
});
test("QN12.2 quiz slot actions have >=44px targets and wrap on mobile",()=>{
  assert.match(editor,/\.slot-row \.slot-actions button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(editor,/\.slot-row \.slot-actions\s*\{[^}]*grid-area:\s*buttons;[^}]*flex-wrap:\s*wrap/s);
  assert.match(editor,/\.slot-row\s*\{[^}]*grid-template-areas:\s*"handle number title" "points points points" "buttons buttons buttons"/s);
});
test("QN12.2 points field no longer placed in implicit 28px grid column",()=>{
  assert.match(editor,/\.slot-row > label\.field\s*\{[^}]*grid-area:\s*points;/s);
  assert.match(editor,/\.slot-row > label\.field input\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(editor,/\.sel-row\s*\{[^}]*grid-template-areas:\s*"number title points" "controls controls controls"/s);
});
test("QN12.2 mobile selection can collapse without clearing its chosen revisions",()=>{
  assert.match(bank,/let collapsed = compactLayout\.matches/);
  assert.match(bank,/id="toggle-selection" aria-controls="selection-details"/);
  assert.match(bank,/id="selection-details"/);
  assert.match(bank,/panel\.dataset\.collapsed = String\(collapsed\)/);
  assert.match(bank,/panel\.querySelector\("#selection-details"\)\.hidden = collapsed/);
  assert.match(bank,/toggle\.setAttribute\("aria-expanded", String\(!collapsed\)\)/);
  assert.match(editor,/#selection-details\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
});
test("QN12.2 selection dock controls and compact toggle remain touch accessible",()=>{
  assert.match(editor,/\.sel-head #toggle-selection\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(editor,/\.sel-row \.sel-ctl\s*\{[^}]*grid-area:\s*controls;[^}]*justify-content:\s*flex-end/s);
  assert.match(editor,/\.selection-panel\[data-collapsed="true"\]\s*\{[^}]*max-height:\s*none;/s);
});
test("QN12.2 visible import/save/image feedback uses live-status semantics",()=>{
  assert.match(quiz,/id="import-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(quiz,/id="save-state" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(form,/id="save-state" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(form,/data-image-status role="status" aria-live="polite"/);
  assert.match(quiz,/Import paused — retry to continue from the last saved problem/);
  assert.match(quiz,/Save incomplete — retry to continue/);
});
test("QN12.2 nav clearance is measured for all author routes, not hardcoded 76px",()=>{
  assert.match(device,/getBoundingClientRect\(\)/);
  assert.match(device,/--mobile-nav-clearance/);
  assert.match(device,/ResizeObserver/);
  assert.match(device,/visualViewport\?\.addEventListener\("resize"/);
  assert.match(editor,/\.editor-actions,\s*\.selection-tray\s*\{[^}]*bottom:\s*var\(--mobile-nav-clearance,/s);
  assert.match(editor,/body\[data-page="problems"\] \.bank-layout > \.selection-panel,[\s\S]*?position:\s*relative;/s);
});
test("QN12.2 import source, images and preview stay within mobile column",()=>{
  assert.match(editor,/\.source-input,\s*\.editor-grid,\s*\.editor-panel,\s*\.editor-preview,\s*\.preview-question,\s*\.image-row\s*\{[^}]*min-width:\s*0/s);
  assert.match(editor,/\.drop-area input\[type="file"\]\s*\{[^}]*max-width:\s*100%/s);
  assert.match(editor,/\.image-row\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(editor,/\.source-input\s*\{[^}]*font-size:\s*1rem/);
});
test("QN12.2 author save controls remain reachable on a narrow phone",()=>{
  assert.match(editor,/\.editor-actions > \.save-state,\s*\.editor-actions > \.actions\s*\{[^}]*flex:\s*1 1 100%/s);
  assert.match(editor,/\.editor-actions \.actions > \.button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(editor,/\.dock-card\s*\{[^}]*grid-template-areas:\s*"title" "hint" "action"/s);
});
test("QN12.2 keeps existing real author data/action paths unchanged",()=>{
  assert.match(quiz,/api\("importProblemBatch"/);
  assert.match(quiz,/api\("saveQuizDraft"/);
  assert.match(quiz,/api\("publishQuiz"/);
  assert.match(bank,/api\("getProblem"/);
});

test("QN12.2 bank card toolbar wraps into 44px buttons on small viewports",()=>{
  assert.match(cards,/@media \(max-width: 600px\)\s*\{[^}]*\.prob-tabs\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(cards,/\.tab-actions \.action-btn\s*\{[^}]*flex:\s*0 0 44px;[^}]*width:\s*44px;[^}]*height:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(cards,/\.prob-select\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(cards,/@media \(hover: none\)\s*\{[^}]*\.action-btn\[data-tooltip\]:hover::before\s*\{[^}]*opacity:\s*0;/s);
});

test("QN12.2 selected-problem controls remain in page flow above cards",()=>{
  assert.match(editor,/body\[data-page="problems"\] \.bank-layout > \.selection-panel,[\s\S]*?position:\s*relative;/s);
  assert.match(editor,/grid-template-areas:\s*"selection" "bank"/);
  assert.match(bank,/panelHome\.prepend\(panel\)/);
  assert.doesNotMatch(bank,/document\.body\.append\(panel\)/);
});

test("QN12.2 problem bank selection label is 44px at phone and tablet widths",()=>{
  assert.match(cards,/\.prob-select\s*\{[^}]*display:\s*inline-grid;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(cards,/\.prob-select input\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;/s);
});

test("QN12.2 compact selection panel stays in bank layout",()=>{
  assert.match(bank,/compactLayout = matchMedia\("\(max-width: 899px\)"\)/);
  assert.match(bank,/panelHome\.prepend\(panel\)/);
  assert.match(bank,/panelHome\.append\(panel\)/);
  assert.doesNotMatch(bank,/document\.body\.append\(panel\)/);
});

test("QN12.2 mobile header prevents large-text min-content width and preserves profile accessibility",()=>{
  assert.match(layout,/\.header-inner\s*\{[^}]*min-width:\s*0;[^}]*gap:\s*10px;/s);
  assert.match(layout,/\.brand\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*0 1 auto;[^}]*overflow:\s*hidden;/s);
  assert.match(layout,/#account-link > span:last-child\s*\{\s*display:\s*none;/s);
  assert.match(shell,/account\.setAttribute\("aria-label", s\.authResolved && !s\.user \? "Sign in" : "Profile"\)/);
});
