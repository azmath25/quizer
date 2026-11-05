import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const app=read("js/app.js");
const router=read("js/core/router.js");
const quiz=read("js/pages/quiz.js");
const scheduling=read("js/services/runner-scheduling.js");

test("opening Quizer does not fire unrelated page-data reads",()=>{
  assert.doesNotMatch(app,/const warmers\s*=/);
  assert.doesNotMatch(app,/setTimeout\(\(\) => \{\s*for\s*\(const file of Object\.keys\(warmers\)\)/);
  assert.doesNotMatch(app,/warm\("listMyAttempts"|warm\("listProblems"|warm\("listMyQuizzes"|warm\("listPublicQuizzes"/);
  assert.match(app,/await startRouter\(renderPage\)/);
  // Module preloading may still occur, without backend/API calls.
  assert.match(router,/loadModule\(file\)\.catch\(\(\) => \{\}\)/);
});

test("quiz runner does not fetch every question when the first opens",()=>{
  assert.doesNotMatch(quiz,/warmAll\(/);
  assert.match(quiz,/function warmNearby\(/);
  assert.match(quiz,/const start = Math\.floor\(\(index \+ 4\) \/ 20\) \* 20/);
  assert.match(quiz,/a\.order\.slice\(start, start \+ 20\)/);
  assert.match(quiz,/concurrency: 1/);
  assert.match(quiz,/batchSize: 20/);
  assert.match(quiz,/if \(warming \|\| !a\.settings\.allowBack \|\| stopped\) return/);
  assert.match(quiz,/await prefetchQuestionBatches\(missing/);
  assert.match(scheduling,/shouldStop\(\)/);
  assert.match(quiz,/fetchItem\(itemId\)/);
});
