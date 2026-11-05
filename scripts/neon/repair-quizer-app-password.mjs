// Read owner URL from stdin; generate/verify restricted Quizer password,
// then store ONLY the app URL in SAT QUIZ Secret Manager. Never print a secret.
// Do not import this into a web page or a Cloud Function.
import {randomBytes} from "node:crypto";
import {spawnSync} from "node:child_process";
import pg from "pg";

const PROJECT="sat-quiz-fd317";
const SECRET="QUIZER_NEON_DATABASE_URL";
const DIRECT="ep-ancient-voice-b9jua9ew.c-7.eu-central-1.aws.neon.tech";
const POOL="ep-ancient-voice-b9jua9ew-pooler.c-7.eu-central-1.aws.neon.tech";
const fail=message=>{console.error("STOP: "+message);process.exit(2);};
const run=(args,input)=>{
  const out=spawnSync("gcloud",args,{
    encoding:"utf8",input,
    stdio:["pipe","pipe","pipe"],
    env:{...process.env,CLOUDSDK_CORE_DISABLE_PROMPTS:"1"},
    timeout:30000,
  });
  return {ok:out.status===0,stdout:out.stdout?.trim()??""};
};
let raw="";
for await(const chunk of process.stdin)raw+=chunk;
if(!raw)fail("Missing hidden owner URL.");
let u;
try{u=new URL(raw);}catch{fail("Owner URL is not valid.");}
const names=[...u.searchParams.keys()];
if(!["postgres:","postgresql:"].includes(u.protocol) ||
   ![DIRECT,POOL].includes(u.hostname) ||
   decodeURIComponent(u.username)!=="quizer_owner" ||
   decodeURIComponent(u.pathname.slice(1))!=="quizer" ||
   !u.password || u.searchParams.get("sslmode")!=="require" ||
   names.some(x=>!["sslmode","channel_binding"].includes(x)) ||
   (u.searchParams.has("channel_binding") &&
      u.searchParams.get("channel_binding")!=="require") ||
   u.hash)fail("Select the exact Neon live branch's quizer_owner TLS URL.");
// Google Cloud Shell can occasionally fail a project lookup during
// transient auth/network refresh. Retry a failed lookup, but NEVER accept
// an unverified or mismatched project identity.
let verifiedProject=false;
for(let attempt=0;attempt<3;attempt++){
  const result=run(["projects","describe",PROJECT,
    "--format=value(projectNumber)"]);
  if(result.ok){
    if(result.stdout!=="476816329871")
      fail("Google Cloud returned an unexpected SAT QUIZ project number. " +
        "No Neon password was changed; check your gcloud account/project.");
    verifiedProject=true;
    break;
  }
}
if(!verifiedProject)
  fail("SAT QUIZ project lookup failed in gcloud. No Neon password was " +
    "changed. Run: gcloud projects describe sat-quiz-fd317 " +
    "--format='value(projectNumber)' and check any CLI error, then retry.");
if(run(["secrets","describe",SECRET,
  "--project="+PROJECT]).ok)
  fail("Secret already exists. Refusing to overwrite it.");
const owner=new pg.Client({
  connectionString:u.href,connectionTimeoutMillis:7000,
});
const candidate=randomBytes(32).toString("base64url");
if(!/^[A-Za-z0-9_-]{40,}$/.test(candidate))
  fail("Secure role password generation failed.");
try{
  await owner.connect();
  const {rows}=await owner.query(
    "SELECT current_user AS role_name, " +
    "EXISTS(SELECT 1 FROM pg_roles WHERE rolname='quizer_app' " +
    "AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb " +
    "AND NOT rolcreaterole AND NOT rolreplication " +
    "AND NOT rolbypassrls) AS limited");
  if(rows[0]?.role_name!=="quizer_owner" || rows[0]?.limited!==true)
    fail("Owner connection or existing restricted role was not verified.");
  // Candidate is generated locally and restricted to base64url alphabet.
  await owner.query("ALTER ROLE quizer_app WITH LOGIN PASSWORD '"+candidate+"'");
}catch{
  fail("Neon owner SQL access or restricted password update failed.");
}finally{
  await owner.end().catch(()=>{});
}
const appUrl=new URL(u.href);
appUrl.username="quizer_app";
appUrl.password=candidate;
appUrl.hostname=POOL;
const app=new pg.Client({
  connectionString:appUrl.href,connectionTimeoutMillis:7000,
});
try{
  await app.connect();
  const {rows}=await app.query(
    "SELECT current_user AS role_name, " +
    "pg_has_role(current_user,'neon_superuser','MEMBER') AS elevated, " +
    "pg_has_role(current_user,'quizer_app_limited','MEMBER') AS limited, " +
    "has_table_privilege(current_user,'quizer.problems'," +
    "'SELECT,INSERT,UPDATE') AS can_write, " +
    "has_table_privilege(current_user,'quizer.quiz_revision_mirrors'," +
    "'SELECT') AS mirror_read");
  const r=rows[0];
  if(r?.role_name!=="quizer_app"||r.elevated!==false||
     r.limited!==true||r.can_write!==true||r.mirror_read!==false)
    fail("Restricted Neon app login or table privileges failed attestation.");
}catch{
  fail("Neon app connection/privileges failed. Secret was not created.");
}finally{
  await app.end().catch(()=>{});
}
const saved=run([
  "secrets","create",SECRET,"--project="+PROJECT,
  "--replication-policy=automatic","--data-file=-","--quiet",
],appUrl.href);
if(!saved.ok)fail("Secret Manager creation failed; no password printed. " +
  "Rerun the owner helper if the secret is still missing.");
console.log("PASS: restricted app login verified.");
console.log("PASS: Neon URL saved to SAT QUIZ Secret Manager.");
console.log("No backend was deployed or enabled.");
