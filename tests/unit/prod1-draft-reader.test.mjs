import test from "node:test";
import assert from "node:assert/strict";
import {createProd1DraftReader}
  from "../../functions/src/prod1/draft-reader.js";

const auth={uid:"teacher_1",token:{email_verified:true}};
const actor={uid:"teacher_1",role:"teacher",
  emailVerified:true,accountStatus:"active"};
function fixture(){
  const data={
    "roles/teacher_1":{role:"teacher",accountStatus:"active"},
    "quizzes/quiz_1":{ownerId:"teacher_1",lifecycle:"active",
      publishedRevisionId:"pub_1"},
    "quizzes/quiz_1/drafts/current":{version:5},
    "quizzes/quiz_1/draftItems/itm_1":{
      itemId:"itm_1",problemId:"old_1",problemRevisionId:"rev_1",points:2,
    },
    "problems/old_1":{ownerId:"teacher_1",lifecycle:"active",
      bankVisibility:"private"},
    "problems/old_1/revisions/rev_1":{
      statementLatex:"$x+1=2$",source:{sourceAssetId:null},
      type:"short",questionAssetBindings:[],
    },
    "problems/old_1/revisions/rev_1/grading/main":{
      acceptedAnswers:["1"],solutionAssetBindings:[],
    },
    "quizzes/quiz_1/revisions/pub_1":{state:"ready"},
    "quizzes/quiz_1/revisions/pub_1/items/itm_1":{
      problemId:"old_1",problemRevisionId:"rev_1",statementLatex:"old frozen",
    },
    "quizzes/quiz_1/revisions/pub_1/grading/itm_1":{
      acceptedAnswers:["1"],
    },
  };
  const db={
    data,
    doc(path){return {path,async get(){return {exists:Object.hasOwn(data,path),
      data:()=>data[path]};}};},
    async runTransaction(fn){
      return fn({get:ref=>ref.get()});
    },
  };
  return db;
}
const deps=db=>({
  enabled:true,db,
  resolveActor:async()=>actor,
  resolveProblemOrigin:async({problemId})=>problemId==="old_1"
    ?"firestore_legacy":"neon_revision",
  neonReader:{getProblemForTeacher:async()=>({problemId:"new_1",
    revisionId:"rev_2",content:{statementLatex:"$y=3$"},
    grading:{acceptedAnswers:["3"]}})},
});
test("Prod1 draft reader is disabled by default",()=>{
  assert.equal(createProd1DraftReader().enabled,false);
});
test("legacy source is returned only after a pinned Firestore recheck",async()=>{
  const db=fixture(),reader=createProd1DraftReader(deps(db));
  const ans=await reader.getItems({
    auth,quizId:"quiz_1",itemIds:["itm_1"]});
  assert.equal(ans.items.length,1);
  assert.equal(ans.items[0].content.statementLatex,"$x+1=2$");
  assert.equal(ans.items[0].problemRevisionId,"rev_1");
});
test("fails closed when draft version changes during external read",async()=>{
  const db=fixture();
  const original=db.runTransaction;
  db.runTransaction=fn=>{
    db.data["quizzes/quiz_1/drafts/current"].version=6;
    return original(fn);
  };
  const reader=createProd1DraftReader(deps(db));
  await assert.rejects(reader.getItems({
    auth,quizId:"quiz_1",itemIds:["itm_1"]}),/changed while loading/);
});
test("revoked problem access reads only matching old published snapshot",async()=>{
  const db=fixture();
  db.data["problems/old_1"].ownerId="other";
  const reader=createProd1DraftReader(deps(db));
  const result=await reader.getItems({
    auth,quizId:"quiz_1",itemIds:["itm_1"]});
  assert.equal(result.items[0].content.statementLatex,"old frozen");
  db.data["quizzes/quiz_1/revisions/pub_1"].bundle={generation:"12"};
  await assert.rejects(reader.getItems({
    auth,quizId:"quiz_1",itemIds:["itm_1"]}),/Legacy snapshot unavailable/);
});
test("Neon outage is never treated as permission-revocation fallback",async()=>{
  const db=fixture();
  db.data["quizzes/quiz_1/draftItems/itm_1"].problemId="new_1";
  db.data["quizzes/quiz_1/draftItems/itm_1"].problemRevisionId="rev_2";
  const reader=createProd1DraftReader({
    ...deps(db),neonReader:{
      async getProblemForTeacher(){throw Error("SQL network unavailable");},
    },
  });
  await assert.rejects(reader.getItems({
    auth,quizId:"quiz_1",itemIds:["itm_1"]}),/SQL network unavailable/);
});
test("cannot save draft slots via unapproved hybrid code path",async()=>{
  const reader=createProd1DraftReader(deps(fixture()));
  await assert.rejects(reader.prepareUpserts({}),/release gate/);
});
