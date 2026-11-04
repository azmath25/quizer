import test from "node:test";
import assert from "node:assert/strict";
import {createProd1ImportFinisher}
  from "../../functions/src/prod1/import-finisher.js";

const actor={uid:"teacher_1",role:"teacher",
  emailVerified:true,accountStatus:"active"};
const auth={uid:"teacher_1",token:{email_verified:true}};
const request=()=>({apiVersion:2,action:"finishImportJob",
  requestId:"finish_123456789abcdefgh",jobId:"job_1",
  title:"New quiz",description:"",settings:{},
  order:["key_1","key_2"]});
function fixture({bankOnly=false}={}){
  const items=["key_1","key_2"];
  const docs={
    "jobs/job_1":{kind:"import",status:"running",
      requestedBy:"teacher_1",targetId:"quiz_import",
      input:{itemCount:2,bankOnly},importedKeys:items,
      progress:{processed:2}},
  };
  items.forEach((key,i)=>{
    const row={importItemKey:key,problemId:"prb_"+i,
      revisionId:"prv_"+i,itemId:"itm_"+i,
      points:i+1,hash:"a".repeat(64),version:1};
    docs["jobs/job_1/mappings/"+key]=row;
    if(!bankOnly)
      docs["quizzes/quiz_import/draftItems/"+row.itemId]={
        itemId:row.itemId,problemId:row.problemId,
        problemRevisionId:row.revisionId,points:row.points,
      };
  });
  let calls=0;
  const db={docs,doc(path){return {path,async get(){return{
    exists:Object.hasOwn(docs,path),data:()=>docs[path],
  };}};}};
  const port=createProd1ImportFinisher({
    enabled:true,db,resolveActor:async()=>actor,
    legacyDispatch:async()=>{calls++;return{data:{quizId:"quiz_import"}};},
  });
  return {db,docs,port,get calls(){return calls;}};
}
test("Prod1 import finisher remains OFF by default",async()=>{
  const x=createProd1ImportFinisher();
  assert.equal(x.enabled,false);
  assert.deepEqual(await x.finish(),{disabled:true});
});
test("valid Neon SQL receipts/Firestore slots authorize existing finish handler",async()=>{
  const f=fixture();
  assert.deepEqual(await f.port.finish(auth,request()),
    {quizId:"quiz_import"});
  assert.equal(f.calls,1);
});
test("missing, altered and mismatched receipts fail before any writer",async()=>{
  for(const broken of [
    f=>{delete f.docs["jobs/job_1/mappings/key_2"];},
    f=>{f.docs["jobs/job_1/mappings/key_2"].hash="bad";},
    f=>{f.docs["jobs/job_1/mappings/key_2"].version=9;},
    f=>{f.docs["quizzes/quiz_import/draftItems/itm_1"]=null;},
    f=>{f.docs["quizzes/quiz_import/draftItems/itm_1"].points=20;},
  ]){
    const f=fixture();
    broken(f);
    await assert.rejects(f.port.finish(auth,request()),
      /receipt|slot/i);
    assert.equal(f.calls,0);
  }
});
test("incomplete import, wrong order and wrong actor cannot finalize",async()=>{
  const f=fixture();
  f.docs["jobs/job_1"].progress.processed=1;
  await assert.rejects(f.port.finish(auth,request()),/Import receipts are incomplete/);
  assert.equal(f.calls,0);
  const x=fixture();
  await assert.rejects(x.port.finish(auth,{
    ...request(),order:["key_1","not_a_receipt"],
  }),/ordering differs/);
  assert.equal(x.calls,0);
  const y=fixture();
  y.docs["jobs/job_1"].requestedBy="other_teacher";
  await assert.rejects(y.port.finish(auth,request()),/Import job unavailable/);
  assert.equal(y.calls,0);
});
test("bank-only import verifies receipts but requires no draft slots",async()=>{
  const f=fixture({bankOnly:true});
  const req=request();delete req.order;
  assert.deepEqual(await f.port.finish(auth,req),
    {quizId:"quiz_import"});
  assert.equal(f.calls,1);
});
test("succeeded imported job preserves legacy receipt idempotency",async()=>{
  const f=fixture();
  f.docs["jobs/job_1"].status="succeeded";
  assert.deepEqual(await f.port.finish(auth,request()),
    {quizId:"quiz_import"});
  assert.equal(f.calls,1);
});

test("legacy Firestore imports without versioned Neon receipts remain finishable",async()=>{
  const f=fixture();
  for(let i=0;i<2;i++){
    const row=f.docs["jobs/job_1/mappings/key_"+(i+1)];
    delete row.version;
    f.docs["problems/"+row.problemId+"/revisions/"+row.revisionId]={
      statementLatex:"Historical legacy problem "+i,
    };
  }
  assert.deepEqual(await f.port.finish(auth,request()),{
    quizId:"quiz_import",
  });
  assert.equal(f.calls,1);
  delete f.docs["problems/prb_1/revisions/prv_1"];
  await assert.rejects(f.port.finish(auth,request()),
    /Historical Firestore import revision unavailable/);
  assert.equal(f.calls,1);
});
