import {initFirebase, watchSession, getSession} from "../firebase-client.js";
import {mountShell} from "../components/shell.js";
import {uploadAsset} from "../services/assets.js";
import {
  canUseMimoTeacherChat, sendTeacherChatMessage, mimoChatErrorMessage,
} from "../services/mimo-chat.js";
import {inspectLocalDocument, makeTeacherContext} from "../services/local-document.js";
import {
  submitMimoExtraction,readMimoExtraction,readMimoPng,buildTeacherReview,
  decideTeacherReview,exportTeacherReview,extractionError,decodeMimoPng,
  MAX_MIMO_FILE_BYTES,
} from "../services/mimo-extraction.js";

/**
 * Document Desk has separate text-chat and teacher-approved PDF/image extraction.
 * Image bytes go only to the restricted file-extraction callable, never text chat.
 */
const main = document.querySelector("#main");
mountShell({showAssistant:false, showBackdrop:false});
await initFirebase();

let desk = null;
function accessMessage(session) {
  if (!session?.authResolved || (session.user && !session.roleResolved))
    return "Checking your teacher access…";
  if (!session.user) return "Sign in to use the Document & Image Desk.";
  return "Only verified teachers and administrators may use the Document & Image Desk.";
}
function accessGate(session) {
  main.replaceChildren();
  const panel = document.createElement("p");
  panel.className = "doc-access";
  panel.setAttribute("role","status");
  panel.textContent = accessMessage(session);
  if (session?.authResolved && !session.user) {
    const link = document.createElement("a");
    link.href = "login.html?next=documents.html";
    link.textContent = " Sign in";
    panel.append(link);
  }
  main.append(panel);
}
function authorised(session) {
  return canUseMimoTeacherChat(session);
}

function mountDesk(session) {
  const ownerUid = session.user.uid;
  const sessionEpoch = session.epoch;
  main.replaceChildren(document.querySelector("#doc-desk-template").content.cloneNode(true));
  const $ = id => main.querySelector("#" + id);
  const fileInput = $("doc-source"), clearBtn = $("doc-clear"),
    preview = $("doc-preview"), feedback = $("doc-feedback"),
    imageControls = $("doc-image-controls"), downloadBtn = $("doc-download-crop"),
    saveImageBtn = $("doc-save-image"), fileLabel = $("doc-file-name"),
    excerpt = $("doc-excerpt"), question = $("doc-question"), consent = $("doc-consent"),
    askBtn = $("doc-ask"), chatLog = $("doc-ai-log"),
    extractBtn=$("doc-extract-start"), extractPage=$("doc-extract-page"),
    extractConsent=$("doc-extract-consent"), extractRefresh=$("doc-extract-refresh"),
    extractStatus=$("doc-extract-status"), extractResult=$("doc-extract-preview"),
    extractSummary=$("doc-extract-summary"), extractDecision=$("doc-extract-decision"),
    extractQuestions=$("doc-extract-questions"), extractExport=$("doc-extract-export"),
    extractPng=$("doc-extract-png"), extractFigure=$("doc-extract-image");
  const urls = new Set();
  let current = null, cropped = null, cropUrl = null;
  let selectionVersion = 0, pending = false, uploadPending = false, disposed = false, history = [];
  let extractPending=false,activeJob=null,review=null,generatedFigureUrl=null;
  const stillOwner = () => !disposed && authorised(getSession()) &&
    getSession().user.uid === ownerUid && getSession().epoch === sessionEpoch;
  function tell(text, isError = false) {
    feedback.textContent = text;
    feedback.dataset.error = String(isError);
  }
  function noFile() {
    const node = document.createElement("div");
    node.className = "doc-placeholder";
    const title = document.createElement("strong");
    title.textContent = "Open a PDF, image or text file";
    const sub = document.createElement("span");
    sub.textContent = "Preview PDF pages, select an image crop, or use text/TeX as AI context.";
    node.append(title,sub);
    preview.replaceChildren(node);
  }
  function releaseUrl(url) {
    if (url) {
      URL.revokeObjectURL(url);
      urls.delete(url);
    }
  }
  function resetSource() {
    selectionVersion += 1;
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    current = null;
    cropped = null;
    cropUrl = null;
    fileInput.value = "";
    fileLabel.textContent = "No file chosen";
    excerpt.value = "";
    question.value = "";
    consent.checked = false;
    history = [];
    chatLog.replaceChildren();
    clearBtn.disabled = true;
    imageControls.hidden = true;
    downloadBtn.disabled = true;
    noFile();
    extractConsent.checked=false;
    extractBtn.disabled=true;
    extractRefresh.hidden=true;
    extractResult.hidden=true;
    activeJob=null;review=null;
    extractQuestions.replaceChildren();
    extractFigure.replaceChildren();
    extractFigure.hidden=true;
    if(generatedFigureUrl){URL.revokeObjectURL(generatedFigureUrl);generatedFigureUrl=null;}
    extractStatus.textContent="Choose a PDF, PNG or JPEG to begin a new extraction.";
  }
  async function chooseSource(file) {
    const previousJob=activeJob;
    resetSource();
    if(previousJob){activeJob=previousJob;extractRefresh.hidden=false;}
    const version = selectionVersion;
    if (!file) return;
    tell("Checking the file signature and size locally…");
    try {
      const meta = await inspectLocalDocument(file);
      if (version !== selectionVersion || !stillOwner()) return;
      current = {file, ...meta};
      extractBtn.disabled=!("pdf"===meta.kind || ("image"===meta.kind && /\.(png|jpe?g)$/i.test(meta.name))) || meta.size>MAX_MIMO_FILE_BYTES;
      extractPage.disabled=meta.kind!=="pdf";
      extractStatus.textContent=extractBtn.disabled
        ?"This file cannot be sent to Mimo vision (PDF, PNG or JPEG up to 8 MiB only)."
        :"Ready for extraction. Review the file and check the consent box.";
      fileLabel.textContent = meta.name + " · " + Math.round(meta.size / 1024) + " KB";
      clearBtn.disabled = false;
      const url = meta.kind === "text" ? null : URL.createObjectURL(file);
      if (url) urls.add(url);
      if (meta.kind === "pdf") {
        const pdf = document.createElement("iframe");
        pdf.title = "Local PDF preview — " + meta.name;
        pdf.src = url;
        pdf.setAttribute("aria-label",pdf.title);
        preview.replaceChildren(pdf);
        tell("Local PDF preview ready. Select text in the PDF viewer and paste it into the excerpt box; PDF OCR and extraction are not connected yet.");
      } else if (meta.kind === "text") {
        const pre = document.createElement("pre");
        pre.textContent = meta.text.slice(0, 30000) +
          (meta.text.length > 30000 ? "\n\n[Preview limited to 30,000 characters]" : "");
        preview.replaceChildren(pre);
        excerpt.value = meta.text.slice(0, 3700);
        consent.checked = false;
        tell("Local text loaded. Review and edit the excerpt before explicitly sending it to Mimo.");
      } else {
        const frame = document.createElement("div");
        frame.className = "doc-image-frame";
        const img = document.createElement("img");
        img.alt = "Local image: " + meta.name;
        img.src = url;
        const layer = document.createElement("div");
        layer.className = "doc-image-layer";
        layer.setAttribute("role","img");
        layer.setAttribute("aria-label","Image crop area; drag with a pointer to select a figure");
        const box = document.createElement("div");
        box.className = "doc-image-box";
        box.hidden = true;
        frame.append(img, layer, box);
        preview.replaceChildren(frame);
        imageControls.hidden = false;
        tell("Image preview ready. Drag over a figure to create a PNG crop. AI image recognition is not connected.");
        img.onload = () => {
          if (!stillOwner() || version !== selectionVersion) return;
          if (!img.naturalWidth || !img.naturalHeight ||
              img.naturalWidth * img.naturalHeight > 30_000_000) {
            tell("Image dimensions are too large to crop safely (max 30 megapixels).",true);
            layer.style.pointerEvents = "none";
          }
        };
        let origin = null, pointerId = null, rect = null;
        const point = event => {
          const r = img.getBoundingClientRect();
          return {
            x: Math.max(0, Math.min(r.width,event.clientX-r.left)),
            y: Math.max(0, Math.min(r.height,event.clientY-r.top)),
          };
        };
        layer.addEventListener("pointerdown", event => {
          if (!stillOwner() || !img.complete || !img.naturalWidth || event.button !== 0) return;
          pointerId = event.pointerId;
          origin = point(event);
          rect = null;
          box.hidden = false;
          layer.setPointerCapture(pointerId);
        });
        layer.addEventListener("pointermove", event => {
          if (!origin || event.pointerId !== pointerId) return;
          const p = point(event);
          rect = {x:Math.min(origin.x,p.x),y:Math.min(origin.y,p.y),
            width:Math.abs(p.x-origin.x),height:Math.abs(p.y-origin.y)};
          Object.assign(box.style,{left:rect.x+"px",top:rect.y+"px",
            width:rect.width+"px",height:rect.height+"px"});
        });
        layer.addEventListener("pointerup", async event => {
          if (event.pointerId !== pointerId) return;
          const chosen = rect;
          origin = null; pointerId = null;
          if (!chosen || chosen.width < 12 || chosen.height < 12) {
            box.hidden = true; return;
          }
          try {
            const imgRect = img.getBoundingClientRect();
            const scaleX = img.naturalWidth / imgRect.width;
            const scaleY = img.naturalHeight / imgRect.height;
            const sourceX = Math.floor(chosen.x * scaleX);
            const sourceY = Math.floor(chosen.y * scaleY);
            const width = Math.min(img.naturalWidth - sourceX,Math.ceil(chosen.width * scaleX));
            const height = Math.min(img.naturalHeight - sourceY,Math.ceil(chosen.height * scaleY));
            if (width < 1 || height < 1 || width*height > 16_000_000)
              throw new Error("Selection is too large. Choose a smaller figure.");
            const canvas = document.createElement("canvas");
            canvas.width = width; canvas.height = height;
            canvas.getContext("2d").drawImage(img,sourceX,sourceY,width,height,0,0,width,height);
            const blob = await new Promise((resolve,reject) =>
              canvas.toBlob(value => value?resolve(value):reject(new Error("Crop failed")),"image/png"));
            if (version !== selectionVersion || !stillOwner()) return;
            if (blob.size > 10*1024*1024) throw new Error("Crop is larger than 10 MB.");
            cropped = new File([blob],meta.name.replace(/\.[^.]+$/,"") + "-crop.png",{type:"image/png"});
            releaseUrl(cropUrl);
            cropUrl = URL.createObjectURL(cropped);
            urls.add(cropUrl);
            downloadBtn.disabled = false;
            tell("Figure crop ready ("+width+"×"+height+"). Download or explicitly save it privately; nothing has been uploaded.");
          } catch(error) {if(stillOwner()) tell(error.message,true);}
        });
        layer.addEventListener("pointercancel",()=>{origin=null;pointerId=null;box.hidden=true;});
      }
    } catch(error) {
      if (version !== selectionVersion || !stillOwner()) return;
      tell(error.message || "Could not open file.",true);
      resetSource();
    }
  }

  function addLog(label, body, isError = false) {
    const row = document.createElement("article");
    row.className = "doc-ai-entry";
    row.dataset.error = String(isError);
    const heading = document.createElement("strong"), content = document.createElement("div");
    heading.textContent = label;
    content.textContent = String(body).slice(0, 16000);
    row.append(heading,content);
    chatLog.prepend(row);
    while (chatLog.childElementCount > 8) chatLog.lastElementChild.remove();
  }
  fileInput.addEventListener("change",event => void chooseSource(event.target.files?.[0]));
  clearBtn.addEventListener("click",() => {resetSource();tell("Source and its text context cleared from the workspace.");});
  downloadBtn.addEventListener("click",() => {
    if (!cropped || !cropUrl) return;
    const link = document.createElement("a");
    link.href = cropUrl; link.download = cropped.name;
    link.click();
  });
  saveImageBtn.addEventListener("click",async() => {
    if (uploadPending || !stillOwner() || current?.kind !== "image") return;
    const selectedFile = cropped || current.file;
    const version = selectionVersion;
    uploadPending = true;
    saveImageBtn.disabled = true;
    try {
      // Existing Quizer owner-scoped Firebase upload reservation/finalization.
      const assetId = await uploadAsset(selectedFile, progress => {
        if (stillOwner() && selectionVersion === version)
          tell((progress.stage || "Saving") + " · " + (progress.percent || 0) + "%");
      }, "image");
      if (stillOwner() && selectionVersion === version)
        tell("Image saved to Quizer private assets (ID: "+assetId+"). It was NOT sent to Mimo or imported to the problem bank.");
    } catch(error) {
      if (stillOwner() && selectionVersion === version)
        tell("Private image upload failed: "+String(error.message || "Unavailable").slice(0,160),true);
    } finally {
      uploadPending=false;
      if(stillOwner()) saveImageBtn.disabled=false;
    }
  });
  $("doc-ai-form").addEventListener("submit",async event => {
    event.preventDefault();
    if (pending || !stillOwner()) return;
    if (!consent.checked) {addLog("Consent required","Tick the box to approve the selected text for this request.",true);return;}
    const message = question.value.trim();
    let context;
    try {
      if (!message || message.length > 3000) throw new Error("Enter a request of 1–3000 characters.");
      context = makeTeacherContext(excerpt.value,current?.name || "Teacher excerpt");
    } catch(error) {addLog("Check the request",error.message,true);return;}
    const id = crypto.randomUUID();
    const version = selectionVersion;
    pending = true;askBtn.disabled=true;
    addLog("You",message);
    addLog("Status","Waiting for one Mimo response…");
    try {
      const answer = await sendTeacherChatMessage({
        message,context,history:history.slice(-8),requestId:id,
      });
      if (!stillOwner() || version !== selectionVersion) return;
      chatLog.querySelector(".doc-ai-entry")?.remove();
      addLog("Mimo · text context only",answer.reply);
      history = [...history,{role:"user",content:message.slice(0,1200)},
        {role:"assistant",content:answer.reply.slice(0,1200)}].slice(-8);
      consent.checked=false;
      question.value="";
    } catch(error) {
      if (!stillOwner() || version !== selectionVersion) return;
      chatLog.querySelector(".doc-ai-entry")?.remove();
      addLog("Mimo request not confirmed",mimoChatErrorMessage(error) +
        " Request reference: "+id+". Do not automatically retry an uncertain request.",true);
    } finally {pending=false;if(stillOwner()) askBtn.disabled=false;}
  });

  // The extraction flow is independent of the text-only chat above.
  function extractionMessage(message,failed=false){
    if(!stillOwner())return;
    extractStatus.textContent=message;
    extractStatus.dataset.error=String(failed);
  }
  function element(tag,text,cls){
    const node=document.createElement(tag);
    if(text!==undefined)node.textContent=String(text);
    if(cls)node.className=cls;
    return node;
  }
  function labelledControl(card,label,value,textarea=false){
    const wrapper=element("label");
    wrapper.append(element("span",label));
    const input=element(textarea?"textarea":"input");
    if(textarea){input.rows=3;input.value=value??"";}
    else{input.type="text";input.value=value??"";}
    wrapper.append(input);card.append(wrapper);
    return input;
  }
  function parseOptions(text,question){
    if(question.question_type!=="multiple_choice")return [];
    const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    return lines.map((line,i)=>{
      const m=/^([A-L])\s*:\s*(.+)$/.exec(line);
      if(!m)throw Error("Option "+(i+1)+" must look like A: expression");
      return {label:m[1],latex:m[2]};
    });
  }
  function renderReview(){
    if(!review||!stillOwner())return;
    extractQuestions.replaceChildren();
    extractSummary.textContent=review.items.length+" question(s) · quality: "+review.quality_status;
    if(!review.items.length){
      extractQuestions.append(element("p","No questions were extracted. Check that the PDF/image really contained visible content; this run must not be imported.","doc-field-note"));
    }
    for(const item of review.items){
      const q=item.review?.edited||item.original;
      const card=element("article",undefined,"doc-extract-question");
      card.append(element("h4","Question "+q.printed_number+" · "+q.question_type.replaceAll("_"," ")));
      if(q.review_required||q.uncertain_spans.length||q.review_reasons.length)
        card.append(element("p","Review flags: "+[...q.review_reasons,...q.uncertain_spans.map(x=>x.reason)].join("; ").slice(0,800),"doc-field-note"));
      const statement=labelledControl(card,"Statement (LaTeX)",q.statement_latex,true);
      const options=q.question_type==="multiple_choice"?
        labelledControl(card,"Options (one per line: A: ..., B: ...)",q.options.map(x=>x.label+": "+x.latex).join("\n"),true):null;
      const answer=labelledControl(card,"Verified answer (required for multiple-choice)",q.answer||"");
      const description=q.has_figure?
        labelledControl(card,"Figure description",q.figure_description||"",true):null;
      let assetAlias=null,assetId=null;
      if(q.has_figure){
        card.append(element("p","A figure needs a Quizer-owned image asset and a matching \\includegraphics{alias.png} reference before approval. Inspect/download the reconstructed PNG, then save it privately and enter the reviewed asset ID.","doc-field-note"));
        assetAlias=labelledControl(card,"Figure alias used in \\includegraphics{...}","figure.png");
        assetId=labelledControl(card,"Quizer private asset ID (ast_...)","");
      }
      const verifiedLabel=element("label",undefined,"doc-consent");
      const verified=element("input");verified.type="checkbox";
      verifiedLabel.append(verified,element("span","I checked this question against the source page."));
      card.append(verifiedLabel);
      const manualLabel=element("label",undefined,"doc-consent");
      const manual=element("input");manual.type="checkbox";
      manualLabel.append(manual,element("span","Use teacher manual marking if no answer key is available."));
      card.append(manualLabel);
      const rejectReason=labelledControl(card,"Reason if rejecting this question","");
      const actions=element("div",undefined,"doc-review-actions");
      const approve=element("button","Approve question","doc-primary");
      const reject=element("button","Reject question","doc-secondary");
      approve.type=reject.type="button";
      actions.append(approve,reject);card.append(actions);
      const state=element("div",item.decision==="pending"?"Awaiting teacher review":"Decision: "+item.decision,"doc-reviewed-state");
      card.append(state);
      const decide=action=>{
        if(!stillOwner())return;
        try{
          const edits={statement_latex:statement.value,
            options:options?parseOptions(options.value,q):[],
            answer:answer.value.trim()||null,
            figure_description:description?description.value.trim()||null:null};
          const bindings=assetAlias?.value.trim()&&assetId?.value.trim()?
            {[assetAlias.value.trim()]:assetId.value.trim()}:{};
          review=decideTeacherReview(review,item.id,{
            action,edits,figure_assets:bindings,
            verified_against_source:verified.checked,
            manual_marking_confirmed:manual.checked,
            reason:action==="reject"?rejectReason.value.trim()||null:null,
          },ownerUid);
          renderReview();
          extractionMessage("Teacher decision recorded locally. Nothing has been imported or published.");
        }catch(err){state.textContent=err.message;state.dataset.error="true";}
      };
      approve.addEventListener("click",()=>decide("approve"));
      reject.addEventListener("click",()=>decide("reject"));
      extractQuestions.append(card);
    }
    extractExport.disabled=review.quality_status==="fail"||
      !review.items.length||review.items.some(i=>i.decision==="pending")||
      !review.items.some(i=>i.decision==="approve");
  }
  function filename(title){
    return title.replace(/[^A-Za-z0-9_-]+/g,"_").slice(0,70)||"reviewed_questions";
  }
  async function updateExtraction(){
    if(extractPending||!activeJob||!stillOwner())return;
    extractPending=true;extractRefresh.disabled=true;
    try{
      const status=await readMimoExtraction(activeJob);
      if(!stillOwner())return;
      if(status.state==="completed"){
        if(!current || !/\.(pdf|png|jpe?g)$/i.test(current.name)){
          extractionMessage("Select the original PDF/image used for this job before reviewing its questions.",true);
          return;
        }
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await current.file.arrayBuffer())))
          .map(x=>x.toString(16).padStart(2,"0")).join("");
        if(!stillOwner())return;
        if(digest!==status.page?.source?.sha256){
          extractionMessage("The selected source file does not match this Mimo job. Re-select the original PDF/image.",true);
          return;
        }
        review=buildTeacherReview(status.page);
        extractResult.hidden=false;extractRefresh.hidden=true;
        extractDecision.textContent="Diagram plan: "+(status.diagramDecision||"not available");
        extractPng.hidden=!status.hasReconstruction;
        renderReview();
        extractionMessage("Extraction completed. Check the original page and review each question.");
      }else if(status.state==="failed"||status.state==="attention"){
        extractRefresh.hidden=false;
        extractionMessage("Extraction needs attention ("+(status.error||status.state)+"). No automatic retry is performed.",true);
      }else{
        extractRefresh.hidden=false;
        extractionMessage("Mimo job "+activeJob.slice(0,14)+"… is "+status.state+". Click Refresh status to check again.");
      }
    }catch(err){if(stillOwner())extractionMessage(extractionError(err),true);}
    finally{extractPending=false;if(stillOwner())extractRefresh.disabled=false;}
  }
  extractBtn.addEventListener("click",async()=>{
    if(extractPending||!stillOwner()||!current||!extractConsent.checked){
      extractionMessage("Choose a PDF/image and explicitly approve upload to Mimo.",true);
      return;
    }
    if(!["pdf","image"].includes(current.kind)||!/\.(pdf|png|jpe?g)$/i.test(current.name)){
      extractionMessage("Only PDF, PNG and JPEG are supported for Mimo extraction.",true);return;
    }
    const version=selectionVersion;
    const page=current.kind==="pdf"?Number(extractPage.value):1;
    if(!Number.isInteger(page)||page<1||page>100){
      extractionMessage("Select a PDF page from 1 to 100.",true);return;
    }
    extractPending=true;extractBtn.disabled=true;extractRefresh.hidden=true;
    extractionMessage("Securely uploading original source and starting Mimo. Do not resubmit if the outcome is uncertain…");
    try{
      const result=await submitMimoExtraction(current.file,page);
      if(!stillOwner()||selectionVersion!==version)return;
      activeJob=result.jobId;
      try{sessionStorage.setItem("mathquiz.recovery.mimo-extraction."+ownerUid,activeJob);}catch{}
      extractConsent.checked=false;
      extractRefresh.hidden=false;
      extractionMessage("Job started: "+activeJob+". Click Refresh status when Mimo finishes.");
    }catch(err){
      if(stillOwner()&&selectionVersion===version)
        extractionMessage(extractionError(err)+" Request reference: "+(err.requestId||"unavailable")+".",true);
    }finally{
      extractPending=false;
      if(stillOwner())extractBtn.disabled=false;
    }
  });
  extractRefresh.addEventListener("click",updateExtraction);
  extractExport.addEventListener("click",()=>{
    if(!review||!stillOwner())return;
    try{
      const title="Reviewed mathematics page "+review.source.page_number;
      const prepared=exportTeacherReview(review,title);
      const blob=new Blob([prepared.latex],{type:"text/x-tex;charset=utf-8"});
      const url=URL.createObjectURL(blob),link=element("a");
      link.href=url;link.download=filename(title)+".tex";link.click();
      setTimeout(()=>URL.revokeObjectURL(url),2000);
      extractionMessage(prepared.items.length+" reviewed questions exported as LaTeX. Import the .tex through Quizer's Create quiz interface.");
    }catch(err){extractionMessage(err.message,true);}
  });
  extractPng.addEventListener("click",async()=>{
    if(!activeJob||!stillOwner())return;
    extractPng.disabled=true;
    try{
      const image=decodeMimoPng(await readMimoPng(activeJob));
      if(!stillOwner())return;
      if(generatedFigureUrl)URL.revokeObjectURL(generatedFigureUrl);
      generatedFigureUrl=URL.createObjectURL(image);
      extractFigure.replaceChildren();
      const preview=element("img");preview.src=generatedFigureUrl;
      preview.alt="Mimo-reconstructed TikZ PNG; teacher must check geometry.";
      const download=element("a","Download reconstructed PNG","doc-secondary");
      download.href=generatedFigureUrl;download.download="mimo-reconstructed-diagram.png";
      const save=element("button","Save PNG to Quizer private assets","doc-secondary");
      save.type="button";
      save.addEventListener("click",async()=>{
        save.disabled=true;
        try{
          const file=new File([image],"mimo-reconstructed-diagram.png",{type:"image/png"});
          const id=await uploadAsset(file,()=>{},"image");
          if(stillOwner())extractionMessage("Reconstructed image saved privately as "+id+". Verify the figure, then enter this asset ID in the corresponding question's review form.");
        }catch(err){if(stillOwner())extractionMessage("Could not save image: "+err.message,true);}
        finally{save.disabled=false;}
      });
      extractFigure.append(preview,download,save);
      extractFigure.hidden=false;
    }catch(err){if(stillOwner())extractionMessage(extractionError(err),true);}
    finally{if(stillOwner())extractPng.disabled=false;}
  });

  noFile();
  // A background Mimo run survives page navigation. Resume only for the same signed-in teacher.
  try {
    const previous=sessionStorage.getItem("mathquiz.recovery.mimo-extraction."+ownerUid);
    if(/^[a-f0-9]{64}$/.test(previous||"")){
      activeJob=previous;
      extractRefresh.hidden=false;
      extractionMessage("Previous Mimo job "+previous.slice(0,14)+"… available. Re-select the source page to review it, then click Refresh job status.");
    }
  }catch{}
  return {
    ownerUid,
    sessionEpoch,
    dispose() {
      disposed=true;
      resetSource();
      history=[];
      main.replaceChildren();
    },
  };
}
watchSession(session => {
  if (authorised(session)) {
    if (desk && desk.ownerUid === session.user.uid && desk.sessionEpoch === session.epoch) return;
    desk?.dispose();
    desk = mountDesk(session);
  } else {
    desk?.dispose();
    desk = null;
    accessGate(session);
  }
});
