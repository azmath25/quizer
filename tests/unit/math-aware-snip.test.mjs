import test from "node:test";
import assert from "node:assert/strict";
import {assembleSnipFragments,formatSnipMath,MAX_SNIP_TEXT} from "../../js/components/page-snip.js";

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
