#!/usr/bin/env bash
# PROD1: one-time SAT QUIZ app password bootstrap without exposing passwords.
# Requires only a Neon quizer_owner DATABASE URL pasted into a hidden prompt.
# Does NOT deploy Firebase Hosting, Functions, pages or change Mimo.
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ "$(git branch --show-current)" == "work/quizer-audit-optimization-2026-11" ]] || {
  echo "STOP: wrong Quizer branch." >&2; exit 2;
}
[[ "$(gcloud projects describe sat-quiz-fd317   --format='value(projectNumber)')" == "476816329871" ]] || {
  echo "STOP: wrong Firebase project." >&2; exit 2;
}
if gcloud secrets describe QUIZER_NEON_DATABASE_URL   --project=sat-quiz-fd317 >/dev/null 2>&1; then
  echo "STOP: Quizer connection secret already exists; refusing replacement." >&2
  exit 3
fi
if [[ ! -d node_modules/pg ]]; then npm ci --no-audit --no-fund; fi
echo "Use NEON PROJECT soft-grass-35754518, BRANCH sat-quiz-live-2026-11,"
echo "DATABASE quizer, ROLE quizer_owner in the Neon Connect dialog."
echo "Never paste the URL into chat, GitHub or the visible terminal prompt."
IFS= read -r -s -p "Paste private quizer_owner URL (hidden): " OWNER_URL
printf '\n'
if [[ -z "$OWNER_URL" ]]; then echo "STOP: missing owner URL."; exit 2; fi
# Pipe the URL only to the local verifier; it never reaches argv or logs.
printf '%s' "$OWNER_URL" |
  node scripts/neon/repair-quizer-app-password.mjs
unset OWNER_URL
