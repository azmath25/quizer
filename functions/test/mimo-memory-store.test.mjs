import test from "node:test";
import assert from "node:assert/strict";
import {createAiMemoryStore,AiMemoryError} from "../src/mimo/memory-store.js";

const THREAD="f6c244c8-435c-4ced-aae3-5faabf3cacaf";
const UID="teacherA";
const DOC="3c5b1e49-4ac6-4e5f-b731-845095e4704c";
const requestId="request_1234567890123456";

function fakePool({ownerExists=true,priorThread=null,failAt=""}={}) {
  const calls=[];
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(failAt && sql.includes(failAt))throw Error("Synthetic database failure");
    if(sql.includes("SELECT id FROM quizer_ai.threads"))return ownerExists
      ? {rowCount:1,rows:[{id:THREAD}]} : {rowCount:0,rows:[]};
    if(sql.includes("SELECT DISTINCT thread_id"))return priorThread
      ? {rowCount:1,rows:[{thread_id:priorThread}]} : {rowCount:0,rows:[]};
    if(sql.includes("SELECT id,title,created_at,updated_at FROM quizer_ai.threads"))return ownerExists
      ? {rowCount:1,rows:[{id:THREAD,title:"Math",created_at:new Date(0),updated_at:new Date(0)}]}
      : {rowCount:0,rows:[]};
    if(sql.includes("FROM quizer_ai.documents WHERE owner_uid=$1 AND id=$2"))return {rowCount:0,rows:[]};
    if(sql.includes("FROM quizer_ai.messages"))return {rowCount:0,rows:[]};
    return {rowCount:0,rows:[]};
  };
  return {calls,query,connect:async()=>({query,release:()=>calls.push({sql:"RELEASE"})})};
}

test("atomic user+assistant persistence uses a single transaction and parameterized queries",async()=>{
  const pool=fakePool();
  const store=createAiMemoryStore({pool});
  const message="Solve x<y<script>";
  const result=await store.saveTurn({
    uid:UID,threadId:THREAD,requestId,message,reply:"x=1",runId:"run-123",
  });
  assert.deepEqual(result,{threadId:THREAD,saved:true});
  assert.equal(pool.calls.filter(c=>c.sql==="BEGIN").length,1);
  assert.equal(pool.calls.filter(c=>c.sql==="COMMIT").length,1);
  assert.equal(pool.calls.filter(c=>c.sql.includes("INSERT INTO quizer_ai.messages")).length,2);
  assert.equal(pool.calls.filter(c=>c.sql.includes(message)).length,0);
  assert.ok(pool.calls.some(c=>c.params.includes(message)));
  assert.ok(pool.calls.every(c=>!c.sql.includes("Bearer ")));
});

test("owner-scoped read forbids nonexistent or other-user conversations",async()=>{
  const pool=fakePool({ownerExists:false});
  const store=createAiMemoryStore({pool});
  await assert.rejects(store.getThread(UID,THREAD),{code:"THREAD_NOT_FOUND"});
  assert.equal(pool.calls.filter(c=>c.sql.includes("FROM quizer_ai.messages")).length,0);
  assert.equal(pool.calls[0].params[0],UID);
  await assert.rejects(store.getDocument(UID,DOC),{code:"DOCUMENT_NOT_FOUND"});
});

test("malformed ownership IDs, oversized content and invalid limit are refused",async()=>{
  const pool=fakePool();
  const store=createAiMemoryStore({pool});
  await assert.rejects(store.getThread("teacher/other",THREAD),AiMemoryError);
  await assert.rejects(store.getThread(UID,".."),AiMemoryError);
  await assert.rejects(store.listThreads(UID,500),AiMemoryError);
  await assert.rejects(store.saveTurn({
    uid:UID,threadId:THREAD,requestId,message:"Hello",reply:"x".repeat(15000),
  }),AiMemoryError);
  assert.equal(pool.calls.length,0);
});

test("cross-thread requestId conflicts rollback and never duplicate billable messages",async()=>{
  const pool=fakePool({priorThread:DOC});
  const store=createAiMemoryStore({pool});
  await assert.rejects(store.saveTurn({
    uid:UID,threadId:THREAD,requestId,message:"Explain",reply:"Answer",
  }),{code:"REQUEST_ID_CONFLICT"});
  assert.equal(pool.calls.filter(c=>c.sql==="ROLLBACK").length,1);
  assert.equal(pool.calls.filter(c=>c.sql==="COMMIT").length,0);
  assert.equal(pool.calls.filter(c=>c.sql.includes("INSERT INTO quizer_ai.messages")).length,0);
});

test("failed writes rollback and leave no half conversation",async()=>{
  const pool=fakePool({failAt:"INSERT INTO quizer_ai.messages"});
  const store=createAiMemoryStore({pool});
  await assert.rejects(store.saveTurn({
    uid:UID,threadId:THREAD,requestId,message:"Explain",reply:"Answer",
  }));
  assert.equal(pool.calls.filter(c=>c.sql==="ROLLBACK").length,1);
  assert.equal(pool.calls.filter(c=>c.sql==="COMMIT").length,0);
});

test("text documents are inserted as an owned document plus bounded page record",async()=>{
  const pool=fakePool();
  const store=createAiMemoryStore({pool});
  const result=await store.createTextDocument({
    uid:UID,title:"Mathematics",text:"Problem statement"
  });
  assert.equal(result.status,"text_ready");
  assert.match(result.documentId,/^[0-9a-f-]{36}$/);
  assert.equal(pool.calls.filter(c=>c.sql.includes("INSERT INTO quizer_ai.documents")).length,1);
  assert.equal(pool.calls.filter(c=>c.sql.includes("INSERT INTO quizer_ai.document_pages")).length,1);
  assert.equal(pool.calls.filter(c=>c.sql==="COMMIT").length,1);
});

test("server reads are bounded and owner-filtered",async()=>{
  const pool=fakePool();
  const store=createAiMemoryStore({pool});
  await store.listThreads(UID,10);
  await store.listDocuments(UID,10);
  for(const call of pool.calls){
    if(call.sql.includes("SELECT")) {
      assert.match(call.sql,/owner_uid=\$1/);
      assert.equal(call.params[0],UID);
    }
  }
});
