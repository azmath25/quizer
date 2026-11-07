import test from "node:test";
import assert from "node:assert/strict";
import {buildApprovedImportRecords} from "../../js/services/ai-reviewed-import-core.js";

const approved={
  items:[{
    review_id:"page1_item1",reviewed_by:"teacher_1",
    reviewed_at:"2026-11-07T00:00:00Z",
    content:{type:"open",answerMode:"auto",statementLatex:"Solve x+1=2",
      options:[],defaultPoints:1,questionAssetBindings:{}},
    grading:{correctOptionId:null,acceptedAnswers:["1"],tolerance:0.000001,
      explanationLatex:"",rubricLatex:"",solutionAssetBindings:{}},
  }],
};

test("teacher-approved extraction converts directly into canonical private Quizer import",()=>{
  const records=buildApprovedImportRecords(approved,{title:"Algebra",target:"quiz"});
  assert.equal(records.length,1);
  assert.equal(records[0].importItemKey,"problem_0");
  assert.equal(records[0].metadata.bankVisibility,"private");
  assert.equal(records[0].grading.acceptedAnswers[0],"1");
  const bank=buildApprovedImportRecords(approved,{target:"bank",visibility:"teachers"});
  assert.equal(bank[0].metadata.bankVisibility,"teachers");
  assert.equal(approved.items[0].metadata,undefined);
});

test("unreviewed, duplicated, or wrong-format questions never pass importer adapter",()=>{
  assert.throws(()=>buildApprovedImportRecords({items:[]}));
  assert.throws(()=>buildApprovedImportRecords({
    items:[{...approved.items[0],reviewed_by:null}],
  }));
  assert.throws(()=>buildApprovedImportRecords({
    items:[approved.items[0],approved.items[0]],
  }));
  assert.throws(()=>buildApprovedImportRecords({
    items:[{...approved.items[0],content:{...approved.items[0].content,
      statementLatex:"\\input{secrets}"}}],
  }));
  assert.throws(()=>buildApprovedImportRecords(approved,{target:"public"}));
});
