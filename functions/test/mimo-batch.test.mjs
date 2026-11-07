import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createBatchService,publicBatchStage} from "../src/mimo/batch.js";
const uid="teacherA",uid2="teacherB",secret="server_only_project_key_at_least_32_chars";
const PDF=Buffer.from("%PDF-1.7\nA mathematical sheet\n%%EOF");
const ART="11111111-1111-4111-8111-111111111111";
const runId=n=>"aaaaaaa1-aaaa-4aaa-8aaa-"+String(n).padStart(12,"0");
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const auth=id=>({uid:id,token:{email_verified:true}});
const request=(id="request_batch_test_00001",overrides={})=>({
  requestId:id,fileName:"Algebra.pdf",contentType:"application/pdf",
  base64:PDF.toString("base64"),target:"quiz",pageStart:1,pageEnd:0,
  perPageUsd:0.15,totalUsd:1,...overrides,
});
function firestore(){
  const records=new Map([
    ["roles/"+uid,{role:"teacher",accountStatus:"active"}],
    ["roles/"+uid2,{role:"teacher",accountStatus:"active"}],
  ]);
  const snap=ref=>({
    exists:records.has(ref.path),data:()=>records.get(ref.path),
    id:ref.path.split("/").at(-1),
  });
  // Real Firestore serializes/retries overlapping transactions. Preserve
  // that atomic behavior in the concurrency test instead of allowing lost
  // array updates from an unrealistic in-memory mock.
  let transactionTail=Promise.resolve();
  const atomic=async fn=>{
    const previous=transactionTail;
    let release;
    transactionTail=new Promise(resolve=>{release=resolve;});
    await previous;
    try{return await fn({
      get:async ref=>snap(ref),
      set:(ref,data)=>records.set(ref.path,data),
      create:(ref,data)=>{if(records.has(ref.path))throw Error("duplicate create");records.set(ref.path,data);},
      update:(ref,data)=>records.set(ref.path,{...records.get(ref.path),...data}),
    });}finally{release();}
  };
  const doc=path=>({
    path,get:async()=>snap({path}),
    update:async data=>records.set(path,{...records.get(path),...data}),
    set:async (data,opts)=>records.set(path,opts?.merge?{...records.get(path),...data}:data),
  });
  return {
    records,doc,
    runTransaction:atomic,
    collection:name=>({
      where:(key,op,val)=>({
        limit:n=>({
          get:async()=>({docs:[...records.entries()]
            .filter(([k,v])=>k.startsWith(name+"/")&&k.split("/").length===2&&
              (op==="in"?Array.isArray(val)&&val.includes(v[key]):op==="=="&&v[key]===val))
            .slice(0,n).map(([k,v])=>({id:k.split("/").at(-1),data:()=>v}))}),
        }),
      }),
    }),
  };
}
const json=(obj,code=200)=>new Response(JSON.stringify(obj),{
  status:code,headers:{"content-type":"application/json"},
});
const extracted=n=>({
  schema:"mimo.extracted_page.v1",quality_status:"review_required",
  questions:[{printed_number:String(n),statement_latex:"2x=4",
    question_type:"short_answer",options:[],answer:null,
    has_figure:false,figure_description:null,diagram_requires_reconstruction:false,
    continuation:"complete",review_required:true,review_reasons:["Missing answer"],
    uncertain_spans:[]}],
});
function upstream(requests=[]){
  return async (url,options)=>{
    requests.push({url,options});
    if(url.endsWith("/v1/integrations/artifacts")&&options.method==="POST")
      return json({id:ART,checksum_sha256:digest(PDF)},201);
    if(url.endsWith("/ingest"))return json({page_count:3});
    if(url.endsWith("/runs")&&options.method==="POST"){
      const input=JSON.parse(options.body);
      const page=input.input.page_number||1;
      return json({id:runId(page),status:"queued"},201);
    }
    const matched=/\/v1\/runs\/([0-9a-f-]+)$/.exec(url);
    if(matched){
      const n=Number(matched[1].slice(-12));
      return json({id:runId(n),status:"completed",output:{
        exports:{extracted_page_json:JSON.stringify(extracted(n))},
        nodes:{compile_png:{status:"skipped"}},
      }});
    }
    throw Error("Unexpected Mimo route: "+url);
  };
}
const service=(db=firestore(),fetchImpl=upstream(),now=()=>Date.parse("2026-11-07T09:00:00Z"))=>
  createBatchService({db,projectKey:secret,fetchImpl,now});

test("one PDF upload creates durable whole-document parent and owner-scoped history",async()=>{
  const calls=[],db=firestore(),app=service(db,upstream(calls));
  const started=await app.start({auth:auth(uid),data:request()});
  assert.equal(started.pageCount,3);
  assert.equal(calls.length,2,"upload and ingest only, no AI calls in browser request");
  const list=await app.list({auth:auth(uid),data:{limit:10}});
  assert.equal(list.jobs.length,1);
  assert.equal(list.jobs[0].jobId,started.jobId);
  const same=await app.start({auth:auth(uid),data:request()});
  assert.equal(same.jobId,started.jobId);
  assert.equal(calls.length,2,"same id must not upload again");
  await assert.rejects(app.status({auth:auth(uid2),data:{jobId:started.jobId}}),
    {code:"JOB_NOT_FOUND"});
  await assert.rejects(app.start({auth:auth(uid),data:request(undefined,{
    target:"bank",
  })}),{code:"REQUEST_ID_CONFLICT"});
});

test("scheduled sweeps dispatch every page once and save individually validated checkpoints",async()=>{
  const db=firestore(),calls=[],app=service(db,upstream(calls));
  const started=await app.start({auth:auth(uid),data:request("request_batch_test_00002")});
  await app.sweep();
  assert.equal(calls.filter(x=>x.url.endsWith("/runs")&&
    x.options.method==="POST").length,3,
    "three pages are admitted within the same background tick");
  for(let i=0;i<7;i++)await app.sweep();
  const done=await app.status({auth:auth(uid),data:{jobId:started.jobId}});
  assert.equal(done.state,"ready_review");
  assert.equal(done.completed,3);
  assert.equal(done.reservedUsd,0.45);
  assert.equal(calls.filter(x=>x.url.endsWith("/runs")&&x.options.method==="POST").length,3);
  for(let i=1;i<=3;i++){
    const page=await app.getPage({auth:auth(uid),data:{jobId:started.jobId,pageNumber:i}});
    assert.equal(page.page.questions[0].printed_number,String(i));
    assert.equal(page.page.source.page_number,i);
    assert.equal(page.page.source.sha256,digest(PDF));
  }
  const noExtra=calls.length;
  await app.sweep();
  assert.equal(calls.length,noExtra);
});

test("hard total budget is enforced before a new run, with no hidden extra dispatch",async()=>{
  const db=firestore(),calls=[],app=service(db,upstream(calls));
  const job=await app.start({auth:auth(uid),data:request("request_batch_test_00003",{
    totalUsd:0.3,
  })});
  for(let i=0;i<8;i++)await app.sweep();
  const state=await app.status({auth:auth(uid),data:{jobId:job.jobId}});
  assert.equal(state.state,"budget_exhausted");
  assert.equal(state.completed,2);
  assert.equal(state.reservedUsd,0.3);
  assert.equal(calls.filter(x=>x.url.endsWith("/runs")&&x.options.method==="POST").length,2);
});

test("invalid budgets, impersonated users and unsupported fields are rejected before upload",async()=>{
  const db=firestore(),calls=[],app=service(db,upstream(calls));
  for(const extra of [
    {totalUsd:1000},{perPageUsd:0.7},{perPageUsd:0},{pageStart:0},
    {pageEnd:101},{target:"public"},{workflowId:"foreign"},
  ])await assert.rejects(app.start({auth:auth(uid),data:request("request_batch_bad_00001",extra)}),
    {code:"INVALID_FIELDS"});
  db.records.set("roles/"+uid,{role:"student"});
  await assert.rejects(app.start({auth:auth(uid),data:request("request_batch_bad_00002")}),
    {code:"ROLE_REQUIRED"});
  assert.equal(calls.length,0);
});

test("timeout after start leaves fenced attention state and does not retry paid job",async()=>{
  const db=firestore(),calls=[],fake=upstream(calls);
  const app=service(db,async(url,options)=>{
    if(url.endsWith("/runs")&&options.method==="POST")throw Error("Provider timed out");
    return fake(url,options);
  });
  const job=await app.start({auth:auth(uid),data:request("request_batch_test_00004")});
  await app.sweep();
  const state=await app.status({auth:auth(uid),data:{jobId:job.jobId}});
  assert.equal(state.state,"attention");
  assert.equal(state.pages[0].state,"attention");
  await app.sweep();
  assert.equal(calls.filter(x=>x.url.endsWith("/runs")&&x.options.method==="POST").length,0);
});

test("teacher review is durable, rejects conflicting saves and prepares only fully approved import",async()=>{
  const db=firestore(),app=service(db,upstream());
  const created=await app.start({auth:auth(uid),data:request("request_batch_review_00005")});
  for(let i=0;i<8;i++)await app.sweep();
  const one=await app.getPage({auth:auth(uid),
    data:{jobId:created.jobId,pageNumber:1}});
  assert.equal(one.review,null);
  assert.equal(one.reviewVersion,0);
  await assert.rejects(app.prepared({auth:auth(uid),data:{jobId:created.jobId}}),
    {code:"REVIEW_INCOMPLETE"});
  for(let page=1;page<=3;page++){
    const result=await app.getPage({auth:auth(uid),data:{jobId:created.jobId,pageNumber:page}});
    const decision={
      itemId:"page"+page+"_item1",action:"approve",
      edits:{statement_latex:"Solve 2x=4",options:[],answer:"2",
        figure_description:null},
      figure_assets:{},verified_against_source:true,
      manual_marking_confirmed:false,reason:null,
    };
    const saved=await app.reviewPage({auth:auth(uid),data:{
      jobId:created.jobId,pageNumber:page,
      sourceSha256:result.page.source.sha256,
      expectedVersion:0,decisions:[decision],
    }});
    assert.equal(saved.approvedCount,1);
    assert.equal(saved.reviewVersion,1);
    await assert.rejects(app.reviewPage({auth:auth(uid),data:{
      jobId:created.jobId,pageNumber:page,
      sourceSha256:result.page.source.sha256,
      expectedVersion:0,decisions:[decision],
    }}),{code:"REVIEW_VERSION_CONFLICT"});
  }
  const prepared=await app.prepared({auth:auth(uid),data:{jobId:created.jobId}});
  assert.equal(prepared.items.length,3);
  assert.equal(prepared.published,false);
  assert.equal((prepared.latex.match(/begin\{problem\}/g)||[]).length,3);
  await assert.rejects(app.prepared({auth:auth(uid2),data:{jobId:created.jobId}}),
    {code:"JOB_NOT_FOUND"});
});

test("review cannot bind a forged or other-user private image asset",async()=>{
  const db=firestore(),app=service(db,upstream());
  const job=await app.start({auth:auth(uid),data:request("request_batch_review_00006")});
  for(let i=0;i<8;i++)await app.sweep();
  const page=await app.getPage({auth:auth(uid),
    data:{jobId:job.jobId,pageNumber:1}});
  await assert.rejects(app.reviewPage({auth:auth(uid),data:{
    jobId:job.jobId,pageNumber:1,sourceSha256:page.page.source.sha256,
    expectedVersion:0,decisions:[{
      itemId:"page1_item1",action:"approve",
      edits:{statement_latex:"2x=4",options:[],answer:"2",figure_description:null},
      figure_assets:{"diagram.png":"ast_not_owned"},
      verified_against_source:true,manual_marking_confirmed:false,reason:null,
    }],
  }}),{code:"INVALID_FIGURE_ASSET"});
});

test("three concurrent claim slots never reserve beyond the per-document hard cap",async()=>{
  const db=firestore(),calls=[],app=service(db,upstream(calls));
  const created=await app.start({auth:auth(uid),data:request(
    "request_batch_test_parallel_reservation_007",{totalUsd:0.30},
  )});
  await app.sweep();
  const state=await app.status({auth:auth(uid),data:{jobId:created.jobId}});
  assert.equal(state.reservedUsd,0.3);
  assert.equal(calls.filter(x=>x.url.endsWith("/runs")&&x.options.method==="POST").length,2);
  assert.equal(state.state,"budget_exhausted");
});

test("public progress uses only allowlisted Mimo stage identifiers",()=>{
  const result=publicBatchStage({
    node_tasks:[
      {node_id:"processor",status:"completed",content:"secret input"},
      {node_id:"extract",status:"completed",prompt:"sensitive math"},
      {node_id:"verify",status:"completed"},
      {node_id:"tikz_source",status:"running"},
      {node_id:"private_token",status:"completed"},
    ],
  });
  assert.deepEqual(result,{id:"tikz_source",status:"running"});
  assert.deepEqual(publicBatchStage({node_tasks:[{node_id:"compiler",status:"complete"}]}),
    {id:"processor",status:"pending"});
  assert.deepEqual(publicBatchStage({checkpoints:[{node_id:"compile_png",status:"completed"}]}),
    {id:"compile_png",status:"completed"});
  assert.equal(JSON.stringify(result).includes("sensitive"),false);
});

test("P1 diagram-bearing PDF yields authenticated compiled PNG preview without replay",async()=>{
  const db=firestore(),requests=[];
  const base=upstream(requests);
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]);
  const transport=async(url,options)=>{
    if(url.endsWith("/artifacts/compile_png")){
      return new Response(png,{status:200,headers:{"content-type":"image/png"}});
    }
    const response=await base(url,options);
    if(/\/v1\/runs\/[a-f0-9-]+$/.test(url)){
      const data=await response.json();
      const n=Number(data.id.slice(-12));
      const question=extracted(n);
      question.questions[0].has_figure=true;
      question.questions[0].figure_description="Graph of y=x on coordinates";
      question.questions[0].diagram_requires_reconstruction=true;
      data.output.exports.extracted_page_json=JSON.stringify(question);
      data.output.nodes.compile_png.status="completed";
      return json(data);
    }
    return response;
  };
  const app=service(db,transport);
  const started=await app.start({auth:auth(uid),
    data:request("p1_figure_complete_test_00000001")});
  for(let i=0;i<9;i++)await app.sweep();
  const state=await app.status({auth:auth(uid),data:{jobId:started.jobId}});
  assert.equal(state.state,"ready_review");
  assert.equal(state.pages[0].hasReconstruction,true);
  const page=await app.getPage({auth:auth(uid),
    data:{jobId:started.jobId,pageNumber:1}});
  assert.equal(page.hasReconstruction,true);
  assert.equal(page.page.questions[0].has_figure,true);
  const compiled=await app.image({auth:auth(uid),
    data:{jobId:started.jobId,pageNumber:1}});
  assert.equal(compiled.contentType,"image/png");
  assert.deepEqual(Buffer.from(compiled.base64,"base64"),png);
  await assert.rejects(app.image({auth:auth(uid2),
    data:{jobId:started.jobId,pageNumber:1}}),{code:"JOB_NOT_FOUND"});
  const dispatched=requests.filter(x=>x.url.endsWith("/runs")&&x.options.method==="POST").length;
  await app.sweep();
  assert.equal(requests.filter(x=>x.url.endsWith("/runs")&&x.options.method==="POST").length,dispatched,
    "checkpointed successful pages must not call paid model twice");
});
