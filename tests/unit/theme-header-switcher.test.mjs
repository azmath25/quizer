import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const shell=read("js/components/shell.js");
const profile=read("js/pages/profile.js");
const css=read("assets/css/layout.css");
const ai=read("ai.html");
test("header controls offer accessible Light Dark System modes outside profile",()=>{
  for (const theme of ["light","dark","system"]) {
    assert.match(shell,new RegExp('data-theme-choice="'+theme+'"'));
  }
  assert.match(shell,/class="header-controls"/);
  assert.match(shell,/id="theme-menu"/);
  assert.match(shell,/id="theme-trigger"/);
  assert.match(shell,/aria-pressed/);
  assert.match(shell,/getPreferredTheme/);
  assert.match(css,/\.theme-trigger:focus-visible/);
  assert.match(css,/\.theme-options button\[aria-pressed="true"\]/);
});
test("theme selection is browser-local and does not call Firebase",()=>{
  const code=shell.slice(shell.indexOf('  document.querySelector("#site-header").addEventListener("click"'),shell.indexOf("  watchSession(draw);"));
  assert.match(code,/localStorage\.setItem\(THEME_KEY, theme\)/);
  assert.doesNotMatch(code,/\bapi\(|httpsCallable|fetch\(/);
  assert.match(shell,/if \(THEMES\[preferences\?\.theme\]\) return preferences\.theme;/);
  assert.match(shell,/localStorage\.setItem\("mathquiz\.appearance"/);
  assert.match(shell,/document\.documentElement\.dataset\.theme = theme/);
});
test("profile retains text size but no longer duplicates theme chooser",()=>{
  const template=profile.slice(profile.indexOf('id="appearance"'),profile.indexOf('bindForm(root.querySelector("#profile-form")'));
  assert.match(template,/Text size/);
  assert.match(template,/top navigation/);
  assert.doesNotMatch(template,/\["light", "Light"\]/);
  assert.match(profile,/theme: getPreferredTheme\(profile\.preferences\)/);
});
test("standalone AI Studio appearance icon shares the global three-state choice",()=>{
  assert.match(ai,/GLOBAL_THEME="mathquiz\.theme\.choice"/);
  assert.match(ai,/THEME_MODES=\["light","dark","system"\]/);
  assert.match(ai,/const resolved=mode==="system"\?/);
  assert.match(ai,/localStorage\.setItem\(GLOBAL_THEME,mode\)/);
  assert.match(ai,/id="ic-monitor"/);
});
