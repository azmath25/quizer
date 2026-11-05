import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {initializeApp,getApps} from "../../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import {getFirestore,Timestamp} from "../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js";
import {getAuth} from "../../functions/node_modules/firebase-admin/lib/esm/auth/index.js";
import {dispatch} from "../../functions/src/router.js";

assert(process.env.FIRESTORE_EMULATOR_HOST,"Firestore emulator required");
if(!getApps().length)
  initializeApp({projectId:"demo-mathquiz-v2",
    storageBucket:"demo-mathquiz-v2.appspot.com"});
const db=getFirestore(),uid="publish_noop_"+randomUUID().slice(0,8);
const actor={uid,token:{email:"publish-qa@example.test",
  email_verified:true,name:"Publish QA"}};
const api=async(action,request={},requestId=randomUUID())=>
  (await dispatch(db,actor,{apiVersion:2,action,requestId,...request})).data;
const stamp=s=>s.updateTime.seconds+":"+s.updateTime.nanoseconds;

test("publishing an unchanged already-live quiz creates no new job, writes or audit",async()=>{
  await getAuth().createUser({uid,email:"publish-"+uid+"@example.test",
    emailVerified:true});
  await db.doc("roles/"+uid).set({
    role:"teacher",accountStatus:"active",version:1,updatedAt:Timestamp.now()});
  await api("getSessionInfo");
  const p=await api("createProblem",{
    metadata:{title:"Arithmetic",subject:"Math",difficulty:"Practice",
      tags:[],bankVisibility:"private"},
    content:{type:"open",answerMode:"auto",statementLatex:"Compute 2+2.",
      options:[],defaultPoints:1,questionAssetBindings:{}},
    grading:{correctOptionId:null,acceptedAnswers:["4"],tolerance:0,
      explanationLatex:"",rubricLatex:"",solutionAssetBindings:{}},
  });
  const q=await api("createQuiz",{title:"Existing quiz"});
  const qid=q.quizId,base="quizzes/"+qid,quizRef=db.doc(base),
    draftRef=db.doc(base+"/drafts/current");
  const ids=["itm_one","itm_two"];
  await db.doc(base+"/draftItems/"+ids[0]).set({
    itemId:ids[0],problemId:p.problemId,problemRevisionId:p.revisionId,
    points:1,reuseFromQuizRevisionId:null});
  await db.doc(base+"/draftItems/"+ids[1]).set({
    itemId:ids[1],problemId:p.problemId,problemRevisionId:p.revisionId,
    points:1,reuseFromQuizRevisionId:null});
  await draftRef.update({itemOrder:ids});
  const initialDraft=(await draftRef.get()).data();
  const revId="qrv_existing";
  await db.doc(base+"/revisions/"+revId).set({
    state:"ready",sourceDraftVersion:initialDraft.version,
    itemCount:ids.length,itemOrder:[...ids],title:initialDraft.title,
    description:initialDraft.description,subject:initialDraft.subject,
    difficulty:initialDraft.difficulty,settings:{...initialDraft.settings},
  });
  await quizRef.update({publishedRevisionId:revId,
    lastPublishedRevisionId:revId,publishedAt:Timestamp.now()});
  const quizBefore=await quizRef.get(),draftBefore=await draftRef.get();
  const jobsBefore=(await db.collection("jobs").get()).size;
  const revisionsBefore=(await db.collection(base+"/revisions").get()).size;
  const noopId=randomUUID();
  const outcome=await api("publishQuiz",{
    quizId:qid,expectedVersion:quizBefore.data().version,
    expectedDraftVersion:draftBefore.data().version,
  },noopId);
  assert.deepEqual(outcome,{unchanged:true,revisionId:revId,jobId:null});
  assert.equal(stamp(await quizRef.get()),stamp(quizBefore));
  assert.equal(stamp(await draftRef.get()),stamp(draftBefore));
  assert.equal((await db.collection("jobs").get()).size,jobsBefore);
  assert.equal((await db.collection(base+"/revisions").get()).size,revisionsBefore);
  assert.equal((await db.doc("operations/"+uid+"/requests/"+noopId).get()).exists,false);

  // Reordering alone must no longer be misclassified as an unchanged publish.
  const changed=await api("saveQuizDraft",{
    quizId:qid,expectedDraftVersion:draftBefore.data().version,
    itemOrder:[...ids].reverse(),
  });
  assert.equal(changed.draftVersion,draftBefore.data().version+1);
  const revision=await api("publishQuiz",{
    quizId:qid,expectedVersion:changed.version,
    expectedDraftVersion:changed.draftVersion,
  });
  assert(revision.jobId && !revision.unchanged);
  assert.equal((await db.collection("jobs").get()).size,jobsBefore+1);
});
