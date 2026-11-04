#!/usr/bin/env node
// Read-only P1 Cloud Shell inventory. Never prints a secret or raw IAM policy.
// No deploy, no API enable, no mutation, and no Mimo/Neon project commands.
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
const PROJECT="sat-quiz-fd317",NUMBER="476816329871",
  REGION="europe-west1",
  BUCKET="sat-quiz-fd317.firebasestorage.app";
const SECRETS=["QUIZER_NEON_DATABASE_URL","QUIZER_BANK_CURSOR_KEY"];
const FUNCTIONS=["api","processJob","scheduledMaintenance"];
const parse=(r)=>{try{return JSON.parse(r.text);}catch{return null;}};
export function gcloud(args){
  const r=spawnSync("gcloud",args,{
    encoding:"utf8",timeout:12000,
    stdio:["ignore","pipe","pipe"],
    env:{...process.env,CLOUDSDK_CORE_DISABLE_PROMPTS:"1"},
  });
  return {ok:r.status===0,text:r.status===0?r.stdout.trim():""};
}
export function audit({exec=gcloud,getBranch=()=>{
  const r=spawnSync("git",["branch","--show-current"],{
    encoding:"utf8",timeout:5000,stdio:["ignore","pipe","pipe"],
  });
  return r.status===0?r.stdout.trim():"";
}}={}){
  const project=exec(["projects","describe",PROJECT,
    "--format=value(projectNumber)"]);
  const identity=project.ok&&project.text===NUMBER;
  const info={scope:"QUIZER_PROD1_READ_ONLY",
    verifiedProject:identity,
    verifiedBranch:null,secrets:{},functions:{},storage:false,
    serviceAccountsReviewed:false,activate:false,deploy:false,
    blockedBy:[]};
  if(!identity){info.blockedBy.push("Wrong/unavailable project");
    return info;}
  // First inspect the user-selected branch (no output of repository files).
  info.verifiedBranch=
    getBranch()==="work/quizer-audit-optimization-2026-11";
  if(!info.verifiedBranch)
    info.blockedBy.push("Work branch not selected");
  for(const name of SECRETS){
    const found=exec(["secrets","describe",name,
      "--project="+PROJECT,"--format=value(name)"]);
    const versions=found.ok?exec([
      "secrets","versions","list",name,"--project="+PROJECT,
      "--filter=state:ENABLED","--format=value(name)"]):
      {ok:false,text:""};
    info.secrets[name]={
      exists:found.ok,enabledVersion:versions.ok&&!!versions.text,
      valueAccessed:false,
    };
    if(!info.secrets[name].enabledVersion)
      info.blockedBy.push("Missing enabled secret: "+name);
  }
  const serviceAccounts=new Set();
  for(const name of FUNCTIONS){
    const data=exec(["functions","describe",name,
      "--gen2","--region="+REGION,"--project="+PROJECT,
      "--format=json"]);
    const parsed=data.ok?parse(data):null;
    const account=parsed?.serviceConfig?.serviceAccountEmail??null;
    if(account)serviceAccounts.add(account);
    const configured=parsed?.serviceConfig?.secretEnvironmentVariables??[];
    info.functions[name]={
      deployed:Boolean(parsed),
      serviceAccountPresent:Boolean(account),
      binding:SECRETS.every(secret=>configured.some(
        x=>x.key===secret||x.secret===secret)),
      // It is valid for existing backend to be unbound while gate is OFF.
      boundOnCurrentlyDeployedFunction:configured.length>0,
    };
    if(!parsed)info.blockedBy.push("Deployed function not inspectable: "+name);
  }
  const storage=exec(["storage","buckets","describe","gs://"+BUCKET,
    "--project="+PROJECT,"--format=json"]);
  const bucket=storage.ok?parse(storage):null;
  info.storage=Boolean(bucket);
  if(!bucket)info.blockedBy.push("Storage bucket not verified");
  const policies=[...SECRETS.map(secret=>exec([
    "secrets","get-iam-policy",secret,
    "--project="+PROJECT,"--format=json"])),
    exec(["projects","get-iam-policy",PROJECT,"--format=json"])];
  const docs=policies.map(p=>p.ok?parse(p):null);
  info.serviceAccountsReviewed=docs.every(Boolean);
  if(!info.serviceAccountsReviewed)
    info.blockedBy.push("Service-account IAM policy requires review");
  const allowed=serviceAccount=>{
    const member="serviceAccount:"+serviceAccount;
    const hasAccessor=policy=>(policy?.bindings??[]).some(b=>
      b.role==="roles/secretmanager.secretAccessor" &&
      (b.members??[]).includes(member)&&!b.condition);
    // Both independent secrets must be accessible. A grant on one
    // secret does not imply access to the other.
    return SECRETS.every((_,index)=>
      hasAccessor(docs[index])||hasAccessor(docs[SECRETS.length]));
  };
  info.iamUnconditionalAccessor=Object.fromEntries(
    FUNCTIONS.map(name=>{
      const fn=exec(["functions","describe",name,
        "--gen2","--region="+REGION,"--project="+PROJECT,
        "--format=value(serviceConfig.serviceAccountEmail)"]);
      return [name,fn.ok&&fn.text?allowed(fn.text):false];
    }));
  // This read-only check does not prove effective permissions from ancestor
  // grants or IAM conditions, nor Auth/AppCheck/function execution.
  info.blockedBy.push("Effective IAM, Auth/App Check, and real E2E still required");
  return info;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===
  path.resolve(process.argv[1])){
  const report=audit();
  console.log(JSON.stringify(report,null,2));
  if(report.blockedBy.length)process.exitCode=2;
}
