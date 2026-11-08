/**
 * Recover a completed Mimo page using immutable checkpoints without any
 * provider retry, job submission, or mutation of the original run.
 *
 * A failed/invalid independent verification is NEVER represented as passed QA.
 * The fallback is intentionally narrow: only a truly empty completed verify
 * result, paired with a completed and schema-valid extraction checkpoint.
 */
import {ExtractionContractError,validateExtractedPage} from "../../shared/mimo-extraction.js";

const MAX_EXPORT_CHARS=250000;
export const EMPTY_VERIFY_REVIEW_REASON=
  "Independent AI verification returned no visible output; check every question against the original page.";

function invalid(){
  throw new ExtractionContractError("Completed run has no usable verified extraction");
}

export function completedPageForReview(run,source){
  if(run?.status!=="completed")invalid();
  const output=run.output;
  const final=output?.exports?.extracted_page_json;
  if(typeof final!=="string"||final.length>MAX_EXPORT_CHARS)invalid();

  // Never override a present but malformed or contradictory verification
  // output with an earlier, less trustworthy extraction.
  if(final.trim()){
    const page=validateExtractedPage(JSON.parse(final),source);
    if(page.questions.length===0||page.quality_status==="fail")invalid();
    return {page,recoveredFromCheckpoint:false};
  }

  const verify=output?.nodes?.verify;
  const extract=output?.nodes?.extract;
  if(verify?.status!=="completed"||verify?.result?.kind!=="text"||
     typeof verify?.result?.content!=="string"||
     verify.result.content.trim()!==""||
     extract?.status!=="completed"||extract?.result?.kind!=="text"||
     typeof extract?.result?.content!=="string"||
     !extract.result.content.trim()||
     extract.result.content.length>MAX_EXPORT_CHARS)invalid();

  const first=validateExtractedPage(JSON.parse(extract.result.content),source);
  if(first.questions.length===0||first.quality_status==="fail")invalid();
  const recovered=validateExtractedPage({
    schema:first.schema,
    quality_status:"review_required",
    questions:first.questions.map(q=>({
      ...q,
      review_required:true,
      review_reasons:[...q.review_reasons,EMPTY_VERIFY_REVIEW_REASON],
    })),
  },source);
  return {page:recovered,recoveredFromCheckpoint:true};
}
