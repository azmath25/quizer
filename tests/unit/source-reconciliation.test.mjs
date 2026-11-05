import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyQuizSourceReferences}
  from "../../functions/src/neon/reference-reconciliation.js";

const slot=(id,problemId="p1",revision="r1")=>({
  quizId:"q1",itemId:id,problemId,problemRevisionId:revision,
});
test("exact immutable Neon revision match counts once without Firebase assumptions",()=>{
  const s=slot("i1");
  const result=classifyQuizSourceReferences({
    slots:[s],neonPins:[{problemId:"p1",problemRevisionId:"r1"}],
  });
  assert.deepEqual(result.counts,{total:1,neon:1,firestore:0,
    snapshot:0,missing:0,conflict:0,privateBundleUnknown:0,invalid:0});
  assert.equal(result.anomalies.length,0);
});
test("wrong revision ID cannot masquerade as same problem provenance",()=>{
  const result=classifyQuizSourceReferences({
    slots:[slot("i1","p1","r2")],
    neonPins:[{problemId:"p1",problemRevisionId:"r1"}],
  });
  assert.equal(result.counts.missing,1);
});
test("archived Firestore snapshot and private bundle uncertainty are not false missing",()=>{
  const archived={...slot("i1"),reuseFromQuizRevisionId:"qrv_old"};
  const known=classifyQuizSourceReferences({
    slots:[archived],snapshotPins:[{quizId:"q1",
      revisionId:"qrv_old",itemId:"i1"}]});
  assert.equal(known.counts.snapshot,1);
  const unknown=classifyQuizSourceReferences({
    slots:[{...archived,privateBundleCandidate:true}]});
  assert.equal(unknown.counts.privateBundleUnknown,1);
  assert.equal(unknown.counts.missing,0);
});
test("double ownership, invalid metadata and missing rows are surfaced",()=>{
  const row=slot("i1");
  const result=classifyQuizSourceReferences({
    slots:[row,null,slot("i2","p9","r9")],
    neonPins:[{problemId:"p1",problemRevisionId:"r1"}],
    firebasePins:[{problemId:"p1",problemRevisionId:"r1"}],
  });
  assert.equal(result.counts.conflict,1);
  assert.equal(result.counts.invalid,1);
  assert.equal(result.counts.missing,1);
});
test("live reconciliation script is hard-bound to Quizer and only read-only SQL",()=>{
  const script=readFileSync(
    new URL("../../scripts/neon/quizer-readonly-reconcile.mjs",import.meta.url),
    "utf8");
  assert.match(script,/sat-quiz-fd317/);
  assert.match(script,/quizer_app/);
  assert.match(script,/BEGIN READ ONLY/);
  assert.match(script,/--limit must be 1–20/);
  assert.doesNotMatch(script,/\.doc\([^\n]+\)\.(?:set|update|delete)\(|INSERT INTO|DROP TABLE|TRUNCATE /);
  assert.doesNotMatch(script,/console\.log\(connectionString|console\.log\(uri/);
});
