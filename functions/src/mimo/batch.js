/**
 * Durable whole-document Mimo orchestration.
 * Parent jobs are owner-scoped Firestore records; each page is a separately
 * validated checkpoint. No provider operation executes inside a transaction.
 * An ambiguous dispatch is NEVER silently replayed.
 */
import {createHash, randomUUID} from "node:crypto";
import {safeMimoRunDiagnostic} from "./run-diagnostics.js";
import {completedPageForReview} from "./completed-page.js";
import {validateExtractedPage,createExtractionReview,decideExtractionQuestion,prepareReviewedExtractionImport} from "../../shared/mimo-extraction.js";
import {
  EXTRACTION_WORKFLOW,ExtractionError,authorizeExtractionRole,
  validateExtractionUpload,createExtractionTransport,
} from "./extraction.js";

const SHA=/^[a-f0-9]{64}$/;
const fail=code=>{throw new ExtractionError(code);};
const hash=value=>createHash("sha256").update(value).digest("hex");
const isObj=x=>x&&typeof x==="object"&&!Array.isArray(x);
const money=x=>typeof x==="number"&&Number.isFinite(x)&&x>=0&&
  Math.abs(x*100-Math.round(x*100))<0.000001;
const states=new Set(["queued","claiming","submitted","completed","attention"]);
const PUBLIC_STAGE_IDS=Object.freeze([
  "processor","extract","verify","rebuild_plan","tikz_source","compile_png","output"
]);
const STAGE_STATUSES=new Set(["queued","pending","running","completed","skipped","failed"]);
export function publicBatchStage(timeline) {
  const rows=[...(Array.isArray(timeline?.node_tasks)?timeline.node_tasks:[]),
    ...(Array.isArray(timeline?.checkpoints)?timeline.checkpoints:[])];
  const states=new Map();
  for(const row of rows){
    if(PUBLIC_STAGE_IDS.includes(row?.node_id)&&
      STAGE_STATUSES.has(row?.status))states.set(row.node_id,row.status);
  }
  // The highest begun stage is more useful than the last arbitrary task row.
  for(let i=PUBLIC_STAGE_IDS.length-1;i>=0;i--){
    const id=PUBLIC_STAGE_IDS[i],status=states.get(id);
    if(status&&status!=="pending"&&status!=="queued")
      return {id,status};
  }
  return {id:"processor",status:"pending"};
}

const pageId=(jobId,n)=>hash(jobId+":"+n);

function validateBatch(data){
  if(!isObj(data)||Object.keys(data).some(k=>![
    "requestId","fileName","contentType","base64","target","pageStart",
    "pageEnd","perPageUsd","totalUsd"
  ].includes(k)))fail("INVALID_FIELDS");
  const target=data.target??"quiz";
  if(!["quiz","bank"].includes(target))fail("INVALID_FIELDS");
  const perPageUsd=data.perPageUsd??0.15, totalUsd=data.totalUsd??15;
  if(!money(perPageUsd)||perPageUsd<0.03||perPageUsd>0.5||
    !money(totalUsd)||totalUsd<perPageUsd||totalUsd>50)
    fail("INVALID_FIELDS");
  const start=data.pageStart??1,end=data.pageEnd??0;
  if(!Number.isInteger(start)||start<1||start>100||
    !Number.isInteger(end)||end<0||end>100||(end!==0&&end<start))
    fail("INVALID_FIELDS");
  const file=validateExtractionUpload({
    requestId:data.requestId,fileName:data.fileName,
    contentType:data.contentType,base64:data.base64,pageNumber:1,
  });
  if(file.contentType!=="application/pdf"&&(start!==1||![0,1].includes(end)))
    fail("INVALID_FIELDS");
  return {...file,target,start,end,perPageUsd,totalUsd};
}

const pageSource=(job,n)=>({
  document_id:job.jobId,source_artifact_id:job.artifactId,
  page_artifact_id:null,page_number:n,page_count:job.documentPages,
  sha256:job.digest,
});
const sourceInput=(job,n)=>job.contentType==="application/pdf"
  ?{kind:"mimo_pdf_artifact",artifact_id:job.artifactId,mode:"vision_page",
    page_number:n,text:"Extract only the visible PDF page. Retain printed question numbers and all diagram descriptions."}
  :{kind:"mimo_image_artifact",artifact_id:job.artifactId,
    text:"Extract only the visible image; do not invent problems."};

export function createBatchService({
  db,projectKey,fetchImpl=globalThis.fetch,now=()=>Date.now(),
}={}){
  if(!db?.doc||!db?.runTransaction||!db?.collection)
    throw Error("Firestore database required");
  const transport=()=>createExtractionTransport(projectKey,fetchImpl);
  const parentRef=id=>db.doc("mimoBatchJobs/"+id);
  const recordRef=(id,n)=>db.doc("mimoBatchPages/"+pageId(id,n));
  const time=()=>new Date(now()).toISOString();

  async function start({auth,data}){
    const uid=await authorizeExtractionRole(db,auth);
    const file=validateBatch(data);
    const jobId=hash(uid+":"+file.requestId);
    const ref=parentRef(jobId),quota=db.doc("mimoBatchLimits/"+uid);
    const timestamp=now(),day=new Date(timestamp).toISOString().slice(0,10);
    let existing=null;
    await db.runTransaction(async tx=>{
      const job=await tx.get(ref),limits=await tx.get(quota);
      if(job.exists){
        existing=job.data();
        if(existing.uid!==uid||existing.digest!==file.digest||
           existing.target!==file.target||
           existing.perPageUsd!==file.perPageUsd||
           existing.totalUsd!==file.totalUsd||
           existing.pageStart!==file.start||existing.pageEndRequested!==file.end)
          fail("REQUEST_ID_CONFLICT");
        return;
      }
      const previous=limits.exists?limits.data():{};
      const recent=(Array.isArray(previous.recent)?previous.recent:[])
        .filter(n=>Number.isFinite(n)&&timestamp-n<60000&&n<=timestamp);
      const count=previous.day===day?previous.count||0:0;
      if(recent.length>=2||count>=5)fail("RATE_LIMITED");
      tx.set(quota,{day,count:count+1,recent:[...recent,timestamp]});
      tx.create(ref,{
        jobId,uid,requestId:file.requestId,digest:file.digest,
        fileName:file.fileName,contentType:file.contentType,
        target:file.target,perPageUsd:file.perPageUsd,totalUsd:file.totalUsd,
        reservedUsd:0,pageStart:file.start,pageEndRequested:file.end,
        createdAt:new Date(timestamp).toISOString(),updatedAt:time(),
        state:"accepted",error:null,artifactId:null,documentPages:0,pages:[],
        needsAttentionPolling:false,
      });
    });
    if(existing)return summarize(existing);
    // Upload the source exactly once. If the response is uncertain we halt
    // instead of repeating a potentially billable operation.
    const mimo=transport();
    try{
      const artifact=await mimo.upload(file);
      const ingest=file.contentType==="application/pdf"
        ?await mimo.ingest(artifact.id):{page_count:1};
      const total=ingest?.page_count;
      if(!Number.isInteger(total)||total<1||total>100)fail("INVALID_PAGE_NUMBER");
      const upper=file.end===0?total:file.end;
      if(upper>total)fail("INVALID_PAGE_NUMBER");
      const pages=Array.from({length:upper-file.start+1},(_,i)=>({
        number:file.start+i,state:"queued",runId:null,claimId:null,
        claimedAt:null,stage:"queued",stageStatus:"queued",questionCount:0,figureCount:0,hasReconstruction:false,
        error:null,
      }));
      if(pages.length>100)fail("INVALID_FIELDS");
      await ref.update({
        artifactId:artifact.id,documentPages:total,pages,
        state:"running",needsAttentionPolling:false,error:null,updatedAt:time(),
      });
      return {jobId,state:"running",pageCount:pages.length,documentPages:total,
        target:file.target,totalUsd:file.totalUsd,perPageUsd:file.perPageUsd};
    }catch(error){
      const code=error?.code||"MIMO_UPSTREAM_UNAVAILABLE";
      await ref.update({state:code==="MIMO_OUTCOME_UNKNOWN"?"attention":"failed",
        error:code,updatedAt:time()});
      if(error instanceof ExtractionError)throw error;
      fail("MIMO_UPSTREAM_UNAVAILABLE");
    }
  }

  async function owned(auth,id){
    const uid=await authorizeExtractionRole(db,auth);
    if(typeof id!=="string"||!SHA.test(id))fail("INVALID_FIELDS");
    const ref=parentRef(id),snap=await ref.get();
    if(!snap.exists||snap.data()?.uid!==uid)fail("JOB_NOT_FOUND");
    return {ref,job:snap.data()};
  }
  function summarize(job){
    return {
      jobId:job.jobId,state:job.state,error:job.error||null,
      fileName:job.fileName,target:job.target,
      createdAt:job.createdAt,updatedAt:job.updatedAt,
      documentPages:job.documentPages||0,pageCount:job.pages?.length||0,
      completed:(job.pages||[]).filter(x=>x.state==="completed").length,
      attention:(job.pages||[]).filter(x=>x.state==="attention").length,
      reservedUsd:job.reservedUsd||0,totalUsd:job.totalUsd,
      perPageUsd:job.perPageUsd,
      pages:(job.pages||[]).map(p=>({
        number:p.number,state:p.state,runId:p.runId||null,
        questionCount:p.questionCount||0,figureCount:p.figureCount||0,
        hasReconstruction:p.hasReconstruction===true,
        recoveredFromCheckpoint:p.recoveredFromCheckpoint===true,
        verificationUnusable:p.verificationUnusable===true,
        error:p.error||null,
        stage:p.stage||"queued",stageStatus:p.stageStatus||"pending",
        retryAt:typeof p.retryAt==="string"&&p.retryAt.length<=35&&Number.isFinite(Date.parse(p.retryAt))?p.retryAt:null,
        retryCount:Number.isInteger(p.retryCount)&&p.retryCount>=0&&p.retryCount<=100?p.retryCount:0,
        ...(p.diagnosticCode?{diagnosticCode:p.diagnosticCode,
          ...(p.diagnosticHttpStatus?{diagnosticHttpStatus:p.diagnosticHttpStatus}:{})}:{}),
      })),
    };
  }
  async function list({auth,data}){
    const uid=await authorizeExtractionRole(db,auth);
    if(data&&(!isObj(data)||Object.keys(data).some(k=>k!=="limit")))
      fail("INVALID_FIELDS");
    const limit=data?.limit??20;
    if(!Number.isInteger(limit)||limit<1||limit>30)fail("INVALID_FIELDS");
    const found=await db.collection("mimoBatchJobs")
      .where("uid","==",uid).limit(30).get();
    return {jobs:found.docs.map(x=>summarize(x.data()))
      .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0,limit).map(({pages,...rest})=>rest)};
  }
  async function status({auth,data}){
    if(!isObj(data)||Object.keys(data).some(k=>k!=="jobId"))fail("INVALID_FIELDS");
    const {job}=await owned(auth,data.jobId);
    if(job.state==="accepted"&&now()-Date.parse(job.createdAt)>180000)
      return {...summarize(job),state:"attention",error:"MIMO_OUTCOME_UNKNOWN"};
    return summarize(job);
  }
  async function getPage({auth,data}){
    if(!isObj(data)||Object.keys(data).some(k=>!["jobId","pageNumber"].includes(k)))
      fail("INVALID_FIELDS");
    const {job}=await owned(auth,data.jobId);
    const n=data.pageNumber;
    if(!Number.isInteger(n)||!job.pages?.some(p=>p.number===n&&p.state==="completed"))
      fail("JOB_NOT_READY");
    const snap=await recordRef(job.jobId,n).get();
    if(!snap.exists||snap.data().uid!==job.uid)fail("JOB_NOT_READY");
    return {jobId:job.jobId,pageNumber:n,
      page:snap.data().page,review:snap.data().review||null,
      reviewVersion:snap.data().reviewVersion||0,
      hasReconstruction:job.pages.find(p=>p.number===n).hasReconstruction===true,
      recoveredFromCheckpoint:job.pages.find(p=>p.number===n).recoveredFromCheckpoint===true,
      verificationUnusable:job.pages.find(p=>p.number===n).verificationUnusable===true};
  }
  async function image({auth,data}){
    if(!isObj(data)||Object.keys(data).some(k=>!["jobId","pageNumber"].includes(k)))
      fail("INVALID_FIELDS");
    const {job}=await owned(auth,data.jobId);
    const p=job.pages?.find(p=>p.number===data.pageNumber);
    if(!p||p.state!=="completed"||!p.hasReconstruction||!p.runId)
      fail("JOB_NOT_READY");
    const bytes=await transport().png(p.runId);
    if(bytes.length>4*1024*1024||!bytes.subarray(0,8)
      .equals(Buffer.from([137,80,78,71,13,10,26,10])))fail("MIMO_INVALID_RESPONSE");
    return {contentType:"image/png",base64:bytes.toString("base64")};
  }


  async function reviewPage({auth,data}){
    if(!isObj(data)||Object.keys(data).some(k=>![
      "jobId","pageNumber","sourceSha256","expectedVersion","decisions"
    ].includes(k)))fail("INVALID_FIELDS");
    const {job}=await owned(auth,data.jobId);
    const n=data.pageNumber,decisions=data.decisions;
    if(job.digest!==data.sourceSha256||!Number.isInteger(n)||
        !Number.isInteger(data.expectedVersion)||data.expectedVersion<0||
        !Array.isArray(decisions)||decisions.length>150||
        !job.pages?.some(p=>p.number===n&&p.state==="completed"))
      fail("INVALID_FIELDS");
    const ref=recordRef(job.jobId,n),snapshot=await ref.get();
    if(!snapshot.exists||snapshot.data().uid!==job.uid)fail("JOB_NOT_READY");
    const extracted=snapshot.data().page;
    let review=createExtractionReview({schema:extracted.schema,
      quality_status:extracted.quality_status,questions:extracted.questions},
      extracted.source);
    if(decisions.length!==review.items.length)fail("INVALID_FIELDS");
    const seen=new Set();
    for(const d of decisions){
      if(!isObj(d)||typeof d.itemId!=="string"||seen.has(d.itemId))
        fail("INVALID_FIELDS");
      seen.add(d.itemId);
      // A generated diagram becomes importable only after explicit teacher
      // review AND an owner-scoped, ready Quizer image asset reference.
      if(d.action==="approve"){
        for(const assetId of Object.values(d.figure_assets||{})){
          if(typeof assetId!=="string"||!/^[a-zA-Z0-9_-]{1,128}$/.test(assetId))
            fail("INVALID_FIELDS");
          const image=await db.doc("assets/"+assetId).get();
          if(!image.exists||image.data()?.ownerId!==job.uid||
            image.data()?.status!=="ready"||image.data()?.kind!=="image")
            fail("INVALID_FIGURE_ASSET");
        }
      }
      review=decideExtractionQuestion(review,d.itemId,{
        action:d.action,edits:d.edits||{},
        figure_assets:d.figure_assets||{},
        verified_against_source:d.verified_against_source===true,
        manual_marking_confirmed:d.manual_marking_confirmed===true,
        reason:d.reason??null,
      },job.uid);
    }
    if(review.items.some(item=>item.decision==="pending"))fail("INVALID_FIELDS");
    const approved=review.items.filter(item=>item.decision==="approve").length;
    if(approved){
      // Source/answer/figure/Quizer schema and TeX parser round trip.
      prepareReviewedExtractionImport(review,{title:"Reviewed page "+n});
    }
    await db.runTransaction(async tx=>{
      const current=await tx.get(ref);
      if(!current.exists||current.data().uid!==job.uid)
        fail("JOB_NOT_READY");
      if((current.data().reviewVersion||0)!==data.expectedVersion)
        fail("REVIEW_VERSION_CONFLICT");
      tx.update(ref,{review,reviewVersion:data.expectedVersion+1,
        reviewedAt:time(),approvedCount:approved});
    });
    return {jobId:job.jobId,pageNumber:n,
      approvedCount:approved,reviewVersion:data.expectedVersion+1};
  }
  async function prepared({auth,data}){
    if(!isObj(data)||Object.keys(data).some(k=>k!=="jobId"))fail("INVALID_FIELDS");
    const {job}=await owned(auth,data.jobId);
    if(job.state!=="ready_review"||!Array.isArray(job.pages)||
      job.pages.some(p=>p.state!=="completed"))fail("JOB_NOT_READY");
    const all=[];
    for(const p of job.pages){
      const snap=await recordRef(job.jobId,p.number).get();
      if(!snap.exists||snap.data().uid!==job.uid)fail("JOB_NOT_READY");
      const review=snap.data().review;
      if(!review||review.items?.some(item=>!["approve","reject"].includes(item.decision)))
        fail("REVIEW_INCOMPLETE");
      if(!review.items.some(item=>item.decision==="approve"))continue;
      const verified=prepareReviewedExtractionImport(review,{title:"Reviewed page "+p.number});
      all.push(...verified.items);
      if(all.length>500)fail("MIMO_INVALID_EXTRACTION");
    }
    if(!all.length)fail("REVIEW_INCOMPLETE");
    const title="Reviewed mathematics extraction";
    const latex="\\quiztitle{"+title+"}\n"+
      all.map(item=>item.tex).join("\n\n")+"\n";
    if(Buffer.byteLength(latex,"utf8")>750000)fail("MIMO_INVALID_EXTRACTION");
    return {schema:"quizer.reviewed_import.v1",sourceJobId:job.jobId,
      title,items:all,latex,required_assets:[...new Set(all.flatMap(item=>
        Object.keys(item.content.questionAssetBindings||{})))].sort(),
      automatically_saved:false,published:false};
  }

  // Vision PDF pages send image + text to a shared model credential.
  // Keep at most one page per document in flight until actual provider TPM
  // admission is available. This avoids a 3-page burst; it is NOT a global
  // per-model token limiter and does not guarantee provider acceptance.
  const MAX_ACTIVE_PAGES_PER_DOCUMENT=1;

  // Worker-only: not callable by the browser. Claims are transactionally fenced.
  async function claim(jobId){
    let selected=null;
    const ref=parentRef(jobId);
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists||snap.data().state!=="running")return;
      const job=snap.data(),pages=job.pages||[];
      const active=pages.filter(p=>["submitted","claiming"].includes(p.state)).length;
      if(active>=MAX_ACTIVE_PAGES_PER_DOCUMENT)return;
      const next=pages.findIndex(p=>p.state==="queued");
      if(next<0)return;
      // Reserve worst-case costs before starting; never count a failed run as free.
      const newReserved=Math.round((job.reservedUsd+job.perPageUsd)*100)/100;
      if(newReserved>job.totalUsd+0.0000001){
        tx.update(ref,{state:"budget_exhausted",
          needsAttentionPolling:pages.some(p=>p.state==="submitted"),updatedAt:time()});return;
      }
      const page={...pages[next],state:"claiming",
        claimId:randomUUID(),claimedAt:time()};
      const changed=pages.slice();changed[next]=page;
      tx.update(ref,{pages:changed,reservedUsd:newReserved,updatedAt:time()});
      selected={job:{...job,pages:changed},page};
    });
    return selected;
  }
  async function mark(jobId,pageNumber,from,patch,jobPatch={}){
    const ref=parentRef(jobId);
    let updated=false;
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists)return;
      const job=snap.data(),pages=job.pages||[];
      const at=pages.findIndex(p=>p.number===pageNumber);
      if(at<0||pages[at].state!==from.state||
        (from.claimId&&pages[at].claimId!==from.claimId)||
        (from.runId&&pages[at].runId!==from.runId))return;
      const changed=pages.slice();changed[at]={...pages[at],...patch};
      const hasAttention=changed.some(p=>p.state==="attention");
      const complete=changed.every(p=>p.state==="completed");
      // Budget exhaustion/attention stops NEW paid calls, but must not
      // conceal in-flight submissions or their independently saved results.
      const nextState=job.state==="budget_exhausted"?"budget_exhausted":
        hasAttention?"attention":complete?"ready_review":"running";
      tx.update(ref,{pages:changed,state:nextState,
        needsAttentionPolling:nextState!=="running"&&changed.some(p=>p.state==="submitted"),
        updatedAt:time(),...jobPatch});
      updated=true;
    });
    return updated;
  }
  async function dispatch(jobId,selection){
    const {job,page}=selection;
    try{
      const mimo=transport();
      const run=await mimo.start(sourceInput(job,page.number),
        job.uid, "batch_"+hash(jobId+":"+page.number).slice(0,48),job.perPageUsd);
      await mark(jobId,page.number,{state:"claiming",claimId:page.claimId},
        {state:"submitted",runId:run.id,stage:"processor",stageStatus:"queued",error:null});
    }catch(error){
      // Important: even a timeout could have submitted a paid run.
      await mark(jobId,page.number,{state:"claiming",claimId:page.claimId},
        {state:"attention",error:error?.code||"MIMO_OUTCOME_UNKNOWN"});
    }
  }
  async function poll(job,p,fromState="submitted"){
    try{
      const mimo=transport(),run=await mimo.run(p.runId);
      if(run.status==="completed"){
        let page,recoveredFromCheckpoint,verificationUnusable;
        try{
          ({page,recoveredFromCheckpoint,verificationUnusable}=completedPageForReview(
            run,pageSource(job,p.number)));
        }catch{fail("MIMO_INVALID_EXTRACTION");}
        const hasReconstruction=run.output?.nodes?.compile_png?.status==="completed";
        await recordRef(job.jobId,p.number).set({
          uid:job.uid,jobId:job.jobId,pageNumber:p.number,page,
          review:null,completedAt:time(),recoveredFromCheckpoint,
          verificationUnusable,
        },{merge:true});
        await mark(job.jobId,p.number,{state:fromState,runId:p.runId},{
          state:"completed",questionCount:page.questions.length,
          figureCount:page.questions.filter(q=>q.has_figure).length,
          hasReconstruction,recoveredFromCheckpoint,verificationUnusable,
          stage:"output",stageStatus:"completed",retryAt:null,error:null,
        });
      }else if(["failed","cancelled","dispatch_failed","waiting_for_review"].includes(run.status)){
        await mark(job.jobId,p.number,{state:fromState,runId:p.runId},
          {state:"attention",stageStatus:"failed",retryAt:null,
            error:"MIMO_RUN_"+run.status.toUpperCase(),
            ...safeMimoRunDiagnostic(run.output)});
      }
      if(["running","queued"].includes(run.status)){
        // A previously uncertain run with an already-known ID can be
        // reattached to normal polling: no additional /runs POST is needed.
        const reattached=fromState==="attention";
        const patch=reattached?{state:"submitted",error:null}:{};
        const retryAt=run.status==="queued"&&typeof run.next_attempt_at==="string"&&
          Number.isFinite(Date.parse(run.next_attempt_at))&&
          Date.parse(run.next_attempt_at)>now()
          ?run.next_attempt_at:null;
        const retryCount=Number.isInteger(run.rate_limit_deferrals)?
          Math.min(100,Math.max(0,run.rate_limit_deferrals)):0;
        if(retryAt!==p.retryAt||retryCount!==(p.retryCount||0)){
          patch.retryAt=retryAt;patch.retryCount=retryCount;
          if(retryAt){patch.stage="processor";patch.stageStatus="pending";}
        }
        // A paused provider call should not trigger a supplemental timeline GET.
        if(retryAt){
          if(reattached||Object.keys(patch).length)
            await mark(job.jobId,p.number,{state:fromState,runId:p.runId},patch);
          return;
        }
        try{
          const {id,status}=publicBatchStage(await mimo.timeline(p.runId));
          if(id!==p.stage||status!==p.stageStatus){
            patch.stage=id;patch.stageStatus=status;
          }
        }catch{ /* Timeline is supplemental; run status is authoritative. */ }
        if(reattached||Object.keys(patch).length)
          await mark(job.jobId,p.number,{state:fromState,runId:p.runId},patch);
      }
      // A running Mimo job is simply polled at the next scheduled tick.
    }catch(error){
      if(error?.code==="MIMO_RATE_LIMITED"||error?.code==="MIMO_UPSTREAM_UNAVAILABLE")
        return;
      await mark(job.jobId,p.number,{state:fromState,runId:p.runId},
        {state:"attention",error:error?.code||"MIMO_OUTCOME_UNKNOWN"});
    }
  }
  // Owner-invoked recovery of durable, known run IDs. There are NO artifact
  // uploads or /runs POST calls here. A failed run remains failed; an
  // indeterminate dispatch with no runId is intentionally not replayed.
  async function reconcile({auth,data}){
    if(!isObj(data)||Object.keys(data).some(k=>k!=="jobId"))
      fail("INVALID_FIELDS");
    const {job}=await owned(auth,data.jobId);
    const known=(job.pages||[]).filter(p=>
      p.state==="attention"&&typeof p.runId==="string"&&p.runId.length>0);
    // A bounded number of status GETs avoids an untrusted client demanding
    // unbounded polling. All remaining pages can be checked in later calls.
    for(const page of known.slice(0,10))
      await poll(job,page,"attention");
    const current=await parentRef(job.jobId).get();
    if(!current.exists||current.data()?.uid!==job.uid)fail("JOB_NOT_FOUND");
    return {...summarize(current.data()),checkedExistingRuns:Math.min(known.length,10),
      neverStartedNewRuns:true};
  }

  async function sweep(max=6){
    if(!Number.isInteger(max)||max<1||max>10)throw Error("Invalid sweep size");
    // Old attention/budget-exhausted jobs must never occupy the runnable
    // dispatch slots. updatedAt rotates equally old jobs fairly.
    // Requires Firestore composites (state,updatedAt) and
    // (needsAttentionPolling,updatedAt), installed BEFORE this function.
    const runnable=await db.collection("mimoBatchJobs")
      .where("state","==","running").orderBy("updatedAt","asc").limit(max).get();
    const unfinished=await db.collection("mimoBatchJobs")
      .where("needsAttentionPolling","==",true)
      .orderBy("updatedAt","asc").limit(Math.min(2,max)).get();
    const jobs=new Map();
    for(const doc of [...runnable.docs,...unfinished.docs])jobs.set(doc.id,doc);
    let visited=0;
    for(const doc of jobs.values()){
      const job=doc.data();visited++;
      const stale=(job.pages||[]).find(p=>p.state==="claiming"&&
        now()-Date.parse(p.claimedAt)>180000);
      if(stale){
        await mark(job.jobId,stale.number,{state:"claiming",claimId:stale.claimId},
          {state:"attention",error:"MIMO_OUTCOME_UNKNOWN"});
        continue;
      }
      // Poll active *known* run IDs even when other pages require attention.
      for(const page of (job.pages||[]).filter(p=>p.state==="submitted")
        .slice(0,MAX_ACTIVE_PAGES_PER_DOCUMENT))await poll(job,page);
      // Do not dispatch new paid work for paused or attention-required jobs.
      if(job.state==="running"){
        const claims=[];
        for(let n=0;n<MAX_ACTIVE_PAGES_PER_DOCUMENT;n++){
          const selection=await claim(job.jobId);
          if(!selection)break;
          claims.push(selection);
        }
        // Every claim reserves budget transactionally before any provider call.
        await Promise.all(claims.map(selection=>dispatch(job.jobId,selection)));
      }
      // The sweep heartbeat rotates idle running/attention jobs; without it
      // a long-lived provider wait can starve newer jobs behind limit(max).
      await parentRef(job.jobId).update({updatedAt:time()});
    }
    return {visited};
  }
  return Object.freeze({start,list,status,getPage,image,reviewPage,prepared,reconcile,sweep});
}
