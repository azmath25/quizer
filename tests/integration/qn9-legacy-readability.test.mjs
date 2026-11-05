import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp } from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import { getFirestore, Timestamp } from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import { getAuth } from "../../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import { dispatch } from "../../functions/src/router.js";
import { buildLegacyPreservationPlan } from "../../functions/src/neon/legacy-preservation.js";
import { syntheticLegacySnapshot } from "../fixtures/qn9-sanitized-legacy.mjs";

assert(process.env.FIRESTORE_EMULATOR_HOST,"QN9 requires emulator (never live Firebase)");
initializeApp({projectId:"demo-mathquiz-v2",storageBucket:"demo-mathquiz-v2.appspot.com"});
const db=getFirestore(),auth=getAuth();
const teacher={uid:"teacher_synthetic",token:{
  email:"teacher@synthetic.invalid",email_verified:true,name:"Synthetic teacher"}};
const student={uid:"student_synthetic",token:{
  email:"student@synthetic.invalid",email_verified:true,name:"Synthetic student"}};
const call=(actor,action,params={})=>dispatch(db,actor,{
  apiVersion:2,action,requestId:randomUUID(),...params}).then(x=>x.data);

test("QN9: legacy published revisions and pinned student results remain readable without any Neon activity",async()=>{
  for(const [actor,role] of [[teacher,"teacher"],[student,"student"]]){
    await auth.createUser({uid:actor.uid,email:actor.token.email,emailVerified:true});
    await db.doc("roles/"+actor.uid).set({
      role,accountStatus:"active",version:1,updatedAt:Timestamp.now(),
    });
  }
  const docs=syntheticLegacySnapshot(2);
  const plan=buildLegacyPreservationPlan({documents:docs});
  assert.equal(plan.ready,true,JSON.stringify(plan.errors));
  const batches=[];
  let batch=db.batch(),count=0;
  for(const [path,data] of Object.entries(docs)){
    batch.set(db.doc(path),data);
    if(++count===100){batches.push(batch);batch=db.batch();count=0;}
  }
  if(count)batches.push(batch);
  for(const b of batches)await b.commit();

  const oldPath="quizzes/quiz_synthetic/revisions/qrv_old/items/itm_0";
  const gradePath="quizzes/quiz_synthetic/revisions/qrv_old/grading/itm_0";
  const attemptPath="attempts/att_synthetic_old";
  const paths=[oldPath,gradePath,attemptPath,
    "attempts/att_synthetic_old/answers/itm_0",
    "attempts/att_synthetic_old/grades/itm_0",
    "assets/ast_original_tex","assets/ast_figure"];
  const before=new Map();
  for(const path of paths){
    const snap=await db.doc(path).get();
    assert(snap.exists,path);
    before.set(path,snap.updateTime.toMillis());
  }

  const draft=await call(teacher,"getQuizDraft",{quizId:"quiz_synthetic"});
  assert.equal(draft.items.length,2);
  assert.deepEqual(draft.draft.itemOrder,["itm_0","itm_1"]);
  const old=await call(teacher,"previewQuizRevision",{
    quizId:"quiz_synthetic",revisionId:"qrv_old",
    itemIds:["itm_0"],includeKeys:true,
  });
  const latest=await call(teacher,"previewQuizRevision",{
    quizId:"quiz_synthetic",revisionId:"qrv_new",
    itemIds:["itm_0"],includeKeys:true,
  });
  assert.equal(old.items[0].content.problemRevisionId,"prv_0_1");
  assert.equal(old.items[0].grading.acceptedAnswers[0],"2");
  assert.equal(latest.items[0].content.problemRevisionId,"prv_0_2");
  assert.equal(latest.items[0].grading.acceptedAnswers[0],"3");
  const result=await call(student,"getAttemptResult",{
    attemptId:"att_synthetic_old",offset:0,limit:1,
  });
  assert.equal(result.attempt.quizRevisionId,"qrv_old");
  assert.equal(result.items[0].solution.acceptedAnswers[0],"2");
  assert.equal(result.items[0].answer.value,"2");
  assert.equal(result.items[0].grade.awarded,2);

  // A read-only preservation audit cannot silently modify old answers,
  // grades, images or quiz revision timestamps.
  assert.equal(buildLegacyPreservationPlan({documents:docs}).manifestHash,
    plan.manifestHash);
  for(const [path,ts] of before){
    const snap=await db.doc(path).get();
    assert.equal(snap.updateTime.toMillis(),ts,
      "Unexpected historical Firebase write: "+path);
  }
  assert.equal((await db.collection("activityOutbox").get()).size,0);
});
