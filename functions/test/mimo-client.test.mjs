import test from 'node:test';
import assert from 'node:assert/strict';
import { createMimoClient, MimoTransportError } from '../src/mimo/client.js';

const RUN_ID='f6c244c8-435c-4ced-aae3-5faabf3cacaf';
const base = {
  origin: 'https://mimo-execution-hhe6zssqxa-ew.a.run.app',
  projectKey: 'quizer-server-test-only-project-key',
  workflowId: 'math_extract_verify_tikz',
  version: 2,
};
const json=(value,status=200)=>new Response(JSON.stringify(value), {
  status, headers:{'content-type':'application/json'},
});

test('starts a pinned background run with hard spend limit and server-side bearer',async()=>{
  const hits=[];
  const client=createMimoClient({...base,fetchImpl:async(url,opts)=>{
    hits.push({url,opts});return json({id:RUN_ID,status:'queued',version:2},201);
  }});
  const out=await client.start({uid:'teacher1',requestId:'Abcdefghijklmnop',input:'Solve x+1=2'});
  assert.deepEqual(out,{runId:RUN_ID,status:'queued',version:2,output:null});
  assert.equal(hits[0].url,base.origin+'/v1/workflows/math_extract_verify_tikz/runs');
  assert.equal(hits[0].opts.headers.Authorization,'Bearer '+base.projectKey);
  const payload=JSON.parse(hits[0].opts.body);
  assert.deepEqual(payload,{input:'Solve x+1=2',version:2,background:true,cost_limit_usd:0.1,cost_mode:'hard'});
  assert.match(hits[0].opts.headers['Idempotency-Key'],/^quizer-[0-9a-f]{64}$/);
  assert.equal(hits[0].opts.redirect,'error');
});

test('same identity + retry ID produces stable idempotency; other identity differs',async()=>{
  const keys=[];
  const c=createMimoClient({...base,fetchImpl:async(_url,opts)=>{
    keys.push(opts.headers['Idempotency-Key']);return json({id:RUN_ID,status:'started'},201);
  }});
  for(const uid of ['u1','u1','u2'])await c.start({uid,requestId:'abcdefghijklmnop',input:'hello'});
  assert.equal(keys[0],keys[1]);assert.notEqual(keys[1],keys[2]);
});

test('rejects browser-selected origins, paths, workflow IDs and invalid caps',()=>{
  for (const override of [
    {origin:'http://mimo-execution-hhe6zssqxa-ew.a.run.app'},
    {origin:'https://evil.example'},
    {origin:'https://mimo-execution-hhe6zssqxa-ew.a.run.app/private'},
    {origin:'https://mimo-execution-hhe6zssqxa-ew.a.run.app?x=1'},
    {workflowId:'../unapproved'},
    {costLimitUsd:2},
    {version:-1},
  ]) assert.throws(()=>createMimoClient({...base,...override}),MimoTransportError);
});

test('rejects invalid and excessive requests before network',async()=>{
  let called=0;
  const c=createMimoClient({...base,fetchImpl:()=>{called++;return json({id:RUN_ID,status:'queued'});}});
  assert.throws(()=>c.start({uid:'u',requestId:'short',input:'x'}),{code:'MIMO_INVALID_INPUT'});
  assert.throws(()=>c.start({uid:'u',requestId:'abcdefghijklmnop',input:'A'.repeat(12001)}),{code:'MIMO_INVALID_INPUT'});
  assert.throws(()=>c.getRun({runId:'../../runs'}),{code:'MIMO_INVALID_INPUT'});
  assert.equal(called,0);
});

test('GET run uses only verified UUID and no idempotency header',async()=>{
  const hits=[];
  const c=createMimoClient({...base,fetchImpl:async(url,opts)=>{
    hits.push([url,opts]);return json({id:RUN_ID,status:'completed',output:{text:'answer'}});
  }});
  const output=await c.getRun({runId:RUN_ID});
  assert.equal(output.status,'completed');
  assert.equal(hits[0][1].method,'GET');
  assert.equal(hits[0][1].headers['Idempotency-Key'],undefined);
});

test('upstream problems return only fixed error codes and never response content',async()=>{
  for(const [status,expected] of [[401,'MIMO_PROJECT_NOT_AUTHORIZED'],[403,'MIMO_PROJECT_NOT_AUTHORIZED'],[404,'MIMO_WORKFLOW_OR_RUN_NOT_FOUND'],[409,'MIMO_CONFLICT'],[429,'MIMO_RATE_LIMITED'],[503,'MIMO_UPSTREAM_UNAVAILABLE']]){
    const c=createMimoClient({...base,fetchImpl:async()=>json({detail:'secret=do-not-expose'},status)});
    await assert.rejects(c.start({uid:'u',requestId:'abcdefghijklmnop',input:'hello'}),error=>{
      assert.equal(error.code,expected);assert.ok(!String(error).includes('secret'));return true;
    });
  }
});

test('ambiguous POST failure is not retried automatically',async()=>{
  let calls=0;
  const c=createMimoClient({...base,fetchImpl:async()=>{calls++;throw new Error('network fail secret');}});
  await assert.rejects(c.start({uid:'u',requestId:'abcdefghijklmnop',input:'hello'}),{code:'MIMO_OUTCOME_UNKNOWN'});
  assert.equal(calls,1);
});

test('response size and response type are bounded',async()=>{
  const big=createMimoClient({...base,fetchImpl:async()=>json({id:RUN_ID,status:'done',output:'a'.repeat(65537)})});
  await assert.rejects(big.start({uid:'u',requestId:'abcdefghijklmnop',input:'hello'}),{code:'MIMO_INVALID_RESPONSE'});
  const html=createMimoClient({...base,fetchImpl:async()=>new Response('<html>error</html>')});
  await assert.rejects(html.start({uid:'u',requestId:'abcdefghijklmnop',input:'hello'}),{code:'MIMO_INVALID_RESPONSE'});
});
