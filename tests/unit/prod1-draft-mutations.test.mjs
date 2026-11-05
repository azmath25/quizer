import test from "node:test";
import assert from "node:assert/strict";
import {createProd1DraftMutationGateway}
  from "../../functions/src/prod1/draft-mutations.js";

const auth={uid:"teacher_1",token:{email_verified:true}};
const actor={uid:"teacher_1",role:"teacher",emailVerified:true,
  accountStatus:"active"};
const rid="request_123456789abcdefgh";
const request=(item)=>({apiVersion:2,action:"saveQuizDraft",
  requestId:rid,quizId:"quiz_1",expectedDraftVersion:4,
  upsertItems:item?[item]:[]});
function fixture(){
  const documents={
    "roles/teacher_1":{role:"teacher",accountStatus:"active"},
    "quizzes/quiz_1":{ownerId:"teacher_1",lifecycle:"active",
      version:2,publishingJobId:null},
    "quizzes/quiz_1/drafts/current":{
      version:4,title:"Test",description:"",subject:"Algebra",
      difficulty:"",settings:{},itemOrder:[]},
    "problems/old_1":{ownerId:"teacher_1",
      lifecycle:"active",bankVisibility:"private"},
    "problems/old_1/revisions/rev_old":{statementLatex:"old"},
  };
  let writes=0,transactions=0,sqlCalls=0,legacyCalls=0;
  const db={
    documents,
    get writes(){return writes;},
    get transactions(){return transactions;},
    doc(path){return {path,async get(){return{
      exists:Object.hasOwn(documents,path),
      data:()=>documents[path]};}};},
    async runTransaction(fn){
      transactions++;
      const staging=[];
      const tx={
        get:ref=>db.doc(ref.path).get(),
        set(ref,value){staging.push(["set",ref.path,value]);},
        delete(ref){staging.push(["delete",ref.path]);},
      };
      const result=await fn(tx);
      for(const [action,path,value] of staging){
        writes++;
        if(action==="delete")delete documents[path];
        else documents[path]=value;
      }
      return result;
    },
  };
  const root={
    enabled:true,db,resolveActor:async()=>actor,
    resolveOrigin:async({problemId})=>problemId==="old_1"
      ?"firestore_legacy":"neon_revision",
    neonReader:{async getProblemForTeacher({problemId,revisionId}){
      sqlCalls++;
      return {problemId,revisionId,
        problem:{ownerId:"teacher_1",lifecycle:"active"},
        content:{statementLatex:"secret_neon_statement",
          questionAssetBindings:[]},
        grading:{acceptedAnswers:["secret_correct_answer"],
          solutionAssetBindings:[]}};
    }},
    legacyDispatch:async()=>{legacyCalls++;return {data:{legacy:true}};},
    verifyAssets:async()=>true,
  };
  return {db,root,get sql(){return sqlCalls;},
    get legacy(){return legacyCalls;}};
}
const item={
  clientKey:"client_1",problemId:"new_1",
  problemRevisionId:"rev_1",points:3,
};
test("draft metadata-only change stays in the original Firebase path",async()=>{
  const f=fixture(),g=createProd1DraftMutationGateway(f.root);
  const out=await g.handle(auth,request(null));
  assert.deepEqual(out,{legacy:true});
  assert.equal(f.sql,0);
  assert.equal(f.db.transactions,0);
  assert.equal(f.legacy,1);
});
test("Neon references pin only minimal Firestore metadata, not content",async()=>{
  const f=fixture(),g=createProd1DraftMutationGateway(f.root);
  const out=await g.handle(auth,request(item));
  assert.equal(f.sql,1);
  assert.equal(out.draftVersion,5);
  assert.equal(Object.keys(out.itemIdMap).length,1);
  assert.equal(f.db.documents["quizzes/quiz_1/drafts/current"].version,5);
  assert.equal(f.db.documents["quizzes/quiz_1"].draftVersion,5);
  const serialized=JSON.stringify(f.db.documents);
  assert(!serialized.includes("secret_neon_statement"));
  assert(!serialized.includes("secret_correct_answer"));
});
test("replayed mutation is idempotent, different payload rejected",async()=>{
  const f=fixture(),g=createProd1DraftMutationGateway(f.root);
  const input=request(item);
  const first=await g.handle(auth,input);
  const oldWrites=f.db.writes;
  assert.deepEqual(await g.handle(auth,input),first);
  assert.equal(f.db.writes,oldWrites);
  const altered={...input,upsertItems:[{...item,points:4}]};
  await assert.rejects(g.handle(auth,altered),/reused/);
  assert.equal(f.db.writes,oldWrites);
});
test("SQL outage or cross-owner source fails before Firestore writes",async()=>{
  const f=fixture();
  f.root.neonReader.getProblemForTeacher=async()=>{
    throw Error("Neon is down");};
  const g=createProd1DraftMutationGateway(f.root);
  await assert.rejects(g.handle(auth,request(item)),/Neon is down/);
  assert.equal(f.db.writes,0);
  const y=fixture();
  y.root.neonReader.getProblemForTeacher=async()=>({
    problemId:"new_1",revisionId:"rev_1",
    problem:{ownerId:"another_teacher",lifecycle:"active"},
    content:{},grading:{}});
  await assert.rejects(createProd1DraftMutationGateway(y.root)
    .handle(auth,request(item)),/Owner's pinned Neon revision/);
  assert.equal(y.db.writes,0);
});
test("revoked Firebase role fails under transaction even after SQL preflight",async()=>{
  const f=fixture(),g=createProd1DraftMutationGateway(f.root);
  const original=f.db.runTransaction;
  f.db.runTransaction=fn=>{
    f.db.documents["roles/teacher_1"].accountStatus="disabled";
    return original(fn);
  };
  await assert.rejects(g.handle(auth,request(item)),/Quiz, author or draft changed/);
  assert.equal(f.db.writes,0);
});
test("hybrid save enforces draft version and rejects duplicate order",async()=>{
  const f=fixture();
  f.db.documents["quizzes/quiz_1/drafts/current"].version=8;
  const g=createProd1DraftMutationGateway(f.root);
  await assert.rejects(g.handle(auth,request(item)),/Quiz, author or draft changed/);
  assert.equal(f.db.writes,0);
  const y=fixture();
  const z={...request(item),itemOrder:["client_1","client_1"]};
  await assert.rejects(createProd1DraftMutationGateway(y.root)
    .handle(auth,z),/Draft order must contain/);
  assert.equal(y.db.writes,0);
});
