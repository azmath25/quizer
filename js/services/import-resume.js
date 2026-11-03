// QN11.3: bounded resumable import planning and session-only recovery metadata.
// Never persist question text, answer keys, original source or image bytes here.
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const HASH=/^[0-9a-f]{64}$/;
const key=(uid,bankOnly)=>"mathquiz.recovery.import."+uid+"."+(bankOnly?"bank":"quiz");
const bytes=(value)=>new TextEncoder().encode(value).byteLength;
const ENVELOPE={apiVersion:2,action:"importProblemBatch",requestId:"x".repeat(36),
  jobId:"x".repeat(128)};
export function planImportBatches(records,{
  maxItems=20,maxBytes=650000,
}={}){
  if(!Array.isArray(records)||records.length<1||records.length>500 ||
    !Number.isInteger(maxItems)||maxItems<1||maxItems>20 ||
    !Number.isInteger(maxBytes)||maxBytes<4000||maxBytes>1000000)
    throw Error("Invalid bounded import plan.");
  const keys=new Set(),batches=[];let chunk=[];
  const fits=(values)=>bytes(JSON.stringify({...ENVELOPE,records:values}))<=maxBytes;
  for(const record of records){
    if(!ID.test(record?.importItemKey)||keys.has(record.importItemKey))
      throw Error("Duplicate or invalid import item key.");
    keys.add(record.importItemKey);
    if(!fits([record]))
      throw Error("One problem exceeds the safe import request size.");
    if(chunk.length && (chunk.length>=maxItems || !fits([...chunk,record]))){
      batches.push(chunk);
      chunk=[];
    }
    chunk.push(record);
  }
  if(chunk.length)batches.push(chunk);
  return batches;
}
export function missingImportRecords(records,processedKeys){
  if(!Array.isArray(records)||!Array.isArray(processedKeys)||
    new Set(processedKeys).size!==processedKeys.length)
    throw Error("Invalid server import checkpoint.");
  const all=new Set(records.map(r=>r.importItemKey));
  if(processedKeys.some(k=>!all.has(k)))
    throw Error("Saved import contains different problem keys.");
  const done=new Set(processedKeys);
  return records.filter(r=>!done.has(r.importItemKey));
}
export async function sourceDigest(text){
  if(typeof text!=="string")throw TypeError("Source text required.");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
}
export async function fileDigests(files){
  const entries=await Promise.all([...files].map(async([name,file])=>{
    if(!name||typeof file?.arrayBuffer!=="function")throw Error("Invalid image.");
    const arr=await file.arrayBuffer();
    const digest=await crypto.subtle.digest("SHA-256",arr);
    return [name,Array.from(new Uint8Array(digest),
      x=>x.toString(16).padStart(2,"0")).join("")];
  }));
  return Object.fromEntries(entries.sort((a,b)=>a[0].localeCompare(b[0])));
}
export function readImportRecovery(storage,uid,bankOnly){
  if(!ID.test(uid??""))return null;
  try{
    const raw=JSON.parse(storage.getItem(key(uid,bankOnly))||"null");
    if(!raw||raw.uid!==uid||raw.bankOnly!==bankOnly ||
      !HASH.test(raw.sourceFingerprint)||raw.itemCount<1 ||
      raw.itemCount>500||!Number.isInteger(raw.itemCount)||
      !ID.test(raw.importNonce)||!Number.isFinite(raw.savedAt)||
      Date.now()-raw.savedAt>24*3600*1000 ||
      raw.savedAt>Date.now()+60000)return null;
    if(raw.jobId!=null&&!ID.test(raw.jobId))return null;
    if(raw.sourceAssetId!=null&&!ID.test(raw.sourceAssetId))return null;
    for(const id of Object.values(raw.assets??{}))
      if(!ID.test(id))return null;
    for(const hash of Object.values(raw.imageDigests??{}))
      if(!HASH.test(hash))return null;
    return raw;
  }catch{return null;}
}
export function saveImportRecovery(storage,uid,bankOnly,data){
  if(!ID.test(uid??"")||!data || !HASH.test(data.sourceFingerprint)||
    !ID.test(data.importNonce))return false;
  const safe={uid,bankOnly,savedAt:Date.now(),sourceFingerprint:data.sourceFingerprint,
    importNonce:data.importNonce,jobId:data.jobId??null,
    sourceAssetId:data.sourceAssetId??null,
    itemCount:data.itemCount,assets:{...(data.assets??{})},
    imageDigests:{...(data.imageDigests??{})}};
  try{storage.setItem(key(uid,bankOnly),JSON.stringify(safe));return true;}
  catch{return false;}
}
export function clearImportRecovery(storage,uid,bankOnly){
  if(ID.test(uid??""))try{storage.removeItem(key(uid,bankOnly));}catch{}
}
export function recoveryMatches(recovery,{sourceFingerprint,itemCount,imageDigests}){
  const canonical=obj=>JSON.stringify(Object.entries(obj??{})
    .sort(([a],[b])=>a.localeCompare(b)));
  return !!recovery && recovery.sourceFingerprint===sourceFingerprint &&
    recovery.itemCount===itemCount &&
    canonical(recovery.imageDigests)===canonical(imageDigests);
}
