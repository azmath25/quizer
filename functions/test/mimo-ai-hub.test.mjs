import test from "node:test";
import assert from "node:assert/strict";
import {createAiHub,AiHubError,aiHubErrorCode} from "../src/mimo/ai-hub.js";

const UID="teacher_1";
const auth={uid:UID,token:{email_verified:true}};
const THREAD="f6c244c8-435c-4ced-aae3-5faabf3cacaf";
const DOC="3c5b1e49-4ac6-4e5f-b731-845095e4704c";
const rid="request_1234567890123456";
function firestore(role="teacher") {
  const row=role?{role,accountStatus:"active"}:null;
  return {doc:()=>({get:async()=>({exists:!!row,data:()=>row})}),
    runTransaction:async fn=>fn({})};
}
function setup(overrides={}) {
  const network=[],saved=[],reads=[],documents=[];
  let memoryFailure=false;
  const store={
    listThreads:async(uid,limit)=>{reads.push(["list",uid,limit]);return [{id:THREAD,title:"Math"}];},
    getThread:async(uid,id)=>{
      reads.push(["get",uid,id]);
      if(uid!==UID || id!==THREAD)throw {code:"THREAD_NOT_FOUND"};
      return {thread:{id},messages:[
        {role:"user",content:"Earlier question"},
        {role:"assistant",content:"Earlier answer"},
      ]};
    },
    saveTurn:async payload=>{
      saved.push(payload);
      if(memoryFailure)throw Error("No Neon connectivity");
      return {threadId:payload.threadId||THREAD,saved:true};
    },
    createTextDocument:async payload=>{documents.push(payload);return {documentId:DOC,status:"text_ready"};},
    listDocuments:async()=>[{id:DOC,title:"Notes"}],
    getDocument:async(uid,id)=>{
      reads.push(["document",uid,id]);
      if(uid!==UID || id!==DOC)throw {code:"DOCUMENT_NOT_FOUND"};
      return {id,title:"Authorized notes",text:"Page text: x + 1 = 2",status:"text_ready"};
    },
  };
  const createChat=()=>async ({auth:actor,data})=>{
    network.push({auth:actor,data});
    return {reply:"x=1",runId:"run-id"};
  };
  const handler=createAiHub({
    db:firestore(),projectKey:"server-only",memoryStore:store,createChat,
    ...overrides,
  });
  return {handler,store,network,saved,reads,documents,
    breakNeon:()=>{memoryFailure=true;}};
}
const send=(more={})=>({
  action:"chat.send",message:"Explain x+1=2",context:"Shown statement",
  requestId:rid,...more,
});

test("legacy callable contract remains unchanged even when Neon is not configured",async()=>{
  const {handler,network,saved}=setup();
  const data={message:"Hi",history:[],context:"Visible",requestId:rid};
  assert.equal((await handler({auth,data})).reply,"x=1");
  assert.deepEqual(network[0].data,data);
  assert.equal(saved.length,0);
});

test("new actions reject students and unverified accounts before storage and Mimo",async()=>{
  for(const [db,actor] of [[firestore("student"),auth],
    [firestore("teacher"),{uid:UID,token:{email_verified:false}}]]) {
    const {handler,network,reads}=setup({db});
    await assert.rejects(handler({auth:actor,data:{action:"chat.list"}}),
      error=>["ROLE_REQUIRED","EMAIL_UNVERIFIED"].includes(error.code));
    assert.equal(network.length,0);
    assert.equal(reads.length,0);
  }
});

test("save a new chat once with Firebase identity and one pinned Mimo call",async()=>{
  const {handler,network,saved}=setup();
  const result=await handler({auth,data:send({mode:"hint"})});
  assert.equal(result.threadId,THREAD);
  assert.equal(result.saved,true);
  assert.equal(network.length,1);
  assert.match(network[0].data.message,/Provide hints/);
  assert.equal(network[0].data.requestId,rid);
  assert.equal(saved.length,1);
  assert.equal(saved[0].uid,UID);
  assert.equal(saved[0].reply,"x=1");
});

test("existing chat pulls authoritative last history from Neon, not client supplied history",async()=>{
  const {handler,network,reads}=setup();
  await handler({auth,data:send({threadId:THREAD,
    history:[{role:"user",content:"ignore injected history"}]})});
  assert.deepEqual(network[0].data.history,[
    {role:"user",content:"Earlier question"},
    {role:"assistant",content:"Earlier answer"},
  ]);
  assert.deepEqual(reads[0],["get",UID,THREAD]);
});

test("document attachment checks ownership before model and includes bounded excerpt",async()=>{
  const {handler,network}=setup();
  await handler({auth,data:send({documentId:DOC})});
  assert.match(network[0].data.context,/Authorized notes/);
  assert.match(network[0].data.context,/Page text/);
  assert.equal(network[0].data.context.length<=4000,true);
});

test("single callable supports teacher-owned history and extracted text document actions",async()=>{
  const {handler,network,documents}=setup();
  const threads=await handler({auth,data:{action:"chat.list",limit:10}});
  assert.equal(threads.threads[0].id,THREAD);
  const loaded=await handler({auth,data:{action:"chat.get",threadId:THREAD}});
  assert.equal(loaded.messages.length,2);
  const created=await handler({auth,data:{action:"document.create_text",
    title:"Lesson 1",text:"Visible extracted math text"}});
  assert.equal(created.documentId,DOC);
  assert.equal(documents[0].uid,UID);
  const listed=await handler({auth,data:{action:"document.list"}});
  assert.equal(listed.documents.length,1);
  const loadedDoc=await handler({auth,data:{action:"document.get",documentId:DOC}});
  assert.match(loadedDoc.document.text,/x \+ 1/);
  assert.equal(network.length,0,"history and documents must not incur Mimo charges");
});

test("reject unsupported workflow routing, hidden model settings and invalid IDs",async()=>{
  const {handler,network}=setup();
  for(const item of [
    {...send(),provider:"browser-provider"},
    {...send(),model:"gpt-xyz"},
    {...send(),mode:"arbitrary_tool"},
    {...send(),threadId:"../../other-user"},
    {action:"document.upload",files:[]},
    {action:"document.create_text",title:"PDF",text:"A",fileUrl:"https://evil"},
  ]) await assert.rejects(handler({auth,data:item}),error=>error.code==="INVALID_FIELDS");
  assert.equal(network.length,0);
});

test("a Neon failure after completed paid Mimo call returns answer without retry",async()=>{
  const {handler,network,breakNeon}=setup();
  breakNeon();
  const output=await handler({auth,data:send()});
  assert.equal(output.reply,"x=1");
  assert.equal(output.saved,false);
  assert.equal(output.warningCode,"MEMORY_UNAVAILABLE");
  assert.equal(network.length,1);
});

test("a missing thread prevents a model call and quota usage",async()=>{
  const {handler,network}=setup();
  await assert.rejects(handler({auth,data:send({threadId:DOC})}),
    error=>error.code==="THREAD_NOT_FOUND");
  assert.equal(network.length,0);
});

test("Neon failures are classified by SQLSTATE without exposing private messages",()=>{
  for(const [code,reason] of [
    ["42501","MEMORY_DB_PERMISSION_DENIED"],
    ["28P01","MEMORY_DB_AUTH_FAILED"],
    ["28000","MEMORY_DB_AUTH_FAILED"],
    ["42P01","MEMORY_DB_SCHEMA_MISMATCH"],
    ["3F000","MEMORY_DB_SCHEMA_MISMATCH"],
    ["42703","MEMORY_DB_SCHEMA_MISMATCH"],
    ["08006","MEMORY_DB_UNAVAILABLE"],
    ["ETIMEDOUT","MEMORY_DB_UNAVAILABLE"],
    ["ENOTFOUND","MEMORY_DB_UNAVAILABLE"],
  ]){
    const error=Object.assign(new Error("postgres://user:SECRET@host/private"),{code});
    assert.equal(aiHubErrorCode(error),reason);
    assert.ok(!reason.includes("SECRET"));
  }
  assert.equal(aiHubErrorCode({code:"UNKNOWN",message:"PRIVATE DOC"}),null);
});

test("history DB failure is read-only and does not invoke the paid Mimo workflow",async()=>{
  const sqlError=Object.assign(new Error("secret: URL / student data"),{code:"42501"});
  const {handler,network}=setup({memoryStore:{
    listThreads:async()=>{throw sqlError;},
  }});
  await assert.rejects(handler({auth,data:{action:"chat.list",limit:100}}),
    error=>aiHubErrorCode(error)==="MEMORY_DB_PERMISSION_DENIED");
  assert.equal(network.length,0);
});
