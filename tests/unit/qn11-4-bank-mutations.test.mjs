import test from "node:test";
import assert from "node:assert/strict";
import {createQuizerNeonBankMutations} from "../../functions/src/neon/bank-mutations.js";
import {fingerprint} from "../../functions/src/neon/write-repository.js";
const owner={uid:"teacher_alpha",role:"teacher",emailVerified:true,accountStatus:"active"};
const other={...owner,uid:"teacher_beta"};
const admin={...owner,uid:"admin_one",role:"admin"};
const content={type:"choice",answerMode:"auto",statementLatex:"Which is odd?",
  options:[{id:"a",textLatex:"2"},{id:"b",textLatex:"3"}],defaultPoints:1,
  questionAssetBindings:{"figure.png":"ast_shared"}};
const grading={correctOptionId:"b",acceptedAnswers:[],tolerance:0,
  explanationLatex:"3 is odd",rubricLatex:"",solutionAssetBindings:{}};
const role=()=>({role_name:"quizer_app",rolsuper:false,rolcreatedb:false,
  rolcreaterole:false,rolreplication:false,rolbypassrls:false,
  inherited_neon_superuser:false});
function db({sourceOwner=owner.uid,visible="teachers",failing=()=>false,
  dbRole=role()}={}){
  let state={problems:new Map(),revisions:new Map(),tags:new Map(),receipts:new Map()};
  const id="prb_original",rid="prv_old";
  const row={problem_id:id,owner_uid:sourceOwner,title:"Parity",
    search_title:"parity",subject:"Math",difficulty:"Practice",
    bank_visibility:visible,lifecycle:"active",latest_revision_id:rid,
    revision_number:1,version:3,updated_at:new Date().toISOString(),
    owner_display_name:"Example",created_at:new Date().toISOString()};
  state.problems.set(id,row);
  state.tags.set(id,["parity"]);
  state.revisions.set(rid,{
    revision_id:rid,problem_id:id,revision_number:1,
    content_json:content,grading_json:grading,source_json:{},
    content_hash:fingerprint({content,grading}),created_by_uid:owner.uid,
    created_at:new Date().toISOString()});
  let tail=Promise.resolve();const queries=[];
  const sql={
    get state(){return state;},queries,
    transaction(fn){
      const run=async()=>{
        const copy=structuredClone(state);
        const tx={async query(query,args=[]){
          queries.push({query,args});
          if(failing(query,args))throw Error("SYNTHETIC_SQL_FAILURE");
          if(query.startsWith("SELECT current_user AS role_name"))
            return {rows:[dbRole]};
          if(query.includes("pg_advisory_xact_lock"))return {rows:[]};
          if(query.includes("FROM quizer.mutation_receipts")){
            const existing=copy.receipts.get(args[0]+":"+args[1]);
            return {rows:existing?[existing]:[]};
          }
          if(query.includes("FROM quizer.problems p WHERE")&&
            query.includes("FOR UPDATE OF p")){
            const found=copy.problems.get(args[0]);
            return {rows:found?[{...found,tags:[...(copy.tags.get(args[0])??[])]}]:[]};
          }
          if(query.includes("FROM quizer.problem_revisions WHERE")){
            const found=copy.revisions.get(args[1]);
            return {rows:found&&found.problem_id===args[0]?[found]:[]};
          }
          if(query.startsWith("UPDATE quizer.problems SET")){
            const p=copy.problems.get(args[0]);
            if(!p)throw Error("Missing problem");
            if(query.includes("SET subject=$2")){
              assert.equal(p.version,args[6]);
              Object.assign(p,{subject:args[1],difficulty:args[2],
                bank_visibility:args[3],version:args[4],updated_at:args[5]});
            }else if(query.includes("SET lifecycle=$2")){
              assert.equal(p.version,args[6]);
              Object.assign(p,{lifecycle:args[1],bank_visibility:args[2],
                trashed_at:args[3],version:args[4],updated_at:args[5]});
            }else if(query.includes("SET bank_visibility=$2")){
              assert.equal(p.version,args[4]);
              Object.assign(p,{bank_visibility:args[1],version:args[2],
                updated_at:args[3]});
            }else throw Error("Unknown UPDATE SQL");
            return {rows:[]};
          }
          if(query.startsWith("DELETE FROM quizer.problem_tags")){
            copy.tags.set(args[0],[]);return {rows:[]};
          }
          if(query.startsWith("INSERT INTO quizer.problem_tags")){
            const tags=copy.tags.get(args[0])??[];
            tags.push(args[1]);copy.tags.set(args[0],tags);return {rows:[]};
          }
          if(query.startsWith("INSERT INTO quizer.problems ")){
            if(copy.problems.has(args[0]))throw Error("Duplicate problem");
            copy.problems.set(args[0],{
              problem_id:args[0],owner_uid:args[1],title:args[2],
              subject:args[3],difficulty:args[4],
              bank_visibility:"private",lifecycle:"active",
              latest_revision_id:args[5],revision_number:1,version:1,
              source_problem_id:args[6],source_problem_revision_id:args[7],
              updated_at:args[8]});
            copy.tags.set(args[0],[]);
            return {rows:[]};
          }
          if(query.startsWith("INSERT INTO quizer.problem_revisions")){
            if(copy.revisions.has(args[0]))throw Error("Duplicate rev");
            copy.revisions.set(args[0],{
              revision_id:args[0],problem_id:args[1],revision_number:1,
              content_json:JSON.parse(args[2]),grading_json:JSON.parse(args[3]),
              source_json:JSON.parse(args[4]),content_hash:args[5]});
            return {rows:[]};
          }
          if(query.startsWith("INSERT INTO quizer.mutation_receipts")){
            const key=args[0]+":"+args[1];
            if(copy.receipts.has(key))throw Error("Duplicate receipt");
            copy.receipts.set(key,{action:args[2],payload_hash:args[3],
              result_json:JSON.parse(args[4])});
            return {rows:[]};
          }
          throw Error("Unexpected SQL "+query);
        }};
        const result=await fn(tx);state=copy;return result;
      };
      const work=tail.then(run);tail=work.catch(()=>{});return work;
    },
  };
  let assetChecks=0;
  const mutations=createQuizerNeonBankMutations({enabled:true,sql,
    verifyAssetCopy:async({actor,assetIds,problemId,revisionId})=>{
      assetChecks++;assert.equal(problemId,id);assert.equal(revisionId,rid);
      assert(assetIds.includes("ast_shared"));assert.notEqual(actor.role,"student");
    }});
  const mutate=(action,request,actor=owner,requestId="request_000000000001")=>
    mutations.mutate({actor,action,request,requestId});
  return {sql,mutations,mutate,get assetChecks(){return assetChecks},id,rid};
}
const why=reason=>e=>e.reason===reason;
test("QN11.4 SQL bank metadata operations default off; fail closed without trusted verifier",async()=>{
  assert.deepEqual(await createQuizerNeonBankMutations().mutate(),
    {disabled:true});
  assert.throws(()=>createQuizerNeonBankMutations({enabled:true,
    sql:{transaction:async()=>{}}}),/asset-copy verifier/);
});
test("sharing is versioned, restricted, replay-safe and never edits protected revision",async()=>{
  const f=db();const before=structuredClone(f.sql.state.revisions.get(f.rid));
  const request={problemId:f.id,expectedVersion:3,visibility:"private"};
  const first=await f.mutate("setProblemSharing",request);
  assert.deepEqual(first,{version:4});
  assert.equal(f.sql.state.problems.get(f.id).bank_visibility,"private");
  const second=await f.mutate("setProblemSharing",request);
  assert.deepEqual(second,first);
  assert.equal(f.sql.state.problems.get(f.id).version,4);
  assert.deepEqual(f.sql.state.revisions.get(f.rid),before);
  await assert.rejects(f.mutate("setProblemSharing",{
    ...request,visibility:"teachers"}),why("VERSION_CONFLICT"));
  await assert.rejects(f.mutate("setProblemSharing",{
    ...request,expectedVersion:3},owner,"another_request_12345"),
    why("VERSION_CONFLICT"));
  assert.equal(f.sql.state.receipts.size,1);
});
test("trash, restore and cross-user access preserve history and private sharing",async()=>{
  const f=db();const trashed=await f.mutate("trashProblem",{
    problemId:f.id,expectedVersion:3},owner,"trash_request_123456");
  assert.equal(trashed.version,4);
  assert.equal(f.sql.state.problems.get(f.id).lifecycle,"trashed");
  const restored=await f.mutate("restoreProblem",{
    problemId:f.id,expectedVersion:4},owner,"restore_request_123456");
  assert.equal(restored.version,5);
  assert.equal(f.sql.state.problems.get(f.id).bank_visibility,"private");
  assert.equal(f.sql.state.revisions.size,1);
  await assert.rejects(f.mutate("trashProblem",{
    problemId:f.id,expectedVersion:5},other,"other_request_123456"),
    why("RESOURCE_UNAVAILABLE"));
  assert.equal((await f.mutate("setProblemSharing",{
    problemId:f.id,expectedVersion:5,visibility:"teachers"},
    admin,"admin_request_123456")).version,6);
});
test("bulk update commits all selected metadata/tags or none and replays",async()=>{
  const f=db();const request={problemIds:[f.id],
    subject:"Number theory",addTags:["geometry"],removeTags:["parity"],
    visibility:"teachers"};
  const first=await f.mutate("bulkUpdateProblems",request);
  assert.deepEqual(first.versions,{[f.id]:4});
  assert.deepEqual(f.sql.state.tags.get(f.id),["geometry"]);
  assert.equal(f.sql.state.problems.get(f.id).subject,"Number theory");
  assert.deepEqual(await f.mutate("bulkUpdateProblems",request),first);
  assert.equal(f.sql.state.receipts.size,1);
  await assert.rejects(f.mutate("bulkUpdateProblems",{...request,
    problemIds:[f.id,"prb_missing"]},owner,"bulk_missing_123456"),
    why("RESOURCE_UNAVAILABLE"));
  assert.equal(f.sql.state.problems.get(f.id).version,4);
  await assert.rejects(f.mutate("bulkUpdateProblems",{
    problemIds:[f.id],addTags:Array.from({length:13},(_,i)=>"t"+i)},
    owner,"bulk_too_many_123456"),why("INVALID_FIELDS"));
});
test("atomic receipt insertion failure rolls back metadata and version",async()=>{
  const f=db({failing:q=>q.startsWith("INSERT INTO quizer.mutation_receipts")});
  await assert.rejects(f.mutate("trashProblem",{
    problemId:f.id,expectedVersion:3}),/SYNTHETIC_SQL_FAILURE/);
  assert.equal(f.sql.state.problems.get(f.id).lifecycle,"active");
  assert.equal(f.sql.state.problems.get(f.id).version,3);
  assert.equal(f.sql.state.receipts.size,0);
});
test("fork authorizes shared immutable content and assets and pins source metadata",async()=>{
  const f=db({sourceOwner:"teacher_other"});
  const request={problemId:f.id,title:"Parity (copy)"};
  const a=await f.mutate("forkProblem",request);
  assert.equal(a.version,1);
  assert.equal(f.assetChecks,1);
  const copy=f.sql.state.problems.get(a.problemId);
  assert.equal(copy.owner_uid,owner.uid);
  assert.equal(copy.bank_visibility,"private");
  assert.equal(copy.source_problem_id,f.id);
  assert.equal(copy.source_problem_revision_id,f.rid);
  assert.deepEqual(f.sql.state.revisions.get(a.revisionId).grading_json,
    {...grading,gradingVersion:1});
  assert.equal(f.sql.state.revisions.size,2);
  // A successful fork can replay after the original owner revokes sharing;
  // it must not refetch private source content or redo asset authorization.
  f.sql.state.problems.get(f.id).bank_visibility="private";
  const again=await f.mutate("forkProblem",request);
  assert.deepEqual(again,a);
  assert.equal(f.assetChecks,1);
  assert.equal(f.sql.state.problems.size,2);
});
test("private source cannot be forked and unauthorized actors never trigger copy",async()=>{
  const f=db({sourceOwner:"someone_else",visible:"private"});
  await assert.rejects(f.mutate("forkProblem",{problemId:f.id}),
    why("RESOURCE_UNAVAILABLE"));
  assert.equal(f.assetChecks,0);
  await assert.rejects(f.mutate("trashProblem",{
    problemId:f.id,expectedVersion:3},{...owner,role:"student"},
    "student_request_123456"),why("ROLE_REQUIRED"));
});
test("SQL role elevation blocks mutation; queries always parameterize unsafe strings",async()=>{
  const bad=db({dbRole:{...role(),rolsuper:true}});
  await assert.rejects(bad.mutate("trashProblem",{
    problemId:bad.id,expectedVersion:3}),/elevated/);
  const good=db();
  const unsafe="X'); DROP SCHEMA quizer CASCADE;--";
  await good.mutate("bulkUpdateProblems",{
    problemIds:[good.id],subject:unsafe});
  assert(!good.sql.queries.some(x=>x.query.includes(unsafe)));
  assert(good.sql.queries.some(x=>x.args.includes(unsafe)));
});
