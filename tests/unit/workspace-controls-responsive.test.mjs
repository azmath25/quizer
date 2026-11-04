import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
test("teacher controls preserve native validated saves and cleanup", () => {
  const s = read("js/components/workspace-controls.js");
  assert.match(s, /form\.requestSubmit\(submit\)/);
  assert.match(s, /onLeave\(dispose\)/);
  assert.match(s, /submit\.disabled/);
  assert.match(s, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(s, /form\.contains\(document\.activeElement\)/);
});
test("both teacher editors install the same shared controls", () => {
  for (const path of ["js/pages/quiz-editor.js","js/components/problem-form.js"]) {
    const s=read(path);
    assert.match(s, /installEditorWorkspace\(\{ root, form \}\)/);
  }
});
test("selection inspector remains responsive without affecting API", () => {
  const problems=read("js/pages/problems.js");
  assert.match(problems,/installBankSearchShortcut\(root\)/);
  assert.match(problems,/const placePanel = \(\) =>/);
  assert.match(problems,/tabletDock\.matches/);
  const css=read("assets/css/pages/editor.css");
  assert.match(css,/\.editor-grid\[data-inspector="closed"\]/);
  assert.match(css,/@media \(max-width: 900px\)/);
  assert.match(css,/\.inspector-toggle \{ display: none; \}/);
});
test("latest backend compatibility utilities remain used on results route", () => {
  const results=read("js/pages/results.js");
  assert.match(results,/minutesBetweenDates/);
  assert.match(read("js/core/date-time.js"),/export/);
});
test("no production deployment configuration changed in this milestone", () => {
  const pkg=read(".github/workflows/quizer-github-pages.yml");
  assert.match(pkg,/work\/quizer-audit-optimization-2026-11/);
  assert.doesNotMatch(pkg,/design\/frontend-context-layout-2026-11-05/);
});
