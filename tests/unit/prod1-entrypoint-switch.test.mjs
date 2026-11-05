import test from "node:test";
import assert from "node:assert/strict";
import {
  createProd1EntrypointBridge,isProd1Enabled,PROD1_PROJECT,
  PROD1_SECRET_NAMES,
} from "../../functions/src/prod1/entrypoint-switch.js";
import {PROD1_RELEASE_APPROVED}
  from "../../functions/src/prod1/release-gate.js";

function fixture(){
  const docs={
    "jobs/job_old":{kind:"publish_quiz",input:{sources:[]}},
    "jobs/job_private":{
      kind:"publish_quiz",input:{bundleMode:"private_bundle_v1",
        revisionId:"rev_1",sources:[{
          source:{kind:"neon_revision"}}]},
    },
    "jobs/job_grading":{kind:"grade_attempt",targetId:"attempt_1"},
    "jobs/job_legacy_grading":{kind:"grade_attempt",targetId:"attempt_old"},
    "attempts/attempt_1":{quizId:"quiz_1",quizRevisionId:"private_rev"},
    "attempts/attempt_old":{quizId:"quiz_1",quizRevisionId:"legacy_rev"},
    "quizzes/quiz_1/revisions/private_rev":{
      state:"ready",bundle:{sha256:"a".repeat(64)}},
    "quizzes/quiz_1/revisions/legacy_rev":{
      state:"ready",bundle:null},
  };
  let reads=0,legacy=0,runtimeCreated=0,secretReads=0;
  const db={doc(path){return{async get(){reads++;
    return{exists:Object.hasOwn(docs,path),data:()=>docs[path]};}};}};
  const deps={
    db,
    legacyDispatch:async(_db,auth,req)=>{
      legacy++;return {apiVersion:2,data:{legacy:true,action:req.action}};},
    legacyRunJob:async()=>{legacy++;return {legacyJob:true};},
    runtimeFactory:async config=>{
      runtimeCreated++;
      assert.equal(config.firebaseProjectId,PROD1_PROJECT);
      return {
        async dispatch(){return {apiVersion:2,data:{hybrid:true}};},
        createWorker(){return {runJob:async()=>({private:true})};},
      };
    },
    readSecrets:async()=>{secretReads++;return {
      databaseUrl:"postgresql://dummy",cursorKey:"a".repeat(32)};},
    environment:{GCLOUD_PROJECT:PROD1_PROJECT},
  };
  return {docs,db,deps,get stats(){return{
    reads,legacy,runtimeCreated,secretReads,
  }}};
}
test("P1-B source approval still needs runtime flag and exact project",()=>{
  assert.equal(PROD1_RELEASE_APPROVED,true);
  assert.equal(isProd1Enabled({
    releaseApproved:PROD1_RELEASE_APPROVED,
    env:{GCLOUD_PROJECT:PROD1_PROJECT,QUIZER_PROD1_ENABLED:"false"},
  }),false);
  assert.equal(isProd1Enabled({
    releaseApproved:false,
    env:{GCLOUD_PROJECT:PROD1_PROJECT,QUIZER_PROD1_ENABLED:"true"},
  }),false);
  assert.equal(isProd1Enabled({
    releaseApproved:PROD1_RELEASE_APPROVED,
    env:{GCLOUD_PROJECT:PROD1_PROJECT,QUIZER_PROD1_ENABLED:"true"},
  }),true);
  assert.equal(isProd1Enabled({releaseApproved:true,
    env:{GCLOUD_PROJECT:"mimo-backend-513412",
      QUIZER_PROD1_ENABLED:"true"}}),false);
  assert.equal(isProd1Enabled({releaseApproved:true,
    env:{GCLOUD_PROJECT:PROD1_PROJECT,
      QUIZER_PROD1_ENABLED:"true"}}),true);
  assert.deepEqual(PROD1_SECRET_NAMES,[
    "QUIZER_NEON_DATABASE_URL","QUIZER_BANK_CURSOR_KEY",
  ]);
});
test("default-off bridge preserves old API and worker without any secret read",async()=>{
  const f=fixture();
  const bridge=createProd1EntrypointBridge({enabled:false,...f.deps});
  assert.equal(bridge.enabled,false);
  assert.equal((await bridge.dispatch(null,{action:"getDashboard"})).data.legacy,true);
  assert.deepEqual(await bridge.runJob(f.db,"job_old"),{legacyJob:true});
  assert.deepEqual(f.stats,{reads:0,legacy:2,runtimeCreated:0,secretReads:0});
});
test("enabled bridge initializes once on first request and never leaks secrets",async()=>{
  const f=fixture();
  const bridge=createProd1EntrypointBridge({enabled:true,...f.deps});
  assert.equal(f.stats.secretReads,0);
  assert.deepEqual((await bridge.dispatch(null,{action:"getDashboard"})).data,
    {legacy:true,action:"getDashboard"});
  assert.equal(f.stats.secretReads,0);
  assert.deepEqual((await bridge.dispatch(null,{action:"createProblem"})).data,
    {hybrid:true});
  await bridge.dispatch(null,{action:"createProblem"});
  assert.equal(f.stats.secretReads,1);
  assert.equal(f.stats.runtimeCreated,1);
});
test("legacy publications stay on the old worker without Neon initialization",async()=>{
  const f=fixture();
  const bridge=createProd1EntrypointBridge({enabled:true,...f.deps});
  assert.deepEqual(await bridge.runJob(f.db,"job_old"),
    {legacyJob:true});
  assert.equal(f.stats.secretReads,0);
  assert.deepEqual(await bridge.runJob(f.db,"job_private"),
    {private:true});
  assert.equal(f.stats.secretReads,1);
  assert.equal(f.stats.legacy,1);
});
test("private grading routes into trusted worker and never into legacy",async()=>{
  const f=fixture();
  const bridge=createProd1EntrypointBridge({enabled:true,...f.deps});
  assert.deepEqual(await bridge.runJob(f.db,"job_grading"),
    {private:true});
  assert.equal(f.stats.legacy,0);
});
test("secret rejection fails closed without a Firestore fallback",async()=>{
  const f=fixture();
  f.deps.readSecrets=async()=>({databaseUrl:null,cursorKey:"short"});
  const bridge=createProd1EntrypointBridge({enabled:true,...f.deps});
  await assert.rejects(bridge.runJob(f.db,"job_private"),
    /Bound Quizer secrets unavailable/);
  assert.equal(f.stats.legacy,0);
  assert.equal(f.stats.runtimeCreated,0);
});
test("other project cannot construct an enabled live bridge",()=>{
  const f=fixture();
  assert.throws(()=>createProd1EntrypointBridge({
    enabled:true,...f.deps,
    environment:{GCLOUD_PROJECT:"mimo-backend-513412"},
  }),/Wrong Firebase project/);
  assert.equal(f.stats.secretReads,0);
});

test("legacy grading remains Firebase-only even without available Neon secrets",async()=>{
  const f=fixture();
  f.deps.readSecrets=async()=>{throw Error("Neon credentials offline");};
  const bridge=createProd1EntrypointBridge({enabled:true,...f.deps});
  assert.deepEqual(await bridge.runJob(f.db,"job_legacy_grading"),
    {legacyJob:true});
  assert.equal(f.stats.secretReads,0);
  assert.equal(f.stats.runtimeCreated,0);
});
