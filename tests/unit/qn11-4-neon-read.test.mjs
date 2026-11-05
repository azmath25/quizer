import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createQuizerNeonReadRepository} from "../../functions/src/neon/repository.js";
const fixture=JSON.parse(readFileSync(new URL(
  "../fixtures/neon/qn3-synthetic-problem.json",import.meta.url),"utf8"));
const {owner,collaborator,student}=fixture.actors;
const row={...fixture.header,updated_at:"2026-11-03T06:00:00.000Z"};
function fake({header=[row],history=[],content=fixture.revision}={}){
  const calls=[];
  const port={async query(sql,values){
    calls.push({sql,values});
    if(sql.includes("FROM quizer.problem_revisions")){
      if(sql.includes("SELECT r.revision_id,r.revision_number,r.created_by_uid"))
        return {rows:history};
      return {rows:content?[content]:[]};
    }
    return {rows:header};
  }};
  return {calls,repo:createQuizerNeonReadRepository(port)};
}
const denied=reason=>e=>e.reason===reason;
test("QN11.4 SQL list accepts subject/difficulty separately, never both",async()=>{
  const f=fake({header:[]});
  await f.repo.listProblemHeaders({actor:owner,subject:"Algebra"});
  assert.match(f.calls.at(-1).sql,/p.subject = \$/);
  assert(f.calls.at(-1).values.includes("Algebra"));
  await f.repo.listProblemHeaders({actor:owner,difficulty:"Olympiad"});
  assert.match(f.calls.at(-1).sql,/p.difficulty = \$/);
  assert(f.calls.at(-1).values.includes("Olympiad"));
  await assert.rejects(f.repo.listProblemHeaders({
    actor:owner,subject:"Algebra",tag:"parity"}),denied("INVALID_FIELDS"));
});
test("QN11.4 searching by title uses correct ASC keyset tuple",async()=>{
  const f=fake({header:[row,{...row,problem_id:"prb_second",
    search_title:"parity second"}]});
  const first=await f.repo.listProblemHeaders({
    actor:owner,search:"Parity",limit:1});
  assert.deepEqual(first.next,{searchTitle:"parity practice",
    problemId:row.problem_id});
  assert.match(f.calls.at(-1).sql,/ORDER BY p.search_title ASC, p.problem_id ASC/);
  await f.repo.listProblemHeaders({actor:owner,search:"Parity",
    limit:1,after:first.next});
  assert.match(f.calls.at(-1).sql,/p.search_title, p.problem_id/);
  assert(f.calls.at(-1).values.includes("parity practice"));
});
test("QN11.4 SQL lookahead supports 100 public items but refuses unbounded scans",async()=>{
  const f=fake({header:[]});
  await f.repo.listProblemHeaders({actor:owner,limit:101});
  assert(f.calls.at(-1).values.includes(102));
  await assert.rejects(f.repo.listProblemHeaders({actor:owner,limit:102}),
    denied("INVALID_FIELDS"));
});
test("QN11.4 history rechecks sharing, exposes only revision metadata",async()=>{
  const revs=[{revision_id:"prv_b",revision_number:2,
    created_at:"2026-11-03T04:00:00Z",created_by_uid:owner.uid},
    {revision_id:"prv_a",revision_number:1,
    created_at:"2026-11-02T04:00:00Z",created_by_uid:owner.uid}];
  const f=fake({history:revs});
  const first=await f.repo.listProblemRevisions({
    actor:collaborator,problemId:row.problem_id,limit:1});
  assert.deepEqual(first.items,[{id:"prv_b",revisionNumber:2,
    createdAt:"2026-11-03T04:00:00.000Z",createdBy:owner.uid}]);
  assert.deepEqual(first.next,{createdAt:"2026-11-03T04:00:00.000Z",
    revisionId:"prv_b"});
  assert.match(f.calls.at(-1).sql,/JOIN quizer.problems p/);
  assert.match(f.calls.at(-1).sql,/p.bank_visibility='teachers'/);
  assert(!JSON.stringify(first).includes("acceptedAnswers"));
  await f.repo.listProblemRevisions({actor:collaborator,
    problemId:row.problem_id,limit:1,after:first.next});
  assert(f.calls.at(-1).values.includes("prv_b"));
});
test("QN11.4 protected grading query enforces authorization after header lookup",async()=>{
  const f=fake();
  const result=await f.repo.getProblemForTeacher({
    actor:collaborator,problemId:row.problem_id});
  assert.equal(result.grading.correctOptionId,"b");
  assert.match(f.calls[1].sql,/JOIN quizer.problems p/);
  assert.deepEqual(f.calls[1].values,[row.problem_id,
    fixture.revision.revision_id,collaborator.uid,collaborator.role]);
  const before=f.calls.length;
  await assert.rejects(f.repo.getProblemForTeacher({
    actor:student,problemId:row.problem_id}),denied("ROLE_REQUIRED"));
  assert.equal(f.calls.length,before);
});


test("owner's 50 exact protected revisions are read in ONE permission-filtered SQL query",async()=>{
  const pins=Array.from({length:50},(_,i)=>({
    problemId:"prb_"+i,revisionId:"prv_"+i}));
  const calls=[],revision=fixture.revision;
  const port={query:async(sql,params)=>{
    calls.push({sql,params});
    return {rows:pins.map((pin,i)=>({
      ...row,problem_id:pin.problemId,revision_id:pin.revisionId,
      problem_revision_number:row.revision_number,
      revision_number:i+1,content_json:revision.content_json,
      grading_json:revision.grading_json,
      source_json:revision.source_json??{},content_hash:revision.content_hash,
      created_at:"2026-11-03T06:00:00.000Z",
      created_by_uid:owner.uid,
    }))};
  }};
  const repo=createQuizerNeonReadRepository(port);
  const result=await repo.getProblemBatchForTeacher({actor:owner,pins});
  assert.equal(result.length,50);
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/unnest\(\$2::varchar\[\],\$3::varchar\[\]\)/);
  assert.match(calls[0].sql,/p.owner_uid=\$1 AND p.lifecycle='active'/);
  assert.match(calls[0].sql,/r.revision_id=pins.revision_id/);
  assert.deepEqual(calls[0].params,[owner.uid,
    pins.map(p=>p.problemId),pins.map(p=>p.revisionId)]);
  assert.equal(result[49].revisionId,"prv_49");
  assert.equal(result[0].problem.ownerId,owner.uid);
  assert.deepEqual(result[0].grading,revision.grading_json);
});
test("batch read fails closed for unauthorized roles, short SQL result, wrong pin order and oversized batch",async()=>{
  let queries=0;
  const pins=[{problemId:"prb_0",revisionId:"prv_0"},
    {problemId:"prb_1",revisionId:"prv_1"}];
  const port={query:async()=>{queries++;
    return {rows:[{...row,problem_id:"prb_0",revision_id:"prv_0",
      created_at:"2026-11-03T06:00:00.000Z"}]};}};
  const repo=createQuizerNeonReadRepository(port);
  await assert.rejects(repo.getProblemBatchForTeacher({actor:student,pins}),
    denied("ROLE_REQUIRED"));
  assert.equal(queries,0);
  await assert.rejects(repo.getProblemBatchForTeacher({actor:owner,pins}),
    denied("RESOURCE_UNAVAILABLE"));
  assert.equal(queries,1);
  await assert.rejects(repo.getProblemBatchForTeacher({actor:owner,
    pins:Array.from({length:51},()=>pins[0])}),denied("INVALID_FIELDS"));
  assert.equal(queries,1);
});
