import {initFirebase,getSession,watchSession} from "../firebase-client.js";
import {mountShell} from "../components/shell.js";
import {renderChatMarkdown} from "../components/ai-chat-markdown.js";
import {typeset} from "../components/math-content.js";
import {sendTeacherChatMessage,teacherChatHistory,canUseMimoTeacherChat,
  mimoChatErrorMessage} from "../services/mimo-chat.js";
import {submitMimoExtraction,readMimoExtraction,readMimoPng,listMimoExtractions,
  submitMimoBatch,listMimoBatches,readMimoBatch,readMimoBatchPage,
  readMimoBatchImage,saveMimoBatchReview,readMimoBatchPrepared,
  buildTeacherReview,decideTeacherReview,exportTeacherReview,
  extractionError,decodeMimoPng} from "../services/mimo-extraction.js";
import {importApprovedExtraction} from "../services/ai-reviewed-import.js";
import {uploadAsset} from "../services/assets.js";
import {snipPageContent} from "../components/page-snip.js";

const $=id=>document.getElementById(id);
const app=$("app"),gate=$("ai-access");
let threads=[],threadId=null,messages=[],jobs=[],selectedJob=null,review=null,hasOlder=false;
let busyChat=false,busyJob=false,imageContext="",pendingImageQuestion="";
const originalSources=new Map();
const batchReviews=new Map();
let transientUrls=[];
const listen=(id,kind,fn)=>$(id).addEventListener(kind,fn);
const node=(tag,text="",className="")=>{
  const el=document.createElement(tag);if(className)el.className=className;
  if(text!==undefined)el.textContent=String(text);return el;
};
const humanTime=t=>{const d=new Date(t);return Number.isFinite(d.getTime())
  ?d.toLocaleString(): "Time unavailable";};
function status(text,error=false){
  const el=$("ai-status");el.textContent=text;el.className=error?"ai-error":"ai-muted";
}
function safeError(err){
  const reason=String(err?.details?.reason||"");
  if(reason.startsWith("MIMO_")||reason==="RATE_LIMITED")
    return mimoChatErrorMessage(err);
  return String(err?.message||"Action failed").slice(0,250);
}
function activeTab(tab){
  const chat=tab==="chat";
  $("ai-chat-panel").hidden=!chat;$("ai-jobs-panel").hidden=chat;
  $("ai-tab-chat").setAttribute("aria-selected",String(chat));
  $("ai-tab-jobs").setAttribute("aria-selected",String(!chat));
}
function drawThreads(){
  const container=$("ai-threads"),needle=$("ai-chat-search").value.toLowerCase();
  container.replaceChildren();
  for(const entry of threads.filter(x=>String(x.title||"").toLowerCase().includes(needle))){
    const b=node("button",entry.title||"New chat");
    b.type="button";b.setAttribute("aria-current",String(entry.id===threadId));
    const small=node("small",humanTime(entry.updatedAt||entry.createdAt));
    b.append(small);b.onclick=()=>void openThread(entry.id);container.append(b);
  }
  if(!container.childElementCount)container.append(node("p","No matching conversations.","ai-muted"));
}
function drawMessages(){
  $("ai-load-older").hidden=!hasOlder;
  const target=$("ai-messages");target.replaceChildren();
  if(!messages.length)target.append(node("p",
    "Ask a question or open a saved conversation. Your replies are stored in your private chat history.",
    "ai-muted"));
  for(const m of messages){
    const box=node("article","","ai-msg");box.dataset.role=m.role;
    box.append(node("strong",m.role==="assistant"?"Mimo assistant":"You"));
    const body=node("div");
    if(m.role==="assistant"){renderChatMarkdown(body,m.content||"");}
    else body.textContent=m.content||"";
    box.append(body);target.append(box);
    if(m.role==="assistant")void typeset(body);
  }
  target.scrollTop=target.scrollHeight;
}
async function loadThreads(){
  const result=await teacherChatHistory("chat.list",{limit:100});
  threads=Array.isArray(result?.threads)?result.threads:[];
  drawThreads();
}
async function openThread(id){
  const data=await teacherChatHistory("chat.get",{threadId:id});
  threadId=id;messages=Array.isArray(data?.messages)?data.messages:[];
  hasOlder=data?.hasMore===true;
  history.replaceState(null,"","ai.html?thread="+encodeURIComponent(id));
  activeTab("chat");drawThreads();drawMessages();
}
async function loadOlder(){
  if(!threadId||!hasOlder||!messages[0]?.id)return;
  $("ai-load-older").disabled=true;
  const selected=threadId,earliest=messages[0].id;
  try{
    const result=await teacherChatHistory("chat.get",{threadId:selected,before:earliest});
    if(threadId!==selected)return;
    const older=Array.isArray(result?.messages)?result.messages:[];
    const seen=new Set(messages.map(m=>m.id));
    messages=[...older.filter(m=>!seen.has(m.id)),...messages];
    hasOlder=result?.hasMore===true;
    drawMessages();
  }catch(e){status(safeError(e),true);}
  finally{$("ai-load-older").disabled=false;}
}
function newThread(){
  threadId=null;messages=[];hasOlder=false;imageContext="";
  history.replaceState(null,"","ai.html");
  drawThreads();drawMessages();$("ai-prompt").value="";activeTab("chat");
  $("ai-prompt").focus();
}
async function sendText(message,context=""){
  if(busyChat||!message.trim())return;
  busyChat=true;$("ai-send").disabled=true;
  const snapshot=messages.slice();
  messages.push({role:"user",content:message});
  drawMessages();status("Sending your message to Mimo…");
  try {
    const answer=await sendTeacherChatMessage({
      message,context,threadId,requestId:crypto.randomUUID(),
      history:snapshot.filter(m=>["user","assistant"].includes(m.role))
        .slice(-8).map(m=>({role:m.role,content:String(m.content||"").slice(0,1200)})),
    });
    messages.push({role:"assistant",content:answer.reply});
    threadId=answer.threadId||threadId;
    drawMessages();
    if(answer.saved&&threadId){
      history.replaceState(null,"","ai.html?thread="+encodeURIComponent(threadId));
      await loadThreads();
    } else status("Reply received, but history could not be saved. Copy the answer before closing.",true);
    $("ai-prompt").value="";
    return true;
  }catch(error){messages=snapshot;drawMessages();status(safeError(error),true);
    return false;}
  finally{busyChat=false;$("ai-send").disabled=false;}
}
async function chatSubmit(event){
  event.preventDefault();
  if(busyChat)return;
  const prompt=$("ai-prompt").value.trim(),file=$("ai-chat-photo").files?.[0];
  if(file){
    if(!["image/png","image/jpeg"].includes(file.type)){status("Select a PNG or JPEG image.",true);return;}
    if(!confirm("Send this photo to Mimo for private mathematics extraction?"))return;
    pendingImageQuestion=prompt||"Explain the mathematics in this photo.";
    try {
      const result=await submitMimoExtraction(file,1,{target:"chat",costLimitUsd:0.15});
      originalSources.set(result.jobId,file);
      $("ai-chat-photo").value="";
      status("Photo accepted as background vision job. Select it after completion to discuss the extracted mathematics.");
      await loadJobs();await selectJob(result.jobId);
      activeTab("jobs");
    }catch(error){status(extractionError(error),true);}
    return;
  }
  const confirmed=await sendText(prompt,imageContext);
  if(confirmed)imageContext="";
}
function drawJobs(){
  const target=$("ai-job-list");target.replaceChildren();
  for(const job of jobs){
    const b=node("button",job.fileName||job.jobId);
    b.type="button";b.setAttribute("aria-current",String(job.jobId===selectedJob));
    b.append(node("small",(job.kind==="batch"?"Document · ":"Page · ")+
      (job.state||"queued")+" · "+humanTime(job.createdAt)));
    b.onclick=()=>void selectJob(job.jobId);
    target.append(b);
  }
  if(!jobs.length)target.append(node("p","No saved extraction jobs yet.","ai-muted"));
}
async function loadJobs(){
  const [single,batches]=await Promise.all([listMimoExtractions(),listMimoBatches()]);
  jobs=[
    ...(Array.isArray(single?.jobs)?single.jobs.map(x=>({...x,kind:"single"})):[]),
    ...(Array.isArray(batches?.jobs)?batches.jobs.map(x=>({...x,kind:"batch"})):[]),
  ].sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  drawJobs();
}
function addStage(container,title,complete){
  const li=node("li",title);if(complete)li.prepend(node("span","✓ "));
  container.append(li);
}
function drawStages(result){
  const card=node("div","","ai-status");
  card.append(node("strong","Job status: "+result.state));
  const ol=node("ol");
  const state=result.state;
  addStage(ol,"Source file accepted",true);
  addStage(ol,"Mimo workflow dispatched",!!result.runId);
  for(const task of (Array.isArray(result.stages)?result.stages:[])){
    const item=node("li",task.label+" — "+task.status);
    if(task.status==="completed"||task.status==="skipped")item.prepend(node("span","✓ "));
    ol.append(item);
  }
  if(state==="completed")addStage(ol,"Ready for teacher review",true);
  else addStage(ol,"Teacher review and import",false);
  card.append(ol);
  if(state==="running"||state==="submitted")
    card.append(node("p","The Mimo workflow is processing. Detailed step progress is not exposed by this bridge; no percentage or ETA is fabricated.","ai-muted"));
  if(result.error)card.append(node("p","Attention: "+result.error,"ai-error"));
  return card;
}
async function verifySource(file,page){
  if(!file||!page?.source?.sha256)return false;
  const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
  const hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  return hex===page.source.sha256;
}
function field(parent,label,initial,tag="textarea"){
  const wrap=node("label",label);
  const el=node(tag);
  el.value=String(initial??"");
  if(tag==="textarea"){el.rows=3;el.spellcheck=false;}
  wrap.append(el);parent.append(wrap);return el;
}
function reviewUI(container,result,sourceVerified,{batchJobId=null,reviewVersion=0}={}){
  if(!review||!result.page)return;
  const head=node("section","","ai-review");
  head.append(node("h2","Teacher review · "+review.items.length+" questions"));
  head.append(node("p","Inspect the original file, correct LaTeX/answers, then approve or reject EVERY question. Figure problems need verified Quizer-owned PNG assets.","ai-muted"));
  if(!sourceVerified){
    head.append(node("p","Re-select the exact original source below to enable review. Its SHA-256 must match this job.","ai-alert"));
    const source=node("input");source.type="file";source.accept=".pdf,.png,.jpg,.jpeg";
    source.onchange=async()=>{
      const file=source.files?.[0];
      if(!file)return;
      if(await verifySource(file,result.page)){
        originalSources.set(result.jobId,file);status("Original source verified.");
        if(batchJobId)await openBatchPage(batchJobId,result.page.source.page_number);
        else await selectJob(result.jobId);
      }else status("File checksum does not match this extraction job.",true);
    };
    head.append(source);
  }
  for(const item of review.items){
    const q=item.review?.edited||item.original;
    const card=node("div","","ai-review-card");
    card.append(node("h3","Question "+item.original.printed_number+
      " · "+item.decision));
    if(q.review_required)card.append(node("p","Review flags: "+(q.review_reasons||[]).join("; "),"ai-muted"));
    const statement=field(card,"Statement LaTeX",q.statement_latex);
    const options=q.question_type==="multiple_choice"?
      field(card,"Options JSON (labels and LaTeX)",JSON.stringify(q.options,null,2)):null;
    const answer=field(card,"Verified answer (blank for manual marking)",q.answer??"","input");
    const figure=q.has_figure?field(card,"Figure description",q.figure_description??""):null;
    const assets=q.has_figure?field(card,"Figure bindings JSON, e.g. {\"figure.png\":\"ast_...\"}",
      JSON.stringify(item.review?.figure_assets||{})):null;
    if(q.has_figure)card.append(node("p",
      "Save the reconstructed image using the button below, then add its asset ID and \\includegraphics{figure.png} in the statement.","ai-muted"));
    const inspected=node("input");inspected.type="checkbox";inspected.disabled=!sourceVerified;
    const inspectedLabel=node("label"," I checked this question against the original page");
    inspectedLabel.prepend(inspected);card.append(inspectedLabel);
    const manual=node("input");manual.type="checkbox";manual.disabled=!sourceVerified;
    const manualLabel=node("label"," Teacher will mark this open-ended answer manually");
    manualLabel.prepend(manual);card.append(manualLabel);
    const actions=node("div","","ai-buttons");
    for(const action of ["approve","reject"]){
      const button=node("button",action==="approve"?"Approve":"Reject","ai-secondary");
      button.type="button";button.disabled=!sourceVerified;
      button.onclick=()=>{
        try{
          const edited={statement_latex:statement.value,answer:answer.value.trim()||null,
            ...(options?{options:JSON.parse(options.value)}:{}),
            ...(figure?{figure_description:figure.value.trim()||null}:{})};
          const decision={action,edits:edited,
            figure_assets:assets?JSON.parse(assets.value||"{}"):{},
            verified_against_source:inspected.checked,
            manual_marking_confirmed:manual.checked,
            reason:action==="reject"?"Teacher rejected during review":null};
          review=decideTeacherReview(review,item.id,decision,getSession().user.uid);
          status("Question "+item.original.printed_number+" "+action+"d.");
          card.querySelector("h3").textContent="Question "+item.original.printed_number+" · "+action;
        }catch(e){status(String(e.message||"Invalid review"),true);}
      };
      actions.append(button);
    }
    card.append(actions);head.append(card);
  }
  const importButtons=node("div","","ai-buttons");
  const title=field(head,"Private draft / import name","Reviewed mathematics page "+result.page.source.page_number,"input");
  if(batchJobId){
    const persist=node("button","Save this page's reviewed decisions","ai-primary");
    persist.type="button";persist.disabled=!sourceVerified;
    persist.onclick=async()=>{
      persist.disabled=true;
      try{
        if(review.items.some(item=>item.decision==="pending"))
          throw Error("Approve or reject every question before saving this page.");
        const decisions=review.items.map(item=>({
          itemId:item.id,action:item.decision,
          edits:{
            statement_latex:item.review.edited.statement_latex,
            options:item.review.edited.options,
            answer:item.review.edited.answer,
            figure_description:item.review.edited.figure_description,
          },
          figure_assets:item.review.figure_assets,
          verified_against_source:item.review.verified_against_source,
          manual_marking_confirmed:item.review.manual_marking_confirmed,
          reason:item.review.reason,
        }));
        const saved=await saveMimoBatchReview(batchJobId,
          result.page.source.page_number,result.page.source.sha256,
          reviewVersion,decisions);
        status("Saved "+saved.approvedCount+" approved questions for page "+
          saved.pageNumber+". Continue with other pages, then import the document.");
        await selectJob(batchJobId);
      }catch(e){status(safeError(e),true);persist.disabled=false;}
    };
    importButtons.append(persist);
    head.append(importButtons);container.append(head);return;
  }
  for(const target of ["quiz","bank"]){
    const button=node("button",target==="quiz"?"Import approved to private quiz":"Import approved to Problem Bank","ai-primary");
    button.type="button";button.disabled=!sourceVerified;
    button.onclick=async()=>{
      if(!confirm("Import only the teacher-approved questions into your private "+(target==="quiz"?"quiz draft":"problem bank")+"?"))return;
      button.disabled=true;
      try{
        const prepared=exportTeacherReview(review,title.value);
        const saved=await importApprovedExtraction(prepared,{
          title:title.value,sourceJobId:result.jobId,target,
          onProgress:progress=>status(progress),
        });
        if(target==="quiz"&&saved.quizId)location.assign("upload.html?id="+encodeURIComponent(saved.quizId));
        else location.assign("problems.html");
      }catch(e){status(String(e.message||"Import failed").slice(0,250),true);}
      finally{button.disabled=false;}
    };
    importButtons.append(button);
  }
  head.append(importButtons);container.append(head);
}
async function selectJob(id){
  selectedJob=id;drawJobs();activeTab("jobs");
  const target=$("ai-job-result");target.replaceChildren(node("p","Fetching actual job status…","ai-muted"));
  try{
    const result=await readMimoExtraction(id);
    if(id!==selectedJob)return;
    result.jobId=id;
    target.replaceChildren(drawStages(result));
    if(result.state==="completed"&&result.page){
      const verified=await verifySource(originalSources.get(id),result.page);
      if(!review||review.source?.document_id!==result.page.source.document_id)
        review=buildTeacherReview(result.page);
      if(result.hasReconstruction){
        const load=node("button","Open TikZ-generated PNG","ai-secondary");load.type="button";
        load.onclick=async()=>{
          load.disabled=true;
          try{
            const blob=decodeMimoPng(await readMimoPng(id));
            const url=URL.createObjectURL(blob);transientUrls.push(url);
            const img=node("img");img.src=url;img.alt="Generated TikZ diagram; teacher must verify against original";
            img.style.maxWidth="min(100%,480px)";
            target.append(img);
            const save=node("button","Save verified PNG as private Quizer asset","ai-secondary");
            save.onclick=async()=>{
              save.disabled=true;
              try{
                const assetId=await uploadAsset(new File([blob],"mimo-figure.png",{type:"image/png"}),()=>{},"image");
                status("Saved asset ID: "+assetId+" — associate it with the correct question before approval.");
              }catch(e){status(e.message,true);}finally{save.disabled=false;}
            };
            target.append(save);
          }catch(e){status(extractionError(e),true);}
          finally{load.disabled=false;}
        };target.append(load);
      }
      if(result.page.questions?.length)reviewUI(target,result,verified);
      if(result.jobId&&jobs.find(x=>x.jobId===id)?.target==="chat"){
        const use=node("button","Discuss extracted mathematics in Assistant","ai-primary");
        use.type="button";use.onclick=()=>{
          imageContext=JSON.stringify(result.page.questions.map(q=>({
            text:q.statement_latex,options:q.options,figure:q.figure_description,
          }))).slice(0,3500);
          $("ai-prompt").value=pendingImageQuestion||"Explain the mathematics in the attached photo.";
          pendingImageQuestion="";activeTab("chat");$("ai-prompt").focus();
          status("Vision extraction available as bounded context for your next assistant message.");
        };target.append(use);
      }
    }else if(["running","submitted","accepted"].includes(result.state)){
      const refresh=node("button","Refresh run status","ai-secondary");
      refresh.type="button";refresh.onclick=()=>void selectJob(id);target.append(refresh);
    }
  }catch(e){status(extractionError(e),true);}
}
async function newJob(event){
  event.preventDefault();if(busyJob)return;
  const file=$("ai-job-file").files?.[0],page=Number($("ai-job-page").value);
  const lastPage=$("ai-job-last-page").value?Number($("ai-job-last-page").value):0;
  if(!file){status("Select a PDF or image.",true);return;}
  busyJob=true;$("ai-start-job").disabled=true;
  try{
    const job=await submitMimoBatch(file,{
      perPageUsd:Number($("ai-job-budget").value),
      totalUsd:Number($("ai-job-total-budget").value),
      target:$("ai-job-target").value,pageStart:page,pageEnd:lastPage,
    });
    originalSources.set(job.jobId,file);
    status("Background extraction submitted. It will continue without this tab open.");
    await loadJobs();await selectJob(job.jobId);
  }catch(e){status(extractionError(e),true);}
  finally{busyJob=false;$("ai-start-job").disabled=false;}
}
async function boot(){
  try {
    await initFirebase();
    const session=await new Promise(resolve=>{
      let unsub=()=>{};
      unsub=watchSession(s=>{
        if(s.status==="error"||s.status==="unconfigured"||
            (s.authResolved&&(!s.user||s.roleResolved))){
          queueMicrotask(()=>unsub());resolve(s);
        }
      });
    });
    if(!session?.user){location.replace("login.html?next=ai.html");return;}
    if(!canUseMimoTeacherChat(session)){
      gate.textContent="AI Studio requires an active verified teacher or administrator account.";
      return;
    }
    mountShell({showAssistant:false,showBackdrop:false});
    app.hidden=false;gate.hidden=true;
    listen("ai-new-chat","click",newThread);
    listen("ai-load-older","click",()=>void loadOlder());
    listen("ai-chat-search","input",drawThreads);
    listen("ai-tab-chat","click",()=>activeTab("chat"));
    listen("ai-tab-jobs","click",()=>activeTab("jobs"));
    listen("ai-chat-form","submit",e=>void chatSubmit(e));
    listen("ai-snip-math","click",async()=>{
      try{
        const selected=await snipPageContent();
        if(!selected){status("No visible material selected. For figures, use a photo or visual snip.");return;}
        const prompt=$("ai-prompt");
        const proposed=[prompt.value.trim(),"Selected source (verify LaTeX before sending):\n"+selected]
          .filter(Boolean).join("\n\n");
        if(proposed.length>prompt.maxLength){
          status("Selected text exceeds the chat limit. Select a smaller region.",true);return;
        }
        prompt.value=proposed;
        activeTab("chat");prompt.focus();
        status("Selected text and source LaTeX added for review; nothing was sent.");
      }catch(e){status(safeError(e),true);}
    });
    listen("ai-jobs-refresh","click",()=>void loadJobs().catch(e=>status(safeError(e),true)));
    listen("ai-job-form","submit",e=>void newJob(e));
    listen("ai-prompt","keydown",event=>{
      if(event.key==="Enter"&&!event.shiftKey&&!event.isComposing){
        event.preventDefault();if(!busyChat)$("ai-chat-form").requestSubmit();
      }
    });
    watchSession(s=>{
      if(!canUseMimoTeacherChat(s)){
        app.hidden=true;gate.hidden=false;
        gate.textContent="Session changed. Reload and sign in to continue.";
        for(const url of transientUrls)URL.revokeObjectURL(url);
        transientUrls=[];messages=[];threads=[];jobs=[];
      }
    });
    const params=new URLSearchParams(location.search);
    if(params.get("target")==="bank")$("ai-job-target").value="bank";
    const initialThread=params.get("thread");
    await Promise.allSettled([loadThreads(),loadJobs()]);
    if(initialThread&&/^[a-f0-9-]{36}$/i.test(initialThread)){
      try{await openThread(initialThread);}catch(e){status("Saved chat is unavailable for this account.",true);newThread();}
    }else{newThread();}
    if(params.get("mode")==="job")activeTab("jobs");
    drawJobs();
  }catch(error){
    gate.hidden=false;app.hidden=true;
    gate.textContent="AI Studio could not load. Verify your account and server connection.";
    console.error("AI Studio initialization failed",error);
  }
}
void boot();
