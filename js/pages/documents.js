import {initFirebase, watchSession, getSession} from "../firebase-client.js";
import {mountShell} from "../components/shell.js";
import {uploadAsset} from "../services/assets.js";
import {
  canUseMimoTeacherChat, sendTeacherChatMessage, mimoChatErrorMessage,
} from "../services/mimo-chat.js";
import {inspectLocalDocument, makeTeacherContext} from "../services/local-document.js";

/**
 * Document Desk is a real, client-only file preview and text-to-Mimo feature.
 * PDF/image binary is NEVER submitted to the text-only chat callable.
 * No persistent document job or extraction pipeline is represented here.
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
    askBtn = $("doc-ask"), chatLog = $("doc-ai-log");
  const urls = new Set();
  let current = null, cropped = null, cropUrl = null;
  let selectionVersion = 0, pending = false, uploadPending = false, disposed = false, history = [];
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
  }
  async function chooseSource(file) {
    resetSource();
    const version = selectionVersion;
    if (!file) return;
    tell("Checking the file signature and size locally…");
    try {
      const meta = await inspectLocalDocument(file);
      if (version !== selectionVersion || !stillOwner()) return;
      current = {file, ...meta};
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
  noFile();
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
