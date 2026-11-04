import test from "node:test";
import assert from "node:assert/strict";
import {createSatQuizNeonSql,SAT_QUIZ_NEON}
  from "../../functions/src/neon/sat-quiz-live-sql.js";

const url = "postgresql://quizer_app:synthetic-only@" +
  SAT_QUIZ_NEON.pooledHostname +
  "/quizer?sslmode=require&channel_binding=require";

function fakePool(){
  const calls=[];
  const pool={
    calls,
    connect:async()=>({
      query:async (sql,values=[])=>{
        calls.push([sql,values]);
        if(sql.includes("SELECT current_user AS role_name"))return {rows:[{
          role_name:"quizer_app",rolsuper:false,rolcreatedb:false,
          rolcreaterole:false,rolreplication:false,rolbypassrls:false,
          inherited_neon_superuser:false,
        }]};
        if(sql==="SELECT 42 AS answer")return {rows:[{answer:42}]};
        return {rows:[]};
      },
      release(){},
    }),
    async end(){},
  };
  return pool;
}
test("SAT QUIZ Neon port is disabled by default and does not dial",async()=>{
  const port=createSatQuizNeonSql();
  assert.equal(port.enabled,false);
  assert.deepEqual(await port.query("SELECT 42 AS answer"),{disabled:true});
});
test("SAT QUIZ live connection requires exact Firebase project",()=>{
  assert.throws(()=>createSatQuizNeonSql({
    enabled:true,firebaseProject:"mimo-backend-513412",connectionString:url,
  }),/not authorized/);
  assert.throws(()=>createSatQuizNeonSql({
    enabled:true,firebaseProject:"quizer-staging-az26",connectionString:url,
  }),/not authorized/);
});
test("SAT QUIZ live rejects cross-branch, owner and parameter overrides",()=>{
  for (const candidate of [
    url.replace(SAT_QUIZ_NEON.pooledHostname,
      "ep-some-other-pooler.c-7.eu-central-1.aws.neon.tech"),
    url.replace("quizer_app:","quizer_owner:"),
    url.replace("synthetic-only",""),
    url.replace("sslmode=require","sslmode=disable"),
    url+"&host=localhost",
    url.replace("channel_binding=require","channel_binding=disable"),
  ]) {
    assert.throws(()=>createSatQuizNeonSql({
      enabled:true,firebaseProject:"sat-quiz-fd317",
      connectionString:candidate,
    }),/not authorized|unsafe|Unexpected/);
  }
});
test("SAT QUIZ live uses a restricted SQL transaction and pinned pool",async()=>{
  let poolCount=0,options;
  const pool=fakePool();
  const port=createSatQuizNeonSql({
    enabled:true,firebaseProject:"sat-quiz-fd317",
    connectionString:url,
    createPool:async settings=>{poolCount++;options=settings;return pool;},
  });
  assert.equal(port.enabled,true);
  assert.equal(poolCount,0);
  const out=await port.query("SELECT 42 AS answer");
  assert.equal(out.rows[0].answer,42);
  assert.equal(poolCount,1);
  assert.equal(options.max,3);
  assert.equal(options.connectionString,url);
  await port.close();
});
test("SAT QUIZ live rejects unexpected elevated SQL role",async()=>{
  const pool=fakePool();
  const old=pool.connect;
  pool.connect=async()=>{
    const c=await old();
    const query=c.query;
    c.query=async (sql,args)=>{
      if(sql.includes("SELECT current_user AS role_name"))return {rows:[{
        role_name:"quizer_owner",rolsuper:false,rolcreatedb:true,
        rolcreaterole:true,rolreplication:false,rolbypassrls:true,
        inherited_neon_superuser:true,
      }]};
      return query(sql,args);
    };
    return c;
  };
  const port=createSatQuizNeonSql({
    enabled:true,firebaseProject:"sat-quiz-fd317",
    connectionString:url,createPool:async()=>pool,
  });
  await assert.rejects(port.query("SELECT 42 AS answer"),/elevated or unverified role/);
  await port.close();
});
