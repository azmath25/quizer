import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read = path => readFileSync(new URL("../../"+path,import.meta.url),"utf8");

test("quiz cards retain View quiz and Manage links with shared native destinations",()=>{
  const ui = read("js/components/ui.js");
  assert.match(ui,/class="quiz-card"/);
  assert.match(ui,/management \? "Manage" : "View quiz"/);
  assert.match(ui,/management \? "quiz-manage" : "quiz"/);
  assert.match(ui,/class="text-link"/);
});

test("touch-only stretched heading link covers card; CTA remains above overlay",()=>{
  const css=read("assets/css/components.css");
  assert.match(css,/@media \(hover: none\), \(pointer: coarse\)/);
  assert.match(css,/\.quiz-card \.qc-front h3 a::after\s*\{/);
  assert.match(css,/position: absolute;\s*inset: 0;\s*z-index: 1;/);
  assert.match(css,/\.quiz-card \.qc-front \.card-foot \.text-link\s*\{/);
  assert.match(css,/position: relative;\s*z-index: 2;/);
  const math=read("assets/css/math.css");
  assert.match(math,/@media \(hover: hover\)[\s\S]*?\.quiz-card:hover \.qc-inner/);
  assert.match(math,/@media \(hover: none\), \(prefers-reduced-motion: reduce\)[\s\S]*?\.qc-back \{ display: none; \}/);
});

test("tap navigates by native link without custom touch listeners",()=>{
  const app=read("js/app.js");
  assert.doesNotMatch(app,/touchstart[\s\S]{0,150}quiz-card|touchend[\s\S]{0,150}quiz-card/);
});
