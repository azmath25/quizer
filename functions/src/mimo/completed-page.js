/**
 * Interpret Mimo's published PDF output contract for Quizer.
 *
 * Current workflow v1 exports:
 * - extracted_page_json: FIRST-PASS vision extraction (mandatory, nonempty)
 * - verified_page_json: independent visual QA (may be empty or invalid)
 *
 * The QA result can improve a page, but it can never erase an otherwise
 * schema-valid extraction. Any missing/invalid/mismatched QA is explicitly
 * marked as needing teacher review. For older already-completed runs whose
 * export was incorrectly sourced from QA, salvage the stored first-pass
 * checkpoint without resubmitting a paid job.
 */
import {ExtractionContractError,validateExtractedPage}
  from "../../shared/mimo-extraction.js";

const MAX_EXPORT_CHARS=250000;
export const EMPTY_VERIFY_REVIEW_REASON=
  "Independent AI verification returned no visible output; check every question against the original page.";
export const INVALID_VERIFY_REVIEW_REASON=
  "Independent AI verification was invalid or differed from the first pass; compare all questions to the original page.";

function invalid(){
  throw new ExtractionContractError("Completed run has no usable extraction");
}

function validatedPage(content,source){
  if(typeof content!=="string"||!content.trim()||
    content.length>MAX_EXPORT_CHARS)invalid();
  const page=validateExtractedPage(JSON.parse(content),source);
  if(page.questions.length===0||page.quality_status==="fail")invalid();
  // Some model outputs encode a visual newline as the *literal* characters
  // backslash+n (e.g. "$x=2$\\nWhat..."). Convert that narrow prose
  // separator while preserving real TeX macros such as \\nu and \\nabla.
  const questions=page.questions.map(q=>({
    ...q,
    statement_latex:q.statement_latex.replace(/\\n(?=\s|[A-Z])/g,"\n"),
  }));
  return {...page,questions};
}

function reviewOnly(page,reason,recoveredFromCheckpoint=false){
  const marked=validateExtractedPage({
    schema:page.schema,
    quality_status:"review_required",
    questions:page.questions.map(q=>({
      ...q,
      review_required:true,
      review_reasons:[...q.review_reasons.slice(0,19),reason],
    })),
  },page.source);
  return {
    page:marked,recoveredFromCheckpoint,verificationUnusable:true,
  };
}

function samePrintedQuestions(first,verified){
  if(first.questions.length!==verified.questions.length)return false;
  return first.questions.every((item,i)=>
    item.printed_number===verified.questions[i].printed_number);
}

export function completedPageForReview(run,source){
  if(run?.status!=="completed")invalid();
  const output=run.output;
  const final=output?.exports?.extracted_page_json;
  if(typeof final!=="string"||final.length>MAX_EXPORT_CHARS)invalid();

  // Historical broken v1 runs used verify as the export source.
  // This is recoverable ONLY if the final verifier was truly empty and an
  // immutable completed first-pass text checkpoint exists.
  if(!final.trim()){
    const verify=output?.nodes?.verify;
    const extract=output?.nodes?.extract;
    if(verify?.status!=="completed"||verify?.result?.kind!=="text"||
       typeof verify?.result?.content!=="string"||
       verify.result.content.trim()!==""||
       extract?.status!=="completed"||extract?.result?.kind!=="text")
      invalid();
    return reviewOnly(validatedPage(extract.result.content,source),
      EMPTY_VERIFY_REVIEW_REASON,true);
  }

  const first=validatedPage(final,source);
  const exports=output?.exports||{};
  if(!Object.prototype.hasOwnProperty.call(exports,"verified_page_json")){
    // Old releases exported their QA result in extracted_page_json.
    return {page:first,recoveredFromCheckpoint:false,verificationUnusable:false};
  }

  const verification=exports.verified_page_json;
  if(typeof verification!=="string"||verification.length>MAX_EXPORT_CHARS)invalid();
  if(!verification.trim())
    return reviewOnly(first,EMPTY_VERIFY_REVIEW_REASON);

  let verified;
  try{verified=validatedPage(verification,source);}
  catch{
    // The first-pass result remains available, but MUST be manually checked.
    return reviewOnly(first,INVALID_VERIFY_REVIEW_REASON);
  }
  if(!samePrintedQuestions(first,verified))
    return reviewOnly(first,INVALID_VERIFY_REVIEW_REASON);

  // Independent QA is a candidate correction, NEVER teacher approval.
  // Every question is still pending explicit review in Quizer.
  return {page:verified,recoveredFromCheckpoint:false,verificationUnusable:false};
}
