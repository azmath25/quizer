import {
  listTeacherChats,getTeacherChat,listTeacherDocuments,createTeacherTextDocument,
  mimoChatErrorMessage,
} from "../services/mimo-chat.js";

const make=(tag,text,className)=>{
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(className)node.className=className;
  return node;
};
const button=(text,fn)=>{
  const node=make("button",text,"qa-library-button");
  node.type="button";
  node.addEventListener("click",fn);
  return node;
};

/** Inline library view in the existing modal. No extra page or credential. */
export function createAiChatLibrary({
  panel,log,form,trigger,onChat,onDocument,onClose,
}){
  const library=make("section",undefined,"qa-library");
  library.setAttribute("aria-label","Saved chats and documents");
  library.hidden=true;
  panel.append(library);
  let open=false,loading=false;

  const setVisible=visible=>{
    open=visible;
    library.hidden=!visible;
    log.hidden=visible;
    form.hidden=visible;
    trigger.setAttribute("aria-expanded",String(visible));
  };
  function close(){
    setVisible(false);
    onClose?.();
    trigger.focus();
  }
  async function start(){
    if(loading)return;
    setVisible(true);
    library.replaceChildren();
    const nav=make("div",undefined,"qa-library-top");
    nav.append(make("strong","Your AI library"),
      button("Back to chat",close));
    library.append(nav);
    const status=make("p","Loading saved chats and documents…","qa-note");
    status.setAttribute("role","status");
    library.append(status);
    loading=true;
    try {
      // Only teacher-owned rows returned by the authenticated callable.
      const [chats,docs]=await Promise.all([
        listTeacherChats(),listTeacherDocuments(),
      ]);
      if(!open)return;
      status.remove();
      const threads=make("section",undefined,"qa-library-group");
      threads.append(make("h3","Recent chats"));
      const items=(Array.isArray(chats?.threads)?chats.threads:[]).slice(0,25);
      if(!items.length)threads.append(make("p","No saved chats yet."));
      for(const row of items) {
        const label=String(row.title||"New chat").slice(0,120);
        const item=button(label,async()=>{
          if(loading)return;
          loading=true;
          item.disabled=true;
          try{
            const result=await getTeacherChat(row.id);
            if(!open)return;
            onChat?.(result);
            close();
          }catch(error){
            if(open)statusMessage(mimoChatErrorMessage(error));
          }finally{loading=false;item.disabled=false;}
        });
        threads.append(item);
      }
      library.append(threads);
      const documents=make("section",undefined,"qa-library-group");
      documents.append(make("h3","Text documents"));
      documents.append(make("p",
        "Use notes or extracted text you are authorized to share. PDF and image upload are not enabled yet."));
      const records=(Array.isArray(docs?.documents)?docs.documents:[]).slice(0,20);
      for(const row of records) {
        const item=button("Use: "+String(row.title||"Untitled").slice(0,120),()=>{
          onDocument?.({documentId:row.id,title:row.title});
          close();
        });
        documents.append(item);
      }
      documents.append(button("Don't attach a document",()=>{
        onDocument?.({documentId:null,title:null});
        close();
      }));
      const paste=make("form",undefined,"qa-library-paste");
      const title=make("input");
      title.type="text";
      title.maxLength=160;
      title.required=true;
      title.placeholder="Document title";
      title.setAttribute("aria-label","Document title");
      const text=make("textarea");
      text.maxLength=20000;
      text.required=true;
      text.rows=4;
      text.placeholder="Paste extracted text or lesson notes…";
      text.setAttribute("aria-label","Document text");
      const save=make("button","Save text");
      save.type="submit";
      paste.append(make("h4","Save new text document"),title,text,save);
      paste.addEventListener("submit",async event=>{
        event.preventDefault();
        if(loading)return;
        loading=true;
        save.disabled=true;
        try {
          const result=await createTeacherTextDocument({
            title:title.value.trim(),text:text.value.trim(),
          });
          if(!open)return;
          onDocument?.({documentId:result.documentId,title:title.value.trim()});
          close();
        } catch(error){
          if(open) statusMessage(mimoChatErrorMessage(error));
        } finally {loading=false;save.disabled=false;}
      });
      documents.append(paste);
      library.append(documents);
      library.querySelector("button")?.focus();
    }catch(error){
      if(open)status.textContent=mimoChatErrorMessage(error);
    }finally{loading=false;}
  }
  function statusMessage(text){
    const alert=make("p",text,"qa-error");
    alert.setAttribute("role","alert");
    library.prepend(alert);
  }
  trigger.addEventListener("click",()=>{
    if(!open)void start();
    else close();
  });
  return {close,isOpen:()=>open,root:library};
}
