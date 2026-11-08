import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const icon = () => "<svg></svg>";
const linkButton = (label,url,tone) =>
  `<a class="button ${tone}" href="${escape(url)}">${escape(label)}</a>`;
const badge = label => `<span>${escape(label)}</span>`;
const empty = (title,text,action) => `<div class="empty">${escape(title)} ${escape(text)} ${action}</div>`;
const notice = text => `<div class="notice">${escape(text)}</div>`;
const quizCard = q => `<article class="quiz-card">${escape(q.title)}</article>`;

function homeRunner(data) {
  const source = read("js/pages/home.js")
    .replace(/^import .*\n/gm,"")
    .replace(/^export /gm,"");
  const calls = [];
  const apiSWR = async (key,payload,draw) => {
    calls.push({key,payload});
    draw(data);
  };
  const mount = new Function("apiSWR","linkButton","quizCard","empty","e",
    "icon","badge","date","notice",source+"\nreturn mount;")(
      apiSWR,linkButton,quizCard,empty,escape,icon,badge,
      () => "Nov 8",notice);
  const root = {innerHTML:""};
  return {run: async session => {await mount(root,session);return {html:root.innerHTML,calls};}};
}
const guest = {user:null,capabilities:{teach:false,admin:false},profile:null};
const student = {user:{uid:"student",emailVerified:true},
  capabilities:{teach:false,admin:false},profile:{displayName:"Student"}};
const teacher = {user:{uid:"teacher",emailVerified:true},
  capabilities:{teach:true,admin:false},profile:{displayName:"Teacher"}};

test("F1 home guest has exactly one next action and no decorative/empty second column",async()=>{
  const {html,calls} = await homeRunner({
    publicQuizzes:[{id:"quiz1",title:"Algebra"}],attempts:[],
  }).run(guest);
  assert.equal(calls.length,1);
  assert.equal(calls[0].key,"getDashboard");
  assert.equal((html.match(/Browse quizzes/g)||[]).length,1);
  assert.match(html,/Mathematics quizzes/);
  assert.match(html,/home-content-single/);
  assert.doesNotMatch(html,/class="home-rail"/);
  assert.doesNotMatch(html,/Quick access|home-action-list|home-metrics|<nav/);
  assert.match(html,/Algebra/);
});

test("F1 teacher continues active attempt first without competing Create Quiz button",async()=>{
  const {html,calls} = await homeRunner({
    myQuizzes:[{id:"quiz1",title:"Geometry"}],
    attempts:[{id:"attempt1",status:"active",quizTitle:"Geometry",startedAt:"2026-11-08"}],
    marking:[],
  }).run(teacher);
  assert.equal(calls.length,1);
  assert.match(html,/Continue where you left off/);
  assert.match(html,/href="quiz\.html\?attempt=attempt1"/);
  assert.ok(html.indexOf("<h2>Continue</h2>")<html.indexOf("Your quizzes"));
  assert.doesNotMatch(html,/Create quiz/);
  assert.doesNotMatch(html,/class="home-rail"/);
});

test("F1 teacher shows actual pending reviews in one sidebar and no extra API calls",async()=>{
  const {html,calls} = await homeRunner({
    myQuizzes:[{id:"quiz1",title:"Geometry"}],
    attempts:[],marking:[{
      id:"attempt2",quizTitle:"Geometry",studentDisplayName:"Student",
      pending:2,
    }],
  }).run(teacher);
  assert.equal(calls.length,1);
  assert.match(html,/Create quiz/);
  assert.match(html,/home-rail/);
  assert.match(html,/Needs marking/);
  assert.match(html,/results\.html\?id=attempt2/);
  assert.doesNotMatch(html,/Recent results/);
});

test("F1 signed-in student sees their own recent results without extra controls",async()=>{
  const {html,calls} = await homeRunner({
    publicQuizzes:[{title:"Numbers",id:"quiz2"}],
    attempts:[{id:"past",status:"completed",quizTitle:"Numbers",startedAt:"2026-11-08"}],
  }).run(student);
  assert.equal(calls.length,1);
  assert.match(html,/Recent results/);
  assert.match(html,/results\.html\?id=past/);
  assert.doesNotMatch(html,/Create quiz|Quick access|Save your progress/);
});

test("F1 global header has one Home via brand; tablet More and phone More preserve roles",()=>{
  const shell = read("js/components/shell.js");
  const css = read("assets/css/atlas-v2.css");
  const html = read("index.html");
  const font = read("assets/css/tokens.css");
  const desktopLinks = shell.slice(shell.indexOf("const links ="),shell.indexOf("const THEMES"));
  assert.doesNotMatch(desktopLinks,/\["home", "index\.html", "Home"\]/);
  assert.match(shell,/const compactNavQuery = window\.matchMedia\?/);
  assert.match(shell,/global-more-options/);
  assert.match(shell,/mobile-more-options/);
  assert.match(shell,/key !== "ai" \|\| s\.capabilities\.teach \|\| s\.capabilities\.admin/);
  assert.match(shell,/s\.capabilities\.admin \? \[\["admin", "admin\.html", "Admin"\]\]/);
  assert.match(shell,/s\.user \? "profile\.html" : "login\.html"/);
  assert.match(css,/#site-header #account-link\{display:none!important\}/);
  assert.match(css,/#desktop-nav \.global-more-options a\{/);
  assert.match(css,/#mobile-nav \.mobile-more-options a\{/);
  assert.match(css,/home-content\.home-content-single/);
  assert.doesNotMatch(html,/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(font,/--brand: #0281af/);
});

test("F1 document library requirement is planned, not prematurely exposed as extraction",()=>{
  const spec=read("docs/QUIZER_FRONTEND_DESIGN_SYSTEM_F0_20261108.md");
  assert.match(spec,/Default Documents screen is the document library, not an extraction form/);
  assert.match(spec,/Unfiled/);
  assert.match(spec,/New extraction/);
  // F1 must not wire extraction changes or create new data models.
  const home=read("js/pages/home.js");
  const shell=read("js/components/shell.js");
  assert.doesNotMatch(home+shell,/submitMimoBatch|submitMimoExtraction|createImportJob/);
});

function shellNav(session,{compact=false,page="home"}={}) {
  const code=read("js/components/shell.js")
    .replace(/^import .*\n/gm,"")
    .replace(/^export /gm,"")+"\nreturn mountShell;";
  const elements={};
  const make=()=>({innerHTML:"",style:{setProperty(){}},
    addEventListener(){},setAttribute(k,v){this[k]=v},
    removeAttribute(k){delete this[k]},classList:{remove(){},add(){}}});
  for(const selector of ["#site-header","#desktop-nav","#account-link","#mobile-nav",
    "#site-footer","#theme-trigger","#theme-menu",".brand"]){
    elements[selector]=make();
  }
  const dom={
    body:{dataset:{page}},
    documentElement:{dataset:{},style:{setProperty(){}}},
    querySelector:selector=>elements[selector]||null,
    querySelectorAll:()=>[],
    addEventListener(){},
  };
  const storage={getItem:()=>null,setItem(){}};
  const window={matchMedia:()=>({matches:compact,addEventListener(){}})};
  const mount=new Function("watchSession","getSession","icon","e","document",
    "window","localStorage",code)(
      callback=>callback(session),()=>session,icon,escape,dom,window,storage);
  mount({showAssistant:false,showBackdrop:false});
  return {
    desktop:elements["#desktop-nav"].innerHTML,
    mobile:elements["#mobile-nav"].innerHTML,
    brand:elements[".brand"],
    account:elements["#account-link"],
  };
}
const urls=markup=>[...markup.matchAll(/href="([^"]+)"/g)].map(x=>x[1]);

test("F1 actual header renders guest navigation once, without private teacher/admin links",()=>{
  const n=shellNav({...guest,authResolved:true});
  assert.deepEqual(urls(n.desktop),["quizzes.html"]);
  assert.deepEqual(urls(n.mobile),["index.html","quizzes.html","login.html"]);
  assert.equal(n.account.href,"login.html");
  assert.equal(n.brand["aria-current"],"page");
});

test("F1 actual tablet header keeps student Activity accessible",()=>{
  const n=shellNav({...student,authResolved:true},{compact:true});
  assert.deepEqual(urls(n.desktop),["quizzes.html","activity.html"]);
  assert.match(n.desktop,/global-more-options/);
  assert.deepEqual(urls(n.mobile),["index.html","quizzes.html","activity.html","profile.html"]);
  assert.doesNotMatch(n.mobile,/admin\.html|teaching\.html|ai\.html/);
});

test("F1 teacher/admin nav keeps each route only once, including mobile More",()=>{
  for(const admin of [false,true]){
    const session={...teacher,authResolved:true,capabilities:{teach:true,admin}};
    const n=shellNav(session,{compact:true});
    const d=urls(n.desktop),m=urls(n.mobile);
    for(const url of ["quizzes.html","teaching.html","ai.html","activity.html"]){
      assert.equal(d.filter(x=>x===url).length,1,"desktop "+url);
      assert.equal(m.filter(x=>x===url).length,1,"mobile "+url);
    }
    assert.equal(d.includes("admin.html"),admin);
    assert.equal(m.includes("admin.html"),admin);
    assert.match(n.mobile,/mobile-more-options/);
    assert.equal(m.filter(x=>x==="profile.html").length,1);
  }
});
