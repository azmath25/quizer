import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createQuizerBankCompatibility} from "../../functions/src/neon/bank-compat.js";
import {createQuizerDraftCompatibility} from "../../functions/src/neon/draft-compat.js";

const owner={uid:"teacher_alpha",role:"teacher",emailVerified:true,
  accountStatus:"active"};
const other={...owner,uid:"teacher_beta"};
const student={...owner,uid:"student_gamma",role:"student"};
const auth={uid:owner.uid,token:{email_verified:true}};
const stamp=n=>new Date(Date.UTC(2026,10,3,12,n,0)).toISOString();
const header=(id,origin,minute,overrides={})=>({
  id,problemId:id,ownerId:owner.uid,title:id,searchTitle:id.toLowerCase(),
  bankVisibility:"private",lifecycle:"active",updatedAt:stamp(minute),
  tags:["parity"],subject:"Math",difficulty:"Practice",origin,...overrides,
});
const oldRows=[header("prb_b","legacy",3),header("prb_d","legacy",1)];
const neonRows=[header("prb_a","neon",4),header("prb_c","neon",2)];
function setupBank({old=oldRows,neon=neonRows,origin={},failNeon=false}={}){
  const events=[],done=new Map();
  const sort=(rows,opts)=>rows.filter(x=>
    (!opts.subject||x.subject===opts.subject)&&
    (!opts.difficulty||x.difficulty===opts.difficulty)&&
    (!opts.tag||x.tags.includes(opts.tag))&&
    (!opts.search||x.searchTitle.startsWith(opts.search.toLowerCase()))&&
    (opts.view==="shared"?x.bankVisibility==="teachers":
      x.ownerId===opts.actor.uid&&x.lifecycle===opts.lifecycle)&&
    (!opts.after || (opts.search
      ? x.searchTitle>opts.after.searchTitle||
        (x.searchTitle===opts.after.searchTitle&&x.id>opts.after.problemId)
      : x.updatedAt<opts.after.updatedAt||
        (x.updatedAt===opts.after.updatedAt&&x.id<opts.after.problemId)))
    ).sort((a,b)=>opts.search?a.searchTitle.localeCompare(b.searchTitle)||
      a.id.localeCompare(b.id):b.updatedAt.localeCompare(a.updatedAt)||
      b.id.localeCompare(a.id)).slice(0,opts.limit);
  const legacy={
    async listHeaders(opts){events.push("legacy-list");return {items:sort(old,opts)};},
    async handle(action,trusted,r){
      events.push("legacy-"+action);
      return {source:"legacy",action,problemId:r.problemId,version:5};
    },
  };
  const neonReader={
    async listProblemHeaders(opts){
      events.push("neon-list");
      if(failNeon)throw Error("NEON_DOWN");
      return {items:sort(neon,opts)};
    },
    async getProblemForTeacher({actor,problemId,revisionId}){
      events.push("neon-get");
      assert.equal(actor.uid,owner.uid);
      return {problemId,revisionId:revisionId??"prv_one",
        content:{statementLatex:"Proof"},grading:{acceptedAnswers:["2"]}};
    },
    async listProblemRevisions({actor,problemId,after,limit}){
      events.push("neon-history");
      return {items:[{id:"prv_one",revisionNumber:1,
        createdAt:stamp(1),createdBy:actor.uid}],
        next:after?null:{createdAt:stamp(1),revisionId:"prv_one"}};
    },
  };
  const gateway={enabled:true,handle:async()=>{
    events.push("neon-edit");return {problemId:"prb_a",version:2};}};
  const mutations={enabled:true,mutate:async({action})=>{
    events.push("neon-"+action);return {version:2};}};
  const coordinator={enabled:true,
    async prepare({requestId,payloadHash}){
      events.push("prepare");
      const prior=done.get(requestId);
      if(prior){if(prior.hash!==payloadHash)throw Error("PAYLOAD_COLLISION");
        if(prior.result)return {status:"complete",result:prior.result};}
      done.set(requestId,{hash:payloadHash});
      return {status:"prepared",token:"fencing_token_123456"};
    },
    async recordEffect({requestId,result}){
      events.push("effect");done.get(requestId).pending=result;},
    async finalize({requestId,result}){
      events.push("finalize");done.get(requestId).result=result;return result;},
  };
  const bank=createQuizerBankCompatibility({enabled:true,
    resolveFirebaseActor:async()=>owner,
    resolveOrigin:async({problemId})=>origin[problemId] ??
      (problemId==="prb_a"||problemId==="prb_c"?"neon_revision":
        "firestore_legacy"),
    legacy,neonReader,neonGateway:gateway,bankMutations:mutations,
    coordinator,cursorSecret:"Q".repeat(64)});
  const call=(action,r)=>bank.handle(action,auth,{apiVersion:2,action,...r});
  return {bank,events,call,done};
}
test("QN11.4 bank compatibility is OFF without credentials or source ports",async()=>{
  const off=createQuizerBankCompatibility();
  assert.deepEqual(await off.handle(),{disabled:true});
  assert.throws(()=>createQuizerBankCompatibility({enabled:true}),
    /trusted bank ports/);
});
test("hybrid list keeps exact DTO pagination and includes both proven sources",async()=>{
  const f=setupBank(),first=await f.call("listProblems",{limit:2});
  assert.deepEqual(first.items.map(x=>x.id),["prb_a","prb_b"]);
  assert.equal(typeof first.nextCursor,"string");
  const second=await f.call("listProblems",{limit:2,cursor:first.nextCursor});
  assert.deepEqual(second.items.map(x=>x.id),["prb_c","prb_d"]);
  assert.equal(second.nextCursor,null);
  await assert.rejects(f.call("listProblems",{limit:3,cursor:first.nextCursor}),
    e=>e.reason==="INVALID_FIELDS");
  const [body,mac]=first.nextCursor.split(".");
  const tampered=body+"."+(mac[0]==="A"?"B":"A")+mac.slice(1);
  await assert.rejects(f.call("listProblems",{limit:2,cursor:tampered}),
    e=>e.reason==="INVALID_FIELDS");
  assert(f.events.includes("neon-list")&&f.events.includes("legacy-list"));
});
test("hybrid filters never expose private rows through shared view",async()=>{
  const f=setupBank({old:[header("prb_x","legacy",3,{
    bankVisibility:"teachers",subject:"Algebra",tags:["one"]})],
    neon:[header("prb_z","neon",4,{bankVisibility:"teachers",
      subject:"Algebra",tags:["one"]}),
      header("prb_q","neon",5,{bankVisibility:"private",
        subject:"Algebra",tags:["one"]})]});
  const page=await f.call("listProblems",{view:"shared",subject:"Algebra"});
  assert.deepEqual(page.items.map(x=>x.id),["prb_z","prb_x"]);
  assert(!JSON.stringify(page).includes("prb_q"));
  await assert.rejects(f.call("listProblems",{
    subject:"Algebra",tag:"one"}),e=>e.reason==="INVALID_FIELDS");
  const search=await f.call("listProblems",{search:"prb_",limit:2});
  assert.equal(search.items.length,2);
});
test("unknown origin, duplicate cross-store ID and Neon outage fail closed",async()=>{
  const unknown=setupBank({origin:{prb_missing:"unknown"}});
  await assert.rejects(unknown.call("getProblem",{
    problemId:"prb_missing"}),e=>e.reason==="RESOURCE_UNAVAILABLE");
  const duplicate=setupBank({old:[header("same","legacy",2)],
    neon:[header("same","neon",1)]});
  await assert.rejects(duplicate.call("listProblems",{}),
    e=>e.reason==="VERSION_CONFLICT");
  const outage=setupBank({failNeon:true});
  await assert.rejects(outage.call("listProblems",{}),/NEON_DOWN/);
  assert(!outage.events.includes("legacy-getProblem"));
});
test("origin-routed reads and opaque revision pagination cannot cross scopes",async()=>{
  const f=setupBank();
  const neon=await f.call("getProblem",{problemId:"prb_a",revisionId:"prv_old"});
  assert.equal(neon.revisionId,"prv_old");
  assert.equal((await f.call("getProblem",{problemId:"prb_b"})).source,"legacy");
  const a=await f.call("listProblemRevisions",{
    problemId:"prb_a",limit:2});
  assert.equal(a.items[0].id,"prv_one");
  const b=await f.call("listProblemRevisions",{
    problemId:"prb_a",limit:2,cursor:a.nextCursor});
  assert.equal(b.nextCursor,null);
  await assert.rejects(f.call("listProblemRevisions",{
    problemId:"prb_c",limit:2,cursor:a.nextCursor}),
    e=>e.reason==="INVALID_FIELDS");
});
test("bank mutations require fenced Firebase coordinator and keep legacy route",async()=>{
  const f=setupBank();
  const requestId="req_0123456789012345";
  const act="setProblemSharing";
  const r={problemId:"prb_a",expectedVersion:1,
    visibility:"teachers",requestId};
  assert.deepEqual(await f.call(act,r),{version:2});
  await f.call(act,r);
  assert.equal(f.events.filter(x=>x==="neon-"+act).length,1);
  await assert.rejects(f.call(act,{...r,visibility:"private"}),
    /PAYLOAD_COLLISION/);
  const legacy=await f.call("trashProblem",{problemId:"prb_b",
    expectedVersion:1,requestId:"req_legacy_12345678"});
  assert.equal(legacy.source,"legacy");
  assert(f.events.includes("legacy-trashProblem"));
  await assert.rejects(f.call("bulkUpdateProblems",{
    problemIds:["prb_a","prb_b"],addTags:["geometry"],
    requestId:"req_bulk_1234567890"}),e=>e.reason==="FAILED_PRECONDITION");
});
test("actor comes from verified Firebase callback, never request JSON",async()=>{
  const f=setupBank();
  await assert.rejects(f.call("getProblem",{
    problemId:"prb_a",role:"admin"}),e=>e.reason==="INVALID_FIELDS");
  await assert.rejects(f.bank.handle("getProblem",null,{
    apiVersion:2,action:"getProblem",problemId:"prb_a"}),
    e=>e.reason==="AUTH_REQUIRED");
});
const content={type:"open",answerMode:"auto",statementLatex:"2+2",
  options:[],defaultPoints:1,questionAssetBindings:{"diagram.png":"asset1"}};
const grading={correctOptionId:null,acceptedAnswers:["4"],
  tolerance:0,explanationLatex:"",rubricLatex:"",
  solutionAssetBindings:{"answer.png":"asset2"}};
function setupDraft({origin="neon_revision",revoked=false,changed=false,
  retained=null}={}){
  const calls=[],slot={itemId:"itm_1",problemId:"prb_a",
    problemRevisionId:"prv_1",points:2,reuseFromQuizRevisionId:null};
  const owned={quiz:{ownerId:owner.uid,publishedRevisionId:"pub_1"},
    draft:{version:3}};
  const draft=createQuizerDraftCompatibility({enabled:true,
    resolveActor:async()=>owner,
    resolveOrigin:async()=>origin,
    loadOwnedDraft:async()=>owned,
    loadSlots:async()=>[slot],
    neonReader:{getProblemForTeacher:async()=>{
      calls.push("neon");if(revoked)
        throw Object.assign(Error("Revoked"),{reason:"RESOURCE_UNAVAILABLE"});
      return {problemId:slot.problemId,revisionId:slot.problemRevisionId,
        content,grading};}},
    readLegacySource:async()=>{
      calls.push("legacy");
      return {problemId:slot.problemId,revisionId:slot.problemRevisionId,
        content,grading};},
    readRetainedSource:async({retainedRevisionId})=>{
      calls.push("retained");
      assert.equal(retainedRevisionId,"pub_1");
      if(retained===null)
        throw Object.assign(Error("No retained snapshot"),{
          reason:"RESOURCE_UNAVAILABLE"});
      return retained;},
    recheckDraft:async()=>{
      calls.push("recheck");return !changed;},
  });
  return {draft,slot,calls};
}
test("draft reader loads exact Neon pin and authorizes image refs only",async()=>{
  const f=setupDraft();
  const x=await f.draft.getItems({auth,quizId:"quiz_1",itemIds:["itm_1"]});
  assert.equal(x.items[0].content.statementLatex,"2+2");
  assert.equal(x.items[0].grading.acceptedAnswers[0],"4");
  assert.deepEqual(await f.draft.draftAssetIds({
    auth,quizId:"quiz_1",itemIds:["itm_1"]}),["asset1","asset2"]);
  assert(!f.calls.includes("legacy"));
  assert(f.calls.includes("recheck"));
});
test("revoked Neon sharing only falls back to matching retained snapshot",async()=>{
  const contentSource={problemId:"prb_a",revisionId:"prv_1",content,grading};
  const f=setupDraft({revoked:true,retained:contentSource});
  assert.equal((await f.draft.getItems({auth,quizId:"quiz_1",
    itemIds:["itm_1"]})).items.length,1);
  assert.deepEqual(f.calls,["neon","retained","recheck"]);
  const denied=setupDraft({revoked:true});
  await assert.rejects(denied.draft.getItems({auth,
    quizId:"quiz_1",itemIds:["itm_1"]}),e=>e.reason==="RESOURCE_UNAVAILABLE");
});
test("draft version drift and unverified source provenance never leak results",async()=>{
  const changed=setupDraft({changed:true});
  await assert.rejects(changed.draft.getItems({auth,
    quizId:"quiz_1",itemIds:["itm_1"]}),
    e=>e.reason==="VERSION_CONFLICT");
  const unknown=setupDraft({origin:"not_sure"});
  await assert.rejects(unknown.draft.getItems({auth,
    quizId:"quiz_1",itemIds:["itm_1"]}),
    e=>e.reason==="RESOURCE_UNAVAILABLE");
  await assert.rejects(changed.draft.getItems({auth,
    quizId:"quiz_1",itemIds:["itm_1","itm_1"]}),
    e=>e.reason==="INVALID_FIELDS");
});
test("draft stage stays disabled and keeps live dispatcher/worker untouched",async()=>{
  assert.deepEqual(await createQuizerDraftCompatibility().getItems(),
    {disabled:true});
  const router=readFileSync(new URL(
    "../../functions/src/router.js",import.meta.url),"utf8");
  const worker=readFileSync(new URL(
    "../../functions/src/jobs/worker.js",import.meta.url),"utf8");
  assert.doesNotMatch(router+worker,/bank-compat|draft-compat|bank-mutations/);
});
