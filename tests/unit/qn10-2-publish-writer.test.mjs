import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateProblem } from "../../shared/schema.js";
import { fingerprint } from "../../functions/src/neon/write-repository.js";
import { createPrivateBundlePublisher } from "../../functions/src/bundles/publish-writer.js";
import { createPrivateBundleStoragePort } from "../../functions/src/bundles/private-storage.js";
import { MAX_BUNDLE_BYTES, BUNDLE_CONTENT_TYPE } from "../../functions/src/bundles/published-bundle.js";

const grading = n => ({
  correctOptionId:null,acceptedAnswers:[String(n+1)],
  tolerance:0,explanationLatex:"",rubricLatex:"",solutionAssetBindings:{},
});
const content = n => ({
  type:"open",answerMode:"auto",statementLatex:"Compute "+n+"+1.",
  options:[],defaultPoints:2,questionAssetBindings:{},
});
const defaultSettings = {
  durationSeconds:1200,shuffleQuestions:false,shuffleOptions:false,
  allowBack:false,penalty:0,scoreRelease:"immediate",solutionRelease:"manual",
};
function fixture(size=3) {
  const sources=[],revisionById=new Map();
  for(let i=0;i<size;i++) {
    const problemId="prb_"+i,problemRevisionId="prv_"+i+"_2";
    const normalized=validateProblem(content(i),grading(i));
    revisionById.set(problemRevisionId,{...normalized,problemId,problemRevisionId});
    sources.push({itemId:"itm_"+i,problemId,problemRevisionId,points:2,
      contentHash:fingerprint(normalized),
      source:{kind:"neon_revision",problemId,problemRevisionId}});
  }
  const plan={jobId:"job_qn10_2",quizId:"quiz_private",
    revisionId:"qrv_new",leaseOwner:"lease_A",
    previousPublishedRevisionId:"qrv_old",
    jobInputHash:"hash_of_input",
    revisionManifestHash:"hash_of_frozen_draft",
    expectedQuizVersion:7,sourceDraftVersion:4,
    sources,
    revision:{state:"building",publicationJobId:"job_qn10_2",
      revisionNumber:2,title:"Private practice",description:"",subject:"Math",
      difficulty:"Practice",settings:defaultSettings,
      itemOrder:sources.map(x=>x.itemId),
      itemCount:size,totalPoints:size*2},
  };
  return {plan,revisionById};
}
function fakeBucket() {
  const objects=new Map(),ops=[];
  let sequence=900;
  const port={
    file(path,{generation}={}) {
      return {
        async save(bytes,opts) {
          ops.push({operation:"save",path,options:opts});
          assert.equal(opts.preconditionOpts.ifGenerationMatch,0);
          assert.equal(opts.metadata.cacheControl,"private, no-store");
          assert.equal(opts.metadata.metadata.bundleFormat,"quizer.published_bundle.v1");
          assert.equal(opts.metadata.metadata.firebaseStorageDownloadTokens,undefined);
          if(objects.has(path))throw Object.assign(new Error("precondition"),{code:412});
          objects.set(path,{bytes:Buffer.from(bytes),
            generation:String(++sequence),
            size:String(bytes.length),
            contentType:opts.metadata.contentType,
            cacheControl:opts.metadata.cacheControl,
            metadata:structuredClone(opts.metadata.metadata)});
        },
        async getMetadata() {
          ops.push({operation:"metadata",path});
          const o=objects.get(path);
          if(!o) throw Object.assign(new Error("missing"),{code:404});
          return [{generation:o.generation,size:o.size,
            contentType:o.contentType,cacheControl:o.cacheControl,
            metadata:o.metadata}];
        },
        async download() {
          ops.push({operation:"download",path,generation});
          const o=objects.get(path);
          if(!o||String(generation)!==o.generation)
            throw Object.assign(new Error("generation mismatch"),{code:404});
          return [Buffer.from(o.bytes)];
        },
      };
    },
  };
  return {bucket:port,objects,ops};
}
function harness(size=3,options={}) {
  const {plan,revisionById}=fixture(size);
  const rawStorage=fakeBucket();
  const storage=createPrivateBundleStoragePort({bucket:rawStorage.bucket,enabled:true});
  const writerStorage=options.failStorageCreate ?
    {...storage,createOnly:async()=>{throw Error("SIMULATED_UPLOAD_FAILURE");}} :
    storage;
  const state={plan,latestPublished:"qrv_old",draftVersion:4,
    jobStatus:"running",leaseOwner:"lease_A",activationCount:0,
    oldSnapshot:{revisionId:"qrv_old",answer:"original"},
    attempts:[{id:"att_old",quizRevisionId:"qrv_old",score:2}]};
  let resolveCalls=0;
  const publicationStore={
    async load(jobId) {
      if(state.jobStatus==="succeeded")
        return {completed:true,jobId,quizId:plan.quizId,
          revisionId:plan.revisionId,manifest:state.manifest};
      return structuredClone({...state.plan});
    },
    async activate({plan:request,manifest}) {
      if(options.failActivate?.(state,request,manifest))
        throw new Error("ATOMIC_ACTIVATION_FAILURE");
      if(state.jobStatus==="succeeded") {
        assert.equal(state.manifest.sha256,manifest.sha256);
        return {alreadyPublished:true};
      }
      assert.equal(request.leaseOwner,state.leaseOwner);
      assert.equal(request.sourceDraftVersion,state.draftVersion);
      assert.equal(request.previousPublishedRevisionId,state.latestPublished);
      assert.equal(request.expectedQuizVersion,7);
      assert.equal(request.revisionManifestHash,"hash_of_frozen_draft");
      state.latestPublished=request.revisionId;
      state.jobStatus="succeeded";
      state.activationCount++;
      state.manifest=manifest;
      return {activated:true};
    },
  };
  const publisher=createPrivateBundlePublisher({
    enabled:true,storage:writerStorage,publicationStore,
    resolvePinnedRevision:async({problemId,problemRevisionId})=>{
      resolveCalls++;
      const source=revisionById.get(problemRevisionId);
      assert.equal(source.problemId,problemId);
      if(options.corruptSource?.(problemRevisionId,source))
        return {...source,grading:{...source.grading,acceptedAnswers:["tampered"]}};
      return source;
    },
  });
  return {publisher,publicationStore,storage,rawStorage,state,revisionById,
    get resolveCalls(){return resolveCalls;}};
}

test("QN10.2 publisher disabled by default and has no side effects",async()=>{
  const p=createPrivateBundlePublisher();
  assert.equal(p.enabled,false);
  assert.deepEqual(await p.publish({jobId:"job_1"}),{disabled:true});
  const s=createPrivateBundleStoragePort();
  assert.equal(s.enabled,false);
});
test("writer requires all three trusted ports before enabling",()=>{
  assert.throws(()=>createPrivateBundlePublisher({enabled:true}),
    /Trusted bundle writer/);
  assert.throws(()=>createPrivateBundleStoragePort({enabled:true}),
    /Admin Storage/);
});
test("write once, pin generation, verify answer-bearing bytes, then atomically activate",async()=>{
  const h=harness();
  const r=await h.publisher.publish({jobId:h.state.plan.jobId});
  assert.equal(r.activated,true);
  assert.equal(h.state.latestPublished,"qrv_new");
  assert.equal(h.state.jobStatus,"succeeded");
  assert.equal(h.state.activationCount,1);
  assert.equal(h.rawStorage.objects.size,1);
  const stored=h.rawStorage.objects.get(r.manifest.storagePath);
  assert(stored,"Expected exactly one private object");
  assert.equal(stored.generation,r.manifest.generation);
  assert.equal(r.manifest.sha256,
    createHash("sha256").update(stored.bytes).digest("hex"));
  const body=JSON.parse(stored.bytes.toString("utf8"));
  assert.equal(body.items[0].grading.acceptedAnswers[0],"1");
  assert.equal(body.items[0].problemRevisionId,"prv_0_2");
  assert.equal(r.manifest.itemCount,3);
  assert(!JSON.stringify(r.manifest).includes("acceptedAnswers"));
  assert(!JSON.stringify(r.manifest).includes("https"));
  assert.deepEqual(h.state.oldSnapshot,{revisionId:"qrv_old",answer:"original"});
  assert.deepEqual(h.state.attempts,[{id:"att_old",quizRevisionId:"qrv_old",score:2}]);
  assert(h.rawStorage.ops.some(x=>x.operation==="download" &&
    x.generation===r.manifest.generation));
  assert(!h.rawStorage.ops.some(x=>/sign|delete|url/i.test(x.operation)));
});
test("retry of completed job does not upload, read or republish older pointer",async()=>{
  const h=harness();
  await h.publisher.publish({jobId:"job_qn10_2"});
  const operations=h.rawStorage.ops.length;
  const r=await h.publisher.publish({jobId:"job_qn10_2"});
  assert.equal(r.alreadyPublished,true);
  assert.equal(h.rawStorage.ops.length,operations);
  assert.equal(h.state.activationCount,1);
});
test("precondition 412 reuses only content-verified existing generation",async()=>{
  const h=harness(),original=await h.publisher.publish({jobId:"job_qn10_2"});
  h.state.jobStatus="running";h.state.latestPublished="qrv_old";
  const replay=await h.publisher.publish({jobId:"job_qn10_2"});
  assert.equal(replay.manifest.sha256,original.manifest.sha256);
  assert.equal(replay.manifest.generation,original.manifest.generation);
  assert.equal(h.rawStorage.objects.size,1);
  assert.equal(h.state.activationCount,2);
});
test("bad source hash fails before Storage or Firestore activation",async()=>{
  const h=harness(3,{corruptSource:(id)=>id==="prv_1_2"});
  await assert.rejects(h.publisher.publish({jobId:"job_qn10_2"}),
    e=>e.reason==="VERSION_CONFLICT");
  assert.equal(h.rawStorage.objects.size,0);
  assert.equal(h.state.latestPublished,"qrv_old");
  assert.equal(h.state.activationCount,0);
});
test("wrong revision source identity and altered pinned points reject before upload",async()=>{
  const h=harness();
  h.state.plan.sources[1].source.problemRevisionId="prv_999";
  await assert.rejects(h.publisher.publish({jobId:"job_qn10_2"}),
    e=>e.reason==="INVALID_FIELDS");
  assert.equal(h.rawStorage.objects.size,0);
  const y=harness();
  y.state.plan.sources[0].points=3;
  await assert.rejects(y.publisher.publish({jobId:"job_qn10_2"}),
    e=>e.reason==="INVALID_FIELDS");
  assert.equal(y.rawStorage.objects.size,0);
});
test("upload error leaves prior published revision and old attempts untouched",async()=>{
  const h=harness(3,{failStorageCreate:true});
  await assert.rejects(h.publisher.publish({jobId:"job_qn10_2"}),
    /SIMULATED_UPLOAD_FAILURE/);
  assert.equal(h.state.latestPublished,"qrv_old");
  assert.deepEqual(h.state.oldSnapshot,{revisionId:"qrv_old",answer:"original"});
  assert.equal(h.state.activationCount,0);
});
test("crash between object upload and Firestore commit retains old publication, retry succeeds",async()=>{
  let fail=true;
  const h=harness(3,{failActivate:()=>fail});
  await assert.rejects(h.publisher.publish({jobId:"job_qn10_2"}),
    /ATOMIC_ACTIVATION_FAILURE/);
  assert.equal(h.rawStorage.objects.size,1);
  assert.equal(h.state.latestPublished,"qrv_old");
  fail=false;
  const r=await h.publisher.publish({jobId:"job_qn10_2"});
  assert.equal(r.activated,true);
  assert.equal(h.rawStorage.objects.size,1);
  assert.equal(h.state.latestPublished,"qrv_new");
});
test("corrupted orphan object is not activated, even on valid path",async()=>{
  let fail=true;
  const h=harness(3,{failActivate:()=>fail});
  await assert.rejects(h.publisher.publish({jobId:"job_qn10_2"}));
  const obj=[...h.rawStorage.objects.values()][0];
  obj.bytes[30]^=1;
  fail=false;
  await assert.rejects(h.publisher.publish({jobId:"job_qn10_2"}),
    e=>e.reason==="RESOURCE_UNAVAILABLE");
  assert.equal(h.state.latestPublished,"qrv_old");
  assert.equal(h.state.activationCount,0);
});
test("private Storage token or cache-policy tampering prevents activation",async()=>{
  let fail=true;
  const h=harness(3,{failActivate:()=>fail});
  await assert.rejects(h.publisher.publish({jobId:"job_qn10_2"}));
  const obj=[...h.rawStorage.objects.values()][0];
  obj.metadata.firebaseStorageDownloadTokens="exposed";
  fail=false;
  await assert.rejects(h.publisher.publish({jobId:"job_qn10_2"}),
    e=>e.reason==="RESOURCE_UNAVAILABLE");
  assert.equal(h.state.latestPublished,"qrv_old");
});
test("storage adapter refuses overwrite, unsafe paths, or oversized files",async()=>{
  const h=harness();
  const s=h.storage;
  await assert.rejects(s.createOnly({
    storagePath:"staging/teacher/asset/original",
    bytes:Buffer.from("{}"),contentType:BUNDLE_CONTENT_TYPE,
    cacheControl:"private, no-store",ifGenerationMatch:0,
  }),/Unsafe/);
  await assert.rejects(s.createOnly({
    storagePath:"published-bundles/v1/q/r/"+"a".repeat(64)+".json",
    bytes:Buffer.alloc(MAX_BUNDLE_BYTES+1),
    contentType:BUNDLE_CONTENT_TYPE,
    cacheControl:"private, no-store",ifGenerationMatch:0,
  }),/Unverified/);
  assert.equal(h.rawStorage.objects.size,0);
});
test("100 and 500 pinned revisions each publish exactly one private object",async()=>{
  for(const n of [100,500]) {
    const h=harness(n),r=await h.publisher.publish({jobId:"job_qn10_2"});
    assert.equal(r.manifest.itemCount,n);
    assert.equal(r.manifest.totalPoints,n*2);
    assert.equal(h.resolveCalls,n);
    assert.equal(h.rawStorage.objects.size,1);
    assert.equal(h.state.latestPublished,"qrv_new");
  }
});
test("501 sources and expired preflight prevent object creation",async()=>{
  const h=harness(501);
  await assert.rejects(h.publisher.publish({jobId:"job_qn10_2"}),
    /500 pinned sources/);
  assert.equal(h.rawStorage.objects.size,0);
});
test("simultaneous workers reusing same immutable source produce only one object",async()=>{
  const h=harness();
  const [a,b]=await Promise.all([
    h.publisher.publish({jobId:"job_qn10_2"}),
    h.publisher.publish({jobId:"job_qn10_2"}),
  ]);
  assert.equal(h.rawStorage.objects.size,1);
  assert.equal(h.state.activationCount,1);
  assert.equal([a,b].filter(x=>x.activated).length,1);
  assert.equal([a,b].filter(x=>x.alreadyPublished).length,1);
});
