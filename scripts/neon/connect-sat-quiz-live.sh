#!/usr/bin/env bash
# One-time secure connection: copy the Neon POOLED connection string for
# project soft-grass-35754518 / branch sat-quiz-live-2026-11 /
# database quizer / role quizer_app into SAT QUIZ Secret Manager.
# NO GitHub credential commits. NO Firebase Hosting deploy. NO Mimo access.
set -euo pipefail
cd "$(dirname "$0")/../.."

PROJECT="sat-quiz-fd317"
NUMBER="476816329871"
SECRET="QUIZER_NEON_DATABASE_URL"
EXPECTED_HOST="ep-ancient-voice-b9jua9ew-pooler.c-7.eu-central-1.aws.neon.tech"

if [[ "$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')" != "$NUMBER" ]]; then
  echo "STOP: SAT QUIZ Firebase project identity not verified." >&2
  exit 2
fi
if [[ "$(git branch --show-current)" != "work/quizer-audit-optimization-2026-11" ]]; then
  echo "STOP: Use the Quizer work branch." >&2
  exit 2
fi
if [[ ! -d node_modules/pg ]]; then
  echo "Installing locked frontend tooling (for local SQL connection test only)."
  npm ci --no-audit --no-fund
fi
if gcloud secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  echo "STOP: The SAT QUIZ Neon secret already exists."
  echo "Do not silently overwrite a production credential."
  exit 3
fi

echo "Neon Console: https://console.neon.tech/app/projects/soft-grass-35754518/branches/br-lucky-lake-b9pocorx"
echo "Choose branch sat-quiz-live-2026-11, database quizer, role quizer_app."
echo "If the role has no password, reset it in the Neon Roles panel."
echo "Copy the pooled Postgres URL from Connect. Do NOT paste it into chat."
IFS= read -r -s -p "Paste the complete quizer_app pooled URL (hidden): " NEON_URL
printf '\n'
if [[ -z "$NEON_URL" ]]; then
  echo "STOP: empty connection string"; exit 2
fi

# Connect with a restricted user and check actual grants before storing URL.
QUIZER_URL="$NEON_URL" EXPECTED_HOST="$EXPECTED_HOST" node --input-type=module <<'JS'
import pg from "pg";
const bad = (why) => {
  // Only safe metadata is printed: NEVER the URL, password, token or query values.
  console.error("STOP: " + why);
  console.error("Nothing was saved; copy the RAW pooled PostgreSQL URL from the exact Neon branch.");
  process.exit(2);
};
const raw = process.env.QUIZER_URL ?? "";
if(!raw || /^\\s*psql\\s/i.test(raw) || /^\\s*["']/.test(raw) ||
   /["']\\s*$/.test(raw))
  bad("Paste the PostgreSQL URL only, without psql, quotes or command wrappers.");
let uri;
try {uri=new URL(raw);}catch {
  bad("Input is not a PostgreSQL URL. Copy the URI, not a SQL/psql command.");
}
const params=new Set([...uri.searchParams.keys()]);
if(!["postgres:","postgresql:"].includes(uri.protocol))
  bad("Wrong URL protocol; expected postgresql://.");
if(uri.hostname!==process.env.EXPECTED_HOST)
  bad("Wrong Neon endpoint host: " + uri.hostname +
      ". Re-select branch sat-quiz-live-2026-11 and the POOLED endpoint.");
if(decodeURIComponent(uri.username)!=="quizer_app")
  bad("Wrong Neon role: " + decodeURIComponent(uri.username) +
      ". Select quizer_app, not quizer_owner.");
if(decodeURIComponent(uri.pathname.slice(1))!=="quizer")
  bad("Wrong Neon database: " + decodeURIComponent(uri.pathname.slice(1)) +
      ". Select quizer.");
if(!uri.password)
  bad("No password is present. Set/reset quizer_app password in Neon Roles first.");
if(uri.searchParams.get("sslmode")!=="require")
  bad("Missing sslmode=require. Copy Neon Connect's pooled URL with TLS required.");
if(params.has("channel_binding") &&
   uri.searchParams.get("channel_binding")!=="require")
  bad("Unsafe channel_binding option. Only channel_binding=require is accepted.");
const unknown=[...params].filter(p=>!["sslmode","channel_binding"].includes(p));
if(unknown.length)
  bad("Unexpected URL parameter names: " + unknown.join(", "));
if(uri.hash)bad("URL must not have a fragment.");
const client=new pg.Client({connectionString:raw,connectionTimeoutMillis:8000});
try{
  await client.connect();
  const {rows}=await client.query(
    "SELECT current_user AS role_name, " +
    "pg_has_role(current_user,'neon_superuser','MEMBER') AS elevated, " +
    "pg_has_role(current_user,'quizer_app_limited','MEMBER') AS limited, " +
    "has_table_privilege(current_user,'quizer.problems','SELECT,INSERT,UPDATE') AS bank_write, " +
    "has_table_privilege(current_user,'quizer.quiz_revision_mirrors','SELECT') AS forbidden_mirror");
  const r=rows[0]||{};
  if(r.role_name!=="quizer_app"||r.elevated!==false||
     r.limited!==true||r.bank_write!==true||r.forbidden_mirror!==false)bad();
  console.log("PASS: live Neon branch login/permissions verified (no credentials shown).");
}finally{await client.end().catch(()=>{});}
JS

echo "Enabling Secret Manager API on SAT QUIZ only if required."
gcloud services enable secretmanager.googleapis.com --project="$PROJECT" --quiet

echo "Creating a single SAT QUIZ secret; the URL is passed via stdin, not shell history."
printf '%s' "$NEON_URL" |
  gcloud secrets create "$SECRET" \
    --project="$PROJECT" \
    --replication-policy="automatic" \
    --data-file=-
unset NEON_URL

echo "SUCCESS: SAT QUIZ's restricted Neon URL is stored securely."
echo "No API was redeployed. GitHub Pages and Firebase Hosting were untouched."
echo "The new backend must still bind this secret using Firebase Functions v2."
