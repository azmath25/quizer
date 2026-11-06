import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  MAX_LOCAL_FILE_BYTES,MAX_TEXT_FILE_BYTES,
  inspectLocalDocument,teacherExcerpt,makeTeacherContext,
} from "../../js/services/local-document.js";

const file = (bytes,name,type="application/octet-stream") =>
  new File([bytes],name,{type});
const pdf = () => file(new Uint8Array([37,80,68,70,45,49,46,55]),"math.pdf","application/pdf");
const png = () => file(new Uint8Array([137,80,78,71,13,10,26,10,1,2]),"figure.png","image/png");

test("Document Desk verifies PDF signatures rather than trusting MIME headers", async()=>{
  const good=await inspectLocalDocument(pdf());
  assert.deepEqual({kind:good.kind,name:good.name},{kind:"pdf",name:"math.pdf"});
  await assert.rejects(inspectLocalDocument(file("not-a-pdf","spoofed.pdf","application/pdf")),/signature/);
  await assert.rejects(inspectLocalDocument(file("%PDF-1.7","spoofed.png","image/png")),/signature/);
  await assert.rejects(inspectLocalDocument(file("%PDF-1.7","ignored.exe","application/pdf")),/signature/);
});

test("Image previews admit PNG, JPEG, WebP only when magic bytes match",async()=>{
  assert.equal((await inspectLocalDocument(png())).kind,"image");
  assert.equal((await inspectLocalDocument(file(new Uint8Array([255,216,255,9]),"a.jpeg"))).kind,"image");
  assert.equal((await inspectLocalDocument(file(new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80]),"a.webp"))).kind,"image");
  await assert.rejects(inspectLocalDocument(file(new Uint8Array([0,0,0,0]),"fake.webp")),/signature/);
  await assert.rejects(inspectLocalDocument(file(new Uint8Array([0,0,0,0]),"fake.jpg")),/signature/);
});

test("Text admission validates UTF-8 and refuses binary disguised as text",async()=>{
  assert.equal((await inspectLocalDocument(file("Solve $x+1=2$","worksheet.tex","text/plain"))).text,"Solve $x+1=2$");
  await assert.rejects(inspectLocalDocument(file(new Uint8Array([0xff,0xfe,0x00]),"bad.txt")),/UTF-8/);
  await assert.rejects(inspectLocalDocument(file(new Uint8Array([65,0,66]),"binary.txt")),/Binary/);
  await assert.rejects(inspectLocalDocument(file("","empty.txt")),/nonempty/);
});

test("Per-file local maximums and bounded model context are enforced",async()=>{
  assert.equal(MAX_LOCAL_FILE_BYTES,10*1024*1024);
  assert.equal(MAX_TEXT_FILE_BYTES,512*1024);
  await assert.rejects(inspectLocalDocument(file("x".repeat(MAX_TEXT_FILE_BYTES+1),"huge.tex")),/signature/);
  await assert.rejects(inspectLocalDocument(file("x".repeat(MAX_LOCAL_FILE_BYTES+1),"huge.pdf")),/10 MB/);
  assert.equal(teacherExcerpt(" \r\nabc\r\n "), "abc");
  const context=makeTeacherContext("Solve $x=2$\n\nChoose answer A","text.tex");
  assert.match(context,/Teacher-selected text/);
  assert.match(context,/Solve \$x=2\$/);
  assert.ok(context.length<=4000);
  await assert.rejects(async()=>makeTeacherContext("  ","file.txt"),/Paste or select/);
});

test("Document Desk remains teacher gated and never transmits file bytes to the Mimo text callable",()=>{
  const html=readFileSync(new URL("../../documents.html",import.meta.url),"utf8");
  const ui=readFileSync(new URL("../../js/pages/documents.js",import.meta.url),"utf8");
  const shell=readFileSync(new URL("../../js/components/shell.js",import.meta.url),"utf8");
  assert.match(shell,/\["documents", "documents\.html", "Documents"\]/);
  for (const id of ["doc-source","doc-preview","doc-excerpt","doc-question","doc-consent","doc-ai-form","doc-ai-log"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(ui,/canUseMimoTeacherChat/);
  assert.match(ui,/sendTeacherChatMessage\(\{/);
  assert.match(ui,/message,context,history:history\.slice\(-8\),requestId:id/);
  assert.doesNotMatch(ui,/readAsDataURL|FileReader|base64|bytes:/);
  assert.match(ui,/uploadAsset\(selectedFile/);
  assert.match(ui,/consent\.checked/);
  assert.match(ui,/version !== selectionVersion/);
});
