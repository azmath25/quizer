#!/usr/bin/env bash
# QUIZER FAST STAGING DEPLOY -- FIRESTORE-FIRST
# Explicit project on EVERY Google/Firebase command; does not change gcloud defaults.
# Does not deploy Neon, scheduledMaintenance, Mimo or production.
set -euo pipefail
PROJECT="quizer-staging-az26"
NUMBER="509423933910"
BRANCH="work/quizer-audit-optimization-2026-11"
CONFIG="firebase.staging.deploy.json"

cd "$(dirname "$0")/../.."
if [[ "$(git branch --show-current)" != "$BRANCH" ]]; then
  echo "STOP: Wrong Git branch; expected $BRANCH" >&2; exit 2
fi
if [[ "$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')" != "$NUMBER" ]]; then
  echo "STOP: Quizer staging project identity could not be verified." >&2; exit 2
fi
BILLING="$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)')"
if [[ "$BILLING" != "True" && "$BILLING" != "true" ]]; then
  echo "STOP: Link a billing account to $PROJECT first (Blaze required for Functions)."
  echo "Open: https://console.firebase.google.com/project/$PROJECT/usage/details"
  echo "Then rerun this script. No deployment was attempted."
  exit 3
fi
if [[ ! -f "$CONFIG" || ! -f "config/firebase.staging.js" ]]; then
  echo "STOP: Missing staging-only Firebase configuration." >&2; exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "STOP: Node.js 22+ is needed." >&2; exit 2
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 22 )); then
  echo "STOP: Node.js 22+ is required; current $(node -v)." >&2; exit 2
fi
echo "========== QUIZER STAGING ONLY =========="
echo "Project: $PROJECT"
echo "Branch: $BRANCH"
echo "Billing: enabled (usage may incur charges)"
echo "Backend: CURRENT LEGACY FIRESTORE, NOT NEON"
echo "Scheduled maintenance: NOT SELECTED FOR DEPLOYMENT"
echo "========================================="
npm ci --no-audit --no-fund
npm ci --prefix functions --no-audit --no-fund
npm run build:staging
node --input-type=module -e 'import {auditStagingBundle} from "./scripts/staging/stg2-frontend-audit.mjs"; console.log(JSON.stringify(auditStagingBundle(),null,2))'

# Hosting first: make the site reachable before backend initialization.
echo "========== 1/4 HOSTING =========="
npx --no-install firebase deploy --project="$PROJECT" --config="$CONFIG" --non-interactive --only hosting

# Client writes remain restricted by audited Firebase rules.
echo "========== 2/4 FIRESTORE RULES & INDEXES =========="
npx --no-install firebase deploy --project="$PROJECT" --config="$CONFIG" --non-interactive \
  --only "firestore:rules,firestore:indexes"

# Select exactly two functions; DO NOT deploy scheduledMaintenance.
echo "========== 3/4 API + JOB WORKER =========="
npx --no-install firebase deploy --project="$PROJECT" --config="$CONFIG" --non-interactive \
  --only "functions:mathquiz:api,functions:mathquiz:processJob"

# A Firebase default bucket must be provisioned separately in Firebase Console.
# Missing bucket should not hide a successful frontend+API deployment.
echo "========== 4/4 STORAGE RULES =========="
if gcloud storage buckets describe "gs://$PROJECT.firebasestorage.app" \
  --project="$PROJECT" --format='value(name)' >/dev/null 2>&1; then
  npx --no-install firebase deploy --project="$PROJECT" --config="$CONFIG" \
    --non-interactive --only storage
else
  echo "WARNING: Default Firebase Storage bucket was not verified."
  echo "Open: https://console.firebase.google.com/project/$PROJECT/storage"
  echo "Use Get started and then run:"
  echo "npx --no-install firebase deploy --project=$PROJECT --config=$CONFIG --only storage"
  echo "Image uploads may not work until Storage is configured."
fi
echo "========== STAGING WEBSITE =========="
echo "https://$PROJECT.web.app"
echo "https://$PROJECT.firebaseapp.com"
echo "If login fails, enable Google / Email providers under Firebase Authentication"
echo "and ensure those two Hosting domains are authorized."
echo "Staging uses Firestore-first backend. Production and Mimo were not targeted."
