// QN12-B — pure scheduling guarantees for mobile/large-quiz UX.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {saveBeforeNavigate,prefetchQuestionBatches}
  from "../../js/services/runner-scheduling.js";
const source=readFileSync(new URL("../../js/pages/quiz.js",import.meta.url),
  "utf8");
test("QN12-B navigation waits for successful answer commit",async()=>{
  const sequence=[];
  let unblockSave;
  const waiting=new Promise(resolve=>{unblockSave=resolve;});
  const navigation=saveBeforeNavigate(async()=>{
    sequence.push("saving");
    await waiting;
    sequence.push("saved");
  },async()=>{sequence.push("navigated");return {currentFrontier:2};});
  await Promise.resolve();
  assert.deepEqual(sequence,["saving"]);
  unblockSave();
  assert.deepEqual(await navigation,{currentFrontier:2});
  assert.deepEqual(sequence,["saving","saved","navigated"]);
});
test("QN12-B refused/stale answer save never sends server navigation",async()=>{
  let called=false;
  await assert.rejects(saveBeforeNavigate(
    async()=>{throw Error("save conflict");},
    async()=>{called=true;}),/save conflict/);
  assert.equal(called,false);
  assert.match(source,/const state = await saveBeforeNavigate\(/);
  assert.doesNotMatch(source,/const \[, state\] = await Promise\.all\(\[/);
});
test("QN12-B 500 problems are fetched in at most two 20-item requests",async()=>{
  const ids=Array.from({length:500},(_,i)=>"itm_"+i);
  const seen=[],pages=[];
  let active=0,peak=0;
  await prefetchQuestionBatches(ids,async page=>{
    active++;
    peak=Math.max(peak,active);
    pages.push(page.length);
    await new Promise(resolve=>setTimeout(resolve,1));
    seen.push(...page);
    active--;
  });
  assert.equal(pages.length,25);
  assert(pages.every(n=>n<=20&&n>=1));
  assert(peak<=2&&peak>=1);
  assert.equal(new Set(seen).size,500);
  assert.deepEqual(new Set(seen),new Set(ids));
});
test("QN12-B background failures allow later batches and stop during teardown",async()=>{
  const ids=Array.from({length:90},(_,i)=>"itm_"+i);
  const received=[];
  await prefetchQuestionBatches(ids,async page=>{
    received.push(page[0]);
    if(page[0]==="itm_0")throw Error("offline");
  });
  assert.equal(received.length,5);
  let stopping=false,count=0;
  await prefetchQuestionBatches(ids,async()=>{
    count++;
    stopping=true;
  },{shouldStop:()=>stopping});
  assert(count<=2);
});
test("QN12-B fail-closed prefetch bounds and renderer contracts",async()=>{
  for(const opts of [{concurrency:3},{batchSize:21},
    {concurrency:0},{batchSize:-1}])
    await assert.rejects(prefetchQuestionBatches(
      ["itm_1"],async()=>{},opts),TypeError);
  await assert.rejects(prefetchQuestionBatches(
    Array.from({length:501},(_,i)=>"itm_"+i),async()=>{}),TypeError);
  assert.match(source,/await prefetchQuestionBatches\(missing,/);
  assert.match(source,/Promise\.allSettled\(ids\.map\(\(id\) => fetchItem\(id\)\)\)/);
  assert.match(source,/aria-current="step"/);
  assert.match(source,/\.focus\(\{preventScroll:true\}\)/);
  const warm=source.slice(source.indexOf("async function warmAll()"),
    source.indexOf("async function showQuestion()"));
  assert.doesNotMatch(warm,/loadImages\(/);
});
