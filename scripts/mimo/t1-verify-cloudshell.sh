#!/usr/bin/env bash
# T1 PNG verification — no GitHub Actions, no Mimo POST, no Firebase deploy.
# Run as "bash scripts/mimo/t1-verify-cloudshell.sh" from a clean checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null; then
  echo "STOP: Node 22 is required." >&2
  exit 2
fi
NODE_VERSION="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_VERSION" != "22" ]]; then
  echo "STOP: expected Node 22; found $(node --version)." >&2
  exit 2
fi
case "$(git remote get-url origin)" in
  *azmath25/quizer*) ;;
  *) echo "STOP: not the expected Quizer checkout." >&2; exit 2 ;;
esac

echo "Checking Quizer T1 JavaScript syntax…"
node --check js/components/mimo-png-viewer.js
node --check js/pages/ai-studio.js
node --check js/services/mimo-extraction.js
node --check functions/src/mimo/extraction.js
node --check functions/src/mimo/batch.js

echo "Running T1 mock tests (NO paid AI calls)…"
node --test \
  tests/unit/t1-mimo-png-viewer.test.mjs \
  functions/test/mimo-batch.test.mjs \
  functions/test/mimo-extraction.test.mjs

echo "Checking static module references…"
node scripts/verify-static.mjs

echo "T1_QUIZER_PNG_TESTS_PASS"
echo "Verified source only; the live Firebase callable and browser remain to be tested."
echo "No Firebase deployment, GitHub Actions, git merge, or Mimo runs were started."
