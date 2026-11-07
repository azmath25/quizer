/**
 * Teacher-only document extraction client. Mimo project key never reaches the browser.
 * File bytes are sent ONLY after the teacher explicitly opts in.
 */
import {getFirebaseServices,getSession} from "../firebase-client.js";
import {canUseMimoTeacherChat} from "./mimo-chat.js";
import {
  createExtractionReview,decideExtractionQuestion,prepareReviewedExtractionImport,
} from "../../shared/mimo-extraction.js";

export const MAX_MIMO_FILE_BYTES=8*1024*1024;
function ensureTeacher(snapshot) {
  if (!canUseMimoTeacherChat(snapshot)) throw Error("Verified teacher access is required.");
}
function sameUser(before) {
  const after=getSession();
  return canUseMimoTeacherChat(after)&&after.user.uid===before.user.uid&&after.epoch===before.epoch;
}
async function invoke(name,body,timeout=115000) {
  const before=getSession();
  ensureTeacher(before);
  const services=await getFirebaseServices();
  if (!sameUser(before)) throw Error("Your session changed. Sign in again.");
  const call=services.functionsSDK.httpsCallable(services.functions,name,{timeout});
  const data=(await call(body)).data;
  if (!sameUser(before)) throw Error("Your session changed. Do not share these results.");
  return data;
}
function encode(bytes) {
  let text="";
  // Avoid spreading megabytes into one function call (and its argument limit).
  for(let i=0;i<bytes.length;i+=32768)
    text+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(text);
}
export async function submitMimoExtraction(file, pageNumber=1, {costLimitUsd=0.15,target="quiz",imageAssetId=null}={}) {
  if (!(file instanceof File)||!file.size||file.size>MAX_MIMO_FILE_BYTES)
    throw Error("Choose a nonempty PDF, PNG or JPEG up to 8 MiB.");
  const type=/\.pdf$/i.test(file.name)?"application/pdf":
    /\.png$/i.test(file.name)?"image/png":
      /\.jpe?g$/i.test(file.name)?"image/jpeg":null;
  if(!type)throw Error("Mimo vision accepts PDF, PNG and JPEG only.");
  if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>100)
    throw Error("Page must be between 1 and 100.");
  const before=getSession();
  ensureTeacher(before);
  const base64=encode(new Uint8Array(await file.arrayBuffer()));
  if(!sameUser(before))throw Error("Session changed before upload.");
  // This ID must remain stable across uncertain responses; no automatic retry.
  const requestId=crypto.randomUUID();
  try {
    const result=await invoke("mimoExtractStart",{
      requestId,fileName:file.name.slice(0,120),contentType:type,base64,
      pageNumber:type==="application/pdf"?pageNumber:1,costLimitUsd,target,
      ...(imageAssetId?{imageAssetId}:{}) ,
    });
    return {...result,requestId};
  } catch(e) {
    e.requestId=requestId;
    throw e;
  }
}

/** Whole-document extraction uses one uploaded source and durable page tasks. */
export async function submitMimoBatch(file,{
  target="quiz",pageStart=1,pageEnd=0,perPageUsd=0.15,totalUsd=15,
}={}){
  if(!(file instanceof File)||!file.size||file.size>MAX_MIMO_FILE_BYTES)
    throw Error("Choose a nonempty PDF, PNG or JPEG up to 8 MiB.");
  const type=/\.pdf$/i.test(file.name)?"application/pdf":
    /\.png$/i.test(file.name)?"image/png":
      /\.jpe?g$/i.test(file.name)?"image/jpeg":null;
  if(!type)throw Error("Mimo supports PDF, PNG and JPEG only.");
  const before=getSession();ensureTeacher(before);
  const base64=encode(new Uint8Array(await file.arrayBuffer()));
  if(!sameUser(before))throw Error("Session changed before upload.");
  const requestId=crypto.randomUUID();
  try{
    return {...await invoke("mimoBatchStart",{
      requestId,fileName:file.name.slice(0,120),contentType:type,base64,
      target,pageStart,pageEnd,perPageUsd,totalUsd,
    }),requestId};
  }catch(error){error.requestId=requestId;throw error;}
}
export const listMimoBatches=()=>invoke("mimoBatchList",{limit:30},30000);
export const readMimoBatch=jobId=>invoke("mimoBatchStatus",{jobId},30000);
export const readMimoBatchPage=(jobId,pageNumber)=>
  invoke("mimoBatchGetPage",{jobId,pageNumber},30000);
export const readMimoBatchImage=(jobId,pageNumber)=>
  invoke("mimoBatchImage",{jobId,pageNumber});
export const saveMimoBatchReview=(jobId,pageNumber,sourceSha256,expectedVersion,decisions)=>
  invoke("mimoBatchReviewPage",{
    jobId,pageNumber,sourceSha256,expectedVersion,decisions,
  });
export const readMimoBatchPrepared=jobId=>
  invoke("mimoBatchPrepared",{jobId},60000);

export const readMimoExtraction=jobId=>invoke("mimoExtractStatus",{jobId});
export const listMimoExtractions=()=>invoke("mimoExtractList",{limit:30},30000);
export const readMimoPng=jobId=>invoke("mimoExtractImage",{jobId});
export function buildTeacherReview(page) {
  return createExtractionReview({
    schema:page.schema,quality_status:page.quality_status,questions:page.questions,
  },page.source);
}
export function decideTeacherReview(review,itemId,decision,uid) {
  return decideExtractionQuestion(review,itemId,decision,uid);
}
export function exportTeacherReview(review,title) {
  return prepareReviewedExtractionImport(review,{title});
}
export function extractionError(error) {
  const reason=String(error?.details?.reason||"");
  const map={
    RATE_LIMITED:"Your extraction quota is full (2/minute, 20/day).",
    INVALID_PAGE_NUMBER:"This PDF does not contain that page.",
    INVALID_FIELDS:"The file was rejected. Select a PDF, PNG or JPEG up to 8 MiB.",
    ROLE_REQUIRED:"Only verified teachers and administrators can extract.",
    MIMO_PROJECT_NOT_AUTHORIZED:"The Mimo project does not have access to this workflow.",
    MIMO_INVALID_EXTRACTION:"AI output did not match Quizer's required schema. Review/retry from the original source.",
    MIMO_OUTCOME_UNKNOWN:"Mimo may have accepted the request. Do not automatically retry.",
    MIMO_RATE_LIMITED:"The provider is rate limited. Check the existing job before trying again.",
    MIMO_UPSTREAM_UNAVAILABLE:"Mimo is unavailable or the job could not be confirmed.",
  };
  return map[reason]||(error?.message&&error.message.length<160?error.message:
    "Document extraction could not be completed.");
}
/** Surface only server-allowlisted failure categories, never Mimo raw errors. */
export function describeMimoRunFailure(row) {
  const code=String(row?.diagnosticCode||"");
  const messages={
    provider_invalid_request:"The provider rejected the extraction input.",
    provider_authorization_rejected:"The provider rejected its configured credentials or permission.",
    provider_model_or_endpoint_unavailable:"The configured provider model or endpoint is unavailable.",
    provider_request_timeout_unknown:"The provider timed out; do not blindly resubmit.",
    provider_payload_too_large:"The source exceeded the provider request size limit.",
    provider_unprocessable_request:"The provider could not process the request.",
    provider_rate_limited:"The provider rate limit was reached; check this job before retrying.",
    provider_request_rejected:"The provider rejected the request.",
    provider_server_response_unknown:"The provider returned a server error. The charge may be uncertain.",
    provider_unexpected_status:"The provider returned an unexpected status.",
    provider_timeout_outcome_unknown:"The provider timed out; the charge may be uncertain.",
    provider_transport_outcome_unknown:"The provider connection failed; the charge may be uncertain.",
    execution_invalid_response_or_contract:"Mimo could not process the provider's response.",
    execution_internal_error:"Mimo encountered an internal execution error.",
  };
  const message=messages[code];
  if(!message)return "";
  const http=row?.diagnosticHttpStatus;
  return message+(Number.isInteger(http)&&http>=400&&http<=599?" (HTTP "+http+")":"");
}

export function decodeMimoPng(encoded) {
  if (encoded?.contentType!=="image/png"||typeof encoded.base64!=="string"||
      encoded.base64.length>6*1024*1024) throw Error("Invalid reconstructed image.");
  const raw=atob(encoded.base64),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  const header=[137,80,78,71,13,10,26,10];
  if (!header.every((value,i)=>bytes[i]===value))throw Error("Invalid PNG data.");
  return new Blob([bytes],{type:"image/png"});
}
