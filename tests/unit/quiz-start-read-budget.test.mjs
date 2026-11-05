import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initialQuizItemReads}
  from "../../functions/src/domain/quiz-start-plan.js";

const order=Array.from({length:500},(_,i)=>"itm_"+i);
test("unshuffled normal attempt starts with exactly one immutable question read",()=>{
  const plan=initialQuizItemReads(order);
  assert.deepEqual(plan,["itm_0"]);
  assert.equal(plan.length,1);
});
test("shuffled choices and retry mode preserve full question/point materialization",()=>{
  assert.equal(initialQuizItemReads(order,{shuffleOptions:true}).length,500);
  assert.equal(initialQuizItemReads(order,{retry:true}).length,500);
  assert.equal(initialQuizItemReads(order,{
    shuffleOptions:true,retry:true}).length,500);
});
test("invalid published item-order pointers fail before any read",()=>{
  for(const ids of [[],Array(501).fill("x"),["a","a"],["a",null]])
    assert.throws(()=>initialQuizItemReads(ids));
});
test("legacy start uses the bounded plan while client renders default choice order",()=>{
  const backend=readFileSync(new URL("../../functions/src/api/attempts.js",
    import.meta.url),"utf8");
  const client=readFileSync(new URL("../../js/pages/quiz.js",
    import.meta.url),"utf8");
  const start=backend.split('  "startAttempt",')[1]
    ?.split('define("getAttempt"')[0];
  assert.ok(start);
  assert.match(start,/initialQuizItemReads\(order/);
  assert.doesNotMatch(start,/selected\.map\(async \(itemId\) => \[itemId/);
  assert.match(start,/studentItem\(itemDocs\.get\(order\[0\]\)\)/);
  assert.match(client,/a\.optionOrder\?\.\[itemId\] \?\?/);
  assert.match(client,/\(item\.options \?\? \[\]\)\.map/);
});
