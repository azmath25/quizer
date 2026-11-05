#!/usr/bin/env bash
# Quizer QN10.1 historic bundle compatibility hotfix. Backend ONLY.
# Does not touch Mimo, Firebase Hosting, Firestore rules/indexes, or Neon schema/data.
set -Eeuo pipefail
umask 077

PROJECT="sat-quiz-fd317"
PROJECT_NUMBER="476816329871"
REGION="europe-west1"
SOURCE_BRANCH="main"
EXPECTED_SOURCE_HEAD="9cdd590b34f5492130ecd86c56ae90d846417214"
VERIFIED_HOTFIX_HEAD="4621db4d3200e6a277f7982a51c66daf4c796849"
REMOTE="https://github.com/azmath25/quizer.git"
ENV_SOURCE="${QUIZER_ENV_SOURCE:-$HOME/quizer-staging-audit/quizer/functions/.env.sat-quiz-fd317}"
FUNCTIONS=(api processJob scheduledMaintenance)
SERVICES=(api processjob scheduledmaintenance)
RELEASE_DIR="$HOME/quizer-releases/$(date -u +%Y%m%dT%H%M%SZ)"
SRC="$RELEASE_DIR/source"
BACKEND_STARTED=0

fail(){ echo "ERROR: $*" >&2; exit 1; }
step(){ printf '\n>>> %s\n' "$*"; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "Missing $1"; }

# Protect prior Cloud Run serving revisions on an interrupted release.
rollback(){
  if [[ "$BACKEND_STARTED" != 1 ]]; then return; fi
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

step "Fetch verified pinned main for backend hotfix"
git clone --quiet --single-branch --branch "$SOURCE_BRANCH" "$REMOTE" "$SRC"
cd "$SRC"
[[ "$(git rev-parse HEAD)" == "$EXPECTED_SOURCE_HEAD" ]] \
  || fail "main moved since hotfix approval; stop and revalidate"
git merge-base --is-ancestor "$VERIFIED_HOTFIX_HEAD" HEAD \
  || fail "Reviewed historic bundle hotfix is missing from main"
# No branch push: the frontend is already live and must remain unchanged.
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

step "Install locked dependencies and run regression guards"
npm ci --no-audit --no-fund
npm ci --prefix functions --no-audit --no-fund
npm run prepare:backend
node --test tests/unit/qn10-1-bundle-format.test.mjs
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

step "Backend-only hotfix complete"
echo "SUCCESS: Firebase Functions hotfix deployed and guest-smoked from $EXPECTED_SOURCE_HEAD."
echo "No GitHub Pages, Firestore, Neon, Secret Manager or Mimo changes were made."
echo "Rollback snapshots: $RELEASE_DIR"
echo "IMPORTANT: Test starting an existing historical quiz with an authenticated test account."
