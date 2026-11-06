#!/usr/bin/env bash
# Deploy ONLY the new Quizer teacher PDF/image extraction Firebase functions.
# Execute in an authenticated Google Cloud Shell with this feature branch checked out.
set -euo pipefail

PROJECT="sat-quiz-fd317"
EXPECTED_WORKFLOW="c_mw5e6wmr_wma1bg"

if [[ ! -f package.json || ! -f functions/package.json ||
      ! -f functions/src/mimo/extraction.js ]]; then
  echo "ERROR: Run from the root of the Quizer feature-branch checkout." >&2
  exit 1
fi
if ! grep -q "${EXPECTED_WORKFLOW}" functions/src/mimo/extraction.js; then
  echo "ERROR: Unexpected Mimo workflow. Refusing deployment." >&2
  exit 1
fi
if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud is required; use authenticated Google Cloud Shell." >&2
  exit 1
fi
if [[ "$(gcloud config get-value project 2>/dev/null)" != "${PROJECT}" ]]; then
  echo "ERROR: Active Google Cloud project is not ${PROJECT}." >&2
  echo "Select it explicitly: gcloud config set project ${PROJECT}" >&2
  exit 1
fi
if ! gcloud secrets describe QUIZER_MIMO_PROJECT_KEY --project="${PROJECT}"     --format="value(name)" >/dev/null; then
  echo "ERROR: Existing Mimo project key secret not found/readable. Nothing deployed." >&2
  exit 1
fi

echo "Installing locked dependencies and checking the extraction release…"
npm ci --no-audit --no-fund
npm ci --prefix functions --no-audit --no-fund
npm run prepare:backend
node --check functions/src/index.js
node --check functions/src/mimo/extraction.js
node --check js/pages/documents.js
node --test functions/test/mimo-extraction.test.mjs
node --test tests/unit/document-desk.test.mjs

echo "Deploy target: ${PROJECT} (europe-west1)"
echo "Only functions:mimoExtractStart, functions:mimoExtractStatus, and functions:mimoExtractImage."
echo "Existing api, processJob, scheduledMaintenance, and mimoTeacherChat will not be redeployed."
npx firebase deploy \
  --project "${PROJECT}" \
  --only "functions:mathquiz:mimoExtractStart,functions:mathquiz:mimoExtractStatus,functions:mathquiz:mimoExtractImage" \
  --non-interactive

echo "Extraction function deployment command completed successfully."
echo "Do not release the frontend until the three callable functions are confirmed live."
