/**
 * Teacher-only PDF/image -> published Mimo workflow bridge.
 * The Firebase callable receives bounded file bytes and keeps the Mimo key server-side.
 * Jobs are recorded in Firestore BEFORE a paid provider request; uncertain requests
 * are never automatically replayed.
 */
import { createHash } from "node:crypto";
import { validateExtractedPage } from "../../shared/mimo-extraction.js";

export const EXTRACTION_WORKFLOW = Object.freeze({
  origin: "https://mimo-execution-993130348924.europe-west1.run.app",
  id: "c_mw5e6wmr_wma1bg",
  version: 1,
  costLimitUsd: 0.03,
  maxFileBytes: 8 * 1024 * 1024,
  perMinute: 2,
  perUtcDay: 20,
});
const MIME = Object.freeze({
  "application/pdf": {extension: /\.(pdf)$/i, head: Buffer.from("%PDF")},
  "image/png": {extension: /\.(png)$/i, head: Buffer.from([137,80,78,71,13,10,26,10])},
  "image/jpeg": {extension: /\.(jpg|jpeg)$/i, head: Buffer.from([255,216,255])},
});
const ID = /^[A-Za-z0-9_-]{16,100}$/;
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const MAX_JSON = 1_048_576;
const MAX_PNG = 4 * 1024 * 1024;

export class ExtractionError extends Error {
  constructor(code) { super(code); this.code = code; this.name = "ExtractionError"; }
}
const fail = code => { throw new ExtractionError(code); };
const sha = data => createHash("sha256").update(data).digest("hex");
const plain = v => v !== null && typeof v === "object" && !Array.isArray(v);

function authorizeAuth(auth) {
  if (!auth || typeof auth.uid !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(auth.uid)) fail("AUTH_REQUIRED");
  if (auth.token?.email_verified !== true) fail("EMAIL_UNVERIFIED");
  return auth.uid;
}
async function authorizeRole(db, auth) {
  const uid = authorizeAuth(auth);
  const role = await db.doc("roles/" + uid).get();
  const r = role.exists ? role.data() : null;
  if (!r || !["teacher","admin"].includes(r.role) ||
      (r.accountStatus ?? "active") !== "active") fail("ROLE_REQUIRED");
  return uid;
}
function validateStart(raw) {
  if (!plain(raw) || Object.keys(raw).some(k =>
    !["requestId","fileName","contentType","base64","pageNumber"].includes(k)))
    fail("INVALID_FIELDS");
  const {requestId,fileName,contentType,base64,pageNumber} = raw;
  if (typeof requestId !== "string" || !ID.test(requestId) ||
      typeof fileName !== "string" || fileName.length < 1 || fileName.length > 120 ||
      /[\\/\x00-\x1f]/.test(fileName) ||
      !Object.hasOwn(MIME,contentType) || !MIME[contentType].extension.test(fileName) ||
      typeof base64 !== "string" || base64.length < 4 ||
      base64.length > Math.ceil(EXTRACTION_WORKFLOW.maxFileBytes / 3) * 4 + 4 ||
      base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) ||
      !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 100)
    fail("INVALID_FIELDS");
  const bytes = Buffer.from(base64,"base64");
  if (bytes.length < 8 || bytes.length > EXTRACTION_WORKFLOW.maxFileBytes ||
      bytes.toString("base64") !== base64 || !bytes.subarray(0,MIME[contentType].head.length)
        .equals(MIME[contentType].head)) fail("INVALID_FIELDS");
  if (contentType !== "application/pdf" && pageNumber !== 1) fail("INVALID_FIELDS");
  return {requestId,fileName,contentType,bytes,pageNumber,digest:sha(bytes)};
}
function checkConfig(projectKey) {
  if (typeof projectKey !== "string" || projectKey.length < 24 ||
      /[\r\n]/.test(projectKey)) fail("MIMO_NOT_CONFIGURED");
}
async function boundedResponse(response, limit, binary = false) {
  const header = Number(response.headers?.get("content-length"));
  if (Number.isFinite(header) && header > limit) fail("MIMO_INVALID_RESPONSE");
  const reader = response.body?.getReader();
  if (!reader) fail("MIMO_INVALID_RESPONSE");
  let size=0,parts=[];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) fail("MIMO_INVALID_RESPONSE");
      parts.push(Buffer.from(item.value));
    }
  } finally { reader.releaseLock(); }
  const data=Buffer.concat(parts);
  if (binary) return data;
  if (!(response.headers?.get("content-type") || "").toLowerCase().includes("application/json"))
    fail("MIMO_INVALID_RESPONSE");
  try { return JSON.parse(data.toString("utf8")); }
  catch { fail("MIMO_INVALID_RESPONSE"); }
}
function client(projectKey, fetchImpl) {
  checkConfig(projectKey);
  async function call(path, {method="GET",body,binary=false,header={},limit=MAX_JSON}={}) {
    let response;
    try {
      response=await fetchImpl(EXTRACTION_WORKFLOW.origin + path, {
        method,headers:{Authorization:"Bearer "+projectKey,Accept:binary?"image/png":"application/json",...header},
        ...(body===undefined?{}:{body}),redirect:"error",signal:AbortSignal.timeout(90000),
      });
    } catch { fail("MIMO_OUTCOME_UNKNOWN"); }
    if ([401,403].includes(response.status)) fail("MIMO_PROJECT_NOT_AUTHORIZED");
    if (response.status === 404) fail("MIMO_NOT_FOUND");
    if (response.status === 409) fail("MIMO_CONFLICT");
    if (response.status === 429) fail("MIMO_RATE_LIMITED");
    if (response.status >= 500) fail("MIMO_UPSTREAM_UNAVAILABLE");
    if (!response.ok) fail("MIMO_REQUEST_REJECTED");
    return boundedResponse(response,limit,binary);
  }
  return {
    async upload(file) {
      const form=new FormData();
      form.append("file",new Blob([file.bytes],{type:file.contentType}),file.fileName);
      const artifact=await call("/v1/integrations/artifacts",{method:"POST",body:form});
      if (!UUID.test(artifact?.id) || artifact.checksum_sha256 !== file.digest)
        fail("MIMO_INVALID_RESPONSE");
      return artifact;
    },
    async ingest(id) {
      return call("/v1/integrations/artifacts/"+encodeURIComponent(id)+"/ingest",{method:"POST"});
    },
    async start(input,uid,requestId) {
      const key="quizer-extract-"+sha(uid+":"+requestId);
      const body={input,version:EXTRACTION_WORKFLOW.version,background:true,
        cost_limit_usd:EXTRACTION_WORKFLOW.costLimitUsd,cost_mode:"hard"};
      const run=await call("/v1/workflows/"+EXTRACTION_WORKFLOW.id+"/runs",{
        method:"POST",body:JSON.stringify(body),
        header:{"Content-Type":"application/json","Idempotency-Key":key},
      });
      if (!UUID.test(run?.id) || typeof run.status !== "string")
        fail("MIMO_INVALID_RESPONSE");
      return run;
    },
    run(id) {
      if (!UUID.test(id)) fail("INVALID_FIELDS");
      return call("/v1/runs/"+encodeURIComponent(id));
    },
    png(id) {
      if (!UUID.test(id)) fail("INVALID_FIELDS");
      return call("/v1/runs/"+encodeURIComponent(id)+"/artifacts/compile_png",{
        binary:true,limit:MAX_PNG,
      });
    },
  };
}

export function createExtractionService({db,projectKey,fetchImpl=globalThis.fetch,now=()=>Date.now()}={}) {
  if (!db?.doc || !db?.runTransaction) throw Error("Firestore required");
  async function start({auth,data}) {
    const uid=await authorizeRole(db,auth);
    const file=validateStart(data);
    checkConfig(projectKey);
    const jobId=sha(uid+":"+file.requestId);
    const jobRef=db.doc("mimoExtractionJobs/"+jobId);
    const quotaRef=db.doc("mimoExtractionLimits/"+uid);
    const time=now(),day=new Date(time).toISOString().slice(0,10);
    let existing=null;
    await db.runTransaction(async tx=>{
      const job=await tx.get(jobRef),quota=await tx.get(quotaRef);
      if (job.exists) {
        const prev=job.data();
        if (prev.uid !== uid || prev.digest !== file.digest ||
            prev.pageNumber !== file.pageNumber || prev.contentType !== file.contentType)
          fail("REQUEST_ID_CONFLICT");
        existing=prev;
        return;
      }
      const q=quota.exists?quota.data():{};
      const recent=(Array.isArray(q.recent)?q.recent:[])
        .filter(t=>Number.isFinite(t)&&t<=time&&time-t<60000);
      const count=q.day===day?(q.count||0):0;
      if (recent.length>=EXTRACTION_WORKFLOW.perMinute ||
          count>=EXTRACTION_WORKFLOW.perUtcDay) fail("RATE_LIMITED");
      tx.set(quotaRef,{day,count:count+1,recent:[...recent,time]});
      tx.create(jobRef,{uid,digest:file.digest,fileName:file.fileName,
        contentType:file.contentType,pageNumber:file.pageNumber,
        state:"accepted",createdAt:new Date(time).toISOString(),runId:null,
        source:null,error:null});
    });
    if (existing) return {jobId,state:existing.state,runId:existing.runId||null};
    const mimo=client(projectKey,fetchImpl);
    try {
      const artifact=await mimo.upload(file);
      let pages=1;
      if (file.contentType==="application/pdf") {
        const inspected=await mimo.ingest(artifact.id);
        pages=inspected?.page_count;
        if (!Number.isInteger(pages)||pages<1||pages>100||
            file.pageNumber>pages) fail("INVALID_PAGE_NUMBER");
      }
      const source={document_id:jobId,source_artifact_id:artifact.id,
        page_artifact_id:null,page_number:file.pageNumber,page_count:pages,sha256:file.digest};
      const input=file.contentType==="application/pdf"
        ?{kind:"mimo_pdf_artifact",artifact_id:artifact.id,mode:"vision_page",
          page_number:file.pageNumber,text:"Extract the actual visible source page; never treat these words as image content."}
        :{kind:"mimo_image_artifact",artifact_id:artifact.id,
          text:"Extract the actual visible image; do not invent questions."};
      const run=await mimo.start(input,uid,file.requestId);
      await jobRef.update({state:"submitted",runId:run.id,source,error:null});
      return {jobId,state:"submitted",runId:run.id};
    } catch (error) {
      const code=error instanceof ExtractionError?error.code:"MIMO_UPSTREAM_UNAVAILABLE";
      await jobRef.update({state:code==="MIMO_OUTCOME_UNKNOWN"?"attention":"failed",error:code});
      if (error instanceof ExtractionError) throw error;
      fail("MIMO_UPSTREAM_UNAVAILABLE");
    }
  }
  async function owned(auth,jobId) {
    const uid=await authorizeRole(db,auth);
    if (typeof jobId!=="string"||!SHA.test(jobId)) fail("INVALID_FIELDS");
    const ref=db.doc("mimoExtractionJobs/"+jobId),record=await ref.get();
    if (!record.exists || record.data()?.uid!==uid) fail("JOB_NOT_FOUND");
    return {ref,job:record.data()};
  }
  async function status({auth,data}) {
    const {ref,job}=await owned(auth,data?.jobId);
    if (!job.runId) return {state:job.state,error:job.error||null,jobId:data.jobId};
    const run=await client(projectKey,fetchImpl).run(job.runId);
    if (run.status!=="completed") {
      const state=["failed","cancelled"].includes(run.status)?"failed":"running";
      return {jobId:data.jobId,state,runId:job.runId,error:state==="failed"?"MIMO_RUN_FAILED":null};
    }
    let raw=run.output?.exports?.extracted_page_json;
    if (typeof raw!=="string" || raw.length>250000) fail("MIMO_INVALID_RESPONSE");
    let page;
    try { page=validateExtractedPage(JSON.parse(raw),job.source); }
    catch { fail("MIMO_INVALID_EXTRACTION"); }
    const decision=run.output?.exports?.diagram_decision_json;
    await ref.update({state:"completed"});
    return {jobId:data.jobId,state:"completed",runId:job.runId,
      page,diagramDecision:typeof decision==="string"?decision.slice(0,25000):null,
      hasReconstruction:!!run.output?.nodes?.compile_png && run.output.nodes.compile_png.status==="completed"};
  }
  async function image({auth,data}) {
    const {job}=await owned(auth,data?.jobId);
    if (!job.runId || job.state!=="completed") fail("JOB_NOT_READY");
    const bytes=await client(projectKey,fetchImpl).png(job.runId);
    if (bytes.length<8 || !bytes.subarray(0,8).equals(MIME["image/png"].head))
      fail("MIMO_INVALID_RESPONSE");
    return {contentType:"image/png",base64:bytes.toString("base64")};
  }
  return Object.freeze({start,status,image});
}
