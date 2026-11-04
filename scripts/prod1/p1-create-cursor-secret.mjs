#!/usr/bin/env node
// Explicit owner-run one-time creation of the PROD1 bank cursor key.
// Does not overwrite an existing secret, print the key or deploy functions.
import {randomBytes} from "node:crypto";
import {spawnSync} from "node:child_process";
const PROJECT="sat-quiz-fd317";
const NUMBER="476816329871";
const SECRET="QUIZER_BANK_CURSOR_KEY";
const call=(args,input)=>{
  const p=spawnSync("gcloud",args,{
    input,encoding:"utf8",timeout:30000,
    stdio:["pipe","pipe","pipe"],
    env:{...process.env,CLOUDSDK_CORE_DISABLE_PROMPTS:"1"},
  });
  return {ok:p.status===0,out:p.status===0?p.stdout.trim():""};
};
const project=call(["projects","describe",PROJECT,
  "--format=value(projectNumber)"]);
if(!project.ok||project.out!==NUMBER){
  console.error("STOP: Wrong or inaccessible SAT QUIZ Firebase project.");
  process.exit(2);
}
const existing=call(["secrets","describe",SECRET,
  "--project="+PROJECT,"--format=value(name)"]);
if(existing.ok){
  console.error("STOP: Cursor key already exists; refusing rotation or overwrite.");
  process.exit(3);
}
const secret=randomBytes(48).toString("base64url");
const saved=call(["secrets","create",SECRET,
  "--replication-policy=automatic","--project="+PROJECT,
  "--data-file=-","--quiet"],secret);
if(!saved.ok){
  console.error("STOP: Secret Manager creation failed; no key printed.");
  process.exit(4);
}
console.log("PASS: SAT QUIZ cursor signing secret created (value hidden).");
console.log("The PROD1 backend remains disabled and undeployed.");
