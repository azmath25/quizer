import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const runner=read("js/pages/quiz.js");
const rules=read("js/pages/quiz-rules.js");
const results=read("js/pages/results.js");
const quizCSS=read("assets/css/pages/quiz.css");
const home=read("js/pages/home.js");
const homeCSS=read("assets/css/pages/home.css");
const manage=read("js/pages/quiz-manage.js");

test("desktop timer is in the Problems rail, and mobile clock has its own sticky header-safe bar",()=>{
  assert.match(runner,/<aside class="panel runner-sidebar"><div class="runner-sidebar-timer">/);
  assert.match(runner,/id="timer" role="timer"/);
  assert.match(runner,/id="timer-mobile" role="timer"/);
  assert.match(runner,/id="mobile-question-position"/);
  assert.match(quizCSS,/@media \(min-width: 901px\)[\s\S]*?\.runner-layout > \.runner-sidebar[\s\S]*?position: sticky;/);
  assert.match(quizCSS,/@media \(max-width: 900px\)[\s\S]*?\.runner-mobile-bar[\s\S]*?position: sticky;/);
  assert.match(quizCSS,/\.runner-mobile-bar[\s\S]*?top: 0;/);
  assert.match(quizCSS,/@media \(max-width: 760px\)[\s\S]*?\.runner-mobile-bar[\s\S]*?top: 0;/);
});

test("timer runs while the first problem loads or a recovery prompt is shown",()=>{
  const tick=runner.indexOf("  // Start the visible countdown before recovery prompts");
  const recover=runner.indexOf("  const recovery = loadRecovery(");
  const first=runner.lastIndexOf("    await showQuestion();");
  assert(tick>=0 && recover>tick && first>recover);
  assert.match(runner.slice(tick,recover),/tick\(\);\s*timer = setInterval\(tick, 1000\);/);
  assert.match(runner,/root\.querySelectorAll\("#timer, #timer-mobile"\)/);
  assert.match(runner,/Could not load the problem\. Your attempt is still running\./);
  assert.match(runner,/id="retry-question"/);
});

test("question and answer controls no longer block on diagram byte downloads",()=>{
  assert.doesNotMatch(runner,/await loadImages\(/);
  assert.match(runner,/import \{ resolveImages \} from "\.\.\/services\/assets\.js"/);
  assert.match(runner,/fillQuestionImages\(bindings, view\);\s*function change/);
  assert.match(runner,/const images = Object\.fromEntries/);
  assert.match(runner,/img\.dataset\.quizImagePending = "true"/);
  assert.match(runner,/img\.src = url/);
  assert.match(runner,/id = "retry-diagrams"/);
  assert.match(runner,/version !== viewSequence/);
});

test("rules start is route-safe, and results retry does not silently consume an attempt",()=>{
  assert.match(rules,/onLeave\(\(\) => \{ left = true; \}\)/);
  assert.match(rules,/if \(left \|\| !panel\.isConnected\) return/);
  assert.match(rules,/if \(left\) return/);
  assert.match(results,/quiz\.html\?id=\$\{encodeURIComponent\(a\.quizId\)\}&retry=\$\{encodeURIComponent\(attemptId\)\}/);
  const retry=results.slice(results.indexOf('action(root, "#retry"'),results.indexOf('for (const kind of ["score"'));
  assert.doesNotMatch(retry,/api\("startAttempt"/);
  assert.match(runner,/sourceAttemptId: retrySource/);
  assert.match(rules,/retrySourceAttemptId/);
});

test("home headings align at the same hierarchy outside their cards",()=>{
  assert.match(home,/<section class="home-section home-results">\s*<div class="section-head">/);
  assert.match(home,/<div class="panel home-results-panel">/);
  assert.match(homeCSS,/\.home-simple \.home-section > \.section-head[\s\S]*?min-height: 40px/);
  assert.match(homeCSS,/\.home-results-panel[\s\S]*?display: flex/);
});

test("opening teacher tabs performs no detailed listing request",()=>{
  const content=manage.slice(manage.indexOf('async function showContent()'),manage.indexOf('async function showAccess()'));
  const access=manage.slice(manage.indexOf('async function showAccess()'),manage.indexOf('async function showResults()'));
  const resultsText=manage.slice(manage.indexOf('async function showResults()'),manage.indexOf('async function showHistory()'));
  assert.match(content,/id="revisions-load"/);
  assert.match(content,/action\(panel, "#revisions-load"/);
  assert.match(access,/id="participants-load"/);
  assert.match(access,/id="links-load"/);
  assert.match(access,/Participants not loaded/);
  assert.doesNotMatch(access,/^\s*await loadParticipants\(\);\s*await loadLinks\(\);/m);
  assert.match(resultsText,/id="results-load"/);
  assert.match(resultsText,/Results not loaded/);
  assert.doesNotMatch(resultsText,/^\s*await load\(\);\s*await stats\(\);/m);
});
