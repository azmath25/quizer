#!/usr/bin/env bash
# Production M1 static frontend release to an isolated Vercel project.
# No GitHub Actions, no Firebase deploy, no new Mimo provider calls.
# Resumes the already-created, linked isolated M1 Vercel project safely.
# Does not create projects, relink, modify other Vercel projects or deploy Firebase.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

BRANCH="release/m1-vercel-20261108"
PROJECT="quizer-ai-studio-m1-azmath25"
TEAM="azmath25s-projects"
if [[ "${1:-}" != "--apply" && "${1:-}" != "--plan" ]]; then
  echo "Usage: bash scripts/mimo/m1-release-vercel-cloudshell.sh --plan|--apply" >&2
  exit 2
fi
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  echo "STOP: Node.js 22 is required." >&2
  exit 2
fi
if [[ "$(git rev-parse --is-inside-work-tree)" != "true" ]]; then
  echo "STOP: Not in the Quizer Git checkout." >&2
  exit 2
fi
ORIGIN="$(git remote get-url origin)"
case "$ORIGIN" in
  *github.com/azmath25/quizer*|*github.com:azmath25/quizer*) ;;
  *) echo "STOP: This is not azmath25/quizer." >&2; exit 2;;
esac
if ! git rev-parse --verify "origin/${BRANCH}^{commit}" >/dev/null 2>&1; then
  echo "STOP: Fetch the release branch first: git fetch origin ${BRANCH}" >&2
  exit 2
fi
HEAD="$(git rev-parse HEAD)"
PIN="$(git rev-parse "origin/${BRANCH}^{commit}")"
if [[ "$HEAD" != "$PIN" ]]; then
  echo "STOP: HEAD does not equal origin/${BRANCH}. Switch to the release branch." >&2
  exit 2
fi
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "STOP: Working tree changed; release exact committed source only." >&2
  exit 2
fi
if [[ ! -f vercel.json || ! -f .vercelignore ||
      ! -f js/pages/ai-studio.js || ! -f js/components/mimo-png-viewer.js ]]; then
  echo "STOP: Quizer M1 Vercel static build files are missing." >&2
  exit 2
fi

echo "Preflight — source commit: $HEAD"
echo "Target: existing isolated Vercel project '$TEAM/$PROJECT'."
echo "No new project or Git link will be created."
echo "Existing GitHub Pages site and Firebase functions are untouched."
echo "Running verified M1 tests and static build…"
bash scripts/mimo/m1-verify-cloudshell.sh
node --input-type=module <<'JS'
import {readFileSync,statSync} from "node:fs";
const config=JSON.parse(readFileSync("vercel.json","utf8"));
if(config.outputDirectory!=="dist" || config.buildCommand!=="npm run build" ||
   config.cleanUrls!==false || config.rewrites || config.routes || config.functions ||
   config.builds || config.redirects || config.crons)
  throw Error("Unexpected Vercel configuration. Refusing release.");
for(const file of ["index.html","ai.html","login.html",
  "js/pages/ai-studio.js","js/components/mimo-png-viewer.js",
  "assets/css/ai-studio-native-m1.css","js/firebase-config.js"])
  if(!statSync("dist/"+file).isFile())throw Error("Missing public asset "+file);
const ai=readFileSync("dist/ai.html","utf8");
const client=readFileSync("dist/js/firebase-config.js","utf8");
if(!ai.includes("m1-native-20261108") ||
   !ai.includes("ai-studio-native-m1.css") ||
   !client.includes("sat-quiz-fd317") ||
   !client.includes("1:476816329871:web:057181fe99c4088f1b34fa") ||
   client.includes("quizer-staging-az26"))
  throw Error("M1 or Firebase public client identity mismatch.");
for(const forbidden of ["dist/functions","dist/firebase","dist/.env",
  "dist/node_modules","dist/tests","dist/docs"]){
  try{statSync(forbidden);throw Error("Private/unwanted build artifact: "+forbidden);}
  catch(e){if(e.code!=="ENOENT")throw e;}
}
console.log("M1_VERCEL_STATIC_PREFLIGHT_PASS");
JS

if [[ "$1" == "--plan" ]]; then
  echo "M1_VERCEL_RELEASE_PLAN_PASS — no deployment."
  echo "For production: bash scripts/mimo/m1-release-vercel-cloudshell.sh --apply"
  exit 0
fi

# Vercel CLI 65.12.1 is the already-observed Cloud Shell release tool.
# Keep this version pinned; a newer CLI must be re-audited separately.
if command -v vercel >/dev/null 2>&1 &&
   vercel --version 2>/dev/null | grep -Eq '^Vercel CLI 65\\.12\\.1$|^65\\.12\\.1
case "$DEPLOY_URL" in
  https://*) ;;
  *) echo "Unexpected Vercel deployment URL. Inspect deployment output: $DEPLOY_URL" >&2; exit 4;;
esac
echo "Production deployment URL: $DEPLOY_URL"
if command -v curl >/dev/null 2>&1; then
  HTML="$(curl --retry 3 --retry-delay 2 --fail --location --silent --show-error "$DEPLOY_URL/ai.html")"
  if [[ "$HTML" != *"m1-native-20261108"* || "$HTML" != *"ai-studio-native-m1.css"* ]]; then
    echo "STOP: Deployed /ai.html does not contain pinned M1 assets." >&2
    exit 4
  fi
  curl --retry 3 --retry-delay 2 --fail --location --silent --show-error \
    "$DEPLOY_URL/assets/css/ai-studio-native-m1.css" >/dev/null
  curl --retry 3 --retry-delay 2 --fail --location --silent --show-error \
    "$DEPLOY_URL/js/components/mimo-png-viewer.js" >/dev/null
  echo "M1_VERCEL_PUBLIC_ASSETS_PASS"
fi
echo "M1_VERCEL_PROD_DEPLOY_PASS"
echo "NEXT: Firebase Authentication > Settings > Authorized domains:"
echo "       Add the EXACT hostname of this Vercel deployment's stable production domain."
echo "       Test signed-in teacher chat and existing Mimo job/PNG in Chrome."
echo "NOTE: Google OAuth from a new web domain may show auth/unauthorized-domain until authorized."
echo "GitHub Pages original site was not changed."
; then
  VERCEL=(vercel)
else
  VERCEL=(npx --yes vercel@65.12.1)
fi
# Node 22.21+ supports proxy environment variables for fetch via this opt-in.
# Never display proxy settings or Vercel tokens in logs.
export NODE_USE_ENV_PROXY=1

echo "Checking Vercel CLI authorization."
if ! "${VERCEL[@]}" whoami >/dev/null 2>&1; then
  echo "Complete Vercel account sign-in in the browser when prompted."
  "${VERCEL[@]}" login
fi
"${VERCEL[@]}" whoami

# The prior release already created and linked the isolated project, but the
# upload failed. Resume ONLY that project; do not create or relink anything.
if [[ ! -f .vercel/project.json ]]; then
  echo "STOP: Existing project link is missing. Do not create a new project." >&2
  echo "From the existing release worktree, link the known project, then retry:" >&2
  echo "  npx --yes vercel@65.12.1 link --yes --scope '$TEAM' --project '$PROJECT'" >&2
  exit 3
fi
EXPECTED_PROJECT="$PROJECT" node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
const p=JSON.parse(readFileSync(".vercel/project.json","utf8"));
if(p.projectName!==process.env.EXPECTED_PROJECT ||
   typeof p.projectId!=="string" || !p.projectId.startsWith("prj_") ||
   typeof p.orgId!=="string" || !p.orgId.startsWith("team_"))
  throw Error("Vercel local link does not identify the approved M1 project/team.");
console.log("M1_VERCEL_EXISTING_LINK_VERIFIED");
JS
if ! "${VERCEL[@]}" project inspect "$PROJECT" --scope "$TEAM" >/dev/null; then
  echo "STOP: Cannot verify the existing Vercel project in the approved team." >&2
  exit 3
fi

# Safe unauthenticated reachability diagnostics. HTTP 401 from the user endpoint
# is EXPECTED without a bearer token; we do not print or request credentials.
echo "Checking HTTPS connectivity to Vercel API (no credentials)…"
curl --connect-timeout 12 --max-time 25 --fail-with-body \
   --silent --show-error -o /dev/null \
   -w "Vercel API TCP/TLS reachable (HTTP %{http_code}).\\n" \
   "https://api.vercel.com/v2/user" || true
node --input-type=module <<'JS'
try {
  const response=await fetch("https://api.vercel.com/v2/user", {
    signal:AbortSignal.timeout(18000)
  });
  if(response.status>=500)throw Error("Vercel API returned "+response.status);
  console.log("M1_VERCEL_NODE_NETWORK_PASS (HTTP "+response.status+")");
} catch(e) {
  console.error("M1_VERCEL_NODE_NETWORK_FAIL:",
    e?.cause?.code||e?.cause?.cause?.code||e?.name||"network failure");
  process.exitCode=3;
}
JS

echo "Retrying static deployment to VERIFIED existing M1 project, using compressed archive."
echo "Original GitHub Pages and Firebase functions are not modified."
# Vercel's documented archive mode reduces requests for many static files.
DEPLOY_URL=$("${VERCEL[@]}" deploy --prod --yes --scope "$TEAM" --archive=tgz)
case "$DEPLOY_URL" in
  https://*) ;;
  *) echo "Unexpected Vercel deployment URL. Inspect deployment output: $DEPLOY_URL" >&2; exit 4;;
esac
echo "Production deployment URL: $DEPLOY_URL"
if command -v curl >/dev/null 2>&1; then
  HTML="$(curl --retry 3 --retry-delay 2 --fail --location --silent --show-error "$DEPLOY_URL/ai.html")"
  if [[ "$HTML" != *"m1-native-20261108"* || "$HTML" != *"ai-studio-native-m1.css"* ]]; then
    echo "STOP: Deployed /ai.html does not contain pinned M1 assets." >&2
    exit 4
  fi
  curl --retry 3 --retry-delay 2 --fail --location --silent --show-error \
    "$DEPLOY_URL/assets/css/ai-studio-native-m1.css" >/dev/null
  curl --retry 3 --retry-delay 2 --fail --location --silent --show-error \
    "$DEPLOY_URL/js/components/mimo-png-viewer.js" >/dev/null
  echo "M1_VERCEL_PUBLIC_ASSETS_PASS"
fi
echo "M1_VERCEL_PROD_DEPLOY_PASS"
echo "NEXT: Firebase Authentication > Settings > Authorized domains:"
echo "       Add the EXACT hostname of this Vercel deployment's stable production domain."
echo "       Test signed-in teacher chat and existing Mimo job/PNG in Chrome."
echo "NOTE: Google OAuth from a new web domain may show auth/unauthorized-domain until authorized."
echo "GitHub Pages original site was not changed."
