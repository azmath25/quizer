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
      where:(key,op,val)=>{
        const query=(orderField=null,direction="asc")=>({
          orderBy:(field,dir="asc")=>query(field,dir),
          limit:n=>({
            get:async()=>({docs:[...records.entries()]
              .filter(([k,v])=>k.startsWith(name+"/")&&k.split("/").length===2&&
                (op==="in"?Array.isArray(val)&&val.includes(v[key]):op==="=="&&v[key]===val))
              .sort((a,b)=>orderField
                ?(direction==="desc"?-1:1)*String(a[1][orderField]||"").localeCompare(
                  String(b[1][orderField]||"")):0)
              .slice(0,n).map(([k,v])=>({id:k.split("/").at(-1),data:()=>v}))}),
          }),
        });
        return query();
      },
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
    x.options.method==="POST").length,1,
    "only one PDF page is admitted initially to avoid vision API bursts");
  for(let i=0;i<12;i++)await app.sweep();
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

test("serialized PDF page claims never reserve beyond the per-document hard cap",async()=>{
  const db=firestore(),calls=[],app=service(db,upstream(calls));
  const created=await app.start({auth:auth(uid),data:request(
    "request_batch_test_parallel_reservation_007",{totalUsd:0.30},
  )});
  await app.sweep();
  const first=await app.status({auth:auth(uid),data:{jobId:created.jobId}});
  assert.equal(first.reservedUsd,0.15);
  assert.equal(calls.filter(x=>x.url.endsWith("/runs")&&x.options.method==="POST").length,1);
  for(let i=0;i<8;i++)await app.sweep();
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

test("owner checks known attention run IDs without creating new paid runs",async()=>{
  const db=firestore(),calls=[],fallback=upstream(calls);
  let remoteStatus="failed";
  const fetchImpl=async(url,options)=>{
    if(url.endsWith("/v1/runs/"+runId(1))){
      calls.push({url,options});
      if(remoteStatus==="failed")return json({id:runId(1),status:"failed",
        output:{error_code:"provider_rate_limited",upstream_http_status:429}});
    }
    return fallback(url,options);
  };
  const app=service(db,fetchImpl);
  const started=await app.start({auth:auth(uid),
    data:request("request_reconcile_20261107_001")});
  await app.sweep();
  await app.sweep();
  const failed=await app.status({auth:auth(uid),data:{jobId:started.jobId}});
  assert.equal(failed.state,"attention");
  assert.equal(failed.pages[0].error,"MIMO_RUN_FAILED");
  assert.equal(failed.pages[0].diagnosticCode,"provider_rate_limited");
  assert.equal(failed.pages[1].state,"queued");
  const postCount=()=>calls.filter(c=>c.options?.method==="POST"&&c.url.endsWith("/runs")).length;
  assert.equal(postCount(),1);
  await assert.rejects(app.reconcile({auth:auth(uid2),data:{jobId:started.jobId}}),
    {code:"JOB_NOT_FOUND"});
  const checked=await app.reconcile({auth:auth(uid),data:{jobId:started.jobId}});
  assert.equal(checked.checkedExistingRuns,1);
  assert.equal(checked.neverStartedNewRuns,true);
  assert.equal(checked.state,"attention");
  assert.equal(postCount(),1,"a definitively failed run must not be auto-resubmitted");
  // A definitively failed Mimo run remains failed on reconciliation.
  const stillFailed=await app.status({auth:auth(uid),data:{jobId:started.jobId}});
  assert.equal(stillFailed.pages[0].error,"MIMO_RUN_FAILED");
  assert.equal(postCount(),1);
});

test("late completion is recovered only for a previously uncertain status check",async()=>{
  const db=firestore(),calls=[],fallback=upstream(calls);
  let ambiguous=true;
  const fn=async(url,options)=>{
    if(url.endsWith("/v1/runs/"+runId(1))&&ambiguous)
      throw new Error("ambiguous GET response");
    return fallback(url,options);
  };
  const app=service(db,fn);
  const job=await app.start({auth:auth(uid),
    data:request("request_late_completed_001")});
  await app.sweep();await app.sweep();
  const uncertain=await app.status({auth:auth(uid),data:{jobId:job.jobId}});
  assert.equal(uncertain.pages[0].error,"MIMO_OUTCOME_UNKNOWN");
  assert.equal(uncertain.pages[0].state,"attention");
  ambiguous=false;
  const restored=await app.reconcile({auth:auth(uid),data:{jobId:job.jobId}});
  assert.equal(restored.pages[0].state,"completed");
  assert.equal(restored.pages[1].state,"queued");
  const postCount=calls.filter(x=>x.options?.method==="POST"&&x.url.endsWith("/runs")).length;
  assert.equal(postCount,1);
  assert.equal((await app.getPage({auth:auth(uid),
    data:{jobId:job.jobId,pageNumber:1}})).page.questions.length,1);
});

test("unknown dispatch without a run ID is not replayed by reconciliation",async()=>{
  const db=firestore(),calls=[],fallback=upstream(calls);
  const app=service(db,async(url,options)=>{
    if(url.endsWith("/runs")&&options?.method==="POST")throw Error("timeout");
    return fallback(url,options);
  });
  const job=await app.start({auth:auth(uid),
    data:request("request_unknown_reconcile_001")});
  await app.sweep();
  const old=await app.status({auth:auth(uid),data:{jobId:job.jobId}});
  assert.equal(old.pages[0].runId,null);
  assert.equal(old.pages[0].state,"attention");
  const before=calls.length;
  const checked=await app.reconcile({auth:auth(uid),data:{jobId:job.jobId}});
  assert.equal(checked.checkedExistingRuns,0);
  assert.equal(checked.state,"attention");
  assert.equal(calls.length,before);
});

test("reconciliation reattaches an existing still-running job without dispatching again",async()=>{
  const db=firestore(),calls=[],fallback=upstream(calls);
  let ambiguous=true;
  const fn=async(url,options)=>{
    if(url.endsWith("/v1/runs/"+runId(1))){
      calls.push({url,options});
      if(ambiguous)throw new Error("ambiguous GET response");
      return json({id:runId(1),status:"running"});
    }
    return fallback(url,options);
  };
  const app=service(db,fn);
  const job=await app.start({auth:auth(uid),
    data:request("request_reattach_running_001")});
  await app.sweep();await app.sweep();
  const paused=await app.status({auth:auth(uid),data:{jobId:job.jobId}});
  assert.equal(paused.pages[0].state,"attention");
  ambiguous=false;
  const checked=await app.reconcile({auth:auth(uid),data:{jobId:job.jobId}});
  assert.equal(checked.pages[0].state,"submitted");
  assert.equal(checked.state,"running");
  assert.equal(calls.filter(x=>x.options?.method==="POST"&&x.url.endsWith("/runs")).length,1);
});


test("attention backlog cannot starve a newly runnable document",async()=>{
  const db=firestore(),calls=[],app=service(db,upstream(calls));
  for(let i=0;i<7;i++){
    const id=digest(Buffer.from("old-attention-"+i));
    db.records.set("mimoBatchJobs/"+id,{
      jobId:id,state:"attention",updatedAt:"2026-11-07T01:00:00Z",
      pages:[{number:1,state:"attention"}],needsAttentionPolling:false,
    });
  }
  const job=await app.start({auth:auth(uid),data:request("fairness_new_job_20261108")});
  const swept=await app.sweep();
  const state=await app.status({auth:auth(uid),data:{jobId:job.jobId}});
  assert.equal(swept.visited,1);
  assert.equal(state.pages[0].state,"submitted");
  assert.equal(calls.filter(c=>c.options?.method==="POST"&&c.url.endsWith("/runs")).length,1);
});


test("fair updatedAt rotation visits later runnable jobs without duplicate paid dispatch",async()=>{
  let clock=Date.parse("2026-11-07T09:00:00Z");
  const db=firestore(),calls=[],app=service(db,upstream(calls),()=>clock);
  for(let i=0;i<8;i++){
    const id=digest(Buffer.from("round-robin-"+i));
    db.records.set("mimoBatchJobs/"+id,{
      jobId:id,uid,artifactId:ART,documentPages:1,
      contentType:"application/pdf",digest:digest(PDF),target:"quiz",
      state:"running",perPageUsd:0.15,totalUsd:0.15,reservedUsd:0,
      updatedAt:new Date(clock-8000+i*1000).toISOString(),
      pages:[{number:1,state:"queued",runId:null}],
      needsAttentionPolling:false,
    });
  }
  clock+=20000;
  assert.equal((await app.sweep(4)).visited,4);
  clock+=60000;
  assert.equal((await app.sweep(4)).visited,4);
  const dispatched=[...db.records.entries()]
    .filter(([name])=>name.startsWith("mimoBatchJobs/"))
    .filter(([,job])=>job.pages[0].state==="submitted").length;
  assert.equal(dispatched,8);
  assert.equal(calls.filter(c=>c.options?.method==="POST"&&c.url.endsWith("/runs")).length,8);
});


test("rate-limited known run shows scheduled retry and never resubmits",async()=>{
  const db=firestore(),calls=[],base=upstream(calls),app=service(db,async(url,options)=>{
    if(url.endsWith("/v1/runs/"+runId(1)))return json({
      id:runId(1),status:"queued",next_attempt_at:"2026-11-07T10:00:00Z",
      rate_limit_deferrals:2,
    });
    return base(url,options);
  });
  const job=await app.start({auth:auth(uid),data:request("quota_wait_20261108_test")});
  await app.sweep();
  await app.sweep();
  const state=await app.status({auth:auth(uid),data:{jobId:job.jobId}});
  assert.equal(state.pages[0].state,"submitted");
  assert.equal(state.pages[0].retryAt,"2026-11-07T10:00:00Z");
  assert.equal(state.pages[0].retryCount,2);
  assert.equal(calls.filter(c=>c.url.endsWith("/runs")&&c.options?.method==="POST").length,1);
  assert.equal(calls.filter(c=>c.url.includes("/timeline")).length,0);
});


test("historical Mimo RPM review is classified safely without exposing raw errors",async()=>{
  const db=firestore(),base=upstream(),app=service(db,async(url,options)=>{
    if(url.endsWith("/v1/runs/"+runId(1)))return json({
      id:runId(1),status:"waiting_for_review",
      output:{status:"waiting_for_review",reason:"RPM deferral requires operator review"},
    });
    return base(url,options);
  });
  const job=await app.start({auth:auth(uid),data:request("legacy_quota_20261108_test")});
  await app.sweep();await app.sweep();
  const state=await app.status({auth:auth(uid),data:{jobId:job.jobId}});
  assert.equal(state.state,"attention");
  assert.equal(state.pages[0].diagnosticCode,"provider_rate_limited");
  assert.equal(state.pages[1].state,"queued");
});

test("completed Mimo run with empty QA export is rescued for manual review without another paid run",async()=>{
  const db=firestore(),calls=[],base=upstream(calls);
  let statusUncertain=true;
  const fetchImpl=async(url,options)=>{
    if(url.endsWith("/v1/runs/"+runId(1))){
      calls.push({url,options});
      if(statusUncertain)throw Error("GET timed out after completed remote execution");
      return json({
        id:runId(1),status:"completed",
        output:{
          exports:{extracted_page_json:""},
          nodes:{
            extract:{status:"completed",result:{
              kind:"text",content:JSON.stringify(extracted(1)),
            }},
            verify:{status:"completed",result:{kind:"text",content:""}},
            compile_png:{status:"skipped"},
          },
        },
      });
    }
    return base(url,options);
  };
  const app=service(db,fetchImpl);
  const started=await app.start({auth:auth(uid),
    data:request("recover_empty_verify_batch_20261108")});
  await app.sweep(); // submit one paid run
  await app.sweep(); // GET loses response, now needs action
  let status=await app.status({auth:auth(uid),data:{jobId:started.jobId}});
  assert.equal(status.pages[0].state,"attention");
  statusUncertain=false;
  const postsBefore=calls.filter(x=>x.url.endsWith("/runs")&&x.options.method==="POST").length;
  const result=await app.reconcile({auth:auth(uid),data:{jobId:started.jobId}});
  assert.equal(result.pages[0].state,"completed");
  assert.equal(result.pages[0].recoveredFromCheckpoint,true);
  assert.equal(result.pages[0].questionCount,1);
  const recovered=await app.getPage({auth:auth(uid),data:{
    jobId:started.jobId,pageNumber:1,
  }});
  assert.equal(recovered.page.quality_status,"review_required");
  assert.equal(recovered.page.questions[0].review_required,true);
  assert.match(recovered.page.questions[0].review_reasons.at(-1),
    /Independent AI verification returned no visible output/);
  assert.equal(result.neverStartedNewRuns,true);
  assert.equal(calls.filter(x=>x.url.endsWith("/runs")&&x.options.method==="POST").length,
    postsBefore,"reconciliation MUST NOT submit another paid run");
});

test("completed Mimo run with invalid final QA is NOT silently replaced by earlier extraction",async()=>{
  const db=firestore(),calls=[],base=upstream(calls);
  const app=service(db,async(url,options)=>{
    if(url.endsWith("/v1/runs/"+runId(1)))return json({
      id:runId(1),status:"completed",output:{
        exports:{extracted_page_json:"this is not JSON"},
        nodes:{
          extract:{status:"completed",result:{
            kind:"text",content:JSON.stringify(extracted(1)),
          }},
          verify:{status:"completed",result:{kind:"text",content:""}},
        },
      },
    });
    return base(url,options);
  });
  const started=await app.start({auth:auth(uid),
    data:request("reject_invalid_verified_final_20261108")});
  await app.sweep();
  await app.sweep();
  const status=await app.status({auth:auth(uid),data:{jobId:started.jobId}});
  assert.equal(status.pages[0].state,"attention");
  assert.equal(status.pages[0].error,"MIMO_INVALID_EXTRACTION");
  assert.equal(calls.filter(x=>x.url.endsWith("/runs")&&x.options.method==="POST").length,
    1);
});
