/**
 * Q-AI.3: untrusted Mimo extracted-page output -> explicit, reviewable Quizer
 * problem candidates. Pure functions only: no Firebase, Neon, provider calls,
 * job dispatch, auto-publication or browser storage.
 *
 * The second "source" argument MUST come from a trusted artifact/job service,
 * not the model output or browser-supplied identity. A future authenticated
 * server adapter must revalidate reviewer identity and owned asset IDs.
 */
import { validateProblem } from "./schema.js";
import { parseLatex } from "./latex-parser.js";

export const EXTRACTED_PAGE_SCHEMA = "mimo.extracted_page.v1";
export const REVIEW_SCHEMA = "quizer.extraction_review.v1";
export const IMPORT_SCHEMA = "quizer.reviewed_extraction_import.v1";
const ID = /^[A-Za-z0-9_-]{1,128}$/;
function validId(value) {
  return typeof value === "string" && ID.test(value) &&
    !["__proto__", "prototype", "constructor"].includes(value);
}
const HASH = /^[0-9a-f]{64}$/;
const PRINTED = /^[A-Za-z0-9()._-]{1,32}$/;
const ALIAS = /^[A-Za-z0-9_.-]{1,120}\.(?:png|jpe?g|webp)$/i;
const QUESTION_FIELDS = [
  "printed_number", "statement_latex", "question_type", "options",
  "answer", "has_figure", "figure_description",
  "diagram_requires_reconstruction", "continuation",
  "review_required", "review_reasons", "uncertain_spans",
];
const BLOCKED_LATEX = /\\(?:begin|end)\s*\{\s*(?:problem|question|exercise|choices|oneparchoices|checkboxes|solution)\s*\}|\\(?:answer|accepted|correctchoice|choice|quiztitle|quizsubject|quizdescription|explanation|points)\b/i;
const UNSAFE_CONTROL = /\\(?:input|include(?!graphics)|write\d*|openout|read\d*|immediate|href|url|require|class|cssId|style|html\w*)\b/i;

export class ExtractionContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtractionContractError";
  }
}
function fail(message) { throw new ExtractionContractError(message); }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(label + " must be an object");
  return value;
}
function exact(value, keys, label) {
  object(value, label);
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !expected.has(key)))
    fail(label + " has missing or unexpected fields");
}
function str(value, label, min = 0, max = 30000) {
  if (typeof value !== "string" || value.length < min || value.length > max ||
      (min > 0 && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    fail(label + " must be bounded, nonempty text");
  return value;
}
function enumeration(value, options, label) {
  if (!options.includes(value)) fail("Invalid " + label);
  return value;
}
function bool(value, label) {
  if (typeof value !== "boolean") fail(label + " must be boolean");
  return value;
}
function arr(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum)
    fail(label + " must be an array with at most " + maximum + " entries");
  return value;
}
function safeLatex(value, label, max = 30000) {
  str(value, label, 1, max);
  if (BLOCKED_LATEX.test(value) || UNSAFE_CONTROL.test(value))
    fail(label + " includes prohibited importer or TeX control");
  return value;
}
function sourceRef(source) {
  exact(source, [
    "document_id", "source_artifact_id", "page_artifact_id",
    "page_number", "page_count", "sha256",
  ], "trusted source");
  if (!validId(source.document_id) || !validId(source.source_artifact_id) ||
      (source.page_artifact_id !== null && !validId(source.page_artifact_id)) ||
      !HASH.test(source.sha256))
    fail("Trusted source has invalid identifiers or checksum");
  if (!Number.isInteger(source.page_number) || !Number.isInteger(source.page_count) ||
      source.page_count < 1 || source.page_count > 100 ||
      source.page_number < 1 || source.page_number > source.page_count)
    fail("Trusted source page is out of range");
  return { ...source };
}
function parsedQuestion(q, index) {
  exact(q, QUESTION_FIELDS, "question " + index);
  if (!PRINTED.test(q.printed_number)) fail("Invalid printed question number");
  safeLatex(q.statement_latex, "Statement", 30000);
  enumeration(q.question_type, ["multiple_choice", "short_answer", "open_ended"], "question type");
  arr(q.options, "options", 12);
  if (q.question_type === "multiple_choice" && q.options.length < 2)
    fail("Multiple-choice question needs 2–12 options");
  if (q.question_type !== "multiple_choice" && q.options.length)
    fail("Only multiple-choice questions may have options");
  const labels = new Set();
  q.options.forEach((option, i) => {
    exact(option, ["label", "latex"], "option");
    if (typeof option.label !== "string" || !/^[A-L]$/.test(option.label) ||
        labels.has(option.label)) fail("Options need distinct labels A–L");
    labels.add(option.label);
    safeLatex(option.latex, "Choice " + i, 10000);
  });
  if (q.answer !== null) {
    safeLatex(q.answer, "Answer", 500);
    if (q.question_type === "multiple_choice" && !labels.has(q.answer))
      fail("Multiple-choice answer must identify an existing option label");
  }
  bool(q.has_figure, "has_figure");
  bool(q.diagram_requires_reconstruction, "diagram_requires_reconstruction");
  if (q.figure_description !== null)
    str(q.figure_description, "figure description", 1, 2000);
  if (!q.has_figure && (q.figure_description !== null ||
      q.diagram_requires_reconstruction))
    fail("Figure flags and description are inconsistent");
  enumeration(q.continuation, [
    "complete", "continued_from_previous_page", "continues_next_page",
    "continues_both_sides", "uncertain",
  ], "continuation");
  bool(q.review_required, "review_required");
  arr(q.review_reasons, "review reasons", 20).forEach(value =>
    str(value, "Review reason", 1, 300));
  arr(q.uncertain_spans, "uncertain spans", 30).forEach(span => {
    exact(span, ["text", "reason"], "uncertain span");
    str(span.text, "uncertain text", 1, 300);
    str(span.reason, "uncertain reason", 1, 300);
  });
  // Never infer confidence or an answer from the model's 'pass' label.
  return {
    ...q,
    options: q.options.map(o => ({ ...o })),
    review_reasons: [...q.review_reasons],
    uncertain_spans: q.uncertain_spans.map(o => ({ ...o })),
  };
}
export function validateExtractedPage(raw, source) {
  exact(raw, ["schema", "quality_status", "questions"], "extracted page");
  if (raw.schema !== EXTRACTED_PAGE_SCHEMA) fail("Unsupported extraction schema");
  enumeration(raw.quality_status, ["pass", "review_required", "fail"], "quality status");
  const trusted = sourceRef(source);
  const rows = arr(raw.questions, "questions", 100).map(parsedQuestion);
  const printed = new Set();
  for (const question of rows) {
    if (printed.has(question.printed_number))
      fail("Duplicate printed question number on one page: " + question.printed_number);
    printed.add(question.printed_number);
  }
  return { schema: EXTRACTED_PAGE_SCHEMA, quality_status: raw.quality_status,
    questions: rows, source: trusted };
}
function confirmedChanges(q, edits) {
  if (edits === undefined) return q;
  const allowed = ["statement_latex", "options", "answer", "figure_description"];
  object(edits, "corrections");
  if (Object.keys(edits).some(key => !allowed.includes(key)))
    fail("Unsupported corrections field");
  return parsedQuestion({ ...q, ...edits }, q.printed_number);
}
function bindings(value) {
  object(value, "reviewed figure asset bindings");
  if (Object.keys(value).length > 12) fail("Too many figure assets");
  const result = Object.create(null);
  for (const [alias, assetId] of Object.entries(value)) {
    if (!ALIAS.test(alias) || !validId(assetId) ||
        ["__proto__", "constructor", "prototype"].includes(alias))
      fail("Invalid reviewed figure asset binding");
    result[alias] = assetId;
  }
  return result;
}
function toCandidate(q, imageBindings, manualMarkingConfirmed) {
  if (q.continuation !== "complete")
    fail("Question " + q.printed_number + " crosses a page boundary; reconcile the source pages first");
  const images = bindings(imageBindings);
  const expected = [...q.statement_latex.matchAll(/\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)]
    .map(match => match[1].trim());
  if (q.has_figure && (!expected.length || Object.keys(images).length === 0))
    fail("Question " + q.printed_number + " needs a reviewed, linked figure image");
  if (!q.has_figure && Object.keys(images).length)
    fail("Unexpected figure assets for a figure-free question");
  for (const alias of expected) {
    if (!Object.hasOwn(images, alias))
      fail("Unbound figure in statement: " + alias);
  }
  for (const alias of Object.keys(images)) {
    if (!expected.includes(alias)) fail("Unused figure binding: " + alias);
  }
  if (q.question_type === "multiple_choice" && q.answer === null)
    fail("Multiple-choice question " + q.printed_number + " needs a teacher-verified answer");
  if (q.question_type !== "multiple_choice" && q.answer === null && !manualMarkingConfirmed)
    fail("Missing answer requires explicit manual-marking confirmation");
  const isChoice = q.question_type === "multiple_choice";
  const options = q.options.map((o, i) => ({ id: "o" + (i + 1), textLatex: o.latex }));
  const right = isChoice ? q.options.findIndex(o => o.label === q.answer) : -1;
  return validateProblem({
    type: isChoice ? "choice" : "open",
    answerMode: !isChoice && q.answer === null ? "manual" : "auto",
    statementLatex: q.statement_latex,
    options, defaultPoints: 1,
    questionAssetBindings: images,
  }, {
    correctOptionId: isChoice ? options[right].id : null,
    acceptedAnswers: !isChoice && q.answer !== null ? [q.answer] : [],
    tolerance: 0.000001,
    explanationLatex: "", rubricLatex: "", solutionAssetBindings: {},
  });
}
/**
 * All questions start pending, regardless of the model's claimed quality.
 * The service using this module must independently authorize reviewers and
 * ensure that referenced artifact IDs belong to the same teacher/project.
 */
export function createExtractionReview(raw, source) {
  const page = validateExtractedPage(raw, source);
  return {
    schema: REVIEW_SCHEMA,
    source: page.source,
    quality_status: page.quality_status,
    items: page.questions.map((question, index) => ({
      id: "page" + page.source.page_number + "_item" + (index + 1),
      original: question, decision: "pending", review: null,
    })),
  };
}
export function decideExtractionQuestion(session, itemId, decision, reviewerId, now = new Date()) {
  if (session?.schema !== REVIEW_SCHEMA || !Array.isArray(session.items) ||
      !validId(reviewerId) || !Number.isFinite(now.getTime()))
    fail("Invalid review session or reviewer");
  const idx = session.items.findIndex(row => row.id === itemId);
  if (idx < 0) fail("Review item not found");
  const row = session.items[idx];
  const verified = validateExtractedPage({
    schema: EXTRACTED_PAGE_SCHEMA, quality_status: session.quality_status,
    questions: session.items.map(item => item.original),
  }, session.source);
  if (verified.questions.length !== session.items.length) fail("Review session was modified");
  exact(decision, ["action", "edits", "figure_assets", "verified_against_source", "manual_marking_confirmed", "reason"], "review decision");
  enumeration(decision.action, ["approve", "reject"], "review action");
  bool(decision.verified_against_source, "verified_against_source");
  bool(decision.manual_marking_confirmed, "manual_marking_confirmed");
  if (!decision.verified_against_source)
    fail("Reviewer must inspect the original page before deciding");
  if (decision.reason !== null) str(decision.reason, "decision reason", 1, 500);
  const candidate = confirmedChanges(row.original, decision.edits ?? undefined);
  const assets = bindings(decision.figure_assets);
  if (decision.action === "approve") {
    if (session.quality_status === "fail")
      fail("Failed page extraction requires re-extraction before approval");
    toCandidate(candidate, assets, decision.manual_marking_confirmed);
  } else if (!decision.reason) {
    fail("A rejection must explain why");
  }
  const nextItems = session.items.map((item, i) => i === idx ? {
    ...item, decision: decision.action,
    review: {
      by: reviewerId, at: now.toISOString(),
      edited: candidate,
      figure_assets: { ...assets },
      verified_against_source: true,
      manual_marking_confirmed: decision.manual_marking_confirmed,
      reason: decision.reason,
    },
  } : item);
  return { ...session, items: nextItems };
}
function protectLatex(value) {
  // The existing importer treats unescaped percent as a TeX comment.
  return value.replace(/(^|[^\\])%/g, "$1\\%");
}
function toTex(q, candidate) {
  const content = candidate.content, grading = candidate.grading;
  const statement = protectLatex(content.statementLatex);
  let result = "\\begin{problem}[points=1" +
    (content.answerMode === "manual" ? ",mode=manual" : "") + "]\n" + statement;
  if (content.type === "choice") {
    result += "\n\\begin{choices}\n" +
      content.options.map(o => (o.id === grading.correctOptionId
        ? "\\correctchoice " : "\\choice ") + protectLatex(o.textLatex)).join("\n") +
      "\n\\end{choices}";
  } else if (content.answerMode === "auto") {
    result += "\n\\answer{" + protectLatex(grading.acceptedAnswers[0]) + "}";
  }
  return result + "\n\\end{problem}";
}
/**
 * Prepare a reviewed export; does not save a quiz, commit an import receipt,
 * upload images, or publish any answer. Caller must present an explicit UI
 * confirmation and pass the result through the existing authorized importer.
 */
export function prepareReviewedExtractionImport(session, {title = "Reviewed mathematics extraction"} = {}) {
  if (session?.schema !== REVIEW_SCHEMA || !Array.isArray(session.items))
    fail("Invalid extraction review session");
  const page = validateExtractedPage({
    schema: EXTRACTED_PAGE_SCHEMA, quality_status: session.quality_status,
    questions: session.items.map(item => item.original),
  }, session.source);
  if (page.quality_status === "fail") fail("Page failed extraction quality");
  if (!/^[\p{L}\p{N} ._-]{1,120}$/u.test(title))
    fail("Invalid safe quiz title");
  if (session.items.some(item => !["approve", "reject"].includes(item.decision)))
    fail("Review every extracted question before preparing an import");
  const entries = [];
  for (const item of session.items) {
    if (item.decision !== "approve") continue;
    if (!item.review || !item.review.verified_against_source ||
        !validId(item.review.by) ||
        Number.isNaN(new Date(item.review.at).getTime()))
      fail("Approved question has no valid reviewer record");
    const question = confirmedChanges(item.original, {
      statement_latex: item.review.edited?.statement_latex,
      options: item.review.edited?.options,
      answer: item.review.edited?.answer,
      figure_description: item.review.edited?.figure_description,
    });
    const content = toCandidate(question,
      item.review.figure_assets, item.review.manual_marking_confirmed);
    entries.push({
      review_id: item.id, printed_number: item.original.printed_number,
      source: { ...page.source }, reviewed_by: item.review.by,
      reviewed_at: item.review.at, content: content.content,
      grading: content.grading, tex: toTex(question, content),
    });
  }
  if (!entries.length) fail("No approved questions to import");
  const latex = "\\quiztitle{" + title + "}\n" + entries.map(e => e.tex).join("\n\n") + "\n";
  // An actual parser round-trip checks the real Quizer TeX dialect. Figure
  // filenames remain unresolved until the authorized importer gets uploads.
  const parsed = parseLatex(latex, {filename: "reviewed.tex"});
  if (parsed.quiz.questions.length !== entries.length)
    fail("Importer parsed a different number of approved questions");
  for (let i = 0; i < entries.length; i++) {
    const q = parsed.quiz.questions[i], expected = entries[i].content;
    if (q.prompt !== protectLatex(expected.statementLatex) ||
        q.type !== expected.type || q.answerMode !== expected.answerMode ||
        (q.type === "choice" && q.options.length !== expected.options.length))
      fail("Importer round-trip altered a reviewed problem");
  }
  const requiredAssets = [...new Set(entries.flatMap(e =>
    Object.keys(e.content.questionAssetBindings)))].sort();
  return {
    schema: IMPORT_SCHEMA, latex, items: entries,
    source: { ...page.source }, required_assets: requiredAssets,
    automatically_saved: false, published: false,
  };
}
