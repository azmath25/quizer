// STG2.4: purely local audit of the explicitly built staging static bundle.
// Does NOT build, deploy, connect to Firebase, read credentials or edit source.
import {readFileSync,readdirSync,statSync} from "node:fs";
import {join,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
const PROJECT="quizer-staging-az26";
const APP_ID="1:509423933910:web:bce54427cd2e87af076c77";
const BLOCKED=["sat-quiz-fd317","mimo-backend-513412"];
const MAX_FILES=2500,MAX_TOTAL_BYTES=100*1024*1024;
const TEXT_EXT=/\.(?:html|js|css|json|svg|txt)$/i;
const REQUIRED=[
  "index.html","login.html","quiz.html","quizzes.html","problems.html",
  "upload.html","results.html","js/firebase-config.js",
  "js/pages/quiz.js","assets/css/pages/quiz.css",
];
const fail=(message)=>{throw new Error("STG2.4 staging bundle rejected: "+message);};
export function auditStagingBundle(root=fileURLToPath(
  new URL("../../dist/",import.meta.url))){
  const base=resolve(root);
  const scanned=[];
  let bytes=0;
  function traverse(folder){
    for(const name of readdirSync(folder)){
      const p=join(folder,name),meta=statSync(p);
      if(meta.isDirectory()){traverse(p);continue;}
      if(!meta.isFile())fail("non-file artifact");
      const rel=relative(base,p).split(sep).join("/");
      if(rel.startsWith("../") || rel.includes(".."))fail("unsafe path");
      scanned.push(rel);
      if(scanned.length>MAX_FILES)fail("unexpected file count");
      bytes+=meta.size;
      if(bytes>MAX_TOTAL_BYTES)fail("bundle size limit exceeded");
      if(!TEXT_EXT.test(rel))continue;
      const text=readFileSync(p,"utf8");
      for(const id of BLOCKED)if(text.includes(id))
        fail("production or unrelated project reference in "+rel);
      if(text.includes("-----BEGIN PRIVATE KEY-----") ||
          text.includes("GOOGLE_APPLICATION_CREDENTIALS="))
        fail("server credential material in "+rel);
    }
  }
  traverse(base);
  const names=new Set(scanned);
  for(const path of REQUIRED)if(!names.has(path))fail("missing "+path);
  const config=readFileSync(join(base,"js/firebase-config.js"),"utf8");
  if(!config.includes(PROJECT) || !config.includes(APP_ID) ||
      !config.includes("quizer-staging-az26.firebaseapp.com"))
    fail("staging public app identity mismatch");
  const quiz=readFileSync(join(base,"js/pages/quiz.js"),"utf8");
  const css=readFileSync(join(base,"assets/css/pages/quiz.css"),"utf8");
  if(!/const flagLabel\s*=\s*\(\)\s*=>\s*icon\("flag"\)\s*\+\s*"Flag"/.test(quiz) ||
      !/aria-pressed/.test(quiz) ||
      !/min-width:\s*84px/.test(css))
    fail("mobile flag control stability regression");
  return Object.freeze({stagingProject:PROJECT,filesScanned:scanned.length,
    totalBytes:bytes,readyToDeploy:false,
    generatedBundleAudited:true,physicalDeviceVerified:false,
    cloudBackendVerified:false});
}
