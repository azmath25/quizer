#!/usr/bin/env node
// PROD1 scoped read-only release inventory. Never deploys, updates IAM,
// reads a secret value, changes billing or touches Mimo.
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

export const EXPECTED=Object.freeze({
  repository:"azmath25/quizer",
  branch:"work/quizer-audit-optimization-2026-11",
  firebaseProject:"sat-quiz-fd317",
  firebaseNumber:"476816329871",
  region:"europe-west1",
  secret:"QUIZER_NEON_DATABASE_URL",
  neonProject:"soft-grass-35754518",
  neonBranch:"br-lucky-lake-b9pocorx",
  neonDatabase:"quizer",
  neonRole:"quizer_app",
});
export function run(command,args,{timeout=15000}={}){
  const result=spawnSync(command,args,{
    encoding:"utf8",timeout,stdio:["ignore","pipe","pipe"],
    env:{...process.env,CLOUDSDK_CORE_DISABLE_PROMPTS:"1"},
  });
  return result.status===0?{ok:true,text:result.stdout.trim()}:
    {ok:false,reason:result.error?.code==="ENOENT"?
      "command_missing":"not_verified"};
}
export function collect({exec=run}={}){
  const branch=exec("git",["branch","--show-current"]);
  const proj=exec("gcloud",[
    "projects","describe",EXPECTED.firebaseProject,
    "--format=value(projectNumber)"]);
  const secret=exec("gcloud",[
    "secrets","describe",EXPECTED.secret,
    "--project="+EXPECTED.firebaseProject,
    "--format=value(name)"]);
  const versions=secret.ok?exec("gcloud",[
    "secrets","versions","list",EXPECTED.secret,
    "--project="+EXPECTED.firebaseProject,
    "--filter=state:ENABLED","--format=value(name)"]):
    {ok:false};
  const activeApis=exec("gcloud",[
    "services","list","--enabled",
    "--project="+EXPECTED.firebaseProject,
    "--format=value(config.name)"]);
  const requiredApis=["secretmanager.googleapis.com",
    "cloudfunctions.googleapis.com","firestore.googleapis.com"];
  const available=activeApis.ok?
    new Set(activeApis.text.split(/\s+/).filter(Boolean)):new Set();
  const checks={
    correctBranch:branch.ok&&branch.text===EXPECTED.branch,
    correctFirebaseProject:proj.ok&&
      proj.text===EXPECTED.firebaseNumber,
    secretExists:secret.ok&&
      secret.text.includes(EXPECTED.secret),
    secretEnabledVersion:versions.ok&&
      versions.text.length>0,
    requiredApisEnabled:activeApis.ok&&
      requiredApis.every(s=>available.has(s)),
  };
  return Object.freeze({
    scope:"PROD1_READ_ONLY",
    identities:EXPECTED,
    checks,
    complete:Object.values(checks).every(Boolean),
    // Even a fully green inventory is NOT permission to deploy.
    deploymentAuthorized:false,
    productionActivationAuthorized:false,
    remaining:[
      "Verify actual Functions service-account Secret Manager access",
      "Finish and deploy trusted draft/publish/attempt hybrid adapters",
      "Test Firebase Auth, Firestore, Neon and Storage together",
      "Review old quiz/attempt data retention and restore",
      "Verify App Check, GitHub Pages OAuth domain, quotas and cost alarms",
      "Obtain explicit production approval",
    ],
  });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===
  (await import("node:path")).resolve(process.argv[1])){
  const result=collect();
  console.log(JSON.stringify(result,null,2));
  if(!result.complete)process.exitCode=2;
}
