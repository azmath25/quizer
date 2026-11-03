import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {initializeApp} from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {getFirestore,Timestamp} from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import {getAuth} from "../../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import {dispatch} from "../../functions/src/router.js";
import {fingerprint} from "../../functions/src/neon/write-repository.js";
import {createQuizerNeonOrchestrator} from "../../functions/src/neon/orchestrator.js";
import {createQuizerImportCoordinator} from "../../functions/src/neon/import-coordinator.js";

assert(process.env.FIRESTORE_EMULATOR_HOST,
  "QN11.3 must NEVER access live Firestore");
initializeApp({projectId:"demo-mathquiz-v2"});
const db=getFirestore();
const uid="qn113_teacher",auth={uid,token:{email_verified:true,
  email:"qn113@example.test",name:"QN11.3 teacher"}};
const doc=(path)=>db.doc(path);
const id=()=>randomUUID().replaceAll("-","_");
const item=i=>({importItemKey:"problem_"+i,originalQuestionId:"q"+i,
  metadata:{title:"Problem "+i},content:{statementLatex:"Calculate "+i,
    defaultPoints:1},grading:{acceptedAnswers:["2"]},points:1});
const gatewayCalls=[];
const gateway={enabled:true,replaySafeEdits:true,
  async handle(action,actor,request){
    assert.equal(action,"importProblemBatch");
    assert.equal(actor.uid,uid);
    gatewayCalls.push(request.requestId);
    return {mappings:request.records.map(row=>({
      importItemKey:row.importItemKey,
      itemId:"itm_"+row.importItemKey,
      problemId:"prb_"+row.importItemKey,
      revisionId:"prv_"+row.importItemKey,
      points:row.points,hash:fingerprint(row),version:1,
    })),processedInBatch:request.records.length,newlyInserted:request.records.length};
  }};
async function setup(){
  await getAuth().getUser(uid).catch(async()=>getAuth().createUser({
    uid,email:"qn113@example.test",emailVerified:true}));
  await doc("roles/"+uid).set({role:"teacher",accountStatus:"active",
    version:1,updatedAt:Timestamp.now()});
  const jobId="job_"+id(),targetId="quiz_"+id();
  await doc("jobs/"+jobId).set({
    kind:"import",status:"running",requestedBy:uid,targetId,
    input:{itemCount:100,bankOnly:false,sourceAssetId:"ast_source",
      sourceFingerprint:"a".repeat(64),name:"Draft"},
    progress:{processed:0,total:100,stage:"Importing"},
    importedKeys:[],createdAt:Timestamp.now(),updatedAt:Timestamp.now(),
  });
  return {jobId,targetId};
}
const orchestrator=()=>createQuizerNeonOrchestrator({enabled:true,gateway,
  coordinator:createQuizerImportCoordinator({enabled:true,db})});
const request=(jobId,records,reqid="req_"+id())=>({
  apiVersion:2,action:"importProblemBatch",requestId:reqid,jobId,records,
});
async function call(action,data={}){
  return (await dispatch(db,auth,{apiVersion:2,action,...data})).data;
}
test("QN11.3 live Firestore emulator: durable 20-item checkpoint and exact replay",async()=>{
  const {jobId,targetId}=await setup();
  const o=orchestrator(),records=Array.from({length:20},(_,i)=>item(i));
  const req=request(jobId,records);
  const first=await o.handle(req.action,auth,req);
  assert.equal(first.processed,20);
  assert.equal(first.mappings.length,20);
  const again=await o.handle(req.action,auth,req);
  assert.deepEqual(again,first);
  assert.equal(gatewayCalls.filter(x=>x===req.requestId).length,1);
  const snapshot=await call("getImportCheckpoint",{jobId});
  assert.equal(snapshot.processed,20);
  assert.equal(snapshot.sourceAssetId,"ast_source");
  assert.equal(snapshot.sourceFingerprint,"a".repeat(64));
  assert.equal(snapshot.processedKeys.length,20);
  const stored=await doc("jobs/"+jobId).get();
  assert.equal(stored.data().importClaim,null);
  const mapping=await doc("jobs/"+jobId+"/mappings/problem_3").get();
  assert(mapping.exists);
  const privateDraft=await doc("quizzes/"+targetId+"/draftItems/itm_problem_3").get();
  assert(privateDraft.exists);
  assert.equal((await doc("quizzes/"+targetId).get()).exists,false,
    "unpublished quiz root must not be made public by checkpoint");
  await assert.rejects(o.handle(req.action,auth,{
    ...req,records:[{...item(0),points:3},...records.slice(1)]}),
    e=>e.reason==="VERSION_CONFLICT");
});
test("QN11.3 emulator: 100 items in five batches, resume after new coordinator instance",async()=>{
  const {jobId}=await setup();
  for(let first=0;first<40;first+=20){
    const req=request(jobId,Array.from({length:20},(_,i)=>item(i+first)));
    await orchestrator().handle(req.action,auth,req);
  }
  const resume=await call("getImportCheckpoint",{jobId});
  assert.equal(resume.processed,40);
  for(let first=40;first<100;first+=20){
    const req=request(jobId,Array.from({length:20},(_,i)=>item(i+first)));
    const out=await orchestrator().handle(req.action,auth,req);
    assert.equal(out.processed,first+20);
  }
  const current=await call("getImportCheckpoint",{jobId});
  assert.equal(current.processed,100);
  assert.equal(new Set(current.processedKeys).size,100);
  assert.equal((await doc("jobs/"+jobId).get()).data().importedKeys.length,100);
});
test("QN11.3 emulator: role revocation after SQL blocks Firebase publication",async()=>{
  const {jobId}=await setup();
  const c=createQuizerImportCoordinator({enabled:true,db});
  const req=request(jobId,[item(0)]);
  const expectedItems={jobId,items:[{
    importItemKey:"problem_0",points:1,payloadHash:fingerprint(req.records[0]),
  }]};
  const hash=fingerprint(req);
  const prepared=await c.prepare({action:req.action,auth,requestId:req.requestId,
    payloadHash:hash,expectedItems});
  const result=await gateway.handle(req.action,auth,req);
  await c.recordEffect({action:req.action,auth,requestId:req.requestId,
    payloadHash:hash,token:prepared.token,jobId,result});
  await doc("roles/"+uid).set({role:"student",accountStatus:"active",
    version:2,updatedAt:Timestamp.now()});
  await assert.rejects(c.finalize({action:req.action,auth,
    requestId:req.requestId,payloadHash:hash,token:prepared.token,jobId,result}),
    e=>e.reason==="ROLE_REQUIRED");
  assert.equal((await doc("jobs/"+jobId).get()).data().progress.processed,0);
  assert.equal((await doc("jobs/"+jobId+"/mappings/problem_0").get()).exists,false);
});
test("QN11.3 emulator: fenced concurrent chunks and persisted operation conflict",async()=>{
  const {jobId}=await setup();
  const c=createQuizerImportCoordinator({enabled:true,db});
  const r1=request(jobId,[item(1)]),r2=request(jobId,[item(2)]);
  const one=await c.prepare({action:r1.action,auth,requestId:r1.requestId,
    payloadHash:fingerprint(r1),expectedItems:{jobId,items:[{
      importItemKey:"problem_1",payloadHash:fingerprint(item(1)),points:1}]}});
  assert.equal(one.status,"prepared");
  await assert.rejects(c.prepare({action:r2.action,auth,requestId:r2.requestId,
    payloadHash:fingerprint(r2),expectedItems:{jobId,items:[{
      importItemKey:"problem_2",payloadHash:fingerprint(item(2)),points:1}]}),
    e=>e.reason==="FAILED_PRECONDITION");
  assert.equal((await doc("jobs/"+jobId+"/mappings/problem_2").get()).exists,false);
});
