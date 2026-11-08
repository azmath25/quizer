#!/usr/bin/env bash
# Local syntax and mock-transport tests only. No Firebase/Neon/Mimo deployment.
set -euo pipefail
if [[ ! -f firebase.json || ! -f functions/src/mimo/batch.js ]]; then
  echo "Run from Quizer repository root" >&2; exit 1
fi
if ! command -v node >/dev/null; then echo "Node runtime unavailable" >&2; exit 1; fi
if [[ "$(node --version)" != v22.* ]]; then echo "Node 22 required" >&2; exit 1; fi
# All tested modules are first-party ESM or Node built-ins.
# Do not install the heavyweight root Firebase/browser dependency tree merely
# to run these mock-transport tests; Firebase deps are installed separately
# by the guarded release just before any production index/function changes.
node scripts/sync-functions-shared.mjs
node --check functions/src/index.js
node --check functions/src/mimo/batch.js
node --check functions/src/mimo/run-diagnostics.js
node --check js/pages/ai-studio.js
node --test functions/test/mimo-batch.test.mjs
echo "PASS: Quizer PDF queue and 429 status tests (mock provider, no new runs)."
echo "Before Firebase deployment: deploy new firestore indexes, wait for READY, then only deploy Mimo batch callables + frontend."
