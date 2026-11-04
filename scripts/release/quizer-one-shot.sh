#!/usr/bin/env bash
# Quizer coordinated release: run once in Google Cloud Shell.
# Does not touch Mimo, Firebase Hosting, Firestore rules/indexes, or Neon schema/data.
set -Eeuo pipefail
umask 077

PROJECT="sat-quiz-fd317"
PROJECT_NUMBER="476816329871"
REGION="europe-west1"
SOURCE_BRANCH="integration/quizer-frontend-backend-2026-11-05"
PUBLIC_BRANCH="work/quizer-audit-optimization-2026-11"
EXPECTED_PUBLIC_HEAD="9496b6c762c6af566be4aeba5e0b911992337c5f"
VERIFIED_INTEGRATION_ANCESTOR="7b53065ddf4121f14db0cc77c4993e528c020204"
REMOTE="https://github.com/azmath25/quizer.git"
ENV_SOURCE="${QUIZER_ENV_SOURCE:-$HOME/quizer-staging-audit/quizer/functions/.env.sat-quiz-fd317}"
FUNCTIONS=(api processJob scheduledMaintenance)
SERVICES=(api processjob scheduledmaintenance)
RELEASE_DIR="$HOME/quizer-releases/$(date -u +%Y%m%dT%H%M%SZ)"
SRC="$RELEASE_DIR/source"
BACKEND_STARTED=0
FRONTEND_PUSHED=0

fail(){ echo "ERROR: $*" >&2; exit 1; }
step(){ printf '\n>>> %s\n' "$*"; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "Missing $1"; }

# Protect prior Cloud Run serving revisions on an interrupted release.
rollback(){
  if [[ "$BACKEND_STARTED" != 1 || "$FRONTEND_PUSHED" == 1 ]]; then return; fi
  echo "Backend release interrupted; restoring captured Cloud Run traffic..." >&2
  local i name old
  for i in "${!SERVICES[@]}"; do
    name="${SERVICES[$i]}"
    old="$(cat "$RELEASE_DIR/previous-$name.txt" 2>/dev/null || true)"
    if [[ -n "$old" ]]; then
      gcloud run services update-traffic "$name" --project "$PROJECT" \
        --region "$REGION" --to-revisions="$old=100" --quiet >/dev/null 2>&1 \
        && echo "Restored $name -> $old" >&2 \
        || echo "MANUAL ROLLBACK REQUIRED: $name -> $old" >&2
    fi
  done
}
trap 'code=$?; if ((code != 0)); then rollback; fi' EXIT

step "Check pinned tools and Cloud Shell project"
for bin in git gcloud node npm curl; do need "$bin"; done
mkdir -p "$RELEASE_DIR"
actual_number="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')" \
  || fail "Cannot inspect SAT QUIZ project"
[[ "$actual_number" == "$PROJECT_NUMBER" ]] || fail "Wrong Google Cloud project"
[[ -f "$ENV_SOURCE" ]] || fail "Missing existing project-specific Functions env file: $ENV_SOURCE"
# Do not echo dotenv contents. Runtime must remain enabled as previously approved.
grep -qx 'QUIZER_PROD1_ENABLED=true' "$ENV_SOURCE" \
  || fail "QUIZER_PROD1_ENABLED=true is not present in existing project-specific dotenv file"
if grep -Eq '^(QUIZER_NEON_DATABASE_URL|QUIZER_BANK_CURSOR_KEY)=' "$ENV_SOURCE"; then
  fail "Secrets belong in Secret Manager, never the project dotenv file"
fi

step "Fetch the reviewed combined frontend/backend"
git clone --quiet --single-branch --branch "$SOURCE_BRANCH" "$REMOTE" "$SRC"
cd "$SRC"
git merge-base --is-ancestor "$VERIFIED_INTEGRATION_ANCESTOR" HEAD \
  || fail "Integration branch does not contain verified combined code"
# Release is restricted to the verified sources plus deployment/docs-only changes.
if ! git diff --quiet "$VERIFIED_INTEGRATION_ANCESTOR" HEAD -- \
   ':!docs/**' ':!scripts/release/**' ':!.github/workflows/**'; then
  fail "Source code changed since approved combined CI; rerun CI before release"
fi
public_remote="$(git ls-remote origin "refs/heads/$PUBLIC_BRANCH" | awk '{print $1}')"
[[ "$public_remote" == "$EXPECTED_PUBLIC_HEAD" ]] \
  || fail "Public branch changed since the reviewed baseline: stop, do not overwrite changes"
git push --dry-run origin "HEAD:refs/heads/$PUBLIC_BRANCH" >/dev/null \
  || fail "Git push authorization/fast-forward dry-run failed; fix before deploying backend"
# Preserve the existing ignored runtime flag without printing it.
cp -p "$ENV_SOURCE" functions/.env.sat-quiz-fd317
chmod 600 functions/.env.sat-quiz-fd317
echo "Release source: $(git rev-parse HEAD)"

step "Capture currently SERVING Cloud Run revisions for all three Functions"
for i in "${!FUNCTIONS[@]}"; do
  function="${FUNCTIONS[$i]}"
  service="${SERVICES[$i]}"
  gcloud functions describe "$function" --gen2 --region "$REGION" \
    --project "$PROJECT" --format=json > "$RELEASE_DIR/previous-function-$service.json" \
    || fail "Cannot inspect deployed function $function"
  gcloud run services describe "$service" --region "$REGION" \
    --project "$PROJECT" --format=json > "$RELEASE_DIR/previous-run-$service.json" \
    || fail "Cannot inspect rollback service $service"
  node - "$RELEASE_DIR/previous-run-$service.json" "$RELEASE_DIR/previous-$service.txt" <<'NODE'
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const traffic=(j.status?.traffic??[]).filter(x=>(x.percent??0)>0);
if(traffic.length!==1 || traffic[0].percent!==100 || !traffic[0].revisionName)
  throw new Error("Expected exactly one 100% serving revision");
fs.writeFileSync(process.argv[3],traffic[0].revisionName+"\n");
NODE
  echo "$function previous revision: $(cat "$RELEASE_DIR/previous-$service.txt")"
done

step "Install locked dependencies and run local production guards"
npm ci --no-audit --no-fund
npm ci --prefix functions --no-audit --no-fund
npm run prepare:backend
npm test
npm run test:backend
npm run verify:static
npm run build

step "Deploy only the three Cloud Functions (no Firebase Hosting/rules)"
BACKEND_STARTED=1
./node_modules/.bin/firebase deploy \
  --only functions:mathquiz:api,functions:mathquiz:processJob,functions:mathquiz:scheduledMaintenance \
  --project "$PROJECT" --non-interactive
step "Confirm ACTIVE functions, flag and both bound Secret Manager names"
for function in "${FUNCTIONS[@]}"; do
  gcloud functions describe "$function" --gen2 --region "$REGION" \
    --project "$PROJECT" --format=json > "$RELEASE_DIR/new-$function.json" \
    || fail "Missing deployed function $function"
  node - "$RELEASE_DIR/new-$function.json" "$function" <<'NODE'
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const name=process.argv[3],cfg=j.serviceConfig??{};
const bindings=new Set((cfg.secretEnvironmentVariables??[]).flatMap(v=>[v.key,v.secret]));
for(const secret of ["QUIZER_NEON_DATABASE_URL","QUIZER_BANK_CURSOR_KEY"])
 if(!bindings.has(secret))throw Error(name+": missing "+secret+" binding");
if(j.state!=="ACTIVE")throw Error(name+": not ACTIVE");
if(!(cfg.environmentVariables?.QUIZER_PROD1_ENABLED==="true"))
 throw Error(name+": hybrid runtime flag is not true");
console.log(name+": ACTIVE, secret bindings present, hybrid enabled");
NODE
done

step "Unauthenticated production API smoke (no student or Neon writes)"
API_URL="$(node - "$RELEASE_DIR/new-api.json" <<'NODE'
const j=require(process.argv[2]);
console.log(j.serviceConfig?.uri??"");
NODE
)"
[[ "$API_URL" == https://* ]] || fail "Deployed API URL missing"
REQUEST_ID="$(node -p 'require("crypto").randomUUID()')"
curl --fail --silent --show-error --max-time 35 \
  -H 'Content-Type: application/json' \
  -d "{\"data\":{\"apiVersion\":2,\"action\":\"listPublicQuizzes\",\"requestId\":\"$REQUEST_ID\"}}" \
  "$API_URL" > "$RELEASE_DIR/guest-response.json" \
  || fail "Guest callable API smoke failed"
node - "$RELEASE_DIR/guest-response.json" <<'NODE'
const fs=require("fs");
const response=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const result=response.result??response.data;
if(result?.apiVersion!==2||!Array.isArray(result?.data?.items))
 throw Error("Unexpected public callable response shape");
console.log("Public quiz listing works; count:",result.data.items.length);
NODE

step "Publish reviewed combined frontend via existing GitHub Pages work-branch workflow"
# The existing Pages workflow is push-triggered on the reviewed work branch.
# A fast-forward push publishes only the frontend bundle; does not touch Firebase Hosting.
git push origin "HEAD:refs/heads/$PUBLIC_BRANCH" \
  || fail "Frontend push failed after backend deployment (backend rollback attempted)"
FRONTEND_PUSHED=1
step "Confirm the GitHub Pages workflow actually completed for this commit"
COMMIT="$(git rev-parse HEAD)"
PAGES_STATUS="not-found"
for attempt in $(seq 1 60); do
  # Public GitHub API: release SHA and job status only; no access tokens in logs.
  curl --fail --silent --show-error --max-time 15 \
    "https://api.github.com/repos/azmath25/quizer/actions/runs?per_page=30" \
    > "$RELEASE_DIR/actions-runs.json" || fail "Cannot read GitHub Actions status"
  PAGES_STATUS="$(node - "$RELEASE_DIR/actions-runs.json" "$COMMIT" <<'NODE'
const fs=require("fs"),data=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const run=(data.workflow_runs??[]).find(r=>r.head_sha===process.argv[3] &&
  r.name==="Publish Quizer to GitHub Pages");
console.log(!run?"not-found":run.status!=="completed"?"running":
  run.conclusion==="success"?"success":"failed");
NODE
)"
  [[ "$PAGES_STATUS" == success ]] && break
  [[ "$PAGES_STATUS" == failed ]] && fail "Pages publication failed; inspect GitHub Actions before any more deployment"
  sleep 10
done
[[ "$PAGES_STATUS" == success ]] || fail "Pages completion could not be confirmed; backend remains deployed, inspect GitHub Actions"
echo "SUCCESS: Firebase backend deployed and guest-smoked; GitHub Pages deployed from $COMMIT."
echo "Release/rollback snapshots: $RELEASE_DIR"
echo "NOTE: An authenticated student submission smoke still needs a safe test account."
