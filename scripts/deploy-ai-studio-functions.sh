#!/usr/bin/env bash
# Teacher-only AI Studio release. Run once in authenticated Google Cloud Shell.
# This deploys only the pinned Mimo/Firebase callable and scheduled functions.
set -euo pipefail
PROJECT="sat-quiz-fd317"
WORKFLOW="c_mw5e6wmr_wma1bg"

if [[ "${1:-}" != "--deploy" ]]; then
  echo "Usage: bash scripts/deploy-ai-studio-functions.sh --deploy"
  echo "No functions were deployed."
  exit 2
fi
if [[ ! -f firebase.json || ! -f functions/src/mimo/batch.js ||
      ! -f functions/src/mimo/ai-hub.js || ! -f js/pages/ai-studio.js ]]; then
  echo "ERROR: Run from Quizer's AI Studio release checkout root." >&2
  exit 1
fi
if ! grep -q "${WORKFLOW}" functions/src/mimo/extraction.js; then
  echo "ERROR: Extraction workflow ID mismatch. Deployment blocked." >&2
  exit 1
fi
if ! command -v gcloud >/dev/null || ! command -v git >/dev/null; then
  echo "ERROR: Run inside authenticated Google Cloud Shell." >&2
  exit 1
fi
BRANCH="$(git branch --show-current)"
if [[ "${BRANCH}" != "feature/ai-studio-history-jobs-import-20261107" &&
      "${BRANCH}" != "main" ]]; then
  echo "ERROR: Unexpected branch '${BRANCH}'. Nothing deployed." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Working tree is dirty. Commit or restore before deploying." >&2
  exit 1
fi
if [[ "$(gcloud config get-value project 2>/dev/null)" != "${PROJECT}" ]]; then
  echo "ERROR: Set the Cloud project explicitly: gcloud config set project ${PROJECT}" >&2
  exit 1
fi
for name in QUIZER_MIMO_PROJECT_KEY QUIZER_NEON_DATABASE_URL; do
  if ! gcloud secrets describe "${name}" --project="${PROJECT}" \
       --format='value(name)' >/dev/null 2>&1; then
    echo "ERROR: Required Firebase secret ${name} not found/readable. Nothing deployed." >&2
    exit 1
  fi
done

echo "Checking pinned AI Studio, review and existing Quizer code…"
npm ci --no-audit --no-fund
npm ci --prefix functions --no-audit --no-fund
npm run test:backend
npm test
npm run verify:static
npm run build
node --check functions/src/mimo/batch.js
node --check functions/src/mimo/ai-hub.js
node --check functions/src/mimo/compact-memory.js

echo "Deploying only teacher AI Studio, batch, extraction and chat functions."
echo "The deployed scheduler jobs run every 1m (batch) and 5m (memory)."
echo "Quiz core, Firebase rules, legacy workers and public website are untouched."
npx firebase deploy --project "${PROJECT}" --non-interactive \
  --only "functions:mathquiz:mimoTeacherChat,functions:mathquiz:mimoAiHub,functions:mathquiz:mimoAiMemorySweep,functions:mathquiz:mimoBatchStart,functions:mathquiz:mimoBatchList,functions:mathquiz:mimoBatchStatus,functions:mathquiz:mimoBatchGetPage,functions:mathquiz:mimoBatchImage,functions:mathquiz:mimoBatchReviewPage,functions:mathquiz:mimoBatchPrepared,functions:mathquiz:mimoBatchSweep,functions:mathquiz:mimoExtractStart,functions:mathquiz:mimoExtractStatus,functions:mathquiz:mimoExtractImage,functions:mathquiz:mimoExtractList"
echo "Firebase AI Studio function deployment completed. Now verify with an authenticated teacher before publishing ai.html."
