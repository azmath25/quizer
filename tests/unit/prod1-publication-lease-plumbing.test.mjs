import test from "node:test";
import assert from "node:assert/strict";
import {createQuizerStagedIntegratedGateway}
  from "../../functions/src/bundles/private-staged-gateway.js";

function fixture(){
  const publications=[];
  const calls=[];
  const privateRuntime={
    enabled:true,
    async handle(){return {ok:true};},
    async publishJob(payload){
      publications.push(payload);
      return {published:true};
    },
    async gradeJobBatch(payload){calls.push(payload);},
    async finalizeGradeJob(payload){calls.push(payload);},
    async exportJob(payload){calls.push(payload);},
  };
  const gateway=createQuizerStagedIntegratedGateway({
    enabled:true,
    bankCompat:{enabled:true,handle:async()=>({ok:true})},
    importGateway:{enabled:true,handle:async()=>({ok:true})},
    privateRuntime,
    legacyActions:[],
    legacyHandle:async()=>({}),
  });
  return {gateway,publications,calls};
}
test("staged private publication bridge retains exact claimed lease",async()=>{
  const f=fixture();
  const lease="claimed_worker_123456789abcdef";
  assert.deepEqual(await f.gateway.runPrivateJob({
    kind:"publishJob",jobId:"job_1",leaseOwner:lease,
  }),{published:true});
  assert.deepEqual(f.publications,[{jobId:"job_1",leaseOwner:lease}]);
  assert.equal(f.calls.length,0);
});
test("stage worker rejects unknown job kinds rather than legacy fallback",async()=>{
  const f=fixture();
  await assert.rejects(f.gateway.runPrivateJob({
    kind:"unknown",jobId:"job_1",leaseOwner:"claim_123456789",
  }),/Unknown staged private job kind/);
  assert.equal(f.publications.length,0);
});
