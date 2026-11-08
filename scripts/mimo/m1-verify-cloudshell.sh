#!/usr/bin/env bash
# M1 Quizer-native AI Studio: local/Cloud Shell verification only.
# No GitHub Actions, deployment, merge, model calls or backend writes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  echo "STOP: Node 22 required." >&2
  exit 2
fi
echo "Checking M1 sources…"
node --check js/pages/ai-studio.js
node --check js/components/mimo-png-viewer.js
node --check js/services/mimo-chat.js
node --check js/services/mimo-extraction.js
node --check tests/unit/ai-studio-m1-native.test.mjs

echo "Running UI/auth/history, TikZ and snipping regression tests…"
node --test \
  tests/unit/ai-studio-m1-native.test.mjs \
  tests/unit/ai-studio-focus.test.mjs \
  tests/unit/t1-mimo-png-viewer.test.mjs \
  tests/unit/ai-chat-markdown.test.mjs \
  tests/unit/restore-floating-snip.test.mjs

echo "Regenerating the ignored backend shared mirror from authoritative shared/ source…"
node scripts/sync-functions-shared.mjs
echo "Checking external Quizer shared references and static build…"
node scripts/verify-static.mjs
node scripts/build.mjs
test -f dist/ai.html
test -f dist/js/components/mimo-png-viewer.js
test -f dist/assets/css/ai-studio-native-m1.css
echo "M1_STATIC_TESTS_PASS"
echo "No production deployment, GitHub Actions or Mimo paid requests."
echo "Real mobile/desktop visual QA and authenticated interaction still need manual verification."
