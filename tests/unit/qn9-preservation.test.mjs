import test from "node:test";
import assert from "node:assert/strict";
import { buildLegacyPreservationPlan } from "../../functions/src/neon/legacy-preservation.js";
import { rehearseSanitizedLegacyMigration } from "../../functions/src/neon/legacy-rehearsal.js";
import { syntheticLegacySnapshot } from "../fixtures/qn9-sanitized-legacy.mjs";

const target={projectId:"soft-grass-35754518",branchId:"br-qn9-disposable",
  branchName:"qn9-disposable-test",defaultBranch:false,
  databaseName:"quizer",confirmedFreshByOperator:true};
const prefix="quizzes/quiz_synthetic/revisions/";
const draft="quizzes/quiz_synthetic/draftItems/itm_0";
const firstRevision="problems/prb_synth_0/revisions/prv_0_1";
const firstGrade=firstRevision+"/grading/main";
const bad=code=>x=>x.errors.some(e=>e.code===code);

function mockSql({ failAt=null, corruptRead=false }={}) {
  let state={problems:new Map(),revisions:new Map(),tags:new Map()};
  let inserts=0,commits=0;
  const log=[];
  const sql={
    log,get state(){return state},get commits(){return commits},
    async transaction(fn) {
      const tmp=structuredClone(state);
      const tx={async query(query,args=[]) {
        log.push({query,args});
        if(query.startsWith("SELECT count(*)::integer AS count"))
          return {rows:[{count:tmp.problems.size}]};
        if(query.startsWith("INSERT INTO quizer.problems")) {
          if(++inserts===failAt)throw Error("SYNTHETIC_SQL_FAILURE");
          if(tmp.problems.has(args[0]))throw Error("duplicate problem");
          tmp.problems.set(args[0],{
            owner_uid:args[1],latest_revision_id:args[8],
            revision_number:args[9],version:args[10],
            title:args[3],bank_visibility:args[6]});
          return {rows:[]};
        }
        if(query.startsWith("INSERT INTO quizer.problem_revisions")) {
          if(++inserts===failAt)throw Error("SYNTHETIC_SQL_FAILURE");
          if(tmp.revisions.has(args[0]))throw Error("duplicate revision");
          tmp.revisions.set(args[0],{
            revision_id:args[0],revision_number:args[2],
            content_json:JSON.parse(args[3]),
            grading_json:JSON.parse(args[4]),
            source_json:JSON.parse(args[5]),
            content_hash:args[6]});
          return {rows:[]};
        }
        if(query.startsWith("INSERT INTO quizer.problem_tags")) {
          if(++inserts===failAt)throw Error("SYNTHETIC_SQL_FAILURE");
          const list=tmp.tags.get(args[0])??[];
          list.push(args[1]);tmp.tags.set(args[0],list);
          return {rows:[]};
        }
        if(query.startsWith("SELECT owner_uid,latest_revision_id"))
          return {rows:tmp.problems.has(args[0])?[tmp.problems.get(args[0])]:[]};
        if(query.startsWith("SELECT revision_id,revision_number,content_hash"))
          return {rows:tmp.revisions.has(args[1])?[{
            ...tmp.revisions.get(args[1]),
            ...(corruptRead?{grading_json:{acceptedAnswers:["wrong"]}}:{})
          }]:[]};
        throw Error("Unexpected SQL: "+query.slice(0,95));
      }};
      const output=await fn(tx);
      state=tmp;commits++;
      return output;
    }
  };
  return sql;
}

test("QN9 sanitized inventory finds old and current snapshots and pinned attempt",()=>{
  const docs=syntheticLegacySnapshot(2);
  const plan=buildLegacyPreservationPlan({documents:docs});
  assert.equal(plan.ready,true,JSON.stringify(plan.errors));
  assert.equal(plan.counts.problems,2);
  assert.equal(plan.counts.problemRevisions,4);
  assert.equal(plan.counts.quizzes,2);
  assert.equal(plan.counts.publishedRevisions,2);
  assert.equal(plan.counts.publishedSnapshots,4);
  assert.equal(plan.counts.attempts,1);
  assert.equal(plan.counts.assetsReferenced,2);
  assert(plan.warnings.some(x=>x.code==="LEGACY_QUIZ_PRESERVE_AS_IS"));
  assert(plan.documentHashes[prefix+"qrv_old/items/itm_0"]);
  assert(plan.documentHashes["attempts/att_synthetic_old/grades/itm_0"]);
  assert(plan.documentHashes["assets/ast_figure/refs/ref_synth"]);
});
test("100/500 historical problems are fully inventoried without truncation",()=>{
  for(const n of [100,500]){
    const p=buildLegacyPreservationPlan({documents:syntheticLegacySnapshot(n)});
    assert.equal(p.ready,true,JSON.stringify(p.errors.slice(0,3)));
    assert.equal(p.counts.problems,n);
    assert.equal(p.counts.problemRevisions,n*2);
    assert.equal(p.counts.publishedSnapshots,n*2);
    assert.equal(p.migrationRows.length,n);
    const ids=new Set(p.migrationRows.map(row=>row.problemId));
    assert.equal(ids.size,n);
    for(let i=0;i<n;i++)assert(ids.has("prb_synth_"+i));
  }
});
test("deterministic manifest and source remain byte-for-byte unchanged",()=>{
  const docs=syntheticLegacySnapshot(3);
  const original=structuredClone(docs);
  const first=buildLegacyPreservationPlan({documents:docs});
  const second=buildLegacyPreservationPlan({documents:docs});
  assert.equal(first.manifestHash,second.manifestHash);
  assert.deepEqual(docs,original);
  assert.equal(first.documentHashes["attempts/att_synthetic_old/answers/itm_0"],
    second.documentHashes["attempts/att_synthetic_old/answers/itm_0"]);
});
test("missing published grading blocks migration, never silently skips keys",()=>{
  const docs=syntheticLegacySnapshot();
  delete docs[prefix+"qrv_old/grading/itm_0"];
  const p=buildLegacyPreservationPlan({documents:docs});
  assert.equal(p.ready,false);
  assert(bad("PUBLISHED_GRADING_MISSING")(p));
});
test("lost original source or image asset blocks migration",()=>{
  const docs=syntheticLegacySnapshot();
  delete docs["assets/ast_original_tex"];
  delete docs["assets/ast_figure"];
  const p=buildLegacyPreservationPlan({documents:docs});
  assert.equal(p.ready,false);
  assert(bad("SOURCE_ASSET_MISSING")(p));
  assert(bad("ASSET_RECORD_MISSING")(p));
});
test("broken current publication pointer and pinned old attempt are detected",()=>{
  const docs=syntheticLegacySnapshot();
  docs["quizzes/quiz_synthetic"].publishedRevisionId="qrv_missing";
  delete docs[prefix+"qrv_old"];
  const p=buildLegacyPreservationPlan({documents:docs});
  assert.equal(p.ready,false);
  assert(bad("PUBLISHED_POINTER_MISSING")(p));
  assert(bad("ATTEMPT_PINNED_REVISION_MISSING")(p));
});
test("historical grading hash corruption blocks migration",()=>{
  const docs=syntheticLegacySnapshot();
  docs[firstGrade].acceptedAnswers=["tampered"];
  const p=buildLegacyPreservationPlan({documents:docs});
  assert.equal(p.ready,false);
  assert(bad("PROBLEM_HASH_MISMATCH")(p));
});
test("published old snapshot may preserve an unshared or unavailable bank source",()=>{
  const docs=syntheticLegacySnapshot();
  const id="prb_synth_0";
  for(const path of Object.keys(docs))
    if(path==="problems/"+id||path.startsWith("problems/"+id+"/"))
      delete docs[path];
  const p=buildLegacyPreservationPlan({documents:docs});
  assert.equal(p.ready,true,JSON.stringify(p.errors));
  assert.equal(p.counts.publishedSnapshots,4);
  assert.equal(p.counts.attempts,1);
});
test("migration remains disabled unless explicitly opted in",async()=>{
  assert.deepEqual(await rehearseSanitizedLegacyMigration(),{disabled:true});
});
test("refuses wrong project, parent branch, non-fresh DB and real user IDs",async()=>{
  const plan=buildLegacyPreservationPlan({documents:syntheticLegacySnapshot()});
  const sql=mockSql();
  for(const t of [{...target,defaultBranch:true},
    {...target,projectId:"mimo"},
    {...target,confirmedFreshByOperator:false},
    {...target,branchName:"main"}])
    await assert.rejects(rehearseSanitizedLegacyMigration({
      enabled:true,plan,sql,target:t}),/QN9_REHEARSAL_BLOCKED/);
  const real=structuredClone(plan);
  real.migrationRows[0].ownerId="real_uid";
  await assert.rejects(rehearseSanitizedLegacyMigration({
    enabled:true,plan:real,sql,target}),/synthetic fixtures only/);
  assert.equal(sql.commits,0);
});
test("refuses incomplete or hash-mismatched source before any SQL",async()=>{
  const docs=syntheticLegacySnapshot();
  delete docs[firstGrade];
  const plan=buildLegacyPreservationPlan({documents:docs}),sql=mockSql();
  await assert.rejects(rehearseSanitizedLegacyMigration({
    enabled:true,plan,sql,target}),/inventory must have zero/);
  assert.equal(sql.log.length,0);
});
test("transaction copies all revision IDs, ownership, source and answer keys",async()=>{
  const docs=syntheticLegacySnapshot(2);
  const before=structuredClone(docs);
  const plan=buildLegacyPreservationPlan({documents:docs});
  const sql=mockSql();
  const r=await rehearseSanitizedLegacyMigration({
    enabled:true,plan,sql,target});
  assert.equal(r.verified,true);
  assert.equal(r.insertedProblems,2);
  assert.equal(r.insertedRevisions,4);
  assert.equal(r.firebaseWrites,0);
  assert.equal(r.preservedFirebaseManifestHash,plan.manifestHash);
  assert.equal(sql.state.problems.get("prb_synth_0").owner_uid,"teacher_synthetic");
  assert.equal(sql.state.revisions.get("prv_0_1").grading_json.acceptedAnswers[0],"2");
  assert.equal(sql.state.revisions.get("prv_0_2").source_json.sourceAssetId,
    "ast_original_tex");
  assert.equal(sql.commits,1);
  assert.deepEqual(docs,before);
  assert(!sql.log.some(q=>q.query.includes("DROP")||q.query.includes("UPDATE")));
});
test("partial SQL error rolls back entire rehearsal without touching source",async()=>{
  const docs=syntheticLegacySnapshot(2);
  const baseline=structuredClone(docs);
  const plan=buildLegacyPreservationPlan({documents:docs});
  const sql=mockSql({failAt:3});
  await assert.rejects(rehearseSanitizedLegacyMigration({
    enabled:true,plan,sql,target}),/SYNTHETIC_SQL_FAILURE/);
  assert.equal(sql.commits,0);
  assert.equal(sql.state.problems.size,0);
  assert.equal(sql.state.revisions.size,0);
  assert.deepEqual(docs,baseline);
});
test("read-back content or grading mismatch rolls back the entire rehearsal",async()=>{
  const plan=buildLegacyPreservationPlan({documents:syntheticLegacySnapshot()});
  const sql=mockSql({corruptRead:true});
  await assert.rejects(rehearseSanitizedLegacyMigration({
    enabled:true,plan,sql,target}),/revision, key, or provenance mismatch/);
  assert.equal(sql.commits,0);
  assert.equal(sql.state.problems.size,0);
});
test("nonempty destination refuses overwrite; SQL parameterization protects content",async()=>{
  const plan=buildLegacyPreservationPlan({documents:syntheticLegacySnapshot()});
  const sql=mockSql();
  await rehearseSanitizedLegacyMigration({enabled:true,plan,sql,target});
  await assert.rejects(rehearseSanitizedLegacyMigration({
    enabled:true,plan,sql,target}),/destination is not empty/);
  const title="Synthetic problem 0";
  assert(!sql.log.some(x=>x.query.includes(title)));
  assert(sql.log.some(x=>x.args.includes(title)));
  assert.equal(sql.commits,1);
});
