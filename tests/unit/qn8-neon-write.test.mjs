import test from "node:test";
import assert from "node:assert/strict";
import { createQuizerNeonWriteRepository, MAX_IMPORT_BATCH, fingerprint } from "../../functions/src/neon/write-repository.js";

const teacher = {uid:"teacher_a",role:"teacher",accountStatus:"active",emailVerified:true};
const student = {uid:"student_a",role:"student",accountStatus:"active",emailVerified:true};
const metadata = {title:"Addition",subject:"Math",difficulty:"Practice",
  tags:["arithmetic"],bankVisibility:"private"};
const content = {type:"open",answerMode:"auto",statementLatex:"Compute $1+1$.",
  options:[],defaultPoints:1,questionAssetBindings:{}};
const grading = {correctOptionId:null,acceptedAnswers:["2"],tolerance:0.000001,
  explanationLatex:"",rubricLatex:"",solutionAssetBindings:{}};
const record = n => ({importItemKey:"q_"+n,originalQuestionId:"printed_"+n,
  metadata:{...metadata,title:"Question "+n},content:{...content},
  grading:{...grading},points:1});
const job = {kind:"import",status:"running",requestedBy:teacher.uid,
  jobId:"job_fixture",sourceAssetId:"ast_original_tex"};

const safeRole = () => ({
  role_name:"quizer_app",rolsuper:false,rolcreatedb:false,
  rolcreaterole:false,rolreplication:false,rolbypassrls:false,
  inherited_neon_superuser:false,
});

function fakeDatabase({ role = safeRole(), fail = null } = {}) {
  let state = {problems:new Map(),revisions:new Map(),tags:new Map(),receipts:new Map()};
  let pending = Promise.resolve();
  const log = [];
  let commits = 0;
  const sql = {
    get state() { return state; },
    get commits() { return commits; },
    log,
    transaction(fn) {
      // Model Postgres serialization of conflicting advisory locks. Each
      // transaction owns a private snapshot and commits only if all statements pass.
      const run = async () => {
        const working = structuredClone(state);
        const tx = {async query(raw, args) {
          log.push({raw,args});
          if (fail?.(raw,args)) throw new Error("SIMULATED_SQL_FAILURE");
          if (raw.includes("current_user AS role_name"))
            return {rows:[{...role}]};
          if (raw.includes("pg_advisory_xact_lock")) return {rows:[]};
          if (raw.includes("FROM quizer.problems p WHERE")) {
            const p = working.problems.get(args[0]);
            return {rows:p?[{...p,tags:[...(working.tags.get(args[0])??[])].sort()}]:[]};
          }
          if (raw.includes("FROM quizer.problem_revisions WHERE")) {
            const r = working.revisions.get(args[1]);
            return {rows:r&&r.problem_id===args[0]?[{...r}]:[]};
          }
          if (raw.startsWith("INSERT INTO quizer.problems ")) {
            if (working.problems.has(args[0])) throw new Error("duplicate problem");
            working.problems.set(args[0],{
              problem_id:args[0],owner_uid:args[1],owner_display_name:args[2],
              title:args[3],subject:args[4],difficulty:args[5],
              bank_visibility:args[6],lifecycle:"active",
              latest_revision_id:args[7],revision_number:1,version:1,
              created_at:args[8],updated_at:args[8],
            });
            working.tags.set(args[0], []);
            return {rows:[]};
          }
          if (raw.startsWith("INSERT INTO quizer.problem_revisions ")) {
            const first = args.length === 8;
            const revisionId = args[0],problemId=args[1];
            if (!working.problems.has(problemId)) throw new Error("missing parent");
            if (working.revisions.has(revisionId)) throw new Error("duplicate revision");
            const row = first ? {revision_id:revisionId,problem_id:problemId,
              revision_number:1,content_json:JSON.parse(args[2]),
              grading_json:JSON.parse(args[3]),source_json:JSON.parse(args[4]),
              content_hash:args[5],created_by_uid:args[6],created_at:args[7]} :
              {revision_id:revisionId,problem_id:problemId,
                revision_number:args[2],content_json:JSON.parse(args[3]),
                grading_json:JSON.parse(args[4]),source_json:JSON.parse(args[5]),
                content_hash:args[6],created_by_uid:args[7],created_at:args[8]};
            working.revisions.set(revisionId,row);
            return {rows:[]};
          }
          if (raw.startsWith("INSERT INTO quizer.problem_tags")) {
            const tags=working.tags.get(args[0])??[];
            if (tags.includes(args[1])) throw new Error("duplicate tag");
            tags.push(args[1]);working.tags.set(args[0],tags);
            return {rows:[]};
          }
          if (raw.startsWith("DELETE FROM quizer.problem_tags")) {
            working.tags.set(args[0],[]);return {rows:[]};
          }
          if (raw.startsWith("UPDATE quizer.problems SET")) {
            const p=working.problems.get(args[0]);
            if (!p||p.version!==args[9]) return {rows:[]};
            Object.assign(p,{
              title:args[1],subject:args[2],difficulty:args[3],
              bank_visibility:args[4],latest_revision_id:args[5],
              revision_number:args[6],version:args[7],updated_at:args[8],
            });
            return {rows:[{problem_id:args[0]}]};
          }
          if (raw.startsWith("SELECT payload_hash,problem_id,revision_id FROM quizer.import_receipts")) {
            const item=working.receipts.get(args[0]+":"+args[1]);
            return {rows:item?[{...item}]:[]};
          }
          if (raw.startsWith("INSERT INTO quizer.import_receipts")) {
            const key=args[0]+":"+args[1];
            if (working.receipts.has(key)) throw new Error("duplicate receipt");
            working.receipts.set(key,{payload_hash:args[2],
              problem_id:args[3],revision_id:args[4]});
            return {rows:[]};
          }
          throw Error("Unexpected SQL shape: "+raw.slice(0,140));
        }};
        const result=await fn(tx);
        state=working;commits++;
        return result;
      };
      const result=pending.then(run);
      pending=result.catch(()=>{});
      return result;
    },
  };
  let checked=[];
  const writer=createQuizerNeonWriteRepository({
    sql, enabled:true,
    verifyAssets:async ({actor,assetIds})=>{checked.push({actor,assetIds});},
  });
  return {sql,writer,get checked(){return checked;}};
}
function init(writer,requestId="request_01234567890123") {
  return writer.createProblem({actor:teacher,requestId,metadata,content,grading});
}
const why=code=>err=>err?.reason===code;

test("QN8 remains disabled without a database, driver or credentials",async()=>{
  const off=createQuizerNeonWriteRepository();
  assert.equal(off.enabled,false);
  assert.deepEqual(await off.importProblemBatch(),{disabled:true});
  assert.equal(MAX_IMPORT_BATCH,20);
});
test("QN8 refuses activation without an asset-authorizing callback",()=>{
  assert.throws(()=>createQuizerNeonWriteRepository({
    enabled:true,sql:{transaction:async fn=>fn({query:async()=>({rows:[]})})},
  }),/Firebase asset/);
});
test("actual SQL role inspection refuses inherited admin, createdb or role-management powers",async()=>{
  for(const elevated of [{inherited_neon_superuser:true},{rolcreatedb:true},
    {rolcreaterole:true},{rolsuper:true},{role_name:"quizer_owner"}]) {
    const s=fakeDatabase({role:{...safeRole(),...elevated}});
    await assert.rejects(init(s.writer),/elevated or unverified/);
    assert.equal(s.sql.state.problems.size,0);
  }
});
test("creates one problem and exactly one immutable revision, replay is idempotent",async()=>{
  const {writer,sql}=fakeDatabase();
  const first=await init(writer);
  assert.match(first.problemId,/^prb_[a-f0-9]{28}$/);
  assert.match(first.revisionId,/^prv_[a-f0-9]{28}$/);
  assert.equal(first.version,1);
  const again=await init(writer);
  assert.equal(again.problemId,first.problemId);
  assert.equal(again.replayed,true);
  assert.equal(sql.state.problems.size,1);
  assert.equal(sql.state.revisions.size,1);
  assert.deepEqual(sql.state.tags.get(first.problemId),["arithmetic"]);
  await assert.rejects(writer.createProblem({actor:teacher,
    requestId:"request_01234567890123",metadata:{...metadata,title:"Different"},
    content,grading}),why("VERSION_CONFLICT"));
});
test("metadata-only edits reuse immutable revisions without rewriting unchanged tags",async()=>{
  const {writer,sql}=fakeDatabase();
  const created=await init(writer);
  const before=sql.state.revisions.get(created.revisionId);
  const m={...metadata,title:"Renamed"};
  const n=sql.log.length;
  const result=await writer.saveProblemRevision({actor:teacher,
    requestId:"request_edit_0123456789",problemId:created.problemId,
    expectedVersion:1,metadata:m});
  assert.equal(result.metadataOnly,true);
  assert.equal(result.version,2);
  assert.equal(result.revisionId,created.revisionId);
  assert.equal(sql.state.revisions.size,1);
  assert.deepEqual(sql.state.revisions.get(created.revisionId),before);
  assert(!sql.log.slice(n).some(x=>x.raw.includes("DELETE FROM quizer.problem_tags")));
  const noop=await writer.saveProblemRevision({actor:teacher,
    requestId:"request_noop_0123456789",problemId:created.problemId,
    expectedVersion:2,metadata:m});
  assert.equal(noop.unchanged,true);
  assert.equal(noop.version,2);
});
test("answer edits add one immutable revision; stale version and student edits fail",async()=>{
  const {writer,sql}=fakeDatabase();
  const c=await init(writer);
  const old=structuredClone(sql.state.revisions.get(c.revisionId));
  const newer=await writer.saveProblemRevision({actor:teacher,
    requestId:"request_new_0123456789",problemId:c.problemId,
    expectedVersion:1,metadata,
    content:{...content,statementLatex:"Compute $2+2$."},
    grading:{...grading,acceptedAnswers:["4"]}});
  assert.notEqual(newer.revisionId,c.revisionId);
  assert.equal(newer.version,2);
  assert.equal(sql.state.revisions.size,2);
  assert.deepEqual(sql.state.revisions.get(c.revisionId),old);
  assert.equal(sql.state.revisions.get(newer.revisionId).grading_json.acceptedAnswers[0],"4");
  await assert.rejects(writer.saveProblemRevision({actor:teacher,
    requestId:"request_stale_0123456789",problemId:c.problemId,
    expectedVersion:1,metadata}),why("VERSION_CONFLICT"));
  await assert.rejects(writer.saveProblemRevision({actor:student,
    requestId:"request_guest_0123456789",problemId:c.problemId,
    expectedVersion:2,metadata}),why("ROLE_REQUIRED"));
  await assert.rejects(writer.saveProblemRevision({actor:teacher,
    requestId:"request_malformed_0123456789",problemId:c.problemId,
    expectedVersion:2,metadata,content}),why("INVALID_FIELDS"));
});
test("100-question import performs five atomic batches of twenty with source reference only",async()=>{
  const {writer,sql,checked}=fakeDatabase();
  const mappings=[];
  for(let i=0;i<100;i+=20) {
    const r=await writer.importProblemBatch({actor:teacher,job,
      records:Array.from({length:20},(_,j)=>record(i+j))});
    assert.equal(r.newlyInserted,20);
    mappings.push(...r.mappings);
  }
  assert.equal(sql.commits,5);
  assert.equal(sql.state.problems.size,100);
  assert.equal(sql.state.revisions.size,100);
  assert.equal(sql.state.receipts.size,100);
  assert.equal(checked.length,5,"one Firebase asset verification per batch");
  assert.deepEqual(checked[0].assetIds,["ast_original_tex"]);
  assert.equal(new Set(mappings.map(x=>x.problemId)).size,100);
  assert.equal(sql.state.revisions.get(mappings[0].revisionId).source_json.sourceAssetId,
    "ast_original_tex");
  assert.equal(mappings[99].itemId.startsWith("itm_"),true);
});
test("500 items can be imported in 25 bounded batches without per-item Firebase calls",async()=>{
  const {writer,sql,checked}=fakeDatabase();
  for(let i=0;i<500;i+=20)
    await writer.importProblemBatch({actor:teacher,job,
      records:Array.from({length:20},(_,j)=>record(i+j))});
  assert.equal(sql.state.receipts.size,500);
  assert.equal(sql.commits,25);
  assert.equal(checked.length,25);
});
test("identical import replay creates no new records and preserves response order",async()=>{
  const {writer,sql}=fakeDatabase();
  const records=[record(2),record(1),record(3)];
  const a=await writer.importProblemBatch({actor:teacher,job,records});
  const b=await writer.importProblemBatch({actor:teacher,job,records});
  assert.equal(b.newlyInserted,0);
  assert.equal(b.mappings.every(m=>m.replayed),true);
  assert.deepEqual(b.mappings.map(m=>m.importItemKey),["q_2","q_1","q_3"]);
  assert.deepEqual(a.mappings.map(m=>m.problemId),b.mappings.map(m=>m.problemId));
  assert.equal(sql.state.receipts.size,3);
  const tampered={...record(1),metadata:{...metadata,title:"Changed"}};
  await assert.rejects(writer.importProblemBatch({actor:teacher,job,
    records:[tampered]}),why("VERSION_CONFLICT"));
  assert.equal(sql.state.receipts.size,3);
});
test("failed mid-batch SQL write rolls back all 20 problems and receipts",async()=>{
  let hit=0;
  const {writer,sql}=fakeDatabase({fail:raw=>{
    if(raw.startsWith("INSERT INTO quizer.problem_revisions "))return ++hit===2;
    return false;
  }});
  await assert.rejects(writer.importProblemBatch({actor:teacher,job,
    records:Array.from({length:20},(_,i)=>record(i))}),/SIMULATED_SQL_FAILURE/);
  assert.equal(sql.state.problems.size,0);
  assert.equal(sql.state.revisions.size,0);
  assert.equal(sql.state.receipts.size,0);
  assert.equal(sql.commits,0);
});
test("concurrent retries serialize and produce a single set of import receipts",async()=>{
  const {writer,sql}=fakeDatabase();
  const records=[record(1),record(2)];
  const [a,b]=await Promise.all([
    writer.importProblemBatch({actor:teacher,job,records}),
    writer.importProblemBatch({actor:teacher,job,records}),
  ]);
  assert.equal(a.newlyInserted+b.newlyInserted,2);
  assert.equal(sql.state.problems.size,2);
  assert.equal(sql.state.receipts.size,2);
});
test("authorization, batch bounds and duplicate keys reject before SQL transaction",async()=>{
  const {writer,sql}=fakeDatabase();
  await assert.rejects(writer.importProblemBatch({actor:student,job,records:[record(1)]}),
    why("ROLE_REQUIRED"));
  await assert.rejects(writer.importProblemBatch({actor:teacher,
    job:{...job,requestedBy:"someone_else"},records:[record(1)]}),
    why("RESOURCE_UNAVAILABLE"));
  await assert.rejects(writer.importProblemBatch({actor:teacher,job,
    records:Array.from({length:21},(_,i)=>record(i))}),why("INVALID_FIELDS"));
  await assert.rejects(writer.importProblemBatch({actor:teacher,job,
    records:[record(1),record(1)]}),why("INVALID_FIELDS"));
  assert.equal(sql.commits,0);
});
test("asset verification failure stops mutation before any SQL transaction",async()=>{
  let queries=0;
  const writer=createQuizerNeonWriteRepository({
    enabled:true,sql:{transaction:async()=>{queries++;}},
    verifyAssets:async()=>{throw new Error("ASSET_ACCESS_DENIED");},
  });
  await assert.rejects(writer.importProblemBatch({actor:teacher,job,
    records:[record(1)]}),/ASSET_ACCESS_DENIED/);
  assert.equal(queries,0);
});
test("SQL values are parameters; malicious titles cannot become SQL syntax",async()=>{
  const {writer,sql}=fakeDatabase();
  const title="X'); DROP SCHEMA quizer CASCADE;--";
  await writer.createProblem({actor:teacher,requestId:"request_injection_123456",
    metadata:{...metadata,title},content,grading});
  assert(!sql.log.some(x=>x.raw.includes(title)));
  assert(sql.log.some(x=>x.args?.includes(title)));
});
test("canonical normalized content hash matches the expected stable SHA form",()=>{
  assert.equal(fingerprint({x:1,y:2}),fingerprint({y:2,x:1}));
  assert.equal(fingerprint({content,grading}),fingerprint({grading,content}));
});
