import test from "node:test";
import assert from "node:assert/strict";
import {inflateRawSync} from "node:zlib";
import {createHash} from "node:crypto";
import {createPrivateQuizZipWorker} from "../../functions/src/bundles/private-zip-worker.js";
import {createPrivateZipStoragePort} from "../../functions/src/bundles/private-zip-storage.js";
import {createQuizerAuthorImageScope} from "../../functions/src/bundles/private-author-image-scope.js";
const digest=b=>createHash("sha256").update(b).digest("hex");
const fail=reason=>e=>e?.reason===reason;
function entry(zip,name){
  for(let offset=0;offset<zip.length-46;){
    if(zip.readUInt32LE(offset)!==0x02014b50){offset++;continue}
    const length=zip.readUInt16LE(offset+28),
      extra=zip.readUInt16LE(offset+30),
      comment=zip.readUInt16LE(offset+32);
    const filename=zip.subarray(offset+46,offset+46+length).toString();
    if(filename===name){
      const local=zip.readUInt32LE(offset+42);
      assert.equal(zip.readUInt32LE(local),0x04034b50);
      const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
      const size=zip.readUInt32LE(offset+20),
        method=zip.readUInt16LE(offset+10);
      const bytes=zip.subarray(start,start+size);
      return method===8?inflateRawSync(bytes):bytes;
    }
    offset+=46+length+extra+comment;
  }
  throw new Error("Missing ZIP entry "+name);
}
const bundleHash="a".repeat(64);
const plan={authorized:true,jobId:"job_1",kind:"export_quiz",
  status:"running",quizId:"quiz_1",revisionId:"qrv_1",
  ownerId:"teacher_1",leaseOwner:"lease_1",
  manifest:{sha256:bundleHash,generation:"901",itemCount:1}};
const source={quizId:plan.quizId,revisionId:plan.revisionId,
  itemCount:1,revision:{state:"ready",
    title:"Private Quiz",itemOrder:["itm_1"],
    bundle:{sha256:bundleHash,generation:"901"}},
  records:[{itemId:"itm_1",problemId:"prb_1",
    problemRevisionId:"prv_1",points:2,
    content:{statementLatex:"Question and diagram",
      questionAssetBindings:{picture:"ast_1"}},
    grading:{acceptedAnswers:["SENSITIVE_ANSWER"],
      solutionAssetBindings:{}}}],
  assetIds:["ast_1"]};
function workerFixture({duplicate=false,invalidSource=false,missingImage=false}={}){
  let stored=null,generation="1001",uploads=0,reads=0,finish=0,assets=0;
  const exportStore={enabled:true,
    load:async()=>plan,
    finish:async({object})=>{
      finish++;assert.equal(object.generation,generation);
      return {jobId:plan.jobId,result:object};
    }};
  const assetReader={enabled:true,
    readVerified:async({assetId,quizId})=>{
      assets++;
      assert.equal(quizId,"quiz_1");
      if(missingImage)throw Object.assign(new Error("Image not retained"),
        {reason:"RESOURCE_UNAVAILABLE"});
      const bytes=Buffer.from("SYNTHETIC_PNG");
      return {assetId,bytes,sha256:digest(bytes),
        name:"images/ast_1.png",originalName:"graph.png"};
    }};
  const storage={enabled:true,
    async createOnly({storagePath,bytes}){
      uploads++;
      assert.equal(storagePath,
        "exports/teacher_1/job_1/quiz_1-job_1.zip");
      if(duplicate){
        // The original write succeeded but its acknowledgement was lost.
        if(stored)throw Object.assign(new Error("already exists"),{code:412});
        stored=Buffer.from(bytes);
        throw Object.assign(new Error("already exists"),{code:412});
      }
      if(stored)throw Error("ZIP overwritten");
      stored=Buffer.from(bytes);
    },
    async readExact({sha256,byteLength}){
      reads++;
      assert(Buffer.isBuffer(stored));
      assert.equal(stored.byteLength,byteLength);
      assert.equal(digest(stored),sha256);
      return {storagePath:"exports/teacher_1/job_1/quiz_1-job_1.zip",
        generation,sha256,byteLength,contentType:"application/zip"};
    },
  };
  const worker=createPrivateQuizZipWorker({enabled:true,exportStore,
    sourceReader:async()=>invalidSource
      ?{...source,revisionId:"qrv_changed"}:source,
    assetReader,storage});
  return {worker,get bytes(){return stored},
    get uploads(){return uploads},get reads(){return reads},
    get finish(){return finish},get assets(){return assets}};
}
test("QN11.6.3 disabled ZIP worker and storage ports do nothing",async()=>{
  assert.deepEqual(await createPrivateQuizZipWorker().exportJob(),
    {disabled:true});
  assert.deepEqual(await createPrivateZipStoragePort().createOnly(),
    {disabled:true});
  assert.throws(()=>createPrivateQuizZipWorker({enabled:true}),
    /Trusted ZIP export worker ports/);
});
test("QN11.6.3 creates real compressed ZIP with protected quiz.json and retained image",async()=>{
  const f=workerFixture(),result=await f.worker.exportJob({jobId:"job_1"});
  assert.equal(result.jobId,"job_1");
  assert.equal(f.uploads,1);assert.equal(f.reads,1);
  assert.equal(f.finish,1);assert.equal(f.assets,1);
  assert.equal(f.bytes.readUInt32LE(0),0x04034b50);
  const contents=JSON.parse(entry(f.bytes,"quiz.json").toString());
  assert.equal(contents.kind,"math-quiz-backup");
  assert.equal(contents.revision.bundle.sha256,bundleHash);
  assert.equal(contents.records[0].grading.acceptedAnswers[0],
    "SENSITIVE_ANSWER");
  assert.equal(contents.records[0].content.itemId,"itm_1");
  assert.equal(contents.records[0].content.points,2);
  assert.equal(contents.records[0].content.problemRevisionId,"prv_1");
  assert.equal(contents.assets.ast_1.path,"images/ast_1.png");
  assert.equal(entry(f.bytes,"images/ast_1.png").toString(),"SYNTHETIC_PNG");
});
test("QN11.6.3 duplicate ZIP upload verifies exactly the same bytes before success",async()=>{
  const f=workerFixture({duplicate:true});
  await f.worker.exportJob({jobId:"job_1"});
  const original=Buffer.from(f.bytes);
  await f.worker.exportJob({jobId:"job_1"});
  assert(f.bytes.equals(original),
    "Frozen dates, ordering and canonical records must reproduce ZIP bytes");
  assert.equal(f.uploads,2);assert.equal(f.reads,2);
});
test("QN11.6.3 wrong revision or missing retained image never writes ZIP",async()=>{
  for(const opts of [{invalidSource:true},{missingImage:true}]){
    const f=workerFixture(opts);
    await assert.rejects(f.worker.exportJob({jobId:"job_1"}));
    assert.equal(f.bytes,null);
    assert.equal(f.uploads,0);
    assert.equal(f.finish,0);
  }
});
function authorFixture({problemOrigin="neon_revision",draftOrigin="hybrid",
  draftFresh=true}={}){
  let neon=0,draft=0,originReads=0,rechecks=0;
  const actor={uid:"teacher_1",role:"teacher",emailVerified:true,
    accountStatus:"active"};
  const authorization=createQuizerAuthorImageScope({enabled:true,
    resolveActor:async()=>actor,
    resolveProblemOrigin:async()=>{originReads++;return problemOrigin},
    resolveDraftOrigin:async()=>draftOrigin,
    neonReader:{async getProblemForTeacher({actor:owner,problemId,revisionId}){
      neon++;assert.equal(owner.uid,actor.uid);
      return {problemId,revisionId:revisionId??"prv_1",
        content:{questionAssetBindings:{figure:"ast_1"}},
        grading:{solutionAssetBindings:{solution:"ast_2"}}};
    }},
    draftCompat:{async getItems({itemIds}){
      draft++;return {items:itemIds.map(itemId=>({
        itemId,content:{questionAssetBindings:{fig:"ast_3"}},
        grading:{solutionAssetBindings:{solution:"ast_4"}},
      }))};
    }},
    loadOwnedDraft:async()=>({quiz:{ownerId:actor.uid},
      draft:{version:5,itemOrder:["itm_1","itm_2"]}}),
    recheckDraft:async()=>{rechecks++;return draftFresh},
  });
  const auth={uid:actor.uid,token:{email_verified:true}};
  return {authorization,auth,get neon(){return neon},
    get draft(){return draft},get rechecks(){return rechecks},
    get originReads(){return originReads}};
}
test("QN11.6.3 hybrid author problem and draft images are explicitly authorized",async()=>{
  const f=authorFixture();
  const problem=await f.authorization.authorize({firebaseAuth:f.auth,
    context:{kind:"problem",id:"prb_1",revisionId:"prv_1"}});
  assert.deepEqual(problem,{route:"private",assetIds:["ast_1","ast_2"]});
  const draft=await f.authorization.authorize({firebaseAuth:f.auth,
    context:{kind:"quiz_draft",id:"quiz_1"}});
  assert.deepEqual(draft,{route:"private",assetIds:["ast_3","ast_4"]});
  assert.equal(f.neon,1);assert.equal(f.draft,1);
  assert.equal(f.rechecks,1);
});
test("QN11.6.3 author image unknown provenance and stale drafts fail closed",async()=>{
  const unknown=authorFixture({problemOrigin:"UNKNOWN"});
  await assert.rejects(unknown.authorization.authorize({
    firebaseAuth:unknown.auth,context:{kind:"problem",id:"prb_1"}}),
    fail("RESOURCE_UNAVAILABLE"));
  assert.equal(unknown.neon,0);
  const stale=authorFixture({draftFresh:false});
  await assert.rejects(stale.authorization.authorize({
    firebaseAuth:stale.auth,context:{kind:"quiz_draft",id:"quiz_1"}}),
    fail("VERSION_CONFLICT"));
  const legacy=authorFixture({problemOrigin:"firestore_legacy",
    draftOrigin:"firestore_legacy"});
  assert.deepEqual(await legacy.authorization.authorize({
    firebaseAuth:legacy.auth,context:{kind:"problem",id:"prb_1"}}),
    {route:"legacy"});
  assert.equal(legacy.neon,0);
});
