#!/usr/bin/env bash
# Local syntax and mock-transport tests only. No Firebase/Neon/Mimo deployment.
set -euo pipefail
if [[ ! -f firebase.json || ! -f functions/src/mimo/batch.js ]]; then
  echo "Run from Quizer repository root" >&2; exit 1
fi
if ! command -v node >/dev/null; then echo "Node 22 required" >&2; exit 1; fi
npm ci --no-audit --no-fund
npm ci --prefix functions --no-audit --no-fund
npm run prepare:backend
node --check functions/src/index.js
node --check functions/src/mimo/batch.js
node --check functions/src/mimo/run-diagnostics.js
node --check js/pages/ai-studio.js
node --test functions/test/mimo-batch.test.mjs
echo "PASS: Quizer PDF queue and 429 status tests (mock provider, no new runs)."
echo "Before Firebase deployment: deploy new firestore indexes, wait for READY, then only deploy Mimo batch callables + frontend."
