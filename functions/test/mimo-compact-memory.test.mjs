import test from "node:test";
import assert from "node:assert/strict";
import {createMemoryCompactor,memoryPrompt} from "../src/mimo/compact-memory.js";

const task={
  uid:"teacher_1",threadId:"f6c244c8-435c-4ced-aae3-5faabf3cacaf",
  claimId:"3c5b1e49-4ac6-4e5f-b731-845095e4704c",fromTurn:0,throughTurn:3,
  oldSummary:"Teacher is studying quadratic equations.",
  messages:[{role:"user",content:"Explain factoring x²+3x+2."},
    {role:"assistant",content:"Factor (x+1)(x+2)."}],
};
const secret="server_owned_secret_at_least_32_chars";
const reply=id=>new Response(JSON.stringify({
  id,status:"completed",output:{exports:{reply:"User studies quadratics; factor x²+3x+2=(x+1)(x+2)."}},
}),{status:201,headers:{"content-type":"application/json"}});
test("compact memory sends only prior summary and bounded unsummarized turns",()=>{
  const input=JSON.parse(memoryPrompt(task));
  assert.equal(input.recent_history.length,0);
  assert.match(input.message,/quadratic equations/);
  assert.match(input.message,/x²\+3x\+2/);
  assert.ok(input.message.length<4000);
  assert.doesNotMatch(input.message,/Authorization:/);
});

test("one durable claim yields exactly one capped Mimo model invocation",async()=>{
  const seen=[],saved=[];
  const store={
    claimMemoryTask:async()=>task,
    completeMemoryTask:async(t,summary)=>{saved.push({t,summary});return true;},
    failMemoryTask:async()=>{throw Error("Should not fail");},
  };
  const worker=createMemoryCompactor({
    store,projectKey:secret,
    fetchImpl:async(url,opts)=>{seen.push({url,opts});return reply("a1b2c3d4-1111-2222-3333-aabbccddeeff");},
  });
  assert.deepEqual(await worker(),{processed:1});
  assert.equal(seen.length,1);
  const data=JSON.parse(seen[0].opts.body);
  assert.equal(data.background,false);
  assert.equal(data.cost_limit_usd,0.003);
  assert.equal(data.cost_mode,"hard");
  assert.ok(saved[0].summary.length<=1600);
});

test("uncertain Mimo outcome is not retried and is marked attention",async()=>{
  let hits=0,failed=0;
  const worker=createMemoryCompactor({
    store:{claimMemoryTask:async()=>task,
      completeMemoryTask:async()=>{throw Error("should not save");},
      failMemoryTask:async()=>{failed++;}},
    projectKey:secret,
    fetchImpl:async()=>{hits++;throw Error("timeout");},
  });
  assert.deepEqual(await worker(),{processed:0,attention:1});
  assert.equal(hits,1);assert.equal(failed,1);
});
