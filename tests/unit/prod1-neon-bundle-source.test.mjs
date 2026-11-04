import test from "node:test";
import assert from "node:assert/strict";
import {validateProblem} from "../../shared/schema.js";
import {fingerprint}
  from "../../functions/src/neon/write-repository.js";
import {createPinnedNeonPublicationResolver}
  from "../../functions/src/bundles/pinned-neon-source.js";
const normal=validateProblem({
  type:"open",answerMode:"auto",statementLatex:"Solve $x=2$.",
  options:[],defaultPoints:2,questionAssetBindings:{},
},{
  acceptedAnswers:["2"],tolerance:0,explanationLatex:"",
  rubricLatex:"",solutionAssetBindings:{},
});
const plan={
  jobId:"job_1",quizId:"quiz_1",revisionId:"pub_1",
  leaseOwner:"lease_1",
  sources:[{itemId:"itm_1",problemId:"prb_1",problemRevisionId:"prv_1",
    points:2,contentHash:fingerprint(normal),
    source:{kind:"neon_revision",problemId:"prb_1",
      problemRevisionId:"prv_1"}}],
};
const source={kind:"neon_revision",problemId:"prb_1",
  problemRevisionId:"prv_1"};
function factory({modified=false}={}){
  let assets=0,reads=0;
  const port=createPinnedNeonPublicationResolver({
    enabled:true,
    readRepository:{async getProblemForTeacher(){
      reads++;
      return {
        problemId:"prb_1",revisionId:"prv_1",
        content:{...normal.content,
          statementLatex:modified?"Altered":normal.content.statementLatex,
          revisionNumber:1,createdBy:"teacher_1",
          contentHash:fingerprint(normal),
          source:{importJobId:null}},
        grading:normal.grading,
      };
    }},
    resolvePublicationActor:async()=>({
      uid:"teacher_1",role:"teacher",
      emailVerified:true,accountStatus:"active",
    }),
    verifyAssets:async()=>{assets++;return true;},
  });
  return {port,get reads(){return reads;},get assets(){return assets;}};
}
test("real Neon reader metadata is stripped from strict published bundle",async()=>{
  const x=factory();
  const resolved=await x.port.resolve({
    problemId:"prb_1",problemRevisionId:"prv_1",source,plan,
  });
  assert.deepEqual(resolved.content,normal.content);
  assert.deepEqual(resolved.grading,normal.grading);
  assert.equal(x.reads,1);
  assert.equal(x.assets,1);
  assert(!Object.hasOwn(resolved.content,"source"));
  assert(!Object.hasOwn(resolved.content,"contentHash"));
});
test("modified content hash still fails, metadata stripping cannot bypass pin",async()=>{
  const x=factory({modified:true});
  await assert.rejects(x.port.resolve({
    problemId:"prb_1",problemRevisionId:"prv_1",source,plan,
  }),/hash mismatch/);
  assert.equal(x.assets,0);
});
