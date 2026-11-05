import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  isReadAction, mayCacheAction, jobPollDelayMs,
} from "../../js/services/request-policy.js";

const script=readFileSync(new URL("../../js/services/api.js",import.meta.url),"utf8")
  .replace(/^import .*;\n/gm,"")
  .replace(/^export /gm,"");
function deferred() {
  let resolve,reject;
  const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail});
  return {promise,resolve,reject};
}
function harness({responder}={}){
  const listeners=new Map(),requests=[],session={epoch:1};
  let nextId=0,clock=0;
  const timers=[];
  const document={addEventListener(name,callback){
    const list=listeners.get(name)||[];
    list.push(callback);listeners.set(name,list);
  }};
  const crypto={randomUUID:()=>`id_${++nextId}`};
  const firebase={functions:{},functionsSDK:{
    httpsCallable:()=>(payload)=>{
      requests.push(payload);
      return responder
        ? responder(payload,requests.length).then(data=>({data:{data}}))
        : Promise.resolve({data:{data:{ok:true,action:payload.action}}});
    },
  }};
  const factory=new Function(
    "getFirebaseServices","getSession","isReadAction","mayCacheAction",
    "jobPollDelayMs","document","crypto","setTimeout","Date",
    script+"\nreturn {api, apiSWR, warm, waitForJob};",
  );
  const api=factory(async()=>firebase,()=>session,isReadAction,mayCacheAction,
    jobPollDelayMs,document,crypto,
    (cb,delay)=>{timers.push(delay);clock+=delay;queueMicrotask(cb);},
    {now:()=>clock},
  );
  return {...api,requests,timers,session,
    emit:name=>listeners.get(name)?.forEach(fn=>fn())};
}

test("explicit classification refuses mutations including setStar",()=>{
  for(const name of ["getQuizDraft","getAttemptQuestions","listPublicQuizzes",
    "resolveJoinLink","lookupParticipant","getDashboard"])
    assert.equal(isReadAction(name),true,name);
  for(const name of ["setStar","saveAnswers","publishQuiz","saveQuizDraft",
    "submitAttempt","grantQuizAccess","newFutureWrite","getDangerousMutation"])
    assert.equal(isReadAction(name),false,name);
  assert.equal(mayCacheAction("getDashboard"),true);
  for(const name of ["getAttemptQuestions","getAttempt","getAssetLinks",
    "getExportLink","getQuizDraft","listGradeEvents","setStar"])
    assert.equal(mayCacheAction(name),false,name);
});

test("identical concurrent reads share one network call",async()=>{
  const gate=deferred(),h=harness({responder:()=>gate.promise});
  const a=h.api("getAttemptQuestions",{attemptId:"a",itemIds:["q1"]});
  const b=h.api("getAttemptQuestions",{attemptId:"a",itemIds:["q1"]});
  await Promise.resolve();
  assert.equal(h.requests.length,1);
  gate.resolve({items:[{itemId:"q1"}]});
  const results=await Promise.all([a,b]);
  assert.deepEqual(results[0],results[1]);
  assert.equal(h.requests.length,1);
});

test("concurrent identical mutations have distinct server idempotency keys",async()=>{
  const gates=[deferred(),deferred()],h=harness({
    responder:(_payload,n)=>gates[n-1].promise,
  });
  const one=h.api("setStar",{kind:"problem",starred:true});
  const two=h.api("setStar",{kind:"problem",starred:true});
  await Promise.resolve();
  assert.equal(h.requests.length,2);
  assert.notEqual(h.requests[0].requestId,h.requests[1].requestId);
  gates.forEach(x=>x.resolve({ok:true}));
  await Promise.all([one,two]);
});

test("explicit request ID is preserved for idempotent save retries",async()=>{
  const h=harness();
  await h.api("saveAnswers",{attemptId:"a",changes:[]},"same-stable-id");
  await h.api("saveAnswers",{attemptId:"a",changes:[]},"same-stable-id");
  assert.deepEqual(h.requests.map(x=>x.requestId),[
    "same-stable-id","same-stable-id",
  ]);
});

test("uncertain network failures reuse receipt only for the subsequent retry",async()=>{
  let first=true;
  const h=harness({responder:()=>{
    if(first){first=false;return Promise.reject({code:"functions/unavailable"});}
    return Promise.resolve({ok:true});
  }});
  await assert.rejects(h.api("saveQuizDraft",{quizId:"q",patch:{title:"A"}}));
  const retry=await h.api("saveQuizDraft",{quizId:"q",patch:{title:"A"}});
  assert.equal(retry.ok,true);
  assert.equal(h.requests[0].requestId,h.requests[1].requestId);
});

test("a mutation fences a pending old SWR response and invalidates its cache",async()=>{
  const old=deferred();
  let dashboards=0;
  const h=harness({responder:async payload=>{
    if(payload.action==="getDashboard"){
      dashboards++;
      if(dashboards===1)return old.promise;
      return {generation:2};
    }
    return {ok:true};
  }});
  const paintings=[];
  const first=h.apiSWR("getDashboard",{},(v)=>paintings.push(v.generation));
  await Promise.resolve();
  await h.api("setStar",{starred:true});
  old.resolve({generation:1});
  await first;
  assert.deepEqual(paintings,[],"late pre-mutation response must not repaint");
  await h.apiSWR("getDashboard",{},v=>paintings.push(v.generation));
  assert.deepEqual(paintings,[2]);
  assert.equal(dashboards,2);
});

test("SWR never stores sensitive attempts, private grading or signed links",async()=>{
  const h=harness();
  const seen=[];
  await h.apiSWR("getAttempt",{attemptId:"a"},(v,stale)=>seen.push(stale));
  await h.apiSWR("getAttempt",{attemptId:"a"},(v,stale)=>seen.push(stale));
  assert.deepEqual(seen,[false,false]);
  assert.equal(h.requests.length,2);
  h.emit("session-cleared");
});

test("job status polling slows gradually and preserves terminal result",async()=>{
  assert.deepEqual([0,7,8,15,16,23,24,60].map(jobPollDelayMs),
    [1500,1500,2000,2000,3000,3000,5000,5000]);
  let count=0;
  const h=harness({responder:async payload=>
    payload.action==="getJob"
      ? (++count===27 ? {status:"succeeded",result:{done:true}} :
        {status:"running"})
      : {ok:true},
  });
  const observed=[];
  const result=await h.waitForJob("job_1",j=>observed.push(j.status));
  assert.deepEqual(result,{done:true});
  assert.equal(count,27);
  assert.equal(observed.at(-1),"succeeded");
  assert.equal(h.timers.length,26);
  assert(h.timers.some(x=>x>=5000));
});
