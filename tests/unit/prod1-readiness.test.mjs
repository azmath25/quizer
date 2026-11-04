import test from "node:test";
import assert from "node:assert/strict";
import {EXPECTED,collect}
  from "../../scripts/prod1/readiness.mjs";

function fake({badBranch=false,secret=true,api=true}={}){
  const calls=[];
  const exec=(bin,args)=>{
    calls.push([bin,...args]);
    const joined=[bin,...args].join(" ");
    if(joined.includes("branch --show-current"))
      return {ok:true,text:badBranch?"main":EXPECTED.branch};
    if(joined.includes("projects describe"))
      return {ok:true,text:EXPECTED.firebaseNumber};
    if(joined.includes("secrets describe"))
      return secret?{ok:true,text:EXPECTED.secret}:{ok:false};
    if(joined.includes("secrets versions list"))
      return {ok:true,text:"42"};
    if(joined.includes("services list"))
      return api?{ok:true,text:[
        "secretmanager.googleapis.com",
        "cloudfunctions.googleapis.com",
        "firestore.googleapis.com"].join("\n")}:{ok:false};
    throw Error("Unexpected access: "+joined);
  };
  return {exec,calls};
}
test("readiness inventory is scoped and never authorizes prod writes",()=>{
  const {exec,calls}=fake();
  const r=collect({exec});
  assert.equal(r.complete,true);
  assert.equal(r.deploymentAuthorized,false);
  assert.equal(r.productionActivationAuthorized,false);
  assert.equal(r.identities.firebaseProject,"sat-quiz-fd317");
  assert.equal(r.identities.neonProject,"soft-grass-35754518");
  const cmd=calls.flat().join(" ");
  // Match whole command arguments, not the harmless --enabled filter.
  for(const bad of ["deploy","set-iam-policy","delete","create","enable"])
    assert.equal(calls.some(parts=>parts.includes(bad)),false,cmd);
  assert.equal(cmd.includes("secrets versions access"),false,cmd);
  assert.equal(cmd.includes("mimo-backend-513412"),false,cmd);
});
test("missing secret or service or wrong branch never reports ready",()=>{
  for(const config of [
    {secret:false},{api:false},{badBranch:true},
  ]){
    const r=collect({exec:fake(config).exec});
    assert.equal(r.complete,false);
    assert.equal(r.productionActivationAuthorized,false);
  }
});
