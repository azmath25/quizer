import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {auditStagingBundle}
  from "../../scripts/staging/stg2-frontend-audit.mjs";
const paths=[
  "index.html","login.html","quiz.html","quizzes.html","problems.html",
  "upload.html","results.html","js/firebase-config.js",
  "js/pages/quiz.js","assets/css/pages/quiz.css",
];
const data={
  "js/firebase-config.js":
    'projectId:"quizer-staging-az26",appId:"1:509423933910:web:bce54427cd2e87af076c77",'+
    'authDomain:"quizer-staging-az26.firebaseapp.com"',
  "js/pages/quiz.js":
    'const flagLabel = () => icon("flag") + "Flag";flagBtn.setAttribute("aria-pressed","true");',
  "assets/css/pages/quiz.css":"#flag { min-width: 84px; }",
};
function fixture(callback){
  const dir=mkdtempSync(join(tmpdir(),"quizer-stg2-"));
  try{
    for(const p of paths){
      const target=join(dir,p);
      mkdirSync(dirname(target),{recursive:true});
      writeFileSync(target,data[p]??"<html></html>");
    }
    return callback(dir);
  } finally{rmSync(dir,{recursive:true,force:true});}
}
test("STG2.4 accepts correctly scoped synthetic staging bundle without deploy",()=>{
  fixture(dir=>{
    const r=auditStagingBundle(dir);
    assert.equal(r.stagingProject,"quizer-staging-az26");
    assert.equal(r.readyToDeploy,false);
    assert.equal(r.cloudBackendVerified,false);
    assert.equal(r.physicalDeviceVerified,false);
    assert.equal(r.filesScanned,paths.length);
  });
});
test("STG2.4 detects production Firebase ID leaked in unrelated HTML",()=>{
  fixture(dir=>{
    writeFileSync(join(dir,"quiz.html"),"<p>sat-quiz-fd317</p>");
    assert.throws(()=>auditStagingBundle(dir),
      /production or unrelated project reference in quiz.html/);
  });
});
test("STG2.4 refuses Mimo references, server credentials or missing files",()=>{
  fixture(dir=>{
    writeFileSync(join(dir,"quiz.html"),"mimo-backend-513412");
    assert.throws(()=>auditStagingBundle(dir),/unrelated project reference/);
    writeFileSync(join(dir,"quiz.html"),"-----BEGIN PRIVATE KEY-----");
    assert.throws(()=>auditStagingBundle(dir),/server credential material/);
    rmSync(join(dir,"quiz.html"));
    assert.throws(()=>auditStagingBundle(dir),/missing quiz.html/);
  });
});
test("STG2.4 mobile flag caption/size regression blocks staging bundle",()=>{
  fixture(dir=>{
    writeFileSync(join(dir,"js/pages/quiz.js"),
      'const flagLabel = () => "Flagged";');
    assert.throws(()=>auditStagingBundle(dir),/mobile flag control stability/);
  });
});
test("STG2.4 bundle app ID is exact and is not a cloud deployment authorization",()=>{
  fixture(dir=>{
    writeFileSync(join(dir,"js/firebase-config.js"),
      'projectId:"quizer-staging-az26",authDomain:"quizer-staging-az26.firebaseapp.com"');
    assert.throws(()=>auditStagingBundle(dir),/app identity mismatch/);
  });
});
