import test from "node:test";
import assert from "node:assert/strict";
import {createProd1AuthorImagePorts}
  from "../../functions/src/prod1/author-image-ports.js";
import {createQuizerAuthorImageScope}
  from "../../functions/src/bundles/private-author-image-scope.js";
const actor={uid:"teacher_1",role:"teacher",
  emailVerified:true,accountStatus:"active"};
const firebaseAuth={uid:"teacher_1",token:{email_verified:true}};
function fixture({hybrid=false}={}){
  const docs={
    "roles/teacher_1":{role:"teacher",accountStatus:"active"},
    "quizzes/quiz_1":{ownerId:"teacher_1",lifecycle:"active"},
    "quizzes/quiz_1/drafts/current":{
      version:5,itemOrder:["itm_1",...(hybrid?["itm_2"]:[])]},
    "quizzes/quiz_1/draftItems/itm_1":{
      itemId:"itm_1",problemId:"new_1",problemRevisionId:"rev_1"},
    "quizzes/quiz_1/draftItems/itm_2":{
      itemId:"itm_2",problemId:"old_2",problemRevisionId:"rev_2"},
  };
  const db={
    docs,
    doc(path){return {path,async get(){return{
      exists:Object.hasOwn(docs,path),data:()=>docs[path]};}};},
    async runTransaction(fn){
      return fn({get:ref=>db.doc(ref.path).get()});
    },
  };
  let pages=0;
  const draftCompat={async getItems({itemIds}){
    pages++;
    return {items:itemIds.map(itemId=>({
      itemId,content:{questionAssetBindings:{"f.png":"ast_1"}},
      grading:{solutionAssetBindings:{"solution.png":"ast_2"}},
    }))};
  }};
  const resolveProblemOrigin=async({problemId})=>
    problemId.startsWith("old")?"firestore_legacy":"neon_revision";
  const ports=createProd1AuthorImagePorts({
    enabled:true,db,resolveProblemOrigin,draftCompat});
  const scope=createQuizerAuthorImageScope({
    enabled:true,...ports,resolveActor:async()=>actor,
    neonReader:{async getProblemForTeacher({problemId,revisionId}){
      return {problemId,revisionId,content:{
        questionAssetBindings:{"f.png":"ast_1"}},
        grading:{solutionAssetBindings:{"solution.png":"ast_2"}}};
    }},
  });
  return {db,ports,scope,get pages(){return pages}};
}
test("author image ports default OFF and require trusted DB",()=>{
  assert.equal(createProd1AuthorImagePorts().enabled,false);
  assert.throws(()=>createProd1AuthorImagePorts({enabled:true}),
    /Trusted author-image dependencies/);
});
test("Neon problem and draft scopes authorize only declared image IDs",async()=>{
  const f=fixture();
  const authorized=await f.scope.authorize({firebaseAuth,
    context:{kind:"quiz_draft",id:"quiz_1"}});
  assert.deepEqual(authorized,{route:"private",
    assetIds:["ast_1","ast_2"]});
  assert.equal(f.pages,1);
  assert.equal(await f.ports.resolveDraftOrigin({actor,quizId:"quiz_1"}),
    "neon_revision");
});
test("mixed old/New quiz drafts resolve to explicit hybrid provenance",async()=>{
  const f=fixture({hybrid:true});
  assert.equal(await f.ports.resolveDraftOrigin({actor,quizId:"quiz_1"}),
    "hybrid");
  const result=await f.scope.authorize({firebaseAuth,
    context:{kind:"quiz_draft",id:"quiz_1"}});
  assert.deepEqual(result.assetIds,["ast_1","ast_2"]);
});
test("draft version changed during protected image lookup fails closed",async()=>{
  const f=fixture();
  const original=f.ports.draftCompat.getItems;
  f.ports.draftCompat.getItems=async args=>{
    f.db.docs["quizzes/quiz_1/drafts/current"].version=6;
    return original(args);
  };
  await assert.rejects(f.scope.authorize({firebaseAuth,
    context:{kind:"quiz_draft",id:"quiz_1"}}),
    /Draft changed during image lookup/);
});
test("revoked teacher and owner privilege fail scope authorization",async()=>{
  const f=fixture();
  f.db.docs["roles/teacher_1"].role="student";
  assert.equal(await f.ports.recheckDraft({actor,quizId:"quiz_1",
    draftVersion:5,itemOrder:["itm_1"]}),false);
  f.db.docs["roles/teacher_1"].role="teacher";
  f.db.docs["quizzes/quiz_1"].ownerId="another";
  await assert.rejects(f.ports.resolveDraftOrigin({actor,quizId:"quiz_1"}),
    /Owned quiz draft unavailable/);
});
