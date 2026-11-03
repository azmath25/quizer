import test from "node:test";
import assert from "node:assert/strict";
import { createFutureActivityReader } from "../../functions/src/neon/activity-reports.js";

const actor = (uid,role="teacher") =>
  ({ uid, role, accountStatus:"active", emailVerified:true });
const teacher = actor("teacher_a");
const other = actor("teacher_b");
const admin = actor("admin_a","admin");
const student = actor("student_a","student");
const cutoff = "2026-11-03T00:00:00.000Z";
const events = [
  { event_id:"evt_3", actor_uid:"student_a", actor_role:"student", action:"quiz.started",
    target_type:"quiz",target_id:"quiz_1",quiz_id:"quiz_1",quiz_owner_uid:"teacher_a",
    changed_fields:[],occurred_at:"2026-11-03T12:00:00.000Z" },
  { event_id:"evt_2", actor_uid:"teacher_a", actor_role:"teacher", action:"quiz.draft_saved",
    target_type:"quiz",target_id:"quiz_1",quiz_id:"quiz_1",quiz_owner_uid:"teacher_a",
    changed_fields:["title"],occurred_at:"2026-11-03T11:00:00.000Z" },
  { event_id:"evt_1", actor_uid:"teacher_b", actor_role:"teacher",action:"problem.created",
    target_type:"problem",target_id:"prb_1",quiz_id:null,quiz_owner_uid:null,
    changed_fields:[],occurred_at:"2026-11-03T10:00:00.000Z" },
];
function reader(rows=events, ownerId="teacher_a") {
  const sql = {calls:[], async query(statement,params) {
    this.calls.push({statement,params});
    return {rows};
  }};
  return {sql, reporting:createFutureActivityReader({
    enabled:true,sql,cutoverAt:cutoff,cursorSecret:"local-synthetic-test-secret-32-chars-only",
    resolveQuizOwnerId:async () => ownerId,
  })};
}
const reason = (x) => (e) => e?.reason === x;
test("QN6 disabled by default, no SQL used", async () => {
  const x = createFutureActivityReader({});
  assert.deepEqual(await x.listAdminActivity({actor:admin}),
    {disabled:true,items:[],nextCursor:null});
});
test("student and non-admin cannot fetch admin activity", async () => {
  const {sql,reporting}=reader();
  await assert.rejects(reporting.listAdminActivity({actor:student}),reason("ROLE_REQUIRED"));
  await assert.rejects(reporting.listAdminActivity({actor:teacher}),reason("ROLE_REQUIRED"));
  assert.equal(sql.calls.length,0);
});
test("admin receives sanitized future events and explicit history boundary", async () => {
  const {sql,reporting}=reader();
  const r=await reporting.listAdminActivity({actor:admin,limit:5});
  assert.equal(r.items.length,3);
  assert.equal(r.source,"neon_future_only");
  assert.equal(r.historyStartsAt,cutoff);
  assert.equal(r.historicalBackfill,false);
  assert(!JSON.stringify(r).includes("correctOptionId"));
  assert.match(sql.calls[0].statement,/e.occurred_at >=/);
});
test("teacher can read their owned quiz activity after Firebase ownership verification", async () => {
  const {sql,reporting}=reader();
  await reporting.listOwnedQuizHistory({actor:teacher,quizId:"quiz_1",limit:10});
  assert.match(sql.calls[0].statement,/e.quiz_owner_uid =/);
  assert(sql.calls[0].params.includes("quiz_1"));
  assert(sql.calls[0].params.includes("teacher_a"));
});
test("teacher cannot read another teacher's quiz", async () => {
  const {sql,reporting}=reader();
  await assert.rejects(reporting.listOwnedQuizHistory({actor:other,quizId:"quiz_1"}),reason("RESOURCE_UNAVAILABLE"));
  assert.equal(sql.calls.length,0);
});
test("admin can filter by target user safely", async () => {
  const {sql,reporting}=reader();
  await reporting.listAdminUserActivity({actor:admin,targetUid:"student_a"});
  assert.match(sql.calls[0].statement,/e.actor_uid =/);
  assert(sql.calls[0].params.includes("student_a"));
});
test("bounded keyset cursor signed and scoped to actor and filters", async () => {
  const {sql,reporting}=reader();
  const first=await reporting.listAdminActivity({actor:admin,limit:2});
  assert.equal(first.items.length,2);
  assert.equal(typeof first.nextCursor,"string");
  await reporting.listAdminActivity({actor:admin,limit:2,cursor:first.nextCursor});
  assert.match(sql.calls[1].statement,/\(e.occurred_at,e.event_id\) </);
  await assert.rejects(reporting.listAdminActivity({
    actor:actor("another_admin","admin"),limit:2,cursor:first.nextCursor,
  }),reason("INVALID_FIELDS"));
  await assert.rejects(reporting.listAdminActivity({
    actor:admin,limit:2,cursor:first.nextCursor,filter:{role:"student"},
  }),reason("INVALID_FIELDS"));
});
test("forged signed cursor refused before SQL", async () => {
  const {sql,reporting}=reader();
  const x=await reporting.listAdminActivity({actor:admin,limit:2});
  const bad=x.nextCursor.slice(0,-3)+"abc";
  await assert.rejects(reporting.listAdminActivity({actor:admin,limit:2,cursor:bad}),
    reason("INVALID_FIELDS"));
  assert.equal(sql.calls.length,1);
});
test("cutover clamps older date and returns empty before boundary", async () => {
  const {sql,reporting}=reader();
  await reporting.listAdminActivity({actor:admin,from:"2024-01-01"});
  assert(sql.calls[0].params.includes(cutoff));
  const empty=await reporting.listAdminActivity({actor:admin,to:"2026-01-01"});
  assert.deepEqual(empty.items,[]);
  assert.equal(empty.historyStartsAt,cutoff);
  assert.equal(sql.calls.length,1);
});
test("search values are bound parameters, never interpolated into SQL", async () => {
  const {sql,reporting}=reader([]);
  const injection="problem.created' OR TRUE --";
  await reporting.listAdminActivity({actor:admin,filter:{actionName:injection}}).catch(() => {});
  await reporting.listAdminActivity({actor:admin,filter:{actionName:"problem.created"}});
  assert(!sql.calls[0].statement.includes("problem.created' OR TRUE"));
  assert(sql.calls.at(-1).params.includes("problem.created"));
});
test("validation rejects weak cursor secret or missing cutover", () => {
  assert.throws(() => createFutureActivityReader({
    enabled:true,sql:{query:async()=>({rows:[]})},cursorSecret:"x",cutoverAt:cutoff,
  }));
  assert.throws(() => createFutureActivityReader({
    enabled:true,sql:{query:async()=>({rows:[]})},cursorSecret:"x".repeat(64),
  }));
});
