import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTRACTED_PAGE_SCHEMA, REVIEW_SCHEMA, IMPORT_SCHEMA,
  validateExtractedPage, createExtractionReview,
  decideExtractionQuestion, prepareReviewedExtractionImport,
} from "../../shared/mimo-extraction.js";
import { parseLatex } from "../../shared/latex-parser.js";
import { validateProblem } from "../../shared/schema.js";

const source = () => ({
  document_id: "doc_7", source_artifact_id: "owned_pdf_7",
  page_artifact_id: "rendered_page_7", page_number: 2, page_count: 8,
  sha256: "a".repeat(64),
});
const choice = () => ({
  printed_number: "1", statement_latex: "Solve $2x+3=7$.",
  question_type: "multiple_choice",
  options: [
    {label: "A", latex: "$1$"},
    {label: "B", latex: "$2$"},
    {label: "C", latex: "$3$"},
    {label: "D", latex: "$4$"},
  ],
  answer: null, has_figure: false, figure_description: null,
  diagram_requires_reconstruction: false, continuation: "complete",
  review_required: false, review_reasons: [], uncertain_spans: [],
});
const open = () => ({
  ...choice(), printed_number: "2", statement_latex: "Calculate $3+4$.",
  question_type: "short_answer", options: [], answer: "7",
});
const page = (...questions) => ({
  schema: EXTRACTED_PAGE_SCHEMA, quality_status: "pass", questions,
});
const action = (patch = {}) => ({
  action: "approve", edits: {}, figure_assets: {},
  verified_against_source: true, manual_marking_confirmed: false,
  reason: null, ...patch,
});

test("v1 extracted page validates the original output shape without trusting claimed pass", () => {
  const raw = page(choice(), open());
  const parsed = validateExtractedPage(raw, source());
  assert.equal(parsed.schema, EXTRACTED_PAGE_SCHEMA);
  assert.equal(parsed.questions[0].answer, null);
  assert.deepEqual(parsed.source, source());
  const review = createExtractionReview(raw, source());
  assert.equal(review.schema, REVIEW_SCHEMA);
  assert.deepEqual(review.items.map(q => q.decision), ["pending", "pending"]);
  assert.notEqual(review.items[0].original, raw.questions[0]);
});

test("strict root/source model fields, types, identity and owner provenance", () => {
  assert.throws(() => validateExtractedPage({...page(open()), owner_id: "hijack"}, source()), /missing or unexpected/);
  assert.throws(() => validateExtractedPage({...page(open()), schema: "mimo.extracted_page.v2"}, source()), /Unsupported extraction/);
  assert.throws(() => validateExtractedPage({...page(open()), quality_status: "free"}, source()), /quality status/);
  assert.throws(() => validateExtractedPage(page(open()), {...source(), page_number: 9}), /page is out of range/);
  assert.throws(() => validateExtractedPage(page(open()), {...source(), sha256: "wrong"}), /identifiers or checksum/);
  assert.throws(() => validateExtractedPage(page(open()), {...source(), owner_id: "hijack"}), /missing or unexpected/);
  assert.throws(() => validateExtractedPage(page(open(), {...open(), printed_number: "2"}), source()), /Duplicate printed/);
});

test("strict question and option fields reject over-limit, contradiction and TeX injection", () => {
  const bad = q => validateExtractedPage(page(q), source());
  assert.throws(() => bad({...choice(), unknown: 1}), /missing or unexpected/);
  assert.throws(() => bad({...choice(), question_type: "multiple_choices"}), /question type/);
  assert.throws(() => bad({...choice(), options: [choice().options[0]]}), /2–12/);
  assert.throws(() => bad({...choice(), options: [
    {label: "A", latex: "1"}, {label: "A", latex: "2"}
  ]}), /distinct/);
  assert.throws(() => bad({...choice(), answer: "X"}), /existing option/);
  assert.throws(() => bad({...choice(), statement_latex: "\\end{problem}"}), /prohibited/);
  assert.throws(() => bad({...choice(), statement_latex: "\\input{private}"}), /prohibited/);
  assert.throws(() => bad({...choice(), has_figure: false, figure_description: "triangle"}), /inconsistent/);
  assert.throws(() => bad({...choice(), review_required: "no"}), /boolean/);
  assert.throws(() => bad({...choice(), uncertain_spans: [{text: "1", reason: "blur", inject: true}]}), /missing or unexpected/);
});

test("no implicit publish, import or auto-answer without explicit human decision", () => {
  const draft = createExtractionReview(page(choice(),open()), source());
  assert.throws(() => prepareReviewedExtractionImport(draft), /Review every/);
  assert.throws(() => decideExtractionQuestion(draft,draft.items[0].id,action(), "teacher_7"),
    /needs a teacher-verified answer/);
  assert.throws(() => decideExtractionQuestion(draft,draft.items[0].id,
    action({verified_against_source: false}), "teacher_7"), /must inspect/);
  assert.throws(() => decideExtractionQuestion(draft,draft.items[0].id,
    action({edits: {review_required: false}}), "teacher_7"), /Unsupported corrections/);
  assert.throws(() => decideExtractionQuestion(draft,draft.items[0].id,
    action(), "__proto__"), /Invalid review/);
});

test("review corrections are explicit, approved choice/short answer round-trip unchanged", () => {
  let session = createExtractionReview(page(choice(),open()), source());
  const orig = session;
  session = decideExtractionQuestion(session, session.items[0].id,
    action({edits: {answer: "B"}}), "teacher_7", new Date("2026-11-06T12:00:00Z"));
  assert.equal(orig.items[0].decision, "pending");
  session = decideExtractionQuestion(session,session.items[1].id,action(),"teacher_7");
  const pkg = prepareReviewedExtractionImport(session,{title: "Equations Review"});
  assert.equal(pkg.schema, IMPORT_SCHEMA);
  assert.equal(pkg.automatically_saved,false);
  assert.equal(pkg.published,false);
  assert.deepEqual(pkg.required_assets,[]);
  assert.equal(pkg.items.length,2);
  assert.equal(pkg.items[0].printed_number,"1");
  assert.equal(pkg.items[0].source.sha256,source().sha256);
  assert.equal(pkg.items[0].reviewed_by,"teacher_7");
  assert.equal(pkg.items[0].grading.correctOptionId,"o2");
  assert.equal(pkg.items[1].grading.acceptedAnswers[0],"7");
  assert.match(pkg.latex,/\\correctchoice/);
  const parsed=parseLatex(pkg.latex);
  assert.equal(parsed.quiz.questions.length,2);
  assert.equal(parsed.quiz.questions[0].answer,"o2");
  assert.equal(parsed.quiz.questions[1].answers[0],"7");
  for(const item of pkg.items)
    assert.doesNotThrow(()=>validateProblem(item.content, (({gradingVersion, ...rest}) => rest)(item.grading)));
});

test("unknown open answer requires conscious manual marking, never a guessed answer", () => {
  const item = {...open(), answer:null, question_type:"open_ended"};
  let session=createExtractionReview(page(item),source());
  assert.throws(()=>decideExtractionQuestion(session,session.items[0].id,action(),"teacher_7"),
    /manual-marking confirmation/);
  session=decideExtractionQuestion(session,session.items[0].id,
    action({manual_marking_confirmed:true}),"teacher_7");
  const pkg=prepareReviewedExtractionImport(session);
  assert.match(pkg.latex,/mode=manual/);
  assert.equal(pkg.items[0].content.answerMode,"manual");
  assert.equal(pkg.items[0].grading.acceptedAnswers.length,0);
});

test("continuation cannot be approved until pages are reconciled in later milestone",()=>{
  const item={...open(), continuation:"continues_next_page", review_required:true,
    review_reasons:["Problem crosses PDF page"]};
  const s=createExtractionReview(page(item),source());
  assert.throws(()=>decideExtractionQuestion(s,s.items[0].id,action(),"teacher_7"),
    /crosses a page boundary/);
  assert.throws(()=>decideExtractionQuestion(s,s.items[0].id,
    action({edits:{continuation:"complete"}}),"teacher_7"),/Unsupported corrections/);
});

test("failed extraction cannot be approved, rejected items need justification",()=>{
  const draft=createExtractionReview({...page(open()),quality_status:"fail"},source());
  assert.throws(()=>decideExtractionQuestion(draft,draft.items[0].id,action(),"teacher_7"),
    /re-extraction/);
  assert.throws(()=>decideExtractionQuestion(draft,draft.items[0].id,
    action({action:"reject"}),"teacher_7"),/rejection must explain/);
  const denied=decideExtractionQuestion(draft,draft.items[0].id,
    action({action:"reject",reason:"No readable source"}),"teacher_7");
  assert.equal(denied.items[0].decision,"reject");
  assert.throws(()=>prepareReviewedExtractionImport(denied),/failed extraction quality/);
});

test("figure assets are required; unknown or unbound images never auto-import",()=>{
  const figure={...open(),has_figure:true,figure_description:"Triangle ABC",
    diagram_requires_reconstruction:true,
    statement_latex:"Find the angle shown in the diagram."};
  const draft=createExtractionReview(page(figure),source());
  assert.throws(()=>decideExtractionQuestion(draft,draft.items[0].id,action(),"teacher_7"),
    /linked figure image/);
  assert.throws(()=>decideExtractionQuestion(draft,draft.items[0].id,action({
    edits:{statement_latex:"Find $x$. \\includegraphics{triangle.png}"},
    figure_assets:{"triangle.png":"../fake"},
  }),"teacher_7"),/Invalid reviewed figure/);
  let decided=decideExtractionQuestion(draft,draft.items[0].id,action({
    edits:{statement_latex:"Find $x$. \\includegraphics{triangle.png}"},
    figure_assets:{"triangle.png":"owned_asset_3"},
  }),"teacher_7");
  const pkg=prepareReviewedExtractionImport(decided);
  assert.deepEqual(pkg.required_assets,["triangle.png"]);
  assert.equal(pkg.items[0].content.questionAssetBindings["triangle.png"],"owned_asset_3");
  assert.match(pkg.latex,/\\includegraphics\{triangle.png\}/);
  assert.equal(pkg.automatically_saved,false);
});

test("all review outcomes required, rejects excluded; unsupported model confidence is not enough",()=>{
  let s=createExtractionReview(page(open(),{...choice(),printed_number:"3"}),source());
  s=decideExtractionQuestion(s,s.items[0].id,action(),"teacher_7");
  assert.throws(()=>prepareReviewedExtractionImport(s),/Review every/);
  s=decideExtractionQuestion(s,s.items[1].id,
    action({action:"reject",reason:"Answer unreadable"}),"teacher_7");
  const pkg=prepareReviewedExtractionImport(s);
  assert.equal(pkg.items.length,1);
  assert.equal(pkg.items[0].printed_number,"2");
  assert.match(pkg.latex,/\\begin\{problem\}\[points=1\]/);
});

test("bad reviewer state and invalid import titles fail closed",()=>{
  let s=createExtractionReview(page(open()),source());
  s=decideExtractionQuestion(s,s.items[0].id,action(),"teacher_7");
  assert.throws(()=>prepareReviewedExtractionImport(s,{title:"Bad {title}"}),/Invalid safe quiz title/);
  assert.throws(()=>prepareReviewedExtractionImport({...s,source:{...s.source,sha256:"wrong"}}),/identifiers or checksum/);
  assert.throws(()=>prepareReviewedExtractionImport({
    ...s,items:s.items.map(i=>({...i,review:{...i.review,by:"../../bad"}}))
  }),/reviewer record/);
});

test("percent escaping keeps mathematical text when parsed by the real importer",()=>{
  const item={...open(),statement_latex:"A 20% increase gives $x=12$.\nIs $x=12$?"};
  let s=createExtractionReview(page(item),source());
  s=decideExtractionQuestion(s,s.items[0].id,action(),"teacher_7");
  const pkg=prepareReviewedExtractionImport(s);
  assert.match(pkg.latex,/20\\% increase/);
  assert.equal(parseLatex(pkg.latex).quiz.questions[0].prompt,item.statement_latex.replace("20%","20\\%"));
});
