import test from "node:test";
import assert from "node:assert/strict";
import {createExtractionService,EXTRACTION_WORKFLOW} from "../src/mimo/extraction.js";
const UID="teacher_1", UID2="teacher_2", RUN="a1b2c3d4-1111-2222-3333-aabbccddeeff";
const ART="5a1b2c3d-1234-5678-9876-aabbccddeeff";
const secret="server_only_key_12345678901234567890";
const pdf=Buffer.from("%PDF-1.7\n\ntest");
const auth=(uid=UID)=>({uid,token:{email_verified:true}});
const payload=(requestId="extraction_request_00001",bytes=pdf,pageNumber=1)=>({
  requestId,fileName:"worksheet.pdf",contentType:"application/pdf",
  base64:Buffer.from(bytes).toString("base64"),pageNumber,
});
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"content-type":"application/json"},
});
const result={
  schema:"mimo.extracted_page.v1",quality_status:"review_required",
  questions:[{
    printed_number:"1",statement_latex:"2x+3=7",question_type:"short_answer",
    options:[],answer:null,has_figure:false,figure_description:null,
    diagram_requires_reconstruction:false,continuation:"complete",
    review_required:true,review_reasons:["Answer not printed"],uncertain_spans:[],
  }],
};
function firestore(){
  const docs=new Map([
    ["roles/"+UID,{role:"teacher",accountStatus:"active"}],
    ["roles/"+UID2,{role:"teacher",accountStatus:"active"}],
  ]);
  const snapshot=path=>({exists:docs.has(path),data:()=>docs.get(path)});
  const db={
    docs,
    doc(path){return {
      path,get:async()=>snapshot(path),
      update:async value=>docs.set(path,{...docs.get(path),...value}),
    }},
    runTransaction:async fn=>fn({
      get:async ref=>snapshot(ref.path),
      set:(ref,value)=>docs.set(ref.path,value),
      create:(ref,value)=>{if(docs.has(ref.path))throw Error("duplicate");docs.set(ref.path,value);},
    }),
  };
  return db;
}
const upstream=(requests=[])=>async(url,opts)=>{
  requests.push({url,opts});
  if(url.endsWith("/integrations/artifacts")&&opts.method==="POST")
    return json({id:ART,checksum_sha256:await checksum(pdf)},201);
  if(url.endsWith("/ingest"))return json({page_count:3,pages:[{number:1}]});
  if(url.endsWith("/runs")&&opts.method==="POST")return json({id:RUN,status:"queued"},201);
  if(url.endsWith("/v1/runs/"+RUN))return json({id:RUN,status:"completed",output:{
    exports:{extracted_page_json:JSON.stringify(result),
      diagram_decision_json:'{"needs_tikz":0}'},
    nodes:{compile_png:{status:"skipped"}},
  }});
  throw Error("unexpected "+url);
};
async function checksum(bytes){
  const {createHash}=await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}
const service=(db=firestore(),fetchImpl=upstream())=>
  createExtractionService({db,projectKey:secret,fetchImpl,
    now:()=>Date.parse("2026-11-07T09:00:00Z")});

test("teacher uploads one bounded PDF then starts pinned vision-page workflow",async()=>{
  const calls=[],db=firestore(),bridge=service(db,upstream(calls));
  const started=await bridge.start({auth:auth(),data:payload()});
  assert.equal(started.state,"submitted");
  assert.match(started.jobId,/^[a-f0-9]{64}$/);
  assert.equal(calls.length,3);
  assert.ok(calls[0].opts.body instanceof FormData);
  assert.equal(calls[0].opts.headers.Authorization,"Bearer "+secret);
  assert.equal(calls[1].url,EXTRACTION_WORKFLOW.origin+"/v1/integrations/artifacts/"+ART+"/ingest");
  const sent=JSON.parse(calls[2].opts.body);
  assert.deepEqual({id:sent.input.artifact_id,kind:sent.input.kind,mode:sent.input.mode,page:sent.input.page_number},
    {id:ART,kind:"mimo_pdf_artifact",mode:"vision_page",page:1});
  assert.deepEqual([sent.version,sent.background,sent.cost_mode,sent.cost_limit_usd],
    [1,true,"hard",0.03]);
  assert.match(calls[2].opts.headers["Idempotency-Key"],/^quizer-extract-[a-f0-9]{64}$/);
  const done=await bridge.status({auth:auth(),data:{jobId:started.jobId}});
  assert.equal(done.state,"completed");
  assert.equal(done.page.questions[0].printed_number,"1");
  assert.equal(done.page.source.page_count,3);
  assert.equal(done.hasReconstruction,false);
});
test("idempotent job ID does not upload twice or double-charge quota",async()=>{
  const hits=[],db=firestore(),bridge=service(db,upstream(hits));
  const first=await bridge.start({auth:auth(),data:payload()});
  const same=await bridge.start({auth:auth(),data:payload()});
  assert.equal(same.jobId,first.jobId);
  assert.equal(hits.length,3);
  assert.equal(db.docs.get("mimoExtractionLimits/"+UID).count,1);
  await assert.rejects(bridge.start({auth:auth(),data:payload(undefined,Buffer.from("%PDF-1.7\nDIFF"))}),
    {code:"REQUEST_ID_CONFLICT"});
});
test("role, spoofed files and forged workflow identifiers fail before provider calls",async()=>{
  const db=firestore(),calls=[],bridge=service(db,upstream(calls));
  db.docs.set("roles/"+UID,{role:"student",accountStatus:"active"});
  await assert.rejects(bridge.start({auth:auth(),data:payload()}),{code:"ROLE_REQUIRED"});
  db.docs.set("roles/"+UID,{role:"teacher",accountStatus:"active"});
  const bad=[
    {...payload(),workflowId:"another"},
    {...payload(),projectKey:"attacker"},
    {...payload(),base64:Buffer.from("not-pdf").toString("base64")},
    {...payload(),contentType:"image/png"},
    {...payload(),pageNumber:101},
  ];
  for(const data of bad)
    await assert.rejects(bridge.start({auth:auth(),data}),{code:"INVALID_FIELDS"});
  assert.equal(calls.length,0);
});
test("job ownership is enforced even if a run ID is known",async()=>{
  const db=firestore(),bridge=service(db,upstream());
  const started=await bridge.start({auth:auth(),data:payload()});
  await assert.rejects(bridge.status({auth:auth(UID2),data:{jobId:started.jobId}}),
    {code:"JOB_NOT_FOUND"});
});
test("atomic quota rejects third unique extraction in rolling minute",async()=>{
  const db=firestore(),calls=[],bridge=service(db,upstream(calls));
  for(let i=0;i<2;i++)
    await bridge.start({auth:auth(),data:payload("extraction_request_"+String(i).padStart(8,"0"))});
  await assert.rejects(bridge.start({
    auth:auth(),data:payload("extraction_request_00000003")}),{code:"RATE_LIMITED"});
  assert.equal(calls.length,6);
});
test("uncertain upload failure is not retried or falsely returned as completed",async()=>{
  const db=firestore(),bridge=service(db,async()=>{throw Error("api key secret");});
  const first=await assert.rejects(bridge.start({auth:auth(),data:payload()}),
    {code:"MIMO_OUTCOME_UNKNOWN"});
  assert.equal(first,undefined);
  const row=[...db.docs.entries()].find(([key])=>key.startsWith("mimoExtractionJobs/"));
  assert.equal(row[1].state,"attention");
  const again=await bridge.start({auth:auth(),data:payload()});
  assert.equal(again.state,"attention");
  assert.equal(db.docs.get("mimoExtractionLimits/"+UID).count,1);
});

test("stale accepted job surfaces outcome unknown without replaying a paid upload",async()=>{
  const db=firestore(),jobId="a".repeat(64),calls=[];
  db.docs.set("mimoExtractionJobs/"+jobId,{
    uid:UID,state:"accepted",runId:null,error:null,
    createdAt:"2020-01-01T00:00:00.000Z",
  });
  const bridge=service(db,upstream(calls));
  const value=await bridge.status({auth:auth(),data:{jobId}});
  assert.equal(value.state,"attention");
  assert.equal(value.error,"MIMO_OUTCOME_UNKNOWN");
  assert.equal(calls.length,0);
});
