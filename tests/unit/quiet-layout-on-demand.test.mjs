import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const admin=read("js/pages/admin.js"),manage=read("js/pages/quiz-manage.js");
const bank=read("js/pages/problems.js"),css=read("assets/css/pages/editor.css");
const home=read("js/pages/home.js");
const section=(source,begin,end)=>source.slice(source.indexOf(begin),source.indexOf(end,source.indexOf(begin)+1));

test("admin tabs render empty state and only user actions fetch records",()=>{
  for(const [name,next,placeholder] of [
    ["users","activity","#users-list"],
    ["activity","content",".history-feed"],
    ["content","jobs","#content-list"],
    ["jobs","switchTab","#jobs-list"],
  ]){
    const block=section(admin,"  async function "+name+"(","  async function "+next+"(");
    assert(block.includes('panel.querySelector("'+placeholder+'").innerHTML = empty('),name);
    assert.match(block,/bindForm\(panel\.querySelector\("form"\)/);
    assert(!/\n    await load\(\);\s*\n  \}/.test(block),name+" loads on tab entry");
  }
});
test("quiz history waits for click and offers explicit downloadable CSV",()=>{
  const history=section(manage,"  async function showHistory()","  async function show(value)");
  assert.match(history,/id="history-load"/);
  assert.match(history,/id="history-download"/);
  assert.match(history,/action\(panel, "#history-load"/);
  assert.match(history,/action\(panel, "#history-download"/);
  assert.match(history,/downloadBlob\(/);
  assert(!/\n    await load\(\);\s*\n  \}/.test(history));
});
test("bank is one column with inline compact controls",()=>{
  assert.match(css,/body\[data-page="problems"\] #bank-list\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.doesNotMatch(bank,/document\.body\.append\(panel\)/);
  assert.match(bank,/panelHome\.prepend\(panel\)/);
});
test("home has no eager separate starred request and caps displayed cards",()=>{
  assert.doesNotMatch(home,/mountStarred/);
  assert.match(home,/slice\(0, 2\)/);
  assert.match(home,/getDashboard/);
});
