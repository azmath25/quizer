import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {studentItem} from "../../shared/schema.js";

const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const quiz=read("js/pages/quiz.js");
const rules=read("js/pages/quiz-rules.js");
const css=read("assets/css/pages/quiz.css");
const legacy=read("functions/src/api/attempts.js");
const privateStart=read("functions/src/bundles/private-start-export.js");

test("start button opens a real rules screen, never a confirmation dialog",()=>{
  const start=quiz.slice(quiz.indexOf('action(root, "#start"'),
    quiz.indexOf('action(root, "#request-access"'));
  assert.match(start,/showQuizRules\(root, q,/);
  assert.doesNotMatch(start,/dialog\(/);
  assert.match(start,/begin:\s*\(\) => api\("startAttempt"/);
  assert.match(start,/history\.replaceState/);
  assert.match(rules,/quiz-overview/);
  assert.match(rules,/overview\.hidden = true/);
  assert.match(rules,/Back to overview/);
  assert.match(rules,/Begin quiz/);
  assert.match(rules,/No countdown|no countdown|no countdown timer|no countdown/);
});
test("rules preparation is frontend-only and does not create a timed attempt",()=>{
  const early=rules.slice(0,rules.indexOf('beginButton.addEventListener("click"'));
  assert.doesNotMatch(early,/startAttempt|getAttemptQuestions|api\(|httpsCallable|fetch\(/);
  assert.match(early,/document\.fonts\?\.ready/);
  assert.match(early,/MathJax\?\.startup\?\.promise/);
  assert.match(rules,/starting = true/);
  assert.match(rules,/beginButton\.disabled = true/);
  assert.match(rules,/backButton\.disabled = true/);
  assert.match(rules,/await begin\(\)/);
  assert.match(rules,/await started\(attempt\)/);
  assert.match(rules,/Resume attempt/);
});
test("first question is safely seeded and old backend response still works",()=>{
  assert.match(quiz,/if \(a\.firstQuestion\?\.itemId === a\.order\[index\]\)\s*seedItem\(a\.firstQuestion\);/);
  assert.match(quiz,/api\("getAttemptQuestions"/);
  assert.match(legacy,/firstQuestion:?\s*[={]/);
  assert.match(privateStart,/firstQuestion:/);
  assert.match(privateStart,/studentItem\(/);
  assert.match(privateStart,/return commitStart\(/);
});
test("student item serialization excludes solutions and hidden answer keys",()=>{
  const row=studentItem({
    itemId:"itm_test",type:"choice",answerMode:"auto",
    statementLatex:"x+1=?",points:1,
    options:[{id:"opt_a",textLatex:"2",correct:true}],
    questionAssetBindings:{},
    grading:{correctOptionId:"opt_a",acceptedAnswers:["2"],
      explanationLatex:"SECRET SOLUTION"},
  });
  assert.equal(row.itemId,"itm_test");
  assert.deepEqual(row.options,[{id:"opt_a",textLatex:"2"}]);
  assert(!JSON.stringify(row).includes("SECRET SOLUTION"));
  assert(!JSON.stringify(row).includes("acceptedAnswers"));
  assert(!Object.hasOwn(row,"grading"));
});
test("rules page has an accessible mobile layout and no blocking modal",()=>{
  assert.match(css,/\.quiz-rules\s*\{/);
  assert.match(css,/\.rules-facts/);
  assert.match(css,/@media \(max-width: 760px\)/);
  assert.match(css,/\.quiz-overview\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(rules,/aria-labelledby/);
  assert.match(rules,/aria-live/);
});
