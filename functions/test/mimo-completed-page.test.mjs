import test from "node:test";
import assert from "node:assert/strict";
import {completedPageForReview,EMPTY_VERIFY_REVIEW_REASON}
  from "../src/mimo/completed-page.js";

const source=Object.freeze({
  document_id:"document_test_123",source_artifact_id:"artifact_test_456",
  page_artifact_id:null,page_number:2,page_count:8,sha256:"a".repeat(64),
});
const question=()=>({
  printed_number:"6",
  statement_latex:"Solve $x^2+9x=36$.",
  question_type:"multiple_choice",
  options:[{label:"A",latex:"3"},{label:"B",latex:"6"}],
  answer:null,has_figure:false,figure_description:null,
  diagram_requires_reconstruction:false,continuation:"complete",
  review_required:false,review_reasons:[],uncertain_spans:[],
});
const extracted=(quality_status="pass")=>({
  schema:"mimo.extracted_page.v1",quality_status,questions:[question()],
});
const completed=(final,first=extracted())=>({
  status:"completed",
  output:{
    exports:{extracted_page_json:final},
    nodes:{
      verify:{status:"completed",result:{kind:"text",content:""}},
      extract:{status:"completed",result:{kind:"text",content:JSON.stringify(first)}},
    },
  },
});

test("accepts a verified nonempty final page without weakening its quality markers",()=>{
  const result=completedPageForReview(completed(JSON.stringify(extracted())),source);
  assert.equal(result.recoveredFromCheckpoint,false);
  assert.equal(result.page.quality_status,"pass");
  assert.equal(result.page.questions[0].review_required,false);
  assert.equal(result.page.source.page_number,2);
});

test("recovers a completed but empty verification only as unverified teacher-review material",()=>{
  const run=completed("",extracted());
  const before=JSON.stringify(run);
  const result=completedPageForReview(run,source);
  assert.equal(result.recoveredFromCheckpoint,true);
  assert.equal(result.page.quality_status,"review_required");
  assert.equal(result.page.questions.length,1);
  assert.equal(result.page.questions[0].review_required,true);
  assert.deepEqual(result.page.questions[0].review_reasons,[EMPTY_VERIFY_REVIEW_REASON]);
  assert.equal(result.page.questions[0].answer,null);
  assert.equal(JSON.stringify(run),before,"Mimo run output remains an immutable audit record");
});

test("existing question uncertainty reasons are retained and no answers are invented",()=>{
  const first=extracted("review_required");
  first.questions[0].review_reasons.push("Superscript requires checking");
  const result=completedPageForReview(completed("  ",first),source);
  assert.deepEqual(result.page.questions[0].review_reasons,[
    "Superscript requires checking",EMPTY_VERIFY_REVIEW_REASON,
  ]);
});

test("does not salvage a failed, pending, or unverified run",()=>{
  for(const state of ["failed","queued","waiting_for_review","running"]){
    const run=completed("",extracted());run.status=state;
    assert.throws(()=>completedPageForReview(run,source));
  }
  const run=completed("",extracted());run.output.nodes.verify.status="failed";
  assert.throws(()=>completedPageForReview(run,source));
});

test("never discards a nonempty but invalid final independent QA result",()=>{
  const run=completed("{invalid json",extracted());
  assert.throws(()=>completedPageForReview(run,source));
  run.output.exports.extracted_page_json="{}";
  assert.throws(()=>completedPageForReview(run,source));
});

test("rejects unsupported or empty first-pass checkpoints",()=>{
  for(const first of [extracted("fail"),{...extracted(),questions:[]},
    {...extracted(),schema:"unexpected"},
  ]){
    assert.throws(()=>completedPageForReview(completed("",first),source));
  }
  const run=completed("",extracted());
  run.output.nodes.extract.result.content="not json";
  assert.throws(()=>completedPageForReview(run,source));
});

test("requires the original verification and extract checkpoint to be complete",()=>{
  const run=completed("",extracted());
  run.output.nodes.verify.result.content="an actual conflicting result";
  assert.throws(()=>completedPageForReview(run,source));
  run.output.nodes.verify.result.content="";
  run.output.nodes.extract.status="running";
  assert.throws(()=>completedPageForReview(run,source));
  run.output.nodes.extract.status="completed";
  delete run.output.nodes.extract.result;
  assert.throws(()=>completedPageForReview(run,source));
});

test("rejects oversize exports and rejects untrusted source attribution",()=>{
  const run=completed("",extracted());
  run.output.nodes.extract.result.content="a".repeat(250001);
  assert.throws(()=>completedPageForReview(run,source));
  assert.throws(()=>completedPageForReview(
    completed(JSON.stringify(extracted())),{...source,sha256:"not trusted"}));
});
