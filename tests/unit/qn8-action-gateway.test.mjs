import test from "node:test";
import assert from "node:assert/strict";
import { createQuizerNeonActionGateway } from "../../functions/src/neon/action-gateway.js";

const teacher={uid:"teacher_a",role:"teacher",accountStatus:"active",emailVerified:true};
const identity={uid:"firebase-verified-a"};
const requestId="request_0123456789abcdef";
function fake() {
  const calls=[];let identities=0,jobs=0;
  const gateway=createQuizerNeonActionGateway({
    enabled:true,
    writer:{
      enabled:true,
      async createProblem(value){calls.push({action:"create",value});return {problemId:"prb_1"};},
      async saveProblemRevision(value){calls.push({action:"save",value});return {revisionId:"prv_1"};},
      async importProblemBatch(value){calls.push({action:"import",value});return {mappings:[]};},
    },
    async resolveFirebaseActor(auth){
      identities++;
      assert.equal(auth,identity);
      return {...teacher};
    },
    async readFirebaseImportJob({jobId,actor}){
      jobs++;
      assert.equal(jobId,"job_1");
      assert.equal(actor.uid,teacher.uid);
      return {kind:"import",status:"running",requestedBy:teacher.uid,
        sourceAssetId:"ast_original_tex"};
    },
  });
  return {gateway,calls,get identities(){return identities},get jobs(){return jobs}};
}
test("gateway remains default-off and never calls Firebase or Neon",async()=>{
  const a=createQuizerNeonActionGateway();
  assert.equal(a.enabled,false);
  assert.deepEqual(await a.handle("createProblem",null,{}),{disabled:true});
});
test("gateway rejects activation without trusted loaders",()=>{
  assert.throws(()=>createQuizerNeonActionGateway({enabled:true,writer:{enabled:true}}),
    /trusted Firebase/);
});
test("create and save action envelopes retain original action names",async()=>{
  const f=fake(), data={metadata:{title:"A"},content:{},grading:{}};
  await f.gateway.handle("createProblem",identity,{
    apiVersion:2,action:"createProblem",requestId,...data,
  });
  await f.gateway.handle("saveProblemRevision",identity,{
    apiVersion:2,action:"saveProblemRevision",requestId,
    problemId:"prb_1",expectedVersion:2,metadata:data.metadata,
  });
  assert.deepEqual(f.calls.map(x=>x.action),["create","save"]);
  assert.equal(f.calls[0].value.actor.uid,teacher.uid);
  assert.equal(f.calls[0].value.requestId,requestId);
  assert.equal(f.calls[1].value.expectedVersion,2);
  assert.equal(f.identities,2);
  assert.equal(f.jobs,0);
});
test("import resolves authoritative job from Firestore; ignores no supplied owner",async()=>{
  const f=fake();
  await f.gateway.handle("importProblemBatch",identity,{
    apiVersion:2,action:"importProblemBatch",requestId,jobId:"job_1",records:[],
  });
  assert.equal(f.jobs,1);
  assert.equal(f.calls[0].value.job.requestedBy,teacher.uid);
  assert.equal(f.calls[0].value.job.sourceAssetId,"ast_original_tex");
});
test("request cannot supply spoofed actor, job, role, or account identity",async()=>{
  const f=fake();
  await assert.rejects(f.gateway.handle("createProblem",identity,{
    apiVersion:2,action:"createProblem",requestId,
    actor:{uid:"admin"},metadata:{},content:{},grading:{},
  }),err=>err.reason==="INVALID_FIELDS");
  await assert.rejects(f.gateway.handle("importProblemBatch",identity,{
    apiVersion:2,action:"importProblemBatch",requestId,jobId:"job_1",
    requestedBy:"admin",records:[],
  }),err=>err.reason==="INVALID_FIELDS");
  assert.equal(f.identities,0);
  assert.equal(f.calls.length,0);
});
test("unknown action and invalid request ID are refused before lookup",async()=>{
  const f=fake();
  await assert.rejects(f.gateway.handle("deleteDatabase",identity,{
    apiVersion:2,action:"deleteDatabase",requestId,
  }),err=>err.reason==="INVALID_FIELDS");
  await assert.rejects(f.gateway.handle("createProblem",identity,{
    apiVersion:2,action:"createProblem",requestId:"tiny",
    metadata:{},content:{},grading:{},
  }),err=>err.reason==="INVALID_FIELDS");
  assert.equal(f.identities,0);
});
test("student identity is rejected before any bank write",async()=>{
  let bankCalls=0;
  const f=createQuizerNeonActionGateway({enabled:true,
    writer:{enabled:true,createProblem:()=>{bankCalls++;}},
    resolveFirebaseActor:async()=>({uid:"student_1",role:"student",
      emailVerified:true,accountStatus:"active"}),
    readFirebaseImportJob:async()=>{throw Error("should not happen");},
  });
  await assert.rejects(f.handle("createProblem",identity,{
    apiVersion:2,action:"createProblem",requestId,
    metadata:{},content:{},grading:{},
  }),err=>err.reason==="ROLE_REQUIRED");
  assert.equal(bankCalls,0);
});
