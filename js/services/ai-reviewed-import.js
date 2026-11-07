/**
 * Save only teacher-reviewed canonical extraction through Quizer's existing
 * authenticated/idempotent quiz import ledger. Never publish a quiz.
 */
import {api} from "./api.js";
import {uploadAsset} from "./assets.js";
import {getSession} from "../firebase-client.js";
import {DEFAULT_SETTINGS} from "../../shared/schema.js";
import {sourceDigest,planImportBatches,missingImportRecords} from "./import-resume.js";
import {buildApprovedImportRecords} from "./ai-reviewed-import-core.js";

const recoveryKey=(uid,src,target)=>"mathquiz.ai.reviewed-import."+uid+"."+src+"."+target;
const safeRecord=value=>value&&typeof value==="object"&&
  /^[a-zA-Z0-9_-]{1,128}$/.test(value.jobId||"")&&
  /^[a-zA-Z0-9_-]{1,128}$/.test(value.sourceAssetId||"")&&
  /^[0-9a-f]{64}$/.test(value.fingerprint||"");

export async function importApprovedExtraction(prepared,{
  title="Reviewed mathematics extraction",sourceJobId,target="quiz",
  visibility="private",onProgress=()=>{},
}={}){
  const actor=getSession();
  if(!actor?.user?.uid||!actor.roleResolved||actor.accountStatus!=="active"||
      !(actor.capabilities?.teach||actor.capabilities?.admin))
    throw Error("Verified teacher access required.");
  if(!/^[a-f0-9]{64}$/.test(sourceJobId||""))throw Error("Invalid source job.");
  const records=buildApprovedImportRecords(prepared,{title,target,visibility});
  if(typeof prepared.latex!=="string"||!prepared.latex.trim())
    throw Error("Missing verified LaTeX source.");
  const fingerprint=await sourceDigest(prepared.latex);
  const checkpointKey=recoveryKey(actor.user.uid,sourceJobId,target);
  let recovery=null;
  try {
    const saved=JSON.parse(localStorage.getItem(checkpointKey)||"null");
    if(safeRecord(saved)&&saved.fingerprint===fingerprint)recovery=saved;
  }catch{}
  // Stable per source+teacher+approved-content import intent. A corrected
  // review produces a NEW fingerprint and cannot mutate an older receipt.
  const nonce="aireview_"+(await sourceDigest(JSON.stringify([
    actor.user.uid,sourceJobId,target,fingerprint,visibility,
  ]))).slice(0,45);
  if(!recovery){
    onProgress("Uploading approved source to your private Quizer assets");
    const sourceFile=new File([prepared.latex],"reviewed-ai-extraction.tex",{
      type:"text/plain;charset=utf-8",
    });
    const sourceAssetId=await uploadAsset(sourceFile,(progress)=>
      onProgress("Source: "+progress.stage),"source");
    const created=await api("createImportJob",{
      name:title,sourceAssetId,itemCount:records.length,
      bankOnly:target==="bank",sourceFingerprint:fingerprint,
    },nonce);
    recovery={jobId:created.jobId,sourceAssetId,fingerprint};
    try{localStorage.setItem(checkpointKey,JSON.stringify(recovery));}catch{}
  }
  const checkpoint=await api("getImportCheckpoint",{jobId:recovery.jobId});
  if(checkpoint.sourceFingerprint!==fingerprint||checkpoint.itemCount!==records.length||
      checkpoint.bankOnly!==(target==="bank")||
      checkpoint.sourceAssetId!==recovery.sourceAssetId)
    throw Error("Import checkpoint does not match approved source.");
  if(checkpoint.status==="succeeded"){
    // Retain the confirmed receipt across page reloads and repeat clicks.
    // No private question text or secret is stored in browser storage.
    return checkpoint.result;
  }
  if(checkpoint.status!=="running")throw Error("Existing import requires manual reconciliation.");
  const remaining=missingImportRecords(records,checkpoint.processedKeys);
  for(const group of remaining.length?planImportBatches(remaining):[]){
    const requestId="aireview_batch_"+(await sourceDigest(JSON.stringify([
      recovery.jobId,group,
    ]))).slice(0,45);
    const result=await api("importProblemBatch",{
      jobId:recovery.jobId,records:group,
    },requestId);
    onProgress("Imported "+result.processed+" of "+records.length+" approved problems");
  }
  const confirmed=await api("getImportCheckpoint",{jobId:recovery.jobId});
  if(confirmed.processed!==records.length||
      missingImportRecords(records,confirmed.processedKeys).length)
    throw Error("Import incomplete; reopen this job and resume.");
  const result=await api("finishImportJob",{
    jobId:recovery.jobId,title,description:"Imported from teacher-reviewed Mimo extraction",
    settings:DEFAULT_SETTINGS,order:records.map(x=>x.importItemKey),
  });
  // Keep the job receipt to reopen it idempotently on this device.
  return result;
}
