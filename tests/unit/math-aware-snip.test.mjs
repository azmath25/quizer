import test from "node:test";
import assert from "node:assert/strict";
import {assembleSnipFragments,formatSnipMath,visibleTextIn,MAX_SNIP_TEXT} from "../../js/components/page-snip.js";

test("MathJax original TeX is emitted once between surrounding text",()=>{
  const p={tag:"paragraph"},q={tag:"next"};
  const fragments=[
    {text:"Solve",kind:"text",block:p},
    {text:formatSnipMath("\\frac{x+1}{2} = 4"),kind:"math",block:p},
    {text:"and justify your answer.",kind:"text",block:p},
    {text:"A) 1",kind:"text",block:q},
  ];
  assert.equal(assembleSnipFragments(fragments),
    "Solve \\(\\frac{x+1}{2} = 4\\) and justify your answer.\nA) 1");
});
test("identical answer choices are retained and paragraph order is stable",()=>{
  const blocks=[{},{},{}];
  const text=assembleSnipFragments(blocks.map((block,i)=>({
    text:i<2?"x = 2":"C) x = 3",kind:"text",block,
  })));
  assert.equal(text,"x = 2\nx = 2\nC) x = 3");
});
test("display math keeps its delimiters and is never clipped mid-expression",()=>{
  const latex="\\int_0^1 x^2\\,dx = \\frac{1}{3}";
  assert.equal(formatSnipMath(latex,true),"\\["+latex+"\\]");
  assert.equal(assembleSnipFragments([
    {text:"Question",kind:"text",block:1},
    {text:formatSnipMath(latex,true),kind:"math",block:1},
    {text:"Next",kind:"text",block:2},
  ],18),"Question\nNext");
  assert.equal(formatSnipMath("x".repeat(3801)),"");
});
test("bounded text output protects backend requests",()=>{
  const text=assembleSnipFragments([{text:"A".repeat(MAX_SNIP_TEXT+300),kind:"text",block:1}]);
  assert.equal(text.length,MAX_SNIP_TEXT);
});

test("DOM snip walks visible text + MathJax source in exact page order",()=>{
  const rect={left:0,top:0,right:200,bottom:200};
  const el=(tag,block=null)=>({
    nodeType:1,tagName:tag,
    closest(selector) {
      if(selector==="mjx-container"&&tag==="MJX-CONTAINER")return this;
      if(selector.startsWith("p,li"))return block||this;
      if(selector.startsWith("div,section"))return block||this;
      if(selector.startsWith("mjx-container,.MathJax")&&tag==="MJX-CONTAINER")return this;
      return null;
    },
    getBoundingClientRect(){return rect;},
  });
  const p=el("P"),next=el("P"),math=el("MJX-CONTAINER",p);
  const t=(text,parent)=>({nodeType:3,textContent:text,parentElement:parent});
  const before=t("Solve",p),glyph=t("visually rendered symbols",math),
    after=t("and explain.",p),end=t("Answer A",next);
  math.contains=n=>n===glyph;
  const walked=[p,before,math,glyph,after,next,end];
  const prev={
    document:globalThis.document,window:globalThis.window,
    getComputedStyle:globalThis.getComputedStyle,
    NodeFilter:globalThis.NodeFilter,
  };
  globalThis.NodeFilter={SHOW_ELEMENT:1,SHOW_TEXT:4};
  globalThis.getComputedStyle=()=>({display:"block",visibility:"visible",opacity:"1"});
  globalThis.document={
    body:{},
    createTreeWalker(){let index=-1;return {
      currentNode:null,
      nextNode(){this.currentNode=walked[++index];return !!this.currentNode;},
    };},
    createRange(){return {
      selectNodeContents(){},getClientRects(){return [rect];},
    };},
  };
  globalThis.window={MathJax:{startup:{document:{
    math:[{typesetRoot:math,math:"\\frac{2x}{3}=4",display:false}],
  }}}};
  try{
    assert.equal(visibleTextIn(rect),
      "Solve \\(\\frac{2x}{3}=4\\) and explain.\nAnswer A");
    assert.doesNotMatch(visibleTextIn(rect),/visually rendered symbols/);
  }finally{
    for(const [name,value] of Object.entries(prev)){
      if(value===undefined)delete globalThis[name];else globalThis[name]=value;
    }
  }
});
