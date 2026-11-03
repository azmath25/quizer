import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {initializeApp,getApps}
  from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {getFirestore}
  from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import {createFirestoreBankMutationCoordinator}
  from "../../functions/src/neon/firebase-bank-coordinator.js";
assert(process.env.FIRESTORE_EMULATOR_HOST,
  "QN11.6.5 bank fence tests are Firebase EMULATOR ONLY");
if(!getApps().length)initializeApp({projectId:"demo-mathquiz-v2"});
const db=getFirestore();
const unique=s=>s+randomUUID().replaceAll("-","_");
const error=reason=>e=>e?.reason===reason;
async function fixture(){
  const uid=unique("teacher_"),auth={uid,token:{email_verified:true}};
  await db.doc("roles/"+uid).set({
    role:"teacher",accountStatus:"active",version:1});
  const coordinator=createFirestoreBankMutationCoordinator({enabled:true,db});
  const input={action:"saveProblemRevision",auth,
    requestId:unique("request_"),payloadHash:"e".repeat(64)};
  return {coordinator,input,uid,auth,
    receipt:()=>db.doc("operations/"+uid+"/bankMutations/"+input.requestId)};
}
test("QN11.6.5 Firebase bank mutation port defaults OFF",async()=>{
  assert.deepEqual(await createFirestoreBankMutationCoordinator().prepare(),
    {disabled:true});
  assert.throws(()=>createFirestoreBankMutationCoordinator({
    enabled:true}),error("INVALID_FIELDS"));
});
test("QN11.6.5 Firestore prepare/effect/finalize stores metadata, not protected inputs",async()=>{
  const f=await fixture(),result={id:"prb_1",version:2,
    revisionId:"prv_2"};
  const p=await f.coordinator.prepare(f.input);
  assert.equal(p.status,"prepared");
  assert.match(p.token,/^[0-9a-f-]{36}$/);
  const again=await f.coordinator.prepare(f.input);
  assert.equal(again.token,p.token);
  const rec=await f.coordinator.recordEffect({...f.input,token:p.token,
    result});
  assert.equal(rec.recorded,true);
  assert.deepEqual(await f.coordinator.finalize({
    ...f.input,token:p.token,result}),result);
  const saved=(await (await f.receipt()).get()).data();
  assert.equal(saved.status,"complete");
  assert.equal(saved.result.revisionId,"prv_2");
  assert.equal(JSON.stringify(saved).includes("acceptedAnswers"),false);
  assert.deepEqual(await f.coordinator.prepare(f.input),
    {status:"complete",result});
  assert.deepEqual(await f.coordinator.finalize({
    ...f.input,token:"other",result}),result);
});
test("QN11.6.5 lost SQL ACK and 12 same-request claimants have one fence",async()=>{
  const f=await fixture();
  const contenders=await Promise.all(Array.from({length:12},()=>
    f.coordinator.prepare(f.input)));
  assert.equal(new Set(contenders.map(x=>x.token)).size,1);
  const token=contenders[0].token;
  const reply={id:"prb_once",revisionId:"prv_once"};
  // SQL effect may have committed before Firebase observed its ACK;
  // replayed SQL must be identical and never write protected text.
  await f.coordinator.recordEffect({...f.input,token,result:reply});
  assert.deepEqual(await f.coordinator.recordEffect({...f.input,
    token,result:reply}),{recorded:true});
  assert.deepEqual(await f.coordinator.finalize({
    ...f.input,token,result:reply}),reply);
});
test("QN11.6.5 collision, forged effect, stale lease and role revocation fail closed",async()=>{
  const f=await fixture(),claim=await f.coordinator.prepare(f.input);
  await assert.rejects(f.coordinator.prepare({
    ...f.input,payloadHash:"a".repeat(64)}),error("VERSION_CONFLICT"));
  await assert.rejects(f.coordinator.recordEffect({
    ...f.input,token:"forged",result:{id:"prb_1"}}),
    error("VERSION_CONFLICT"));
  const receipt=await f.receipt();
  await receipt.update({until:new Date(Date.now()-1000)});
  await assert.rejects(f.coordinator.recordEffect({
    ...f.input,token:claim.token,result:{id:"prb_1"}}),
    error("VERSION_CONFLICT"));
  const second=await f.coordinator.prepare(f.input);
  assert.notEqual(second.token,claim.token);
  await db.doc("roles/"+f.uid).update({accountStatus:"disabled"});
  await assert.rejects(f.coordinator.recordEffect({
    ...f.input,token:second.token,result:{id:"prb_1"}}),
    error("ACCOUNT_DISABLED"));
});
test("QN11.6.5 protected problem/answer keys never enter durable receipts",async()=>{
  const f=await fixture(),p=await f.coordinator.prepare(f.input);
  for(const result of [
    {id:"prb_1",grading:{acceptedAnswers:["secret"]}},
    {id:"prb_1",nested:{statementLatex:"secret"}},
    {id:"prb_1",acceptedAnswers:["secret"]},
  ])await assert.rejects(f.coordinator.recordEffect({
    ...f.input,token:p.token,result}),
    error("FAILED_PRECONDITION"));
  assert.equal((await (await f.receipt()).get()).data().status,"prepared");
});
