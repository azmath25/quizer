#!/usr/bin/env bash
# QUIZER — publish current frontend to the EXISTING sat-quiz-fd317 website.
# HOSTING ONLY. No backend, SQL, Firestore rules/data, Functions, Storage rules,
# users or Mimo resources are changed.
set -euo pipefail
PROJECT="sat-quiz-fd317"
PROJECT_NUMBER="476816329871"
BRANCH="work/quizer-audit-optimization-2026-11"
CONFIG="firebase.sat-quiz.deploy.json"
cd "$(dirname "$0")/../.."

[[ "$(git branch --show-current)" == "$BRANCH" ]] || {
  echo "ERROR: Expected Git work branch $BRANCH"; exit 2;
}
[[ -f "$CONFIG" ]] || { echo "ERROR: Missing Firebase deployment config"; exit 2; }
[[ -f "js/firebase-config.js" ]] || { echo "ERROR: Missing Firebase public config"; exit 2; }
[[ "$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')" == "$PROJECT_NUMBER" ]] || {
  echo "ERROR: Refusing to deploy: Firebase project identity not verified"; exit 2;
}
node -e '
const fs=require("node:fs");
const s=fs.readFileSync("js/firebase-config.js","utf8");
if (!s.includes("sat-quiz-fd317") ||
    !s.includes("1:476816329871:web:057181fe99c4088f1b34fa") ||
    s.includes("quizer-staging-az26"))
  throw Error("Production Firebase client configuration is wrong");
'
NODE_MAJOR="$(node -p 'parseInt(process.versions.node.split(".")[0])')"
(( NODE_MAJOR >= 22 )) || { echo "ERROR: Node.js 22+ is required"; exit 2; }

echo "========== TARGET =========="
echo "Hosting: $PROJECT; branch: $BRANCH"
echo "Not deploying backend; it may still run the old Firestore implementation."
npm ci --no-audit --no-fund
npm run build

# Fail closed on wrong project identities or server credentials in dist/.
node --input-type=module <<'JS'
import {readFileSync, readdirSync, statSync} from "node:fs";
import {join,relative} from "node:path";
const root="dist";
let count=0;
function walk(dir){
  for(const name of readdirSync(dir)){
    const p=join(dir,name),s=statSync(p);
    if(s.isDirectory()) {walk(p);continue;}
    if(!s.isFile()) throw Error("Unexpected deployment artifact");
    count++;
    if(count>2500) throw Error("Too many deployment files");
    if(!/\.(html|css|js|json|svg|txt)$/i.test(p))continue;
    const value=readFileSync(p,"utf8");
    if(value.includes("quizer-staging-az26") ||
       value.includes("mimo-backend-513412") ||
       /-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(value))
      throw Error("Unsafe or cross-project artifact "+relative(root,p));
  }
}
walk(root);
const cfg=readFileSync("dist/js/firebase-config.js","utf8");
if(!cfg.includes("sat-quiz-fd317") ||
   !cfg.includes("1:476816329871:web:057181fe99c4088f1b34fa"))
  throw Error("Wrong Firebase app embedded in the public bundle");
for(const page of ["index.html","login.html","quiz.html","quizzes.html","problems.html"]){
  statSync(join(root,page));
}
console.log("Verified "+count+" frontend files for sat-quiz-fd317.");
JS
echo "========== DEPLOY PUBLIC WEBSITE ONLY =========="
npx --no-install firebase deploy \
  --project="$PROJECT" --config="$CONFIG" \
  --only hosting --non-interactive
echo "==============================================="
echo "Website: https://sat-quiz-fd317.web.app"
echo "Note: The new Neon backend is NOT activated by this Hosting-only deployment."
