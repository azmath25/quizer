import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateProblem} from "../../shared/schema.js";
import {fingerprint} from "../../functions/src/neon/write-repository.js";
import {createPinnedNeonPublicationResolver} from "../../functions/src/bundles/pinned-neon-source.js";
import {createQuizerPrivateStartAndExport} from "../../functions/src/bundles/private-start-export.js";
import {createQuizerPrivateIntegration} from "../../functions/src/bundles/private-integration.js";
import {createQuizerPrivateImageSigner} from "../../functions/src/bundles/private-image-signer.js";
import {preparePublishedBundle,makePublishedBundleManifest,BUNDLE_FORMAT,
  BUNDLE_CONTENT_TYPE} from "../../functions/src/bundles/published-bundle.js";
const teacher={uid:"teacher_syn",role:"teacher",emailVerified:true,accountStatus:"active"};
const student={uid:"student_syn",role:"student",emailVerified:true,accountStatus:"active"};
const admin={uid:"admin_syn",role:"admin",emailVerified:true,accountStatus:"active"};
const auth=actor=>({uid:actor.uid,token:{email_verified:true}});
const contentItem={type:"open",answerMode:"auto",statementLatex:"Compute 2+2",
  options:[],defaultPoints:2,questionAssetBindings:{"fig":"ast_picture"}};
const key={correctOptionId:null,acceptedAnswers:["4"],tolerance:0,
  explanationLatex:"It is 4",rubricLatex:"Rubric",
  solutionAssetBindings:{"sol":"ast_solution"}};
const normalized=validateProblem(contentItem,key);
const slot={itemId:"itm_1",problemId:"prb_1",problemRevisionId:"prv_1",
  points:2,source:{kind:"neon_revision",problemId:"prb_1",
    problemRevisionId:"prv_1"},contentHash:fingerprint(normalized)};
const plan={jobId:"job_pub_1",quizId:"quiz_1",revisionId:"qrv_1",
  leaseOwner:"worker_1",sources:[slot]};
const settings={durationSeconds:1200,shuffleQuestions:false,
  shuffleOptions:false,allowBack:false,penalty:0,
  scoreRelease:"immediate",solutionRelease:"manual"};
const bundle=preparePublishedBundle({format:BUNDLE_FORMAT,quizId:"quiz_1",
  revisionId:"qrv_1",revisionNumber:1,title:"Private quiz",
  description:"",subject:"Math",difficulty:"",settings,
  itemOrder:["itm_1"],itemCount:1,totalPoints:2,
  items:[{itemId:"itm_1",problemId:"prb_1",
    problemRevisionId:"prv_1",points:2,content:normalized.content,
    grading:normalized.grading}]});
const manifest=makePublishedBundleManifest(bundle,"901");
const revision={state:"ready",itemOrder:["itm_1"],settings,bundle:manifest};
const why=reason=>error=>error?.reason===reason;
function resolverFixture({hash=slot.contentHash,denyAssets=false,denyActor=false}={}){
  let reads=0,verifications=0;
  const readRepository={async getProblemForTeacher({actor,problemId,revisionId}){
    reads++;assert.equal(actor.uid,teacher.uid);
    assert.equal(problemId,slot.problemId);assert.equal(revisionId,slot.problemRevisionId);
    return {problemId,revisionId,content:normalized.content,
      grading:{...normalized.grading,gradingVersion:1}};
  }};
  const service=createPinnedNeonPublicationResolver({enabled:true,
    readRepository,
    resolvePublicationActor:async({plan:p})=>{
      assert.equal(p.jobId,plan.jobId);
      return denyActor?student:teacher;
    },
    verifyAssets:async({assetIds})=>{
      verifications++;
      assert.deepEqual(assetIds,["ast_picture","ast_solution"]);
      return !denyAssets;
    },
  });
  return {service,get reads(){return reads},
    get verifications(){return verifications}};
}
test("QN11.5 all integration components default OFF",async()=>{
  assert.deepEqual(await createPinnedNeonPublicationResolver().resolve(),
    {disabled:true});
  assert.deepEqual(await createQuizerPrivateStartAndExport().start(),
    {disabled:true});
  assert.deepEqual(await createQuizerPrivateIntegration().handle(),
    {disabled:true});
});
test("pinned publication resolver verifies immutable hash, actor and assets",async()=>{
  const f=resolverFixture();
  const resolved=await f.service.resolve({
    problemId:slot.problemId,problemRevisionId:slot.problemRevisionId,
    source:slot.source,plan});
  assert.equal(resolved.problemId,"prb_1");
  assert.equal(resolved.grading.correctOptionId,null);
  assert.equal(f.reads,1);assert.equal(f.verifications,1);
  await assert.rejects(f.service.resolve({
    problemId:"prb_mismatch",problemRevisionId:slot.problemRevisionId,
    source:slot.source,plan}),why("VERSION_CONFLICT"));
  assert.equal(f.reads,1);
  const changed={...plan,sources:[{...slot,contentHash:"c".repeat(64)}]};
  await assert.rejects(f.service.resolve({
    problemId:slot.problemId,problemRevisionId:slot.problemRevisionId,
    source:slot.source,plan:changed}),why("VERSION_CONFLICT"));
  await assert.rejects(resolverFixture({denyAssets:true}).service.resolve({
    problemId:slot.problemId,problemRevisionId:slot.problemRevisionId,
    source:slot.source,plan}),why("RESOURCE_UNAVAILABLE"));
  await assert.rejects(resolverFixture({denyActor:true}).service.resolve({
    problemId:slot.problemId,problemRevisionId:slot.problemRevisionId,
    source:slot.source,plan}),why("ROLE_REQUIRED"));
});
function startFixture({corrupt=false,deny=false}={}){
  let reads=0,commits=0,exportChecks=0;
  const svc=createQuizerPrivateStartAndExport({enabled:true,
    preflightStart:async({firebaseAuth,quizId})=>({
      authorized:!deny,actorUid:firebaseAuth.uid,
      quizId,revisionId:"qrv_1",selectedItemIds:["itm_1"]}),
    commitStart:async({proof,plan:p})=>{
      commits++;
      assert.equal(proof.revisionId,p.revisionId);
      assert.equal(p.selected[0].points,2);
      assert.deepEqual(p.selected[0].optionIds,[]);
      assert.equal(p.bundleHash,manifest.sha256);
      assert(!JSON.stringify(p).includes("acceptedAnswers"));
      return {attemptId:"att_new",quizRevisionId:p.revisionId};
    },
    authorizeExport:async({jobId})=>({authorized:!deny,jobId,kind:"export_quiz",
      quizId:"quiz_1",revisionId:"qrv_1",leaseOwner:"worker_1",
      status:"running",ownerId:teacher.uid}),
    loadRevision:async()=>revision,
    readPrivateObject:async({generation})=>{
      reads++;return {bytes:Buffer.from(corrupt?"{}":bundle.bytes),
        generation,contentType:BUNDLE_CONTENT_TYPE};
    },
    verifyExportAssets:async({assetIds})=>{
      exportChecks++;assert.deepEqual(assetIds,["ast_picture","ast_solution"]);
      return true;
    },
  });
  return {svc,get reads(){return reads},
    get commits(){return commits},get exportChecks(){return exportChecks}};
}
test("private start verifies full bundle but commits only safe order/options",async()=>{
  const f=startFixture();
  const result=await f.svc.start({firebaseAuth:auth(student),quizId:"quiz_1"});
  assert.deepEqual(result,{attemptId:"att_new",quizRevisionId:"qrv_1"});
  assert.equal(f.reads,1);assert.equal(f.commits,1);
  const denied=startFixture({deny:true});
  await assert.rejects(denied.svc.start({
    firebaseAuth:auth(student),quizId:"quiz_1"}),why("RESOURCE_UNAVAILABLE"));
  assert.equal(denied.reads,0);assert.equal(denied.commits,0);
  const wrong=startFixture({corrupt:true});
  await assert.rejects(wrong.svc.start({
    firebaseAuth:auth(student),quizId:"quiz_1"}),why("RESOURCE_UNAVAILABLE"));
  assert.equal(wrong.commits,0);
});
test("private export only produces internal protected records for authorized job",async()=>{
  const f=startFixture();const result=await f.svc.exportSource({jobId:"job_export"});
  assert.equal(result.quizId,"quiz_1");
  assert.deepEqual(result.records[0].grading.acceptedAnswers,["4"]);
  assert.equal(f.exportChecks,1);
  assert(!JSON.stringify(result).includes("published-bundles"));
  await assert.rejects(startFixture({deny:true}).svc.exportSource({
    jobId:"job_export"}),why("RESOURCE_UNAVAILABLE"));
});
function gatewayFixture({privateOrigin=true,disabled=false}={}){
  const calls=[],actorById=new Map([[student.uid,student],
    [teacher.uid,teacher],[admin.uid,admin]]);
  const legacy={async handle(action,firebaseAuth,request){
    calls.push("legacy-"+action);return {legacy:true,action};
  }};
  const secureAttempts={enabled:true,
    async questions(){calls.push("questions");return {items:[{itemId:"itm_1"}]};},
    async validateAnswers({changes}){calls.push("validate-answers");
      return {validated:true,attemptId:"att_new",
        pinnedRevisionId:"qrv_1",itemIds:changes.map(x=>x.itemId)};},
    async navigationPreview({attemptId,targetIndex}){calls.push("preview");
      return {attemptId,targetIndex,pinnedRevisionId:"qrv_1",
        expectedFrontier:0,expectedUiVersion:0,
        item:{itemId:"itm_1"}};},
    async resultPage(){calls.push("result");return {items:[{}]};},
    async gradeBatch(){calls.push("grade");return {jobId:"job_grade",
      attemptId:"att_new",grades:[],leaseOwner:"lease"};},
    async allowedAssetIds({result}){calls.push("assets-"+result);
      return {assetIds:result?["ast_picture","ast_solution"]:["ast_picture"]};},
  };
  const attemptCommits={enabled:true,
    async saveAnswers(){calls.push("commit-answers");return {answerVersion:2};},
    async navigate(){calls.push("commit-navigation");return {currentFrontier:1};},
    async gradeBatch(){calls.push("commit-grades");return {processed:1};},
  };
  const startExport={enabled:true,
    async start(){calls.push("start");return {attemptId:"att_new"};},
    async exportSource(){calls.push("export");return {internal:true};},
  };
  const publisher={enabled:true,async publish(){calls.push("publish");
    return {activated:true};}};
  const facade=createQuizerPrivateIntegration({enabled:!disabled,
    resolveFirebaseActor:async a=>actorById.get(a.uid),
    resolveAttemptOrigin:async({attemptId})=>privateOrigin&&attemptId==="att_new"
      ?"private_bundle_v1":"firestore_legacy",
    resolveQuizOrigin:async({quizId})=>privateOrigin&&quizId==="quiz_1"
      ?"private_bundle_v1":"firestore_legacy",
    legacy,secureAttempts,attemptCommits,startExport,publisher,
    resolveImageScope:async({attemptId})=>({
      authorized:attemptId==="att_new",itemIds:["itm_1"]}),
    signReadyAssets:async({assetIds})=>({
      links:assetIds.map(assetId=>({assetId,url:"https://files.example/"+assetId}))}),
  });
  const call=(action,actor,body)=>facade.handle(action,auth(actor),{
    apiVersion:2,action,...body});
  return {facade,call,calls};
}
test("private gateway preserves existing callable action names and legacy routing",async()=>{
  const f=gatewayFixture();
  const result=await f.call("getAttemptQuestions",student,{
    attemptId:"att_old",itemIds:["itm_1"]});
  assert.equal(result.legacy,true);
  assert(!f.calls.includes("questions"));
  assert.deepEqual(await f.call("getAttemptQuestions",student,{
    attemptId:"att_new",itemIds:["itm_1"]}),{items:[{itemId:"itm_1"}]});
  assert.deepEqual(await f.call("startAttempt",student,{quizId:"quiz_1"}),
    {attemptId:"att_new"});
  assert((await f.call("startAttempt",student,{quizId:"quiz_old"})).legacy);
  assert.deepEqual(await f.facade.publishJob({jobId:"job_pub"}),{
    activated:true});
  assert.deepEqual(await f.facade.exportSource({jobId:"job_export"}),{
    internal:true});
});
test("private gateway validates before committing answers and navigation",async()=>{
  const f=gatewayFixture();
  const requestId="request_1234567890";
  assert.equal((await f.call("saveAnswers",student,{
    attemptId:"att_new",expectedAnswerVersion:1,requestId,
    changes:[{itemId:"itm_1",value:"4",expectedRevision:0}]})).answerVersion,2);
  assert.deepEqual(f.calls.slice(0,2),["validate-answers","commit-answers"]);
  assert.equal((await f.call("navigateAttempt",student,{
    attemptId:"att_new",targetIndex:0,requestId})).currentFrontier,1);
  assert.deepEqual(f.calls.slice(2,4),["preview","commit-navigation"]);
  await assert.rejects(f.call("saveAnswers",student,{
    attemptId:"att_new",requestId:"short",changes:[],
    expectedAnswerVersion:1}),why("INVALID_FIELDS"));
});
test("private result and image permissions never expose unreleased solutions",async()=>{
  const f=gatewayFixture();
  const result=await f.call("getAttemptResult",student,{
    attemptId:"att_new",offset:0,limit:10});
  assert.equal(result.items.length,1);
  await assert.rejects(f.call("getAdminAttempt",teacher,{
    attemptId:"att_new"}),why("ROLE_REQUIRED"));
  assert.equal((await f.call("getAdminAttempt",admin,{
    attemptId:"att_new"})).items.length,1);
  const image=await f.call("getAssetLinks",student,{
    context:{kind:"attempt",id:"att_new"},assetIds:["ast_picture"]});
  assert.equal(image.links[0].assetId,"ast_picture");
  await assert.rejects(f.call("getAssetLinks",student,{
    context:{kind:"attempt",id:"att_new"},assetIds:["ast_solution"]}),
    why("RESOURCE_UNAVAILABLE"));
  const solution=await f.call("getAssetLinks",student,{
    context:{kind:"result",id:"att_new"},assetIds:["ast_solution"]});
  assert.equal(solution.links.length,1);
  const legacy=await f.call("getAssetLinks",student,{
    context:{kind:"attempt",id:"att_old"},assetIds:["ast_picture"]});
  assert.equal(legacy.legacy,true);
});
test("unsupported, spoofed and unauthenticated private actions fail closed",async()=>{
  const f=gatewayFixture();
  await assert.rejects(f.call("getAttemptQuestions",student,{
    attemptId:"att_new",role:"admin"}),why("INVALID_FIELDS"));
  await assert.rejects(f.facade.handle("getAttemptQuestions",null,{
    apiVersion:2,action:"getAttemptQuestions",attemptId:"att_new",
    itemIds:["itm_1"]}),why("AUTH_REQUIRED"));
  await assert.rejects(f.call("getAssetLinks",student,{
    context:{kind:"attempt",id:"att_new",bundlePath:"foo"},
    assetIds:["ast_picture"]}),why("INVALID_FIELDS"));
  assert.equal((await f.facade.gradeJobBatch({
    jobId:"job_grade",attemptId:"att_new",itemIds:["itm_1"]})).processed,1);
  assert(f.calls.includes("commit-grades"));
});
test("staged integration never imports itself into active router or worker",()=>{
  const router=readFileSync(new URL(
    "../../functions/src/router.js",import.meta.url),"utf8");
  const worker=readFileSync(new URL(
    "../../functions/src/jobs/worker.js",import.meta.url),"utf8");
  assert.doesNotMatch(router+worker,
    /private-integration|private-start-export|private-attempt-commits|pinned-neon-source/);
});

test("QN11.5 image signer restricts ready image objects and two-minute expiry",async()=>{
  const objects=new Map([
    ["ast_picture",{kind:"image",status:"ready",
      storagePath:"assets/teacher_syn/ast_picture/image.png",
      generation:"9",contentType:"image/png"}],
    ["ast_source",{kind:"source",status:"ready",
      storagePath:"sources/teacher_syn/ast_source/original.tex",
      generation:"11",contentType:"text/plain"}],
    ["ast_private",{kind:"image",status:"ready",
      storagePath:"published-bundles/v1/quiz_1/qrv_1/"+"a".repeat(64)+".json",
      generation:"12",contentType:"application/json"}],
    ["ast_pending",{kind:"image",status:"processing",
      storagePath:"assets/teacher_syn/ast_pending/image.png",
      generation:"10",contentType:"image/png"}],
  ]);
  const fakeDb={doc:path=>({async get(){
    const row=objects.get(path.slice(7));
    return {exists:!!row,data:()=>row};
  }})};
  const now=new Date("2026-11-03T14:00:00Z");
  let signed=0;
  const svc=createQuizerPrivateImageSigner({enabled:true,db:fakeDb,
    serverNow:()=>now,
    signImage:async({storagePath,generation,expiresAt})=>{
      signed++;
      assert.equal(storagePath,"assets/teacher_syn/ast_picture/image.png");
      assert.equal(generation,"9");
      assert.equal(expiresAt.valueOf()-now.valueOf(),120000);
      return "https://files.example/ready-image.png?sig=abc";
    }});
  const got=await svc.signReadyAssets({
    firebaseAuth:auth(student),assetIds:["ast_picture"]});
  assert.equal(got.links[0].contentType,"image/png");
  assert.equal(got.links[0].expiresAt.toISOString(),
    "2026-11-03T14:02:00.000Z");
  assert.equal(signed,1);
  for(const key of ["ast_source","ast_private","ast_pending","ast_unknown"])
    await assert.rejects(svc.signReadyAssets({
      firebaseAuth:auth(student),assetIds:[key]}),why("RESOURCE_UNAVAILABLE"));
  assert.equal(signed,1);
  await assert.rejects(svc.signReadyAssets({
    firebaseAuth:auth(student),assetIds:["ast_picture","ast_picture"]}),
    why("INVALID_FIELDS"));
});
test("QN11.5 signing adapter is inert unless explicitly enabled",async()=>{
  assert.deepEqual(await createQuizerPrivateImageSigner().signReadyAssets(),
    {disabled:true});
  assert.throws(()=>createQuizerPrivateImageSigner({enabled:true}),
    /Trusted asset metadata and signing ports/);
});
