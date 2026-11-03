import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  planImportBatches,missingImportRecords,sourceDigest,fileDigests,
  readImportRecovery,saveImportRecovery,clearImportRecovery,recoveryMatches,
} from "../../js/services/import-resume.js";

const rec=i=>({importItemKey:"problem_"+i,originalQuestionId:"q"+i,
  metadata:{title:"Question "+i},content:{statementLatex:"Compute "+i},
  grading:{acceptedAnswers:["2"]},points:1});
const storage=()=>{
  const db=new Map();
  return {getItem:k=>db.get(k)??null,
    setItem:(k,v)=>db.set(k,v),removeItem:k=>db.delete(k),
    get state(){return db;}};
};
const fixture=(sourceFingerprint="a".repeat(64))=>({
  sourceFingerprint,importNonce:"nonce_000000000001",itemCount:100,
  sourceAssetId:"ast_source",jobId:"job_import",assets:{"pic.png":"ast_img"},
  imageDigests:{"pic.png":"b".repeat(64)},
});

for(const count of [10,100,500])
test("QN11.3 plans "+count+" problems in ≤20-item calls",()=>{
  const batches=planImportBatches(Array.from({length:count},(_,i)=>rec(i)));
  assert.equal(batches.length,Math.ceil(count/20));
  assert(batches.every(b=>b.length<=20));
  assert.deepEqual(batches.flat().map(r=>r.importItemKey),
    Array.from({length:count},(_,i)=>"problem_"+i));
});
test("byte-aware batching stays below safe payload; rejects single huge item",()=>{
  const records=Array.from({length:24},(_,i)=>({
    ...rec(i),content:{statementLatex:"∑".repeat(8500)}}));
  const batches=planImportBatches(records,{maxBytes:70000});
  assert(batches.length>2);
  for(const batch of batches){
    const estimate=new TextEncoder().encode(JSON.stringify({
      apiVersion:2,action:"importProblemBatch",
      requestId:"x".repeat(36),jobId:"x".repeat(128),records:batch,
    })).byteLength;
    assert(estimate<=70000);
  }
  assert.throws(()=>planImportBatches([{...rec(0),
    content:{statementLatex:"x".repeat(10000)}}],{maxBytes:4000}),
    /exceeds/);
});
test("duplicate/malformed keys, too-many and invalid bounds are rejected",()=>{
  assert.throws(()=>planImportBatches([rec(0),rec(0)]),/Duplicate/);
  assert.throws(()=>planImportBatches([rec(0)],{maxItems:21}),/Invalid/);
  assert.throws(()=>planImportBatches(Array.from({length:501},(_,i)=>rec(i))),
    /Invalid/);
});
test("only server-confirmed keys are skipped on resume",()=>{
  const records=Array.from({length:100},(_,i)=>rec(i));
  const remaining=missingImportRecords(records,
    Array.from({length:43},(_,i)=>"problem_"+i));
  assert.deepEqual(remaining.map(x=>x.importItemKey),
    Array.from({length:57},(_,i)=>"problem_"+(i+43)));
  assert.equal(planImportBatches(remaining).length,3);
  assert.throws(()=>missingImportRecords(records,["problem_200"]),/different/);
  assert.throws(()=>missingImportRecords(records,["problem_0","problem_0"]),
    /Invalid/);
});
test("source and image fingerprints bind resume to identical bytes",async()=>{
  const digest=await sourceDigest("\\begin{problem}α²\\end{problem}");
  assert.match(digest,/^[a-f0-9]{64}$/);
  assert.notEqual(digest,await sourceDigest("\\begin{problem}α³\\end{problem}"));
  const files=await fileDigests(new Map([["figure.png",{
    arrayBuffer:async()=>new TextEncoder().encode("image bytes").buffer,
  }]]));
  assert.match(files["figure.png"],/^[a-f0-9]{64}$/);
});
test("session recovery is scoped by uid/mode and stores only metadata",()=>{
  const s=storage(),data=fixture();
  assert.equal(saveImportRecovery(s,"teacher_1",false,data),true);
  const got=readImportRecovery(s,"teacher_1",false);
  assert.equal(got.jobId,data.jobId);
  assert.equal(readImportRecovery(s,"teacher_2",false),null);
  assert.equal(readImportRecovery(s,"teacher_1",true),null);
  const bytes=[...s.state.values()].join("");
  assert(!bytes.includes("acceptedAnswers"));
  assert(!bytes.includes("statementLatex"));
  assert(recoveryMatches(got,{sourceFingerprint:data.sourceFingerprint,
    itemCount:100,imageDigests:data.imageDigests}));
  assert(!recoveryMatches(got,{sourceFingerprint:data.sourceFingerprint,
    itemCount:100,imageDigests:{"pic.png":"c".repeat(64)}}));
  clearImportRecovery(s,"teacher_1",false);
  assert.equal(readImportRecovery(s,"teacher_1",false),null);
});
test("tampered and expired resume snapshots are rejected",()=>{
  const s=storage(),d=fixture();
  assert(saveImportRecovery(s,"teacher_1",false,d));
  const key=[...s.state.keys()][0];
  s.setItem(key,JSON.stringify({...JSON.parse(s.getItem(key)),
    savedAt:Date.now()-26*3600*1000}));
  assert.equal(readImportRecovery(s,"teacher_1",false),null);
  assert.equal(saveImportRecovery(s,"teacher_1",false,
    {...d,sourceFingerprint:"wrong"}),false);
});
test("integration wiring uses server checkpoint and preserves old routing",()=>{
  const editor=readFileSync(new URL(
    "../../js/pages/quiz-editor.js",import.meta.url),"utf8");
  const api=readFileSync(new URL(
    "../../functions/src/api/quizzes.js",import.meta.url),"utf8");
  const router=readFileSync(new URL(
    "../../functions/src/router.js",import.meta.url),"utf8");
  assert.match(editor,/planImportBatches\(remaining\)/);
  assert.match(editor,/getImportCheckpoint/);
  assert.match(editor,/clearImportRecovery/);
  assert.match(api,/define\("getImportCheckpoint"/);
  assert.match(api,/importedKeys/);
  assert.doesNotMatch(router,/import-coordinator|sql-port/);
});
