import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildMimoQuizerLatex,MIMO_QUIZER_LATEX_SCHEMA}
  from "../../shared/mimo-quizer-latex.js";
import {parseLatex} from "../../shared/latex-parser.js";

const source=n=>({
  document_id:"doc_01",source_artifact_id:"artifact_01",
  page_artifact_id:null,page_number:n,page_count:3,sha256:"a".repeat(64),
});
function question({number="1",type="multiple_choice",answer="B",figure=false,
  continuation="complete",statement="Solve $2x=4$. Match 10% of the whole."}={}){
  return {
    printed_number:String(number),statement_latex:statement,question_type:type,
    options:type==="multiple_choice"?[
      {label:"A",latex:"$x=1$"},{label:"B",latex:"$x=2$"},
      {label:"C",latex:"$x=3$"},
    ]:[],
    answer,has_figure:figure,
    figure_description:figure?"A line chart":null,
    diagram_requires_reconstruction:figure,
    continuation,review_required:false,review_reasons:[],uncertain_spans:[],
  };
}
function page(n,questions,{qa=false,reconstruction=false,quality="pass"}={}){
  return {
    pageNumber:n,hasReconstruction:reconstruction,
    verificationUnusable:qa,recoveredFromCheckpoint:qa,
    page:{schema:"mimo.extracted_page.v1",quality_status:quality,
      questions,source:source(n)},
  };
}
const build=(pages,options={})=>buildMimoQuizerLatex({
  pages,title:"Algebra practice",...options,
});

test("M2: extracted MC keys preserve correct choice and percent after real parser roundtrip",()=>{
  const output=build([page(1,[question()])]);
  assert.equal(output.schema,MIMO_QUIZER_LATEX_SCHEMA);
  assert.equal(output.summary.questions,1);
  assert.equal(output.summary.modelAnswers,1);
  assert.equal(output.summary.missingSolutions,1);
  assert.equal(output.importerCompatible,true);
  assert.equal(output.readyForAutomaticImport,false);
  assert.match(output.latex,/\\correctchoice \$x=2\$/);
  assert.match(output.latex,/10\\% of the whole/);
  const parsed=parseLatex(output.latex);
  assert.equal(parsed.quiz.questions[0].answer,"o2");
  assert.match(parsed.quiz.questions[0].prompt,/10\\%/);
  assert.equal(output.items[0].answerStatus,"model_unverified");
  assert.equal(output.items[0].solutionStatus,"not_provided");
});

test("M2: unknown MC answer is never manufactured, full draft retains all choices",()=>{
  const output=build([page(1,[question({answer:null})])]);
  assert.equal(output.summary.missingAnswers,1);
  assert.equal(output.summary.blocked,1);
  assert.equal(output.importerCompatible,false);
  assert.match(output.parserError,/correctchoice|answer/i);
  assert.equal(output.latex.includes("\\correctchoice"),false);
  assert.equal((output.latex.match(/\\choice /g)||[]).length,3);
  assert.match(output.latex,/MISSING ANSWER/);
});

test("M2: unknown short answer remains manual, not a fake zero or blank auto-key",()=>{
  const output=build([page(1,[question({type:"short_answer",answer:null})])]);
  assert.equal(output.importerCompatible,true);
  assert.match(output.latex,/\\begin\{problem\}\[points=1,mode=manual\]/);
  assert.equal(output.latex.includes("\\answer{"),false);
  assert.equal(parseLatex(output.latex).quiz.questions[0].answerMode,"manual");
  assert.equal(output.summary.missingAnswers,1);
});

test("M2: correctly keyed short answer round-trips verbatim, not independently verified",()=>{
  const output=build([page(1,[question({
    type:"short_answer",answer:"\\frac{1}{2}",statement:"Find half of one."})])]);
  assert.equal(output.importerCompatible,true);
  assert.deepEqual(parseLatex(output.latex).quiz.questions[0].answers,["\\frac{1}{2}"]);
  assert.equal(output.items[0].answerStatus,"model_unverified");
});

test("M2: page PNG can only be a page-scoped unresolved figure reference",()=>{
  const output=build([page(2,[question({figure:true})],{reconstruction:true})]);
  assert.equal(output.items[0].figureRef.pageNumber,2);
  assert.equal(output.items[0].figureRef.artifact,"compile_png");
  assert.equal(output.items[0].figureRef.status,"unbound_to_question");
  assert.equal(output.summary.figuresUnbound,1);
  assert.equal(output.summary.blocked,1);
  assert.doesNotMatch(output.latex,/\\includegraphics\{.*compile_png/);
  assert.match(output.latex,/FIGURE UNBOUND/);
  assert.match(output.latex,/FIGURE DESCRIPTION — A line chart/);
  assert.equal(output.readyForAutomaticImport,false);
});

test("M2: independent visual QA failure and continued pages remain visibly flagged",()=>{
  const output=build([page(1,[question({
    continuation:"continues_next_page",answer:"A",
  })],{qa:true,quality:"review_required"})]);
  assert.equal(output.items[0].importerBlocked,true);
  assert.equal(output.items[0].verificationStatus,"unusable");
  assert.match(output.items[0].issues.join(" "),/Independent visual QA/);
  assert.match(output.items[0].issues.join(" "),/continues across pages/);
});

test("M2: pages sorted, repeated numbers flagged, source identity fenced",()=>{
  const output=build([page(3,[question({number:"17"})]),page(1,[question({number:"17"})])]);
  assert.deepEqual(output.pageNumbers,[1,3]);
  assert.match(output.items[1].issues.join(" "),/repeats on page 1/);
  assert.equal(output.items[1].importerBlocked,true);
  assert.throws(()=>build([page(1,[question()]),page(1,[question({number:"2"})])]),/Duplicate/);
  const mixed=page(2,[question({number:"2"})]);
  mixed.page.source.sha256="b".repeat(64);
  assert.throws(()=>build([page(1,[question()]),mixed]),/different source documents/);
});

test("M2: rejects hostile TeX, malformed model schema and title TeX injection",()=>{
  assert.throws(()=>build([page(1,[question({statement:"x \\answer{B}"})])]),/prohibited/);
  assert.throws(()=>build([page(1,[question()])],{title:"Quiz} \\input{evil}"}),/title/);
  assert.throws(()=>build([page(1,[question({answer:"Z"})])]),/existing option label/);
  assert.throws(()=>build([page(1,[])]),/No extracted questions/);
});


test("M2: Quizer parser cleanup cannot silently remove model statement content",()=>{
  const output=build([page(1,[question({
    statement:"Refer to equation \\label{eq:test} and solve $2x=4$.",
  })])]);
  assert.equal(output.importerCompatible,false);
  assert.match(output.parserError,/changed problem text/);
  assert.equal(output.readyForAutomaticImport,false);
});

test("M2: embedded unbound figure commands are flagged even when model figure flag is false",()=>{
  const output=build([page(1,[question({
    statement:"Read the graph: \\includegraphics{unlinked.png}.",
  })])]);
  assert.equal(output.importerCompatible,true);
  assert.equal(output.summary.figuresUnbound,1);
  assert.equal(output.summary.blocked,1);
  assert.equal(output.items[0].figureRef.status,"unbound_to_question");
  assert.match(output.items[0].issues.join(" "),/Figure command exists despite missing figure flag/);
});

test("M2: escaped versus unescaped percent signs are preserved by existing importer",()=>{
  const original="Use \\\\% and 10% in the statement";
  const output=build([page(1,[question({statement:original})])]);
  assert.equal(output.importerCompatible,true);
  assert.match(output.latex,/10\\%/);
  assert.match(parseLatex(output.latex).quiz.questions[0].prompt,/10\\%/);
});

test("M2: UI assembles GET-only existing completed pages on demand, no provider runs",()=>{
  const app=readFileSync(new URL("../../js/pages/ai-studio.js",import.meta.url),"utf8");
  assert.match(app,/async function previewMimoQuizerDraft\(job,trigger\)/);
  assert.match(app,/job\.pages\.filter\(page=>page\.state==="completed"\)/);
  assert.match(app,/Partial document:/);
  assert.match(app,/readMimoBatchPage\(id,page\.number\)/);
  assert.match(app,/buildMimoQuizerLatex\(\{pages:rows,title\}\)/);
  assert.match(app,/Preview completed pages as Quizer LaTeX \(no AI run\)/);
  const scoped=app.slice(app.indexOf("async function previewMimoQuizerDraft"),
    app.indexOf("async function selectBatch"));
  assert.doesNotMatch(scoped,/submitMimoBatch\(|submitMimoExtraction\(|importApprovedExtraction\(|uploadAsset\(/);
});
