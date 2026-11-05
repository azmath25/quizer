import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const pages=[
  ["teaching","js/pages/teaching.js","Teaching workspace"],
  ["activity","js/pages/activity.js","Activity"],
  ["problems","js/pages/problems.js","Problem bank"],
  ["manage","js/pages/quiz-manage.js","Quiz management"],
  ["create/edit","js/pages/quiz-editor.js","Creation method"],
  ["admin","js/pages/admin.js","Administration"],
];

test("Every public workspace submenu uses the shared anchored class",()=>{
  for(const [name,file,label] of pages){
    const content=read(file);
    assert.match(content,new RegExp(
      'class="tabs workspace-subnav" role="tablist" aria-label="'+label+'"'),
      name+" must use the page-level subnav component");
  }
  assert.match(read("js/pages/quiz-editor.js"),
    /class="tabs workspace-subnav mobile-editor-tabs" role="tablist" aria-label="Quiz editor"/);
});

test("All page-level submenus directly follow headings; admin instructions come after tabs",()=>{
  for(const [name,file,label] of pages){
    const src=read(file);
    const head=src.indexOf("pageHead(");
    const tabs=src.indexOf('class="tabs workspace-subnav"');
    assert(head>=0&&tabs>head,name+" must follow its heading");
    const gap=src.slice(head,tabs);
    assert(!gap.includes('class="admin-intro"'),
      "Administration intro must not shift the tab bar down");
  }
  const admin=read("js/pages/admin.js");
  assert(admin.indexOf("admin-intro")>
    admin.indexOf('class="tabs workspace-subnav"'));
  const editor=read("js/pages/quiz-editor.js");
  const editIndex=editor.indexOf('aria-label="Quiz editor"');
  assert(editIndex>0);
  assert(editor.indexOf("<div data-message></div><form id=",
    editIndex)>editIndex,"Editor keeps its error/status destination after tabs");
});

test("Only primary menus share normal-flow geometry, nested preview tabs remain independent",()=>{
  const css=read("assets/css/layout.css");
  assert.match(css,/main > div > \.tabs\.workspace-subnav\s*\{/);
  assert.match(css,/position: static;/);
  assert.match(css,/min-height: 112px/);
  assert.match(css,/min-height: 160px/);
  const editor=read("js/pages/quiz-editor.js");
  assert.match(editor,/class="tabs mobile-editor-tabs" role="tablist" aria-label="Import preview"/);
  assert.doesNotMatch(editor,/class="tabs workspace-subnav mobile-editor-tabs" role="tablist" aria-label="Import preview"/);
  assert.match(css,/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});
