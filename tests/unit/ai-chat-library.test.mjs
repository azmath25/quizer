import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

class N {
  constructor(tag){this.tag=tag;this.children=[];this.listeners={};this._text="";this.hidden=false;this.disabled=false;this.value="";}
  set textContent(v){this._text=String(v);this.children=[];}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join("");}
  append(...nodes){this.children.push(...nodes);}
  prepend(node){this.children.unshift(node);}
  replaceChildren(...nodes){this.children=[];this._text="";this.append(...nodes);}
  setAttribute(key,v){this[key]=String(v);}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  async fire(type){const event={preventDefault(){}};await Promise.all((this.listeners[type]||[]).map(fn=>fn(event)));}
  remove(){this.removed=true;}
  focus(){globalThis.__focused=this;}
  find(fn){if(fn(this))return this;for(const n of this.children){const match=n.find(fn);if(match)return match;}return null;}
  querySelector(tag){return this.find(n=>n.tag===tag);}
}
globalThis.document={createElement:tag=>new N(tag)};
const source=readFileSync(new URL("../../js/components/ai-chat-library.js",import.meta.url),"utf8");
const prepared=source.replace(/import \{[\s\S]*?\} from "\.\.\/services\/mimo-chat\.js";/,
 "const {listTeacherChats,getTeacherChat,listTeacherDocuments,createTeacherTextDocument,mimoChatErrorMessage}=globalThis.__libraryApi;");
assert.notEqual(source,prepared);
const {createAiChatLibrary}=await import("data:text/javascript;base64,"+Buffer.from(prepared).toString("base64"));
const turn=()=>new Promise(resolve=>setImmediate(resolve));

function setup(){
  const apiCalls=[];
  globalThis.__libraryApi={
    listTeacherChats:async()=>{apiCalls.push("chats");return {threads:[{id:"chat-1",title:"Linear equations"}]};},
    getTeacherChat:async id=>{apiCalls.push("chat-"+id);return {thread:{id},messages:[{role:"assistant",content:"x=2"}]};},
    listTeacherDocuments:async()=>{apiCalls.push("documents");return {documents:[{id:"doc-1",title:"Lesson notes"}]};},
    createTeacherTextDocument:async data=>{apiCalls.push(data);return {documentId:"new-doc",status:"text_ready"};},
    mimoChatErrorMessage:()=>"Unavailable",
  };
  const panel=new N("section"),log=new N("div"),form=new N("form"),trigger=new N("button");
  const selected=[];
  const library=createAiChatLibrary({
    panel,log,form,trigger,
    onChat:chat=>selected.push(["chat",chat]),
    onDocument:doc=>selected.push(["document",doc]),
    onClose:()=>{},
  });
  return {panel,log,form,trigger,library,apiCalls,selected};
}
test("Library opens in the popup and loads only through the existing callable",async()=>{
  const h=setup();
  await h.trigger.fire("click");await turn();
  assert.equal(h.library.isOpen(),true);
  assert.equal(h.log.hidden,true);
  assert.equal(h.form.hidden,true);
  assert.deepEqual(h.apiCalls,["chats","documents"]);
  assert.match(h.library.root.textContent,/Linear equations/);
  assert.match(h.library.root.textContent,/Lesson notes/);
  assert.match(h.library.root.textContent,/PDF and image upload are not enabled/);
});

test("Selecting a saved thread loads messages, closes the view and restores composer",async()=>{
  const h=setup();
  await h.trigger.fire("click");await turn();
  const choose=h.library.root.find(n=>n.tag==="button"&&n.textContent==="Linear equations");
  await choose.fire("click");
  assert.equal(h.selected.length,1);
  assert.equal(h.selected[0][1].messages[0].content,"x=2");
  assert.equal(h.library.isOpen(),false);
  assert.equal(h.form.hidden,false);
  assert.equal(h.log.hidden,false);
});

test("Choosing an authorized text document provides only its ID to chat",async()=>{
  const h=setup();
  await h.trigger.fire("click");await turn();
  const choose=h.library.root.find(n=>n.tag==="button"&&n.textContent==="Use: Lesson notes");
  await choose.fire("click");
  assert.deepEqual(h.selected[0],["document",{documentId:"doc-1",title:"Lesson notes"}]);
  assert.equal(h.library.isOpen(),false);
});

test("Text notes are saved without uploading any file or using a direct Neon client",async()=>{
  const h=setup();
  await h.trigger.fire("click");await turn();
  const paste=h.library.root.find(n=>n.tag==="form");
  const title=paste.find(n=>n.tag==="input");
  const text=paste.find(n=>n.tag==="textarea");
  title.value="Geometry";
  text.value="The triangle is isosceles.";
  await paste.fire("submit");
  assert.equal(h.selected[0][1].documentId,"new-doc");
  const logged=h.apiCalls.find(x=>typeof x==="object");
  assert.deepEqual(logged,{title:"Geometry",text:"The triangle is isosceles."});
  assert.doesNotMatch(source,/\bfetch\s*\(|\bindexedDB\b|\bWebSocket\b/);
});
