/* P1 one-page Document Lab: local-only PDF/image inspection and image cropping.
 * No network calls. Nothing is uploaded until the user submits the separate
 * authenticated extraction form with its explicit consent checkbox.
 */
import {inspectLocalDocument} from "../services/local-document.js";

const MAX_PIXELS=30_000_000;
const MAX_BYTES=8*1024*1024;
const make=(tag,cls,text)=>{
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(text!==undefined)el.textContent=text;
  return el;
};
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));

export function mountLocalSourcePreview({input,container,onSourceChange=()=>{}}){
  if(!input||!container)throw Error("Source preview requires a file input and container");
  let url=null,crop=null,valid=false,version=0,disposed=false;
  const revoke=()=>{if(url){URL.revokeObjectURL(url);url=null;}};
  const clear=()=>{
    version++;revoke();crop=null;valid=false;container.hidden=true;
    container.replaceChildren();
  };
  const feedback=(text,error=false)=>{
    let line=container.querySelector(".axiom-preview-feedback");
    if(!line){line=make("p","axiom-preview-feedback");container.append(line);}
    line.textContent=text;line.classList.toggle("ai-error",error);
  };
  const addImage=async (file,token)=>{
    const frame=make("div","axiom-preview-frame");
    const img=make("img","axiom-preview-image");
    img.alt="Local source image; drag to select a crop";
    img.src=url;
    const selector=make("div","axiom-crop-layer");
    selector.setAttribute("role","img");
    selector.setAttribute("aria-label","Drag with a mouse or touch to crop a figure");
    const outline=make("div","axiom-crop-outline");outline.hidden=true;
    frame.append(img,selector,outline);container.append(frame);
    const actions=make("div","axiom-crop-actions");
    const reset=make("button","ai-secondary","Undo crop");reset.type="button";reset.hidden=true;
    reset.onclick=()=>{crop=null;reset.hidden=true;feedback("Original source selected. Drag a region to prepare a PNG crop.");onSourceChange();};
    actions.append(reset);container.append(actions);
    await img.decode().catch(()=>{});
    if(disposed||token!==version)return;
    if(!img.naturalWidth||!img.naturalHeight||
       img.naturalWidth*img.naturalHeight>MAX_PIXELS){
      selector.style.pointerEvents="none";
      feedback("This image is too large to crop safely (30 megapixel limit).",true);
      return;
    }
    let start=null,rect=null,pointer=null;
    const pointerPosition=e=>{
      const box=img.getBoundingClientRect();
      return {x:clamp(e.clientX-box.left,0,box.width),
        y:clamp(e.clientY-box.top,0,box.height),width:box.width,height:box.height};
    };
    selector.addEventListener("pointerdown",e=>{
      if(e.button!==0||disposed||token!==version)return;
      const p=pointerPosition(e);
      start=p;rect=null;pointer=e.pointerId;outline.hidden=false;
      Object.assign(outline.style,{left:p.x+"px",top:p.y+"px",width:"0",height:"0"});
      selector.setPointerCapture(e.pointerId);
    });
    selector.addEventListener("pointermove",e=>{
      if(!start||e.pointerId!==pointer)return;
      const p=pointerPosition(e);
      rect={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),
        width:Math.abs(p.x-start.x),height:Math.abs(p.y-start.y)};
      Object.assign(outline.style,{left:rect.x+"px",top:rect.y+"px",
        width:rect.width+"px",height:rect.height+"px"});
    });
    selector.addEventListener("pointercancel",()=>{start=null;rect=null;pointer=null;outline.hidden=true;});
    selector.addEventListener("pointerup",async e=>{
      if(e.pointerId!==pointer)return;
      const selected=rect;start=null;rect=null;pointer=null;
      if(!selected||selected.width<12||selected.height<12){outline.hidden=true;return;}
      const shown=img.getBoundingClientRect();
      if(shown.width<=0||shown.height<=0)return;
      const scaleX=img.naturalWidth/shown.width,scaleY=img.naturalHeight/shown.height;
      const sx=Math.floor(selected.x*scaleX),sy=Math.floor(selected.y*scaleY);
      const width=clamp(Math.ceil(selected.width*scaleX),1,img.naturalWidth-sx);
      const height=clamp(Math.ceil(selected.height*scaleY),1,img.naturalHeight-sy);
      const canvas=document.createElement("canvas");
      canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext("2d");
      if(!ctx){feedback("Could not create image crop.",true);return;}
      ctx.drawImage(img,sx,sy,width,height,0,0,width,height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
      if(disposed||token!==version)return;
      if(!blob||blob.size>MAX_BYTES){
        feedback("Crop exceeds the extraction upload limit (8 MiB). Choose a smaller area.",true);
        outline.hidden=true;return;
      }
      crop=new File([blob],file.name.replace(/\.[^.]+$/,"")+"-crop.png",{type:"image/png"});
      reset.hidden=false;
      feedback("Prepared "+width+" × "+height+" PNG crop locally. Only this crop will be submitted if you start extraction.");
      onSourceChange();
    });
    feedback("Local image ready. Drag over a figure to prepare a crop, or extract the whole image.");
  };
  const show=async()=>{
    clear();const token=version;onSourceChange();
    if(disposed)return;
    const file=input.files?.[0];
    if(!file)return;
    container.hidden=false;
    const title=make("div","axiom-preview-title");
    title.append(make("strong","",file.name),make("small","",Math.ceil(file.size/1024)+" KB · Local preview"));
    container.append(title);
    try{
      if(!file.size||file.size>MAX_BYTES)throw Error("Source must be between 1 byte and 8 MiB.");
      const meta=await inspectLocalDocument(file);
      if(disposed||token!==version)return;
      if(!["pdf","image"].includes(meta.kind) ||
         (meta.kind==="image"&&!/\.(png|jpe?g)$/i.test(file.name)))
        throw Error("Extraction supports PDF, PNG and JPEG sources only.");
      valid=true;
      url=URL.createObjectURL(file);
      if(meta.kind==="pdf"){
        const preview=make("iframe","axiom-preview-pdf");
        preview.title="Local PDF preview — "+file.name;
        preview.src=url;container.append(preview);
        feedback("PDF preview is local. Select pages and budget below; nothing uploads until consent.");
      }else await addImage(file,token);
    }catch(error){
      valid=false;
      feedback(String(error?.message||"Cannot inspect source locally.").slice(0,180),true);
    }
  };
  input.addEventListener("change",show);
  return Object.freeze({
    getFile:()=>valid?(crop??input.files?.[0]??null):null,
    usingCrop:()=>!!crop,
    dispose:()=>{disposed=true;clear();input.removeEventListener("change",show);},
    refresh:show,
  });
}
