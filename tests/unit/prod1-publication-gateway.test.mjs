import test from "node:test";
import assert from "node:assert/strict";
import {validateProblem,DEFAULT_SETTINGS}
  from "../../shared/schema.js";
import {fingerprint} from "../../functions/src/neon/write-repository.js";
import {createProd1PublicationGateway}
  from "../../functions/src/prod1/publication-gateway.js";

const auth={uid:"teacher_1",token:{email_verified:true}};
const actor={uid:"teacher_1",role:"teacher",
  emailVerified:true,accountStatus:"active"};
const makeRequest=()=>({
  apiVersion:2,action:"publishQuiz",requestId:"publish_123456789abcdefgh",
  quizId:"quiz_1",expectedDraftVersion:5,expectedVersion:7,
});
const normalized=validateProblem({
  type:"open",answerMode:"auto",
  statementLatex:"Solve $x=2$.",
  options:[],defaultPoints:2,questionAssetBindings:{},
},{
  acceptedAnswers:["2"],explanationLatex:"",rubricLatex:"",
  solutionAssetBindings:{},tolerance:0,
});
function makeFixture(count=2,{origin="neon_revision",legacyAt=-1}={}){
  const docs={
    "roles/teacher_1":{role:"teacher",accountStatus:"active"},
    "quizzes/quiz_1":{ownerId:"teacher_1",lifecycle:"active",
      publishingJobId:null,version:7,closesAt:null,
      publishedRevisionId:null,lastPublishedRevisionId:null},
  };
  const order=[];
  for(let i=0;i<count;i++){
    const itemId="itm_"+i,problemId="prb_"+i;
    order.push(itemId);
    docs["quizzes/quiz_1/draftItems/"+itemId]={
      itemId,problemId,problemRevisionId:"prv_"+i,points:2,
    };
    if(origin==="firestore_legacy"||legacyAt===i)
      docs["problems/"+problemId]={ownerId:"teacher_1"};
  }
  docs["quizzes/quiz_1/drafts/current"]={
    version:5,title:"Publication test",
    description:"",subject:"Math",difficulty:"",
    settings:{...DEFAULT_SETTINGS},itemOrder:order,
  };
  let readCount=0,sqlCount=0,legacyCount=0,assetCount=0;
  let inFlight=0,maxInFlight=0,txCount=0,writes=0;
  const db={
    docs,
    doc(path){return {path,async get(){
      readCount++;
      return {exists:Object.hasOwn(docs,path),data:()=>docs[path]};
    }};},
    async runTransaction(callback){
      txCount++;
      const operations=[];
      const tx={
        get:ref=>db.doc(ref.path).get(),
        set(ref,value){operations.push([ref.path,value]);},
      };
      const result=await callback(tx);
      for(const [path,value] of operations){
        writes++;docs[path]=value;
      }
      return result;
    },
  };
  const root={
    enabled:true,db,
    resolveActor:async()=>actor,
    resolveOrigin:async({problemId})=>
      docs["problems/"+problemId]?"firestore_legacy":"neon_revision",
    neonReader:{
      async getProblemForTeacher({problemId,revisionId}){
        sqlCount++;inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
        try {
          await Promise.resolve();
          return {problemId,revisionId,
            problem:{ownerId:"teacher_1",lifecycle:"active"},
            content:{...normalized.content,contentHash:fingerprint(normalized),
              revisionNumber:1,createdAt:"2026-11-04T00:00:00.000Z"},
            grading:{...normalized.grading},
          };
        }finally{inFlight--;}
      },
    },
    verifyAssets:async()=>{assetCount++;return true;},
    legacyDispatch:async(_db,_auth,request)=>{
      legacyCount++;
      return {apiVersion:2,data:{legacy:true,action:request.action}};
    },
  };
  return {root,db,docs,get stats(){return{
    readCount,sqlCount,legacyCount,assetCount,inFlight,
    maxInFlight,txCount,writes,
  }}};
}
test("publication gateway defaults OFF and has no side effects",async()=>{
  const disabled=createProd1PublicationGateway();
  assert.equal(disabled.enabled,false);
  assert.deepEqual(await disabled.publish(auth,makeRequest()),
    {disabled:true});
});
test("private publication stores only pinned metadata, not answer keys",async()=>{
  const f=makeFixture();
  const gateway=createProd1PublicationGateway(f.root);
  const result=await gateway.publish(auth,makeRequest());
  assert(result.jobId.startsWith("job_"));
  assert(result.revisionId.startsWith("qrv_"));
  const job=f.docs["jobs/"+result.jobId];
  const rev=f.docs["quizzes/quiz_1/revisions/"+result.revisionId];
  assert.equal(job.input.bundleMode,"private_bundle_v1");
  assert.equal(job.input.sources.length,2);
  assert.equal(job.status,"queued");
  assert.equal(rev.itemCount,2);
  assert.equal(rev.totalPoints,4);
  assert.equal(rev.state,"building");
  assert.equal(f.docs["quizzes/quiz_1"].publishingJobId,result.jobId);
  const audit=Object.entries(f.docs)
    .filter(([path])=>path.startsWith("auditEvents/"));
  assert.equal(audit.length,1);
  assert.equal(audit[0][1].action,"quiz.publishing");
  const all=JSON.stringify({job,rev,quiz:f.docs["quizzes/quiz_1"]});
  assert(!all.includes("Solve $x=2$"));
  assert(!all.includes('"acceptedAnswers"'));
  assert.equal(f.stats.sqlCount,2);
  assert.equal(f.stats.txCount,1);
});
test("publication replay after quiz enters publishing state skips all Neon",async()=>{
  const f=makeFixture(),gateway=createProd1PublicationGateway(f.root);
  const req=makeRequest(),original=await gateway.publish(auth,req);
  const prior=f.stats;
  const replay=await gateway.publish(auth,req);
  assert.deepEqual(replay,original);
  assert.equal(f.stats.sqlCount,prior.sqlCount);
  assert.equal(f.stats.txCount,prior.txCount);
  assert.equal(f.stats.writes,prior.writes);
  assert.equal(f.docs["quizzes/quiz_1"].version,8);
});
test("globally reused receipt from another action or altered input is rejected",async()=>{
  const f=makeFixture(),g=createProd1PublicationGateway(f.root);
  await g.publish(auth,makeRequest());
  const prior=f.stats.writes;
  await assert.rejects(g.publish(auth,{
    ...makeRequest(),expectedVersion:8}),/Request ID reused/);
  const path="operations/teacher_1/requests/"+makeRequest().requestId;
  f.docs[path].action="saveQuizDraft";
  await assert.rejects(g.publish(auth,makeRequest()),/Request ID reused/);
  assert.equal(f.stats.writes,prior);
});
test("all-Firestore publication remains legacy; mixed source fails closed",async()=>{
  const old=makeFixture(3,{origin:"firestore_legacy"});
  const a=await createProd1PublicationGateway(old.root)
    .publish(auth,makeRequest());
  assert.equal(a.legacy,true);
  assert.equal(old.stats.sqlCount,0);
  assert.equal(old.stats.writes,0);
  const mixed=makeFixture(3,{legacyAt:1});
  await assert.rejects(createProd1PublicationGateway(mixed.root)
    .publish(auth,makeRequest()),/Mixed Firestore\/Neon/);
  assert.equal(mixed.stats.writes,0);
});
test("stale quiz version and disabled actor fail before SQL or writes",async()=>{
  const f=makeFixture();
  f.docs["quizzes/quiz_1"].version=12;
  await assert.rejects(createProd1PublicationGateway(f.root)
    .publish(auth,makeRequest()),/Draft or publishing state changed/);
  assert.equal(f.stats.sqlCount,0);
  const revoked=makeFixture();
  revoked.docs["roles/teacher_1"].accountStatus="disabled";
  await assert.rejects(createProd1PublicationGateway(revoked.root)
    .publish(auth,makeRequest()),/Publication state changed/);
  assert.equal(revoked.stats.writes,0);
});
test("asset rejection or wrong SQL content hash blocks a private job",async()=>{
  const f=makeFixture();
  f.root.verifyAssets=async()=>false;
  await assert.rejects(createProd1PublicationGateway(f.root)
    .publish(auth,makeRequest()),/assets unavailable/);
  assert.equal(f.stats.writes,0);
  const corrupted=makeFixture();
  const old=corrupted.root.neonReader.getProblemForTeacher;
  corrupted.root.neonReader.getProblemForTeacher=async x=>{
    const loaded=await old(x);
    loaded.content.contentHash="0".repeat(64);
    return loaded;
  };
  await assert.rejects(createProd1PublicationGateway(corrupted.root)
    .publish(auth,makeRequest()),/Pinned SQL content hash mismatch/);
  assert.equal(corrupted.stats.writes,0);
});
test("large private publication bounds SQL concurrency and preserves order",async()=>{
  const f=makeFixture(28);
  const out=await createProd1PublicationGateway(f.root)
    .publish(auth,makeRequest());
  const sources=f.docs["jobs/"+out.jobId].input.sources;
  assert.deepEqual(sources.map(s=>s.itemId),
    Array.from({length:28},(_,i)=>"itm_"+i));
  assert.equal(f.stats.sqlCount,28);
  assert(f.stats.maxInFlight<=8);
  assert(f.stats.maxInFlight>1);
});
