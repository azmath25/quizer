import {initFirebase,getSession,watchSession} from "../firebase-client.js";
import {mountShell} from "../components/shell.js";
import {renderChatMarkdown,typesetChatMarkdown} from "../components/ai-chat-markdown.js";
import {typeset} from "../components/math-content.js";
import {sendTeacherChatMessage,teacherChatHistory,canUseMimoTeacherChat,
  mimoChatErrorMessage,mimoHistoryErrorMessage} from "../services/mimo-chat.js";
import {submitMimoExtraction,readMimoExtraction,readMimoPng,listMimoExtractions,
  submitMimoBatch,listMimoBatches,readMimoBatch,reconcileMimoBatch,readMimoBatchPage,
  readMimoBatchImage,saveMimoBatchReview,readMimoBatchPrepared,
  buildTeacherReview,decideTeacherReview,exportTeacherReview,
  extractionError,describeMimoRunFailure,decodeMimoPng} from "../services/mimo-extraction.js";
import {importApprovedExtraction} from "../services/ai-reviewed-import.js";
import {uploadAsset,resolveImages} from "../services/assets.js";
import {snipPageContent} from "../components/page-snip.js";
import {mountLocalSourcePreview} from "../components/ai-source-preview.js";
import {createMimoPngViewer} from "../components/mimo-png-viewer.js";
import {inspectLocalDocument,makeTeacherContext} from "../services/local-document.js";

const $=id=>document.getElementById(id);
const app=$("app"),gate=$("ai-access-gate");
let threads=[],threadId=null,messages=[],jobs=[],selectedJob=null,review=null,hasOlder=false;
let busyChat=false,busyJob=false,imageContext="",pendingImageQuestion="",selectedImage=null;
// Pending feedback is local presentation state. It never writes chat history,
// implies model streaming, or starts another provider call.
let pendingReply=false,chatViewEpoch=0,pendingViewEpoch=-1;
const originalSources=new Map();
const batchReviews=new Map();
let transientUrls=[];
let sourcePreview=null;
const listen=(id,kind,fn)=>$(id).addEventListener(kind,fn);
const icon=(name,small=false)=>{
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.classList.add("ico");if(small)svg.classList.add("sm");
  svg.setAttribute("aria-hidden","true");
  const use=document.createElementNS("http://www.w3.org/2000/svg","use");
  use.setAttribute("href","#ic-"+name);svg.append(use);return svg;
};
const MODES={
  chat:{name:"General chat",icon:"chat",desc:"Think, explain, brainstorm and plan.",placeholder:"Ask a question or brainstorm an idea...",
    prompts:[["Understand a concept","Explain a difficult mathematical concept with examples"],["Plan a lesson","Outline a lesson on modular arithmetic"],["Explore an idea","Brainstorm an original olympiad problem"],["Compare methods","Compare two different solution methods"]]},
  solver:{name:"Problem solver",icon:"math",desc:"Reason through mathematics, notation and proofs.",placeholder:"Enter a problem or a LaTeX expression...",
    prompts:[["Solve step by step","Solve $x^2-5x+6=0$ step by step"],["Audit a proof","Identify gaps in the following mathematical proof"],["Find alternatives","Find two approaches to this problem"],["Get a hint","Give me a hint rather than the full solution"]]},
  document:{name:"Document lab",icon:"doc",desc:"PDF extraction, figures, OCR review and LaTeX.",placeholder:"Describe what to extract or review in your files...",
    prompts:[]},
  quiz:{name:"Quiz creator",icon:"quiz",desc:"Prepare, adapt and check quiz content.",placeholder:"Describe a quiz topic, age group or difficulty...",
    prompts:[["Draft exercises","Draft five algebra problems at varied levels"],["Build a test","Outline a 40-minute mathematics mock test"],["Balance difficulty","Organize these problems from easy to hard"],["Audit distractors","Review multiple-choice options for ambiguity"]]},
  review:{name:"Review & audit",icon:"review",desc:"Check grammar, logic, precision and ambiguity.",placeholder:"Paste material and describe what to audit...",
    prompts:[["Find ambiguity","Flag ambiguity and missing assumptions"],["Improve grammar","Polish wording without changing the math"],["Check consistency","Check numbering, formulas and notation"],["Proof referee","Identify unproved steps and possible counterexamples"]]},
};
let studioMode="chat",pinnedOnly=false,inspectorVisible=false;
const PIN_STORAGE="quizer.ai.studio.local-pins.v1";
let pins=new Set();
try{pins=new Set(JSON.parse(localStorage.getItem(PIN_STORAGE)||"[]"));}catch{}
const persistPins=()=>{try{localStorage.setItem(PIN_STORAGE,JSON.stringify([...pins]));}catch{}};
const ALIAS_STORAGE="quizer.ai.studio.local-aliases.v1";
let aliases={};
try{aliases=JSON.parse(localStorage.getItem(ALIAS_STORAGE)||"{}")||{};}catch{}
const displayTitle=t=>t?(String(aliases[t.id]||t.title||"New conversation").slice(0,100)):"New conversation";
const persistAliases=()=>{try{localStorage.setItem(ALIAS_STORAGE,JSON.stringify(aliases));}catch{}};

function studioHead(){
  const current=threads.find(t=>t.id===threadId),mode=MODES[studioMode]||MODES.chat;
  const head=$("conversation-head");head.replaceChildren();
  // Empty chat has one entry point: the composer. No duplicate "New conversation"
  // heading, large welcome banner, or suggested-prompt tiles.
  head.hidden=!threadId;
  const title=node("div","","current-title");
  const symbol=node("span","","title-symbol");symbol.append(icon(mode.icon));
  const copy=node("span","","title-copy");
  copy.append(node("h1",current?displayTitle(current):"Conversation"));
  title.append(symbol,copy);head.append(title);
  const actions=node("div","","head-tools");
  const more=node("details","","chat-options");
  const summary=node("summary","More ⋯");
  summary.setAttribute("aria-label","Conversation actions");
  more.append(summary);
  const menu=node("div","","chat-actions");
  const pin=node("button","","");pin.type="button";pin.disabled=!threadId;
  pin.append(icon("pin",true),document.createTextNode(" "+(pins.has(threadId)?"Unpin":"Pin")));
  pin.title="Pin this conversation on this device";
  pin.onclick=()=>{if(!threadId)return;
    if(pins.has(threadId))pins.delete(threadId);else pins.add(threadId);
    persistPins();drawThreads();more.open=false;
  };
  const rename=node("button","","");rename.type="button";rename.disabled=!threadId;
  rename.append(icon("edit",true),document.createTextNode(" Rename"));
  rename.title="Rename on this device";
  rename.onclick=()=>{if(!threadId)return;
    $("rename-input").value=displayTitle(current);
    $("rename-dialog").showModal();more.open=false;
  };
  const exportButton=node("button","","");
  exportButton.type="button";exportButton.disabled=!messages.length;
  exportButton.append(icon("download",true),document.createTextNode(" Export JSON"));
  exportButton.onclick=()=>{
    const payload={threadId,messages:messages.map(m=>({role:m.role,content:m.content||""}))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
    const link=node("a");link.href=url;link.download="ai-studio-conversation.json";
    link.click();setTimeout(()=>URL.revokeObjectURL(url),0);more.open=false;
  };
  menu.append(pin,rename,exportButton);more.append(menu);actions.append(more);head.append(actions);
  const route=$("ai-route-name");if(route)route.textContent=displayTitle(current);
  const modeText=$("compose-mode");modeText.replaceChildren(icon(mode.icon,true),
    document.createTextNode(" "+mode.name));
  $("ai-prompt").placeholder=mode.placeholder;
}
function applyStudioLayout(){
  const wide=innerWidth>1180;
  const documents=app.classList.contains("documents-mode");
  app.classList.toggle("show-inspector",!wide&&inspectorVisible);
  const inspector=app.querySelector(".inspector");
  if(wide){
    inspector.style.display=inspectorVisible?"":"none";
    // Document extraction is one wide workspace until Saved jobs is opened.
    // Chat keeps just a narrow conversation-history rail.
    $("shell").style.gridTemplateColumns=documents
      ? (inspectorVisible?"minmax(0,1fr) 290px":"minmax(0,1fr)")
      : (inspectorVisible?"246px minmax(0,1fr) 290px":"246px minmax(0,1fr)");
  }else{inspector.style.display="";$("shell").style.gridTemplateColumns="";}
  for(const button of app.querySelectorAll('[data-act="inspector"]'))
    button.setAttribute("aria-expanded",String(inspectorVisible));
}

const node=(tag,text="",className="")=>{
  const el=document.createElement(tag);if(className)el.className=className;
  if(text!==undefined)el.textContent=String(text);return el;
};
const humanTime=t=>{const d=new Date(t);return Number.isFinite(d.getTime())
  ?d.toLocaleString(): "Time unavailable";};
const compactChatDate=value=>{
  if(!value)return "";
  // Neon and older message records may use ISO dates or epoch seconds/ms.
  // Missing/invalid timestamps must not fill the sidebar with error labels.
  const source=typeof value==="object"&&value!==null
    ?(value.seconds??value._seconds??value.iso??value.date??null):value;
  if(source===null)return "";
  const amount=typeof source==="number"||(typeof source==="string"&&/^\d{10,13}$/.test(source))
    ?Number(source):null;
  const date=new Date(amount===null?source:amount<1e12?amount*1000:amount);
  return Number.isFinite(date.getTime())
    ?date.toLocaleDateString(undefined,{month:"short",day:"numeric"}):"";
};
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
  $("ai-tab-chat").classList.toggle("active",chat&&!pinnedOnly);
  $("ai-tab-jobs").classList.toggle("active",!chat);
  $("ai-pin-filter").classList.toggle("active",chat&&pinnedOnly);
  app.classList.remove("show-sidebar");
  app.classList.toggle("documents-mode",!chat);
  if(!chat)inspectorVisible=false;
  applyStudioLayout();
  for(const [id,selected] of [["ai-workbench-jobs",chat],["ai-workbench-extract",!chat]]){
    const button=$(id);
    if(button){button.setAttribute("aria-selected",String(selected));
      button.classList.toggle("active",selected);}
  }
  if(chat)studioHead();
  else {const route=$("ai-route-name");if(route)route.textContent="Document lab";}

}
function drawThreads(){
  const target=$("ai-threads"),needle=$("ai-chat-search").value.toLowerCase();
  target.replaceChildren();
  const visible=threads.filter(t=>(!pinnedOnly||pins.has(t.id))&&
    displayTitle(t).toLowerCase().includes(needle))
    .sort((a,b)=>Number(pins.has(b.id))-Number(pins.has(a.id))||
      String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
  $("chat-count").textContent=String(threads.length);
  $("history-count").textContent=String(visible.length);
  $("history-label").textContent=pinnedOnly?"Pinned":"Recent";
  $("ai-pin-filter").setAttribute("aria-pressed",String(pinnedOnly));
  for(const entry of visible){
    const row=node("div","","history-row");
    if(entry.id===threadId)row.classList.add("active");
    const b=node("button","","history-open");b.type="button";
    b.setAttribute("aria-current",String(entry.id===threadId));
    const symbol=node("span","","history-icon");symbol.append(icon("chat"));
    const label=node("span","","history-text");
    label.append(node("strong",displayTitle(entry)));
    const updated=compactChatDate(entry.updatedAt||entry.createdAt);
    if(updated)label.append(node("small",updated));
    b.append(symbol,label);b.onclick=()=>void openThread(entry.id).catch(e=>status(safeError(e),true));
    const pin=node("button","","pin-btn");
    pin.type="button";pin.title="Pin on this device";
    pin.setAttribute("aria-label",(pins.has(entry.id)?"Unpin ":"Pin ")+displayTitle(entry));
    if(pins.has(entry.id))pin.classList.add("pinned");
    pin.append(icon("pin",true));
    pin.onclick=()=>{if(pins.has(entry.id))pins.delete(entry.id);else pins.add(entry.id);
      persistPins();drawThreads();};
    row.append(b,pin);target.append(row);
  }
  if(!target.childElementCount)target.append(node("div","No saved conversations match this view.","empty-box"));
  studioHead();
}
function drawMessages(){
  $("ai-load-older").hidden=!hasOlder;
  const target=$("ai-messages");target.replaceChildren();
  $("ai-chat-panel").classList.toggle("empty-chat",!messages.length&&!pendingReply);
  for(const m of messages){
    const role=m.role==="assistant"?"assistant":"user";
    const article=node("article","","message "+role);
    const avatar=node("span","","msg-icon");avatar.append(icon(role==="user"?"chat":"spark"));
    const content=node("div","","msg-content");
    const meta=node("div","","msg-meta");
    meta.append(node("strong",role==="assistant"?"Mimo assistant":"You"));
    if(m.createdAt||m.at)meta.append(node("time",humanTime(m.createdAt||m.at)));
    const body=node("div","","msg-body");
    if(role==="assistant")renderChatMarkdown(body,m.content||"");
    else body.textContent=m.content||"";
    const actions=node("div","","msg-actions");
    const copy=node("button","","ai-copy-msg");
    copy.type="button";copy.title="Copy message";
    copy.setAttribute("aria-label",role==="user"?"Copy your message":"Copy assistant message");
    copy.append(icon("copy",true));
    copy.onclick=async()=>{
      try{await navigator.clipboard.writeText(String(m.content||""));
        copy.title="Copied";copy.setAttribute("aria-label","Copied message");
      }catch{status("Copy unavailable — select the message text to copy.",true);}
    };
    actions.append(copy);content.append(meta,body,actions);
    article.append(avatar,content);target.append(article);
    if(m.imageAssetId){
      const img=node("img");img.alt="Private attached mathematics image";img.loading="lazy";
      body.append(img);const epoch=getSession().epoch;
      void resolveImages({attached:m.imageAssetId},
        {kind:"owned_upload",id:m.imageAssetId}).then(urls=>{
        if(epoch===getSession().epoch&&img.isConnected&&urls.attached)img.src=urls.attached;
      }).catch(()=>{img.alt="Attached image unavailable for this account";});
    }
    if(role==="assistant")void typesetChatMarkdown(body,typeset);
  }
  // One temporary, accessible reply indicator; not part of persisted messages.
  if(pendingReply&&pendingViewEpoch===chatViewEpoch){
    const pending=node("article","","message assistant ai-reply-pending");
    pending.id="ai-pending-reply";
    pending.setAttribute("role","status");
    pending.setAttribute("aria-label","Assistant is generating a reply");
    const avatar=node("span","","msg-icon");avatar.append(icon("spark"));
    const content=node("div","","msg-content");
    const loading=node("div","","ai-reply-progress");
    const dots=node("span","","ai-reply-dots");
    dots.setAttribute("aria-hidden","true");
    for(let i=0;i<3;i++)dots.append(node("i"));
    loading.append(dots,node("span","Generating reply…","ai-reply-progress-label"));
    content.append(loading);pending.append(avatar,content);target.append(pending);
  }
  const scroller=$("conversation");scroller.scrollTop=scroller.scrollHeight;
  studioHead();
}
async function loadThreads(){
  try {
    const result=await teacherChatHistory("chat.list",{limit:100});
    threads=Array.isArray(result?.threads)?result.threads:[];
    drawThreads();
    return true;
  } catch(error) {
    const detail=mimoHistoryErrorMessage(error);
    const target=$("ai-threads");target.replaceChildren();
    const message=node("p",detail,"ai-error");
    message.setAttribute("role","alert");
    const retry=node("button","Retry saved chats","ai-secondary");
    retry.type="button";
    retry.onclick=()=>void loadThreads().then(ok=>{
      if(ok)status("");else status(detail,true);
    });
    target.append(message,retry);
    status(detail,true);
    return false;
  }
}
async function openThread(id){
  const data=await teacherChatHistory("chat.get",{threadId:id});
  chatViewEpoch++;
  threadId=id;selectedImage=null;messages=Array.isArray(data?.messages)?data.messages:[];
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
  chatViewEpoch++;
  threadId=null;messages=[];hasOlder=false;imageContext="";selectedImage=null;
  history.replaceState(null,"","ai.html");
  drawThreads();drawMessages();$("ai-prompt").value="";
  $("ai-chat-photo").value="";$("pending").replaceChildren();activeTab("chat");
  $("ai-prompt").focus();
}
async function sendText(message,context=""){
  if(busyChat||!message.trim())return;
  busyChat=true;$("ai-send").disabled=true;
  pendingReply=true;pendingViewEpoch=chatViewEpoch;
  const snapshot=messages.slice();
  const sentThreadId=threadId, sentImage=selectedImage;
  const input=$("ai-prompt"),submittedDraft=input.value;
  input.value="";
  messages.push({role:"user",content:message,
    imageAssetId:selectedImage?.assetId||null,imageJobId:selectedImage?.jobId||null});
  drawMessages();status("");
  try {
    const answer=await sendTeacherChatMessage({
      message,context,threadId,requestId:crypto.randomUUID(),
      ...(sentImage?{imageJobId:sentImage.jobId,imageAssetId:sentImage.assetId}:{}),
      history:snapshot.filter(m=>["user","assistant"].includes(m.role))
        .slice(-8).map(m=>({role:m.role,content:String(m.content||"").slice(0,1200)})),
    });
    if(threadId!==sentThreadId){
      await loadThreads();
      status("Your answer is saved in the conversation where you sent it.");
      return true;
    }
    messages.push({role:"assistant",content:answer.reply});
    threadId=answer.threadId||threadId;
    pendingReply=false;
    drawMessages();
    if(answer.saved&&threadId){
      history.replaceState(null,"","ai.html?thread="+encodeURIComponent(threadId));
      try{await loadThreads();status("");}
      catch{status("Reply saved, but the conversation list could not refresh.",true);}
    } else status("Reply received, but history could not be saved. Copy the answer before closing.",true);
    selectedImage=null;
    return true;
  }catch(error){
    pendingReply=false;
    if(threadId===sentThreadId){
      messages=snapshot;drawMessages();
      if(!input.value)input.value=submittedDraft;
    }
    status(safeError(error),true);
    return false;
  }
  finally{
    pendingReply=false;busyChat=false;
    $("ai-pending-reply")?.remove();
    $("ai-send").disabled=false;
  }
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
      status("Saving the attached photo privately…");
      const imageAssetId=await uploadAsset(file,()=>{},"image");
      const result=await submitMimoExtraction(file,1,{
        target:"chat",costLimitUsd:0.15,imageAssetId,
      });
      originalSources.set(result.jobId,file);
      $("ai-chat-photo").value="";$("ai-prompt").value="";$("pending").replaceChildren();
      status("Photo accepted as background vision job. Select it after completion to discuss the extracted mathematics.");
      await loadJobs();await selectJob(result.jobId);
      activeTab("jobs");
    }catch(error){status(extractionError(error),true);}
    return;
  }
  const modeContext=studioMode==="chat"?"":("Workspace: "+MODES[studioMode].name+". "+MODES[studioMode].desc);
  const confirmed=await sendText(prompt,[modeContext,imageContext].filter(Boolean).join("\n"));
  if(confirmed)imageContext="";
}
function drawJobs(){
  const target=$("ai-job-list");target.replaceChildren();
  $("job-count").textContent=String(jobs.filter(j=>
    ["running","submitted","accepted","queued"].includes(j.state)).length);
  for(const job of jobs){
    const b=node("button","","job-select");
    b.type="button";b.setAttribute("aria-current",String(job.jobId===selectedJob));
    b.append(icon(job.kind==="batch"?"doc":"clock"));
    const text=node("span");
    text.append(node("strong",job.fileName||job.jobId),
      node("small",(job.kind==="batch"?"Document · ":"Page · ")+
        (job.state==="attention"?"Needs action"+(job.attention?" ("+job.attention+" pages)":""):job.state||"queued")+" · "+humanTime(job.createdAt)));
    b.append(text,icon("chevron",true));
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
  const diagnostic=describeMimoRunFailure(result);
  if(diagnostic)card.append(node("p",diagnostic,"ai-error"));
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

function makeBatchPngViewer(jobId,pageNumber){
  return createMimoPngViewer({
    jobId,pageNumber,
    fetchImage:readMimoBatchImage,decodeImage:decodeMimoPng,
    explainError:extractionError,
    registerUrl:url=>transientUrls.push(url),
  });
}

async function openBatchPage(jobId,pageNumber){
  selectedJob=jobId;activeTab("jobs");drawJobs();
  const target=$("ai-job-result");
  target.replaceChildren(node("p","Loading validated page and saved review…","ai-muted"));
  try{
    const result=await readMimoBatchPage(jobId,pageNumber);
    if(selectedJob!==jobId)return;
    const back=node("button","Back to full-document progress","ai-secondary");
    back.type="button";back.onclick=()=>void selectJob(jobId);
    const page=result.page;
    const heading=node("h2","Page "+pageNumber+" · "+page.questions.length+" questions");
    target.replaceChildren(back,heading);
    if(result.recoveredFromCheckpoint||result.verificationUnusable){
      target.append(node("p",
        result.recoveredFromCheckpoint
          ?"Recovered from the saved first-pass extraction. Independent AI verification returned no visible answer. Check all questions against the PDF before importing."
          :"First-pass extraction is available, but independent AI verification was missing or unusable. Check all questions against the PDF before importing.",
        "ai-muted"));
    }
    // T1: the compiled PNG is a completed page artifact, independent of
    // the old question-by-question review form. This is GET-only.
    if(result.hasReconstruction){
      const viewer=makeBatchPngViewer(jobId,pageNumber);
      target.append(viewer.panel);
      void viewer.load();
    }
    const verified=await verifySource(originalSources.get(jobId),page);
    review=result.review||buildTeacherReview(page);
    reviewUI(target,{jobId,page},verified,{
      batchJobId:jobId,reviewVersion:result.reviewVersion,
    });
  }catch(e){status(safeError(e),true);}
}
function documentTaskLabel(page,jobState){
  const error=String(page.error||"");
  if(page.state==="completed")return page.recoveredFromCheckpoint||
    page.verificationUnusable
      ?"Extracted — teacher verification required":"Completed";
  if(page.state==="attention"){
    if(/^MIMO_RUN_(FAILED|CANCELLED|DISPATCH_FAILED)$/.test(error))
      return "Failed — Mimo run ended";
    if(error==="MIMO_RUN_WAITING_FOR_REVIEW")
      return "Mimo requires review";
    if(!page.runId)return "Dispatch outcome unknown — no run ID";
    return "Outcome uncertain — existing run needs checking";
  }
  if(page.state==="queued"&&["attention","budget_exhausted"].includes(jobState))
    return "Paused — not yet dispatched";
  if(page.state==="queued")return "Queued";
  if(page.state==="submitted"&&page.retryAt)return "Rate-limited — retry scheduled";
  if(page.state==="submitted")return "Running";
  if(page.state==="claiming")return "Dispatching";
  return String(page.state||"Unknown");
}
async function selectBatch(id){
  const target=$("ai-job-result");
  target.replaceChildren(node("p","Loading durable document status…","ai-muted"));
  try{
    const job=await readMimoBatch(id);
    if(selectedJob!==id)return;
    // Keep the sidebar and selected detail in agreement after every refresh.
    // The list request may be older than this durable status read.
    const index=jobs.findIndex(item=>item.jobId===id);
    if(index>=0){jobs[index]={...jobs[index],state:job.state,
      updatedAt:job.updatedAt||jobs[index].updatedAt};
      drawJobs();}
    const card=node("div","","ai-status");
    const confirmedFailures=(job.pages||[]).filter(p=>p.state==="attention"&&
      /^MIMO_RUN_(FAILED|CANCELLED|DISPATCH_FAILED)$/.test(String(p.error||""))).length;
    const uncertain=(job.pages||[]).filter(p=>p.state==="attention").length-confirmedFailures;
    const heading=job.state==="attention"?(confirmedFailures
      ?"Needs action · "+confirmedFailures+" failed page"+(confirmedFailures===1?"":"s")
      :"Needs action · "+uncertain+" uncertain page"+(uncertain===1?"":"s"))
      :job.state;
    card.append(node("h2",job.fileName+" · "+heading));
    const count=node("p",job.completed+" of "+job.pageCount+
      " pages completed · reserved maximum $"+Number(job.reservedUsd||0).toFixed(2)+
      " of $"+Number(job.totalUsd||0).toFixed(2));
    card.append(count);
    const explanation=node("p",job.state==="budget_exhausted"
      ?"The hard cost cap has stopped the job before another page. No extra model calls will be made."
      :job.state==="attention"
      ?"Known failed runs cannot finish without a new, separately approved job. Uncertain runs can only be checked by their existing IDs; no page is automatically retried."
      :job.state==="ready_review"
      ?(job.pages||[]).some(p=>p.recoveredFromCheckpoint||p.verificationUnusable)
        ?"Questions were extracted, but independent AI verification did not produce a usable result. Compare every question with the original PDF before approving or importing."
        :"Extraction completed. Review every page before importing any question."
      :"Mimo is running page workflows in the background. Progress uses saved checkpoints, not a simulated countdown.","ai-muted");
    card.append(explanation);
    if(job.error)card.append(node("p",job.error,"ai-error"));
    const refresh=node("button","Refresh document status","ai-secondary");
    refresh.type="button";
    refresh.onclick=()=>void selectBatch(id);
    card.append(refresh);
    const checked=(job.pages||[]).filter(p=>p.state==="attention"&&p.runId);
    if(checked.length){
      const reconcile=node("button","Check existing run IDs (no new AI jobs)","ai-secondary");
      reconcile.type="button";
      reconcile.onclick=async()=>{
        reconcile.disabled=true;
        reconcile.textContent="Checking existing Mimo runs…";
        try{
          const response=await reconcileMimoBatch(id);
          if(selectedJob!==id)return;
          status("Checked "+response.checkedExistingRuns+
            " existing run"+(response.checkedExistingRuns===1?"":"s")+
            ". No extraction was resubmitted.");
          await selectBatch(id);
        }catch(error){
          status(extractionError(error),true);
          reconcile.disabled=false;
          reconcile.textContent="Check existing run IDs (no new AI jobs)";
        }
      };
      card.append(reconcile);
    }
    const list=node("div","","ai-list");
    const labels={
      processor:"Reading source",extract:"Extracting questions",
      verify:"Verifying mathematics",rebuild_plan:"Planning figures",
      tikz_source:"Writing TikZ",compile_png:"Compiling TikZ PNG",
      output:"Preparing review",queued:"Waiting for worker",
    };
    for(const page of job.pages||[]){
      const phase=labels[page.stage]||"Processing";
      const detail=page.state==="completed"
        ?" · "+page.questionCount+" questions · "+page.figureCount+" figures"+(page.verificationUnusable?" · requires source verification":"")
        :page.state==="submitted"&&page.retryAt&&Number.isFinite(Date.parse(page.retryAt))
          ?" · Provider quota wait · next attempt "+new Date(page.retryAt).toLocaleString()
        :page.state==="submitted"?" · "+phase+" ("+(page.stageStatus||"running")+")"
        :page.state==="attention"&&describeMimoRunFailure(page)?" · "+describeMimoRunFailure(page):"";
      const taskLabel=documentTaskLabel(page,job.state);
      const more=page.state==="attention"
        ?(page.runId?" · Run "+page.runId:" · No known run ID")
        :"";
      const b=node("button","Page "+page.number+" — "+taskLabel+
        (page.state==="attention"?" · "+(page.stage||"processor"):detail)+
        (page.state==="attention"&&describeMimoRunFailure(page)
          ?" · "+describeMimoRunFailure(page):"")+more);
      b.type="button";b.disabled=page.state!=="completed";
      b.onclick=()=>void openBatchPage(id,page.number);
      list.append(b);
      if(page.state==="completed"&&page.hasReconstruction){
        // Opt-in retrieval in the overview, to avoid downloading every
        // compiled diagram when a multi-page job is merely listed.
        list.append(makeBatchPngViewer(id,page.number).panel);
      }
    }
    card.append(list);
    target.replaceChildren(card);
    if(job.state==="ready_review"){
      const button=node("button",job.target==="bank"
        ?"Import all approved questions to Problem Bank"
        :"Create private quiz draft from all approved questions","ai-primary");
      button.type="button";
      button.onclick=async()=>{
        if(!confirm("Import only reviewed, approved questions from the entire document?"))return;
        button.disabled=true;
        try{
          const prepared=await readMimoBatchPrepared(id);
          const saved=await importApprovedExtraction(prepared,{
            sourceJobId:id,title:prepared.title,target:job.target,
            onProgress:message=>status(message),
          });
          if(job.target==="quiz"&&saved.quizId)
            location.assign("upload.html?id="+encodeURIComponent(saved.quizId));
          else location.assign("problems.html");
        }catch(e){status(safeError(e),true);button.disabled=false;}
      };
      target.append(button);
    }
  }catch(e){status(safeError(e),true);}
}
async function selectJob(id){
  selectedJob=id;drawJobs();activeTab("jobs");
  if(jobs.find(x=>x.jobId===id)?.kind==="batch"){
    await selectBatch(id);return;
  }
  const target=$("ai-job-result");target.replaceChildren(node("p","Fetching actual job status…","ai-muted"));
  try{
    const result=await readMimoExtraction(id);
    if(id!==selectedJob)return;
    result.jobId=id;
    const index=jobs.findIndex(item=>item.jobId===id);
    if(index>=0){jobs[index]={...jobs[index],state:result.state};drawJobs();}
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
          selectedImage={jobId:id,assetId:result.imageAssetId||
            jobs.find(x=>x.jobId===id)?.imageAssetId};
          imageContext="";
          if(!selectedImage.assetId){
            status("Reattach the original image to discuss this older job.",true);
            selectedImage=null;return;
          }
          $("ai-prompt").value=pendingImageQuestion||"Explain the mathematics in the attached photo.";
          pendingImageQuestion="";activeTab("chat");$("ai-prompt").focus();
          status("This photo is attached to your next chat message. Mimo will use its verified image extraction, and the photo reference will remain in saved history.");
        };target.append(use);
      }
    }else if(["running","submitted","accepted"].includes(result.state)){
      const refresh=node("button","Refresh run status","ai-secondary");
      refresh.type="button";refresh.onclick=()=>void selectJob(id);target.append(refresh);
    }
  }catch(e){status(extractionError(e),true);}
}
function updatePdfBudgetSummary(){
  const perPage=Number($("ai-job-budget").value);
  const total=Number($("ai-job-total-budget").value);
  const first=Number($("ai-job-page").value);
  const endText=$("ai-job-last-page").value;
  const end=endText?Number(endText):null;
  const pages=end!==null&&Number.isInteger(first)&&Number.isInteger(end)
    &&end>=first?end-first+1:null;
  const maxPages=Number.isFinite(total)&&Number.isFinite(perPage)&&perPage>0
    ?Math.max(0,Math.floor((total+1e-9)/perPage)):0;
  let explanation="Each page has a hard $"+perPage.toFixed(2)+
    " maximum, not a guaranteed charge. Total document cap: $"+total.toFixed(2)+".";
  if(pages!==null){
    const required=pages*perPage;
    explanation+=" "+pages+" selected pages reserve up to $"+required.toFixed(2)+".";
    if(required>total+0.000001)
      explanation+=" Your total cap permits at most "+maxPages+
        " pages; remaining pages will stop before a paid run.";
  }else{
    explanation+=" With this selection the total cap covers at most "+maxPages+
      " pages. Exact PDF page count is determined after upload.";
  }
  if(perPage===0.15)
    explanation+=" Economy mode can reject multi-stage verification or TikZ jobs before completion.";
  $("ai-job-estimate").textContent=explanation;
}
async function newJob(event){
  event.preventDefault();if(busyJob)return;
  const file=sourcePreview?.getFile()??null,page=Number($("ai-job-page").value);
  const lastPage=$("ai-job-last-page").value?Number($("ai-job-last-page").value):0;
  if(!file){status("Select and inspect a valid PDF or image (8 MiB maximum).",true);return;}
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
const STUDIO_COMMANDS=[
  {name:"New exploration",hint:"Start a new AI conversation",icon:"plus",run:()=> $("type-dialog").showModal()},
  {name:"Ask the assistant",hint:"Return to this conversation",icon:"chat",run:()=>{activeTab("chat");$("ai-prompt").focus();}},
  {name:"Solve mathematics",hint:"Step-by-step mathematics",icon:"math",run:()=>{studioMode="solver";newThread();$("ai-prompt").focus();}},
  {name:"Review and audit",hint:"Check mathematics and wording",icon:"review",run:()=>{studioMode="review";newThread();$("ai-prompt").focus();}},
  {name:"Extract PDF or image",hint:"Start a private background job",icon:"doc",run:()=>{activeTab("jobs");$("ai-job-file").focus();}},
  {name:"Saved Mimo jobs",hint:"Open the live workbench",icon:"clock",run:()=>{inspectorVisible=true;applyStudioLayout();void loadJobs().catch(e=>status(safeError(e),true));}},
  {name:"Refresh saved chats",hint:"Read your Neon history",icon:"retry",run:()=>void loadThreads()},
  {name:"Import TXT / TeX",hint:"Add a local source to your draft without sending",icon:"doc",run:()=> $("ai-chat-text-file").click()},
  {name:"Snip visible math",hint:"Extract text and original MathJax source",icon:"snip",run:()=>{activeTab("chat");$("ai-snip-math").click();}},
  {name:"Studio preferences",hint:"Adjust your workspace",icon:"settings",run:()=> $("settings-dialog").showModal()},
];
function displayCommands(query=""){
  const container=$("ai-command-results");container.replaceChildren();
  const needle=String(query).toLowerCase().trim();
  const actions=STUDIO_COMMANDS.filter(item=>
    (item.name+" "+item.hint).toLowerCase().includes(needle));
  for(const action of actions){
    const button=node("button","","axiom-command-choice");button.type="button";
    button.setAttribute("role","option");
    const glyph=node("span");glyph.append(icon(action.icon,true));
    button.append(glyph,node("span",action.name),node("small",action.hint));
    button.onclick=()=>{
      $("ai-command-dialog").close();action.run();
      app.classList.remove("show-sidebar");
    };
    container.append(button);
  }
  if(!actions.length)container.append(node("p","No matching commands.","ai-muted"));
}
function openCommands(query=""){
  const dialog=$("ai-command-dialog");if(dialog.open)return;
  $("ai-command-query").value=query;displayCommands(query);
  dialog.showModal();$("ai-command-query").focus();
}
function wireOriginalChrome(){
  const modes=$("types");
  for(const [key,mode] of Object.entries(MODES)){
    const button=node("button","","type-card");button.type="button";
    const symbol=node("span","","type-symbol");symbol.append(icon(mode.icon));
    const label=node("span");label.append(node("strong",mode.name),node("small",mode.desc));
    button.append(symbol,label);
    button.onclick=()=>{
      $("type-dialog").close();
      if(key==="document"){activeTab("jobs");return;}
      studioMode=key;pinnedOnly=false;newThread();
    };
    modes.append(button);
  }
  listen("ai-pin-filter","click",()=>{pinnedOnly=!pinnedOnly;activeTab("chat");drawThreads();});
  listen("ai-return-chat","click",()=>activeTab("chat"));
  listen("ai-command-query","input",event=>displayCommands(event.target.value));
  listen("ai-workbench-jobs","click",()=>{
    $("ai-workbench-jobs").setAttribute("aria-selected","true");
    $("ai-workbench-jobs").classList.add("active");
    $("ai-workbench-extract").setAttribute("aria-selected","false");
    $("ai-workbench-extract").classList.remove("active");
    inspectorVisible=true;applyStudioLayout();
    void loadJobs().catch(e=>status(safeError(e),true));
  });
  listen("ai-workbench-extract","click",()=>activeTab("jobs"));
  document.addEventListener("keydown",event=>{
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){
      event.preventDefault();openCommands();
    }else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="j"){
      event.preventDefault();$("type-dialog").showModal();
    }
  });
  listen("rename-form","submit",event=>{
    event.preventDefault();
    if(!threadId)return;
    const name=$("rename-input").value.trim();
    if(name){aliases[threadId]=name.slice(0,100);persistAliases();drawThreads();studioHead();}
    $("rename-dialog").close();
  });
  listen("ai-chat-text-file","change",async()=>{
    const file=$("ai-chat-text-file").files?.[0];
    if(!file)return;
    try{
      const meta=await inspectLocalDocument(file);
      if(meta.kind!=="text")throw Error("Choose a TXT or TeX text source.");
      const base=makeTeacherContext(meta.text,meta.name);
      const input=$("ai-prompt");
      const available=input.maxLength-input.value.length-(input.value?"\n\n":"");
      if(available<200)throw Error("Clear some draft text to import the source.");
      const truncated=base.length>available;
      input.value+=(input.value?"\n\n":"")+base.slice(0,available);
      activeTab("chat");input.focus();
      status("Local "+meta.name+" added to the draft"+
        (truncated?" (truncated to composer limit)":"")+
        ". Review before sending; nothing has been uploaded.");
    }catch(error){status(String(error?.message||"Could not import text.").slice(0,180),true);}
    finally{$("ai-chat-text-file").value="";}
  });
  listen("ai-chat-photo","change",()=>{
    const file=$("ai-chat-photo").files?.[0];
    const pending=$("pending");pending.replaceChildren();
    if(file){
      const item=node("span","","file");item.append(icon("paperclip",true));
      item.append(node("strong",file.name));
      const remove=node("button","","icon-btn");remove.type="button";remove.title="Remove attachment";
      remove.setAttribute("aria-label","Remove photo");remove.append(icon("x",true));
      remove.onclick=()=>{$("ai-chat-photo").value="";pending.replaceChildren();};
      item.append(remove);pending.append(item);
    }
  });
  const settings=(()=>{
    try{return JSON.parse(localStorage.getItem("quizer.ai.visual.v1")||"{}");}catch{return {};}
  })();
  $("spot-toggle").checked=settings.spot!==false;
  $("motion-toggle").checked=settings.motion!==false;
  const applySettings=()=>{
    const spotlight=$("spot-toggle").checked,motion=$("motion-toggle").checked;
    $("workspace").style.setProperty("--spotlight",spotlight?"1":"0");
    $("workspace").style.setProperty("--aurora",motion?"block":"none");
    try{localStorage.setItem("quizer.ai.visual.v1",
      JSON.stringify({spot:spotlight,motion}));}catch{}
  };
  listen("spot-toggle","change",applySettings);
  listen("motion-toggle","change",applySettings);applySettings();
  app.addEventListener("click",event=>{
    const target=event.target.closest("[data-act]");if(!target)return;
    const act=target.dataset.act;
    if(act==="sidebar"){app.classList.add("show-sidebar");}
    else if(act==="close-drawers"){app.classList.remove("show-sidebar","show-inspector");
      if(innerWidth<=1180){inspectorVisible=false;applyStudioLayout();}}
    else if(act==="inspector"){
      inspectorVisible=!inspectorVisible;applyStudioLayout();
      if(inspectorVisible&&innerWidth<=760)app.classList.remove("show-sidebar");
    }else if(act==="settings")$("settings-dialog").showModal();
    else if(act==="commands")openCommands();
    else if(act==="search"){
      if(innerWidth<=760)app.classList.add("show-sidebar");
      $("ai-chat-search").focus();
    }else if(act==="close-dialog"){
      const dlg=target.closest("dialog");if(dlg?.open)dlg.close();
    }else if(act==="attach")$("ai-chat-photo").click();
  });
  window.addEventListener("resize",applyStudioLayout,{passive:true});
  applyStudioLayout();
}
async function boot(){
  try {
    // Show the one-page workspace immediately; never gate the design behind
    // an extra teacher-role request. Server callables enforce all real access.
    mountShell({showAssistant:false,showBackdrop:false});
    app.hidden=false;gate.hidden=true;
    wireOriginalChrome();
    sourcePreview=mountLocalSourcePreview({
      input:$("ai-job-file"),container:$("ai-local-source-preview"),
      onSourceChange:()=>{$("ai-upload-consent").checked=false;},
    });
    listen("ai-new-chat","click",()=>$("type-dialog").showModal());
    listen("ai-load-older","click",()=>void loadOlder());
    listen("ai-chat-search","input",drawThreads);
    listen("ai-tab-chat","click",()=>{pinnedOnly=false;activeTab("chat");drawThreads();});
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
    for(const id of ["ai-job-budget","ai-job-total-budget","ai-job-page","ai-job-last-page"])
      listen(id,"input",updatePdfBudgetSummary);
    updatePdfBudgetSummary();
    listen("ai-prompt","keydown",event=>{
      if(event.key==="/"&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&
         !$("ai-prompt").value.trim()){
        event.preventDefault();openCommands();return;
      }
      if(event.key==="Enter"&&!event.shiftKey&&!event.isComposing){
        event.preventDefault();if(!busyChat)$("ai-chat-form").requestSubmit();
      }
    });
    // Authentication (not a second role-verification screen) is needed for
    // private calls. Role authorization is enforced by Firebase on each call.
    const session=await new Promise(resolve=>{
      let settled=false,unsub=()=>{};
      const finish=value=>{
        if(settled)return;
        settled=true;clearTimeout(timeout);
        queueMicrotask(()=>unsub());
        resolve(value);
      };
      const timeout=setTimeout(()=>finish({...getSession(),authTimedOut:true}),12000);
      unsub=watchSession(value=>{
        if(value.status==="error"||value.status==="unconfigured"||
          (value.authResolved&&(!value.user||value.roleResolved)))finish(value);
      });
      void initFirebase().catch(error=>finish({
        ...getSession(),status:"error",error:String(error?.message||error),
      }));
    });
    if(session.authTimedOut||session.status==="error"||session.status==="unconfigured"){
      status("Account services are still loading. Your workspace remains available; retry after connection is restored.",true);
      return;
    }
    if(!session?.user){location.replace("login.html?next=ai.html");return;}
    if(session.user.emailVerified!==true){
      status("Verify your email to use the AI Studio services.",true);
      return;
    }
    watchSession(value=>{
      // A role refresh should not remove the workspace. Only sign-out clears
      // the user-specific view. Server-side callables reject students.
      if(value.authResolved&&!value.user){
        messages=[];threads=[];jobs=[];
        for(const url of transientUrls)URL.revokeObjectURL(url);
        transientUrls=[];
        location.replace("login.html?next=ai.html");
      }
    });
    const params=new URLSearchParams(location.search);
    if(params.get("target")==="bank")$("ai-job-target").value="bank";
    const initialThread=params.get("thread");
    // Failure of history must never block the assistant or the job UI.
    const initialLoads=await Promise.allSettled([loadThreads(),loadJobs()]);
    if(initialLoads[1].status==="rejected")
      status("Saved jobs are temporarily unavailable. Refresh the job inspector.",true);
    if(initialThread&&/^[a-f0-9-]{36}$/i.test(initialThread)){
      try{await openThread(initialThread);}catch(e){status("Saved chat is unavailable for this account.",true);newThread();}
    }else{newThread();}
    if(params.get("mode")==="job")activeTab("jobs");
    drawJobs();
  }catch(error){
    app.hidden=false;gate.hidden=true;
    status("AI Studio could not initialize. Reload the page or check your connection.",true);
    console.error("AI Studio initialization failed",error);
  }
}
void boot();
