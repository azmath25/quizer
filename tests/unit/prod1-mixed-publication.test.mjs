import test from "node:test";
import assert from "node:assert/strict";
import {validateProblem,DEFAULT_SETTINGS}
  from "../../shared/schema.js";
import {fingerprint}
  from "../../functions/src/neon/write-repository.js";
import {createProd1LegacyPublicationSource}
  from "../../functions/src/prod1/legacy-publication-source.js";
import {createProd1PublicationGateway}
  from "../../functions/src/prod1/publication-gateway.js";
const actor={uid:"teacher_1",role:"teacher",
  emailVerified:true,accountStatus:"active"};
const auth={uid:"teacher_1",token:{email_verified:true}};
const normalized=validateProblem({
  type:"open",answerMode:"auto",statementLatex:"Legacy equation: $x=4$.",
  options:[],defaultPoints:3,questionAssetBindings:{},
},{
  acceptedAnswers:["4"],tolerance:0,
  explanationLatex:"",rubricLatex:"",solutionAssetBindings:{},
});
const request={apiVersion:2,action:"publishQuiz",
  requestId:"request_123456789abcdefgh",quizId:"quiz_1",
  expectedDraftVersion:5,expectedVersion:7};
function fixture(){
  const docs={
    "roles/teacher_1":{role:"teacher",accountStatus:"active"},
    "quizzes/quiz_1":{ownerId:"teacher_1",lifecycle:"active",
      version:7,publishingJobId:null,publishedRevisionId:"old_pub",
      lastPublishedRevisionId:"old_pub"},
    "quizzes/quiz_1/drafts/current":{
      title:"Mixed quiz",description:"",subject:"Algebra",difficulty:"",
      settings:{...DEFAULT_SETTINGS},version:5,
      itemOrder:["itm_legacy","itm_neon"]},
    "quizzes/quiz_1/draftItems/itm_legacy":{
      itemId:"itm_legacy",problemId:"old_1",
      problemRevisionId:"old_rev",points:3},
    "quizzes/quiz_1/draftItems/itm_neon":{
      itemId:"itm_neon",problemId:"neon_1",
      problemRevisionId:"neon_rev",points:2},
    "problems/old_1":{ownerId:"teacher_1",lifecycle:"active",
      bankVisibility:"private"},
    "problems/old_1/revisions/old_rev":{
      ...normalized.content,revisionNumber:2,
      createdBy:"teacher_1",contentHash:fingerprint(normalized)},
    "problems/old_1/revisions/old_rev/grading/main":{
      ...normalized.grading,createdAt:new Date()},
    "quizzes/quiz_1/revisions/old_pub":{state:"ready",bundle:null},
    "quizzes/quiz_1/revisions/old_pub/items/itm_legacy":{
      itemId:"itm_legacy",problemId:"old_1",
      problemRevisionId:"old_rev",
      ...normalized.content},
    "quizzes/quiz_1/revisions/old_pub/grading/itm_legacy":{
      ...normalized.grading},
  };
  let sql=0,writes=0;
  const db={
    docs,
    doc(path){return {path,async get(){return{
      exists:Object.hasOwn(docs,path),data:()=>docs[path]};}};},
    async runTransaction(fn){
      const pending=[],
        tx={get:ref=>db.doc(ref.path).get(),
          set:(ref,value)=>pending.push([ref.path,value])};
      const result=await fn(tx);
      for(const [path,value] of pending){docs[path]=value;writes++;}
      return result;
    },
  };
  const legacy=createProd1LegacyPublicationSource({
    enabled:true,db,verifyAssets:async()=>true,
    resolvePublicationActor:async()=>actor,
  });
  const port=createProd1PublicationGateway({
    enabled:true,db,legacySource:legacy,
    resolveActor:async()=>actor,
    resolveOrigin:async({problemId})=>
      problemId==="old_1"?"firestore_legacy":"neon_revision",
    neonReader:{async getProblemForTeacher({problemId,revisionId}){
      sql++;
      const n=validateProblem({
        type:"open",answerMode:"auto",statementLatex:"Solve $y=2$.",
        defaultPoints:2,questionAssetBindings:{},options:[],
      },{
        acceptedAnswers:["2"],tolerance:0,explanationLatex:"",
        rubricLatex:"",solutionAssetBindings:{},
      });
      return {problemId,revisionId,
        problem:{ownerId:"teacher_1",lifecycle:"active"},
        content:{...n.content,contentHash:fingerprint(n)},
        grading:n.grading};
    }},
    verifyAssets:async()=>true,
    legacyDispatch:async()=>{throw Error("Mixed quiz must not use old worker");},
  });
  return {db,docs,legacy,port,get sql(){return sql;},
    get writes(){return writes;}};
}
test("legacy published problem metadata is stripped before normalizing",async()=>{
  const f=fixture();
  const resolved=await f.legacy.preflight({
    actor,quizId:"quiz_1",
    slot:f.docs["quizzes/quiz_1/draftItems/itm_legacy"],
  });
  assert.deepEqual(resolved.content,normalized.content);
  assert.deepEqual(resolved.grading,normalized.grading);
  assert.equal(resolved.contentHash,fingerprint(normalized));
  assert.equal(resolved.source.pathType,"problem");
});
test("mixed source plan pins both modes without question/answer data",async()=>{
  const f=fixture(),result=await f.port.publish(auth,request);
  const job=f.docs["jobs/"+result.jobId];
  assert.deepEqual(job.input.sources.map(s=>s.source.kind),
    ["firestore_legacy","neon_revision"]);
  assert.equal(job.input.sources[0].source.pathType,"problem");
  assert.equal(f.sql,1);
  assert(!JSON.stringify(job).includes("Legacy equation"));
  assert(!JSON.stringify(job).includes("acceptedAnswers"));
  assert.equal(f.writes>0,true);
  const reread=await f.legacy.resolve({
    problemId:"old_1",problemRevisionId:"old_rev",
    source:job.input.sources[0].source,
    plan:{jobId:result.jobId,quizId:"quiz_1",
      revisionId:result.revisionId,leaseOwner:"lease_test",
      sources:job.input.sources},
  });
  assert.deepEqual(reread.content,normalized.content);
});
test("revoked current problem can only use an exact retained snapshot",async()=>{
  const f=fixture(),slot=f.docs["quizzes/quiz_1/draftItems/itm_legacy"];
  f.docs["problems/old_1"].ownerId="other_user";
  const retained=await f.legacy.preflight({
    actor,quizId:"quiz_1",slot,retainedRevisionId:"old_pub"});
  assert.equal(retained.source.pathType,"snapshot");
  const plan={jobId:"job_test",quizId:"quiz_1",
    revisionId:"pub_new",leaseOwner:"lease_test",sources:[{
      ...slot,source:retained.source,contentHash:retained.contentHash,
    }]};
  assert.deepEqual((await f.legacy.resolve({
    problemId:"old_1",problemRevisionId:"old_rev",
    source:retained.source,plan})).content,normalized.content);
  f.docs["quizzes/quiz_1/revisions/old_pub"].bundle={sha256:"0".repeat(64)};
  await assert.rejects(f.legacy.resolve({
    problemId:"old_1",problemRevisionId:"old_rev",
    source:retained.source,plan}),/Pinned retained legacy item/);
});
test("legacy content changes after freezing fail the immutable hash check",async()=>{
  const f=fixture(),slot=f.docs["quizzes/quiz_1/draftItems/itm_legacy"];
  const x=await f.legacy.preflight({actor,quizId:"quiz_1",slot});
  f.docs["problems/old_1/revisions/old_rev"].statementLatex="tampered";
  const plan={jobId:"job_test",quizId:"quiz_1",revisionId:"new_pub",
    leaseOwner:"lease_test",sources:[{...slot,
      source:x.source,contentHash:x.contentHash}]};
  await assert.rejects(f.legacy.resolve({
    problemId:"old_1",problemRevisionId:"old_rev",
    source:x.source,plan}),/Frozen legacy revision changed/);
});
test("unknown or revoked sharing cannot be turned into a private snapshot",async()=>{
  const f=fixture(),slot=f.docs["quizzes/quiz_1/draftItems/itm_legacy"];
  f.docs["problems/old_1"].ownerId="other_user";
  await assert.rejects(f.legacy.preflight({
    actor,quizId:"quiz_1",slot}),/Invalid retained published revision/);
  f.docs["quizzes/quiz_1"].publishedRevisionId="another_pub";
  f.docs["quizzes/quiz_1"].lastPublishedRevisionId="another_pub";
  await assert.rejects(f.legacy.preflight({
    actor,quizId:"quiz_1",slot,retainedRevisionId:"old_pub"}),
    /Retained publication unavailable/);
});
