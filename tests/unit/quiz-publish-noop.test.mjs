import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {isCurrentPublishedDraft} from "../../functions/src/bundles/publication-noop.js";

const root=new URL("../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
const draft=()=>({
  version:7,title:"Exam",description:"",subject:"Math",difficulty:"Medium",
  settings:{durationSeconds:1200,penalty:0,scoreRelease:"manual",
    solutionRelease:"never",allowBack:true,shuffleQuestions:false,
    shuffleOptions:false,passFailEnabled:false,passPercentage:50},
  itemOrder:["itm_1","itm_2","itm_3"],
});
const base=()=>{
  const d=draft();
  return {d,quiz:{publishedRevisionId:"qrv_a",publishingJobId:null},
    published:{state:"ready",sourceDraftVersion:d.version,
      itemCount:d.itemOrder.length,itemOrder:[...d.itemOrder],
      title:d.title,description:d.description,subject:d.subject,
      difficulty:d.difficulty,settings:{...d.settings}}};
};

test("repeated publish of an identical ready revision is a read-only no-op",()=>{
  const {quiz,d,published}=base();
  assert.equal(isCurrentPublishedDraft(quiz,d,published),true);
});
test("ordering, a changed question revision or settings never bypasses publication",()=>{
  for(const change of [
    ({d})=>d.itemOrder.reverse(),
    ({d})=>d.version++,
    ({d})=>d.title="New title",
    ({d})=>d.settings.penalty=0.5,
    ({d})=>d.settings.passFailEnabled=true,
    ({d})=>d.settings.newUnsupportedField=true,
    ({published})=>published.itemCount=2,
  ]){
    const state=base();change(state);
    assert.equal(isCurrentPublishedDraft(state.quiz,state.d,state.published),false);
  }
});
test("unpublished, unfinished, missing-version and in-flight revisions cannot short-circuit",()=>{
  for(const change of [
    ({quiz})=>quiz.publishedRevisionId=null,
    ({quiz})=>quiz.publishingJobId="job_running",
    ({published})=>published.state="building",
    ({published})=>delete published.sourceDraftVersion,
    ({published})=>published.itemOrder.reverse(),
  ]){
    const state=base();change(state);
    assert.equal(isCurrentPublishedDraft(state.quiz,state.d,state.published),false);
  }
});
test("both live publisher paths check before heavy sources and both screens accept a no-op response",()=>{
  const legacy=read("functions/src/api/quizzes.js");
  const hybrid=read("functions/src/prod1/publication-gateway.js");
  assert(legacy.indexOf("isCurrentPublishedDraft(quiz, draft, published)")>
         legacy.indexOf('define(\n  "publishQuiz"'));
  assert(legacy.indexOf("isCurrentPublishedDraft(quiz, draft, published)")<
         legacy.indexOf('await c.rate("publish"'));
  assert(hybrid.indexOf("isCurrentPublishedDraft(quiz,draft,published)")<
         hybrid.indexOf("const slots=[];"));
  for(const path of ["js/pages/quiz-editor.js","js/pages/quiz-manage.js"]){
    const ui=read(path);
    assert.match(ui,/if \(job\.unchanged\)/);
    assert.match(ui,/Already published/);
  }
});
test("Manage Quiz section tabs stay in page flow on desktop",()=>{
  const css=read("assets/css/layout.css");
  const start=css.indexOf('body[data-page="quiz-manage"] .tabs[aria-label="Quiz management"]');
  assert(start>=0);
  const block=css.slice(start,css.indexOf("}",start)+1);
  assert.match(block,/position: static/);
  assert.match(block,/box-shadow: none/);
});
