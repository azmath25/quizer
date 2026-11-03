import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createQuizerSqlPort} from "../../functions/src/neon/sql-port.js";
import {createQuizerNeonOrchestrator} from "../../functions/src/neon/orchestrator.js";

const config={enabled:true,projectId:"isolated-quizer",database:"quizer",
  getConnectionString:()=>"postgresql://quizer_app:SYNTHETIC_SECRET@ep-quizer.neon.tech/quizer?sslmode=require"};
const role={role_name:"quizer_app",rolsuper:false,rolcreatedb:false,
  rolcreaterole:false,rolreplication:false,rolbypassrls:false,
  inherited_neon_superuser:false};
function fixture(overrides={}){
  const queries=[];let released=0,ended=0,connected=0;
  const pool={async connect(){connected++;return {
    async query(sql,args=[]){queries.push({sql,args});
      if(overrides.fail?.(sql))throw Error("synthetic query failed");
      if(sql.includes("current_user AS role_name"))
        return {rows:[{...role,...overrides.role}]};
      if(sql==="SELECT $1 AS value")return {rows:[{value:args[0]}]};
      return {rows:[]};},
    release(){released++;},
  };},async end(){ended++;}};
  return {pool,queries,get connected(){return connected},
    get released(){return released},get ended(){return ended}};
}
const auth={uid:"teacher_one",token:{email_verified:true}};
const input={apiVersion:2,action:"saveProblemRevision",
  requestId:"request_test_0000001",problemId:"prb_one",expectedVersion:1,
  metadata:{title:"Example"}};
test("default OFF has no driver or database side effects",async()=>{
  assert.deepEqual(await createQuizerSqlPort().transaction(()=>{throw Error("called");}),
    {disabled:true});
  assert.deepEqual(await createQuizerNeonOrchestrator().handle(),{disabled:true});
});
test("SQL port refuses activation without independently verifiable project",async()=>{
  assert.throws(()=>createQuizerSqlPort({enabled:true,config,createPool:()=>{}}),
    /verified, separate/);
  let dials=0;
  const p=createQuizerSqlPort({enabled:true,config,attestProject:async p=>{
    assert.equal(p.projectId,"isolated-quizer");
    assert.equal(p.hostname,"ep-quizer.neon.tech");
    return false;
  },createPool:()=>{dials++;return fixture().pool;}});
  await assert.rejects(p.transaction(()=>{}),/connection unavailable/);
  assert.equal(dials,0);
});
test("restricted SQL pool verifies role, binds parameters, commits and closes",async()=>{
  const f=fixture();let creations=0;
  const p=createQuizerSqlPort({enabled:true,config,
    attestProject:async()=>true,createPool:async opts=>{
      creations++;assert.equal(opts.max,3);return f.pool;}});
  const out=await Promise.all([
    p.query("SELECT $1 AS value",[3]),
    p.transaction(tx=>tx.query("SELECT $1 AS value",[4])),
  ]);
  assert.deepEqual(out.map(x=>x.rows[0].value),[3,4]);
  assert.equal(creations,1);
  assert.equal(f.connected,2);
  assert.equal(f.released,2);
  assert.equal(f.queries.filter(q=>q.sql==="BEGIN").length,2);
  assert.equal(f.queries.filter(q=>q.sql==="COMMIT").length,2);
  await p.close();assert.equal(f.ended,1);
  await assert.rejects(p.query("SELECT 1"),/closed/);
});
test("elevated roles and query failures rollback; secrets stay private",async()=>{
  for(const invalid of [{rolcreatedb:true},{rolsuper:true},
    {inherited_neon_superuser:true},{role_name:"neondb_owner"}]){
    const f=fixture({role:invalid});
    const p=createQuizerSqlPort({enabled:true,config,
      attestProject:async()=>true,createPool:async()=>f.pool});
    await assert.rejects(p.transaction(()=>{}),/elevated/);
    assert.equal(f.queries.filter(q=>q.sql==="ROLLBACK").length,1);
    await p.close();
  }
  const f=fixture({fail:sql=>sql==="SELECT $1 AS value"});
  const p=createQuizerSqlPort({enabled:true,config,
    attestProject:async()=>true,createPool:async()=>f.pool});
  await assert.rejects(p.query("SELECT $1 AS value",[8]),/synthetic query/);
  assert.equal(f.queries.filter(q=>q.sql==="ROLLBACK").length,1);
  await p.close();
  const bad=createQuizerSqlPort({enabled:true,config,
    attestProject:async()=>true,
    createPool:async()=>({connect:async()=>{throw Error("SYNTHETIC_SECRET");},
      end:async()=>{}})});
  await assert.rejects(bad.query("SELECT 1"),e=>
    !e.message.includes("SYNTHETIC_SECRET"));
  await bad.close();
});
function staged({lose=false}={}){
  const ops=new Map(),events=[];let failOnce=lose;
  const gateway={enabled:true,replaySafeEdits:true,handle:async()=>{
    events.push("NEON");return {problemId:"prb_one",version:2};}};
  const coordinator={
    async prepare({requestId,payloadHash}){
      events.push("FIRESTORE_PREPARE");
      const p=ops.get(requestId);
      if(p){
        if(p.hash!==payloadHash)throw Error("PAYLOAD_COLLISION");
        if(p.complete)return {status:"complete",result:p.result};
        return {status:"prepared",token:p.token};
      }
      const item={hash:payloadHash,token:"fencing_token_00001"};
      ops.set(requestId,item);
      return {status:"prepared",token:item.token};
    },
    async recordEffect({requestId,result,token}){
      events.push("FIRESTORE_EFFECT_RECEIPT");
      assert.equal(ops.get(requestId).token,token);
      ops.get(requestId).result=result;
    },
    async finalize({requestId,result}){
      events.push("FIRESTORE_FINALIZE");
      if(failOnce){failOnce=false;throw Error("lost final acknowledgement");}
      ops.get(requestId).complete=true;
      return result;
    },
  };
  return {events,ops,orchestrator:createQuizerNeonOrchestrator({
    enabled:true,gateway,coordinator})};
}
test("orchestrator rejects unsafe activation and invalid/untrusted requests",async()=>{
  assert.throws(()=>createQuizerNeonOrchestrator({enabled:true,
    gateway:{enabled:true,handle:()=>{}},coordinator:{}}),/replay-safe/);
  const f=staged();
  await assert.rejects(f.orchestrator.handle(input.action,auth,
    {...input,actor:{uid:"imposter"}}),e=>e.reason==="INVALID_FIELDS");
  await assert.rejects(f.orchestrator.handle(input.action,null,input),
    e=>e.reason==="AUTH_REQUIRED");
  assert.equal(f.events.length,0);
});
test("Firebase prepare -> independent SQL effect -> Firebase finalize; replay cached",async()=>{
  const f=staged();
  const a=await f.orchestrator.handle(input.action,auth,input);
  assert.equal(a.version,2);
  assert.deepEqual(f.events,["FIRESTORE_PREPARE","NEON",
    "FIRESTORE_EFFECT_RECEIPT","FIRESTORE_FINALIZE"]);
  assert.deepEqual(await f.orchestrator.handle(input.action,auth,input),a);
  assert.equal(f.events.filter(x=>x==="NEON").length,1);
  await assert.rejects(f.orchestrator.handle(input.action,auth,
    {...input,metadata:{title:"Changed"}}),/PAYLOAD_COLLISION/);
});
test("lost Firebase finalize retries safely; no extra SQL effect after complete",async()=>{
  const f=staged({lose:true});
  await assert.rejects(f.orchestrator.handle(input.action,auth,input),/lost/);
  await f.orchestrator.handle(input.action,auth,input);
  assert.equal(f.events.filter(x=>x==="NEON").length,2);
  await f.orchestrator.handle(input.action,auth,input);
  assert.equal(f.events.filter(x=>x==="NEON").length,2);
  assert.equal(f.ops.get(input.requestId).complete,true);
});
test("QN11.2 leaves active Firebase routes and SQL migrations untouched",()=>{
  const source=readFileSync(new URL("../../functions/src/index.js",import.meta.url),"utf8")+
    readFileSync(new URL("../../functions/src/router.js",import.meta.url),"utf8");
  const migration=readFileSync(new URL(
    "../../db/quizer/002_mutation_receipts_DISPOSABLE_ONLY.sql",import.meta.url),"utf8");
  assert.doesNotMatch(source,/createQuizerNeonOrchestrator|createQuizerSqlPort/);
  assert.match(migration,/CREATE TABLE quizer\.mutation_receipts/);
  assert.match(migration,/PRIMARY KEY \(actor_uid, request_id\)/);
  assert.match(migration,/REVOKE ALL ON quizer\.mutation_receipts FROM PUBLIC/);
  assert.doesNotMatch(migration,/DROP TABLE|DROP SCHEMA|GRANT UPDATE|GRANT DELETE/);
});
