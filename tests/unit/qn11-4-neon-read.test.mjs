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
