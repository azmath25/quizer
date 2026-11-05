import test from "node:test";
import assert from "node:assert/strict";
import {validateProblem,DEFAULT_SETTINGS}
  from "../../shared/schema.js";
import {fingerprint}
  from "../../functions/src/neon/write-repository.js";
import {createPrivateBundlePublisher}
  from "../../functions/src/bundles/publish-writer.js";
import {BUNDLE_CONTENT_TYPE,readPrivatePublishedBundle}
  from "../../functions/src/bundles/published-bundle.js";
function problem(statement,answer){
  return validateProblem({
    type:"open",answerMode:"auto",
    statementLatex:statement,options:[],
    defaultPoints:2,questionAssetBindings:{},
  },{
    acceptedAnswers:[answer],explanationLatex:"",rubricLatex:"",
    solutionAssetBindings:{},tolerance:0,
  });
}
const old=problem("Legacy equation $x=1$","1"),
  fresh=problem("Neon equation $x=2$","2");
function fixture({corruptLegacy=false,failActivation=false}={}){
  const sources=[
    {itemId:"itm_old",problemId:"old_1",problemRevisionId:"old_rev",
      points:2,contentHash:fingerprint(old),source:{
        kind:"firestore_legacy",pathType:"problem",
        problemId:"old_1",problemRevisionId:"old_rev"}},
    {itemId:"itm_new",problemId:"new_1",problemRevisionId:"new_rev",
      points:2,contentHash:fingerprint(fresh),source:{
        kind:"neon_revision",problemId:"new_1",
        problemRevisionId:"new_rev"}},
  ];
  const plan={
    jobId:"job_mix",quizId:"quiz_mix",revisionId:"pub_mix",
    leaseOwner:"lease_worker_claim_12345",sources,
    revision:{revisionNumber:1,title:"Mixed Quiz",
      description:"",subject:"Math",difficulty:"",
      settings:{...DEFAULT_SETTINGS},
      itemOrder:["itm_old","itm_new"],
      itemCount:2,totalPoints:4,
      state:"building",publicationJobId:"job_mix"},
  };
  const objects=new Map();
  let previousPublished="old_publication",activated=0,
    legacyReads=0,neonReads=0,retention=0;
  const storage={
    async createOnly({storagePath,bytes,ifGenerationMatch}){
      assert.equal(ifGenerationMatch,0);
      if(objects.has(storagePath))
        throw Object.assign(new Error("Object exists"),{code:412});
      objects.set(storagePath,Buffer.from(bytes));
    },
    async readExact({storagePath}){
      const bytes=objects.get(storagePath);
      assert(bytes);
      return {bytes,generation:"174000001",
        contentType:BUNDLE_CONTENT_TYPE,
        downloadTokenPresent:false};
    },
  };
  const publicationStore={
    async load(_jobId,expectedLeaseOwner){
      if(expectedLeaseOwner!==undefined&&
        expectedLeaseOwner!==plan.leaseOwner)
        throw Error("claimed publication lease mismatch");
      return plan;
    },
    async activate({manifest,assetRetention}){
      assert.equal(assetRetention,"retained");
      assert.equal(manifest.itemCount,2);
      if(failActivation)throw Error("quiz was cancelled");
      activated++;
      previousPublished="pub_mix";
      return {activated:true};
    },
  };
  const publisher=createPrivateBundlePublisher({
    enabled:true,publicationStore,storage,
    retainPublishedAssets:async()=>{retention++;return "retained";},
    resolveLegacyRevision:async()=>{legacyReads++;
      return {...old,problemId:"old_1",
        problemRevisionId:"old_rev",
        content:corruptLegacy?{...old.content,
          statementLatex:"tampered"}:old.content};},
    resolvePinnedRevision:async()=>{neonReads++;
      return {...fresh,problemId:"new_1",
        problemRevisionId:"new_rev"};},
  });
  return {plan,publisher,storage,
    get stats(){return {activated,legacyReads,neonReads,retention,
      previousPublished,objectCount:objects.size}},
  };
}
test("mixed legacy/Neon private bundle stores complete frozen keys server-side",async()=>{
  const f=fixture(),result=await f.publisher.publish({jobId:"job_mix"});
  assert.equal(result.activated,true);
  assert.equal(f.stats.legacyReads,1);
  assert.equal(f.stats.neonReads,1);
  assert.equal(f.stats.retention,1);
  assert.equal(f.stats.previousPublished,"pub_mix");
  assert.equal(f.stats.objectCount,1);
  const bundle=await readPrivatePublishedBundle({
    manifest:result.manifest,quizId:"quiz_mix",revisionId:"pub_mix",
    authorizePinnedRead:async()=>({
      authorized:true,pinnedRevisionId:"pub_mix"}),
    readObject:args=>f.storage.readExact(args),
  });
  assert.deepEqual(bundle.items.map(v=>v.content.statementLatex),
    [old.content.statementLatex,fresh.content.statementLatex]);
  assert.deepEqual(bundle.items.map(v=>v.grading.acceptedAnswers),
    [["1"],["2"]]);
});
test("legacy hash mismatch prevents publishing, storage and activation",async()=>{
  const f=fixture({corruptLegacy:true});
  await assert.rejects(f.publisher.publish({jobId:"job_mix"}),
    /source revision content changed/);
  assert.equal(f.stats.previousPublished,"old_publication");
  assert.equal(f.stats.objectCount,0);
  assert.equal(f.stats.activated,0);
});
test("private object upload does not activate a cancelled or stale publication",async()=>{
  const f=fixture({failActivation:true});
  await assert.rejects(f.publisher.publish({jobId:"job_mix"}),
    /quiz was cancelled/);
  assert.equal(f.stats.previousPublished,"old_publication");
  assert.equal(f.stats.activated,0);
  assert.equal(f.stats.objectCount,1);
});
test("missing trusted legacy adapter must fail closed",async()=>{
  const f=fixture();
  const publisher=createPrivateBundlePublisher({
    enabled:true,publicationStore:{load:async()=>f.plan,
      activate:async()=>{throw Error("should not activate");}},
    storage:f.storage,
    resolvePinnedRevision:async()=>fresh,
  });
  await assert.rejects(publisher.publish({jobId:"job_mix"}),
    /Trusted pinned legacy publication reader not configured/);
  assert.equal(f.stats.objectCount,0);
});

test("publisher refuses stale worker claim before touching private sources",async()=>{
  const f=fixture();
  await assert.rejects(f.publisher.publish({
    jobId:"job_mix",leaseOwner:"stale_worker_claim_12345",
  }),/claimed publication lease mismatch/);
  assert.equal(f.stats.legacyReads,0);
  assert.equal(f.stats.neonReads,0);
  assert.equal(f.stats.activated,0);
  assert.equal(f.stats.objectCount,0);
  const valid=await f.publisher.publish({
    jobId:"job_mix",leaseOwner:"lease_worker_claim_12345",
  });
  assert.equal(valid.activated,true);
});
