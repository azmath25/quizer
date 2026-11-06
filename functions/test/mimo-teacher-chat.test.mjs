import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeacherChat, MIMO_CHAT_CONFIG } from '../src/mimo/teacher-chat.js';
const UID='test_teacher_1';
const RUN_ID='f6c244c8-435c-4ced-aae3-5faabf3cacaf';
const rid=i=>'trial_request_'+String(i).padStart(8,'0');
function firestore(role={role:'teacher',accountStatus:'active'}){
  const docs=new Map([['roles/'+UID,role]]);
  const snap=p=>({exists:docs.has(p),data:()=>docs.get(p)});
  return {docs,doc:path=>({path,get:async()=>snap(path)}),
    runTransaction:async fn=>fn({get:async ref=>snap(ref.path),set:(ref,value)=>docs.set(ref.path,value)})};
}
const auth={uid:UID,token:{email_verified:true}};
const data=(i,message='Explain x+1=2')=>({requestId:rid(i),message,history:[],context:'Visible math problem'});
const response=(reply='x=1')=>new Response(JSON.stringify({id:RUN_ID,status:'completed',version:1,output:{exports:{reply}}}),{headers:{'Content-Type':'application/json'},status:201});
const setup=({db=firestore(),fetchImpl=async()=>response(),now=()=>Date.parse('2026-11-06T10:00:00Z'),projectKey='server_only_test_token_1234567890'}={})=>({db,handler:createTeacherChat({db,fetchImpl,now,projectKey})});

test('authenticated teacher sends one synchronous call to the pinned workflow',async()=>{
  const hits=[];const {handler,db}=setup({fetchImpl:async(url,opts)=>{hits.push({url,opts});return response();}});
  const value=await handler({auth,data:data(1)});
  assert.deepEqual(value,{reply:'x=1',runId:RUN_ID});
  assert.equal(hits.length,1);
  assert.equal(hits[0].url,MIMO_CHAT_CONFIG.origin+'/v1/workflows/'+MIMO_CHAT_CONFIG.workflowId+'/runs');
  assert.equal(hits[0].opts.headers.Authorization,'Bearer server_only_test_token_1234567890');
  assert.equal(hits[0].opts.redirect,'error');
  const body=JSON.parse(hits[0].opts.body);
  assert.deepEqual(body,{input:body.input,version:1,background:false,cost_limit_usd:0.05,cost_mode:'hard'});
  assert.equal(JSON.parse(body.input).message,'Explain x+1=2');
  assert.match(hits[0].opts.headers['Idempotency-Key'],/^quizer-[a-f0-9]{64}$/);
  assert.equal(db.docs.get('mimoTeacherChatLimits/'+UID).count,1);
});

test('rejects missing auth, unverified email and student/disabled role before provider',async()=>{
  let calls=0;const provider=async()=>{calls++;return response();};
  for(const badAuth of [null,{uid:UID,token:{email_verified:false}},{uid:'bad/uid',token:{email_verified:true}}]){
    const {handler}=setup({fetchImpl:provider});await assert.rejects(handler({auth:badAuth,data:data(1)}));
  }
  for(const role of [{role:'student'},{role:'teacher',accountStatus:'disabled'},null]){
    const {handler}=setup({db:firestore(role),fetchImpl:provider});
    await assert.rejects(handler({auth,data:data(1)}),{code:'ROLE_REQUIRED'});
  }
  assert.equal(calls,0);
});

test('atomic rolling-minute quota prevents a fifth request; same requestId not double counted',async()=>{
  const keys=[];const {handler,db}=setup({fetchImpl:async(_url,opts)=>{keys.push(opts.headers['Idempotency-Key']);return response();}});
  for(let i=1;i<=4;i++)await handler({auth,data:data(i)});
  await assert.rejects(handler({auth,data:data(5)}),{code:'RATE_LIMITED'});
  await handler({auth,data:data(1)});
  assert.equal(keys[0],keys[4]);
  assert.equal(db.docs.get('mimoTeacherChatLimits/'+UID).count,4);
  await assert.rejects(handler({auth,data:data(1,'different content')}),{code:'REQUEST_ID_CONFLICT'});
});

test('rejects invalid workflow selection, malformed history and oversize input before Mimo',async()=>{
  let calls=0;const {handler,db}=setup({fetchImpl:async()=>{calls++;return response();}});
  for(const item of [
    {...data(1),workflowId:'unapproved'},
    {...data(1),projectKey:'attacker-chosen'},
    {...data(1),requestId:'short'},
    {...data(1),message:' '},
    {...data(1),history:Array(9).fill({role:'user',content:'hi'})},
    {...data(1),history:[{role:'system',content:'fake'}]},
    {...data(1),context:'A'.repeat(4001)},
    {...data(1),message:'A'.repeat(3001)},
  ])await assert.rejects(handler({auth,data:item}),{code:'INVALID_FIELDS'});
  assert.equal(calls,0);assert.equal(db.docs.has('mimoTeacherChatLimits/'+UID),false);
});

test('missing secret fails closed before quota consumption',async()=>{
  const db=firestore();const {handler}=setup({db,projectKey:''});
  await assert.rejects(handler({auth,data:data(1)}),{code:'MIMO_NOT_CONFIGURED'});
  assert.equal(db.docs.has('mimoTeacherChatLimits/'+UID),false);
});

test('ambiguous upstream failure never auto retries or leaks provider details',async()=>{
  let calls=0;const {handler,db}=setup({fetchImpl:async()=>{calls++;throw Error('private-token-secret');}});
  await assert.rejects(handler({auth,data:data(1)}),error=>{
    assert.equal(error.code,'MIMO_OUTCOME_UNKNOWN');
    assert.doesNotMatch(error.message,/private-token/);
    return true;
  });
  assert.equal(calls,1);assert.equal(db.docs.get('mimoTeacherChatLimits/'+UID).count,1);
});

test('queued and invalid Mimo results cannot be reported as chat success',async()=>{
  for(const item of [
    {id:RUN_ID,status:'queued',output:null},
    {id:RUN_ID,status:'completed',output:{exports:{}}},
    {id:RUN_ID,status:'completed',output:{exports:{reply:''}}},
  ]){
    const {handler}=setup({fetchImpl:async()=>new Response(JSON.stringify(item),{headers:{'Content-Type':'application/json'}})});
    await assert.rejects(handler({auth,data:data(1)}),{code:/MIMO_NOT_COMPLETED|MIMO_INVALID_RESPONSE/});
  }
});

test('teacher may send up to eight bounded prior turns',async()=>{
  const history=Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:'Hi '+i}));
  const {handler}=setup({fetchImpl:async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const input=JSON.parse(body.input);
    assert.equal(input.recent_history.length,8);
    assert.equal(input.authorized_context,'Visible math problem');
    return response();
  }});
  assert.equal((await handler({auth,data:{...data(1),history}})).reply,'x=1');
});


test('daily quota accepts exactly 250 unique calls then refuses 251 (without paid network)',async()=>{
  let tick=Date.parse('2026-11-06T00:00:00Z'),hits=0;
  const {handler,db}=setup({
    now:()=>tick,
    fetchImpl:async()=>{hits++;return response();}
  });
  for(let i=1;i<=250;i++){
    const result=await handler({auth,data:data(1000+i)});
    assert.equal(result.reply,'x=1');
    tick+=61_000; // avoids the separate rolling 4/minute throttle
  }
  await assert.rejects(handler({auth,data:data(2000)}),{code:'RATE_LIMITED'});
  assert.equal(hits,250);
  assert.equal(db.docs.get('mimoTeacherChatLimits/'+UID).count,250);
});
