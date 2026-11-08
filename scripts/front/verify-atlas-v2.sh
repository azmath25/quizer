#!/usr/bin/env bash
# Atlas v2 frontend verification. No deployment, model calls or GitHub Actions.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  echo "STOP: Node.js 22 required." >&2
  exit 2
fi
echo "Verifying Quizer Atlas v2 JS syntax…"
node --check js/components/shell.js
node --check js/pages/home.js
node --check js/pages/ai-studio.js
node --check tests/unit/atlas-v2-frontend.test.mjs

echo "Running frontend, security and T1 regression checks…"
node --test \
  tests/unit/atlas-v2-frontend.test.mjs \
  tests/unit/ai-studio-m1-native.test.mjs \
  tests/unit/ai-studio-focus.test.mjs \
  tests/unit/ai-chat-markdown.test.mjs \
  tests/unit/restore-floating-snip.test.mjs \
  tests/unit/t1-mimo-png-viewer.test.mjs

echo "Regenerating the local, ignored backend mirror for static validation…"
node scripts/sync-functions-shared.mjs
node scripts/verify-static.mjs
node scripts/build.mjs

for path in index.html ai.html quiz.html problems.html upload.html \
  assets/css/atlas-v2.css assets/css/ai-studio-atlas-v2.css \
  js/pages/home.js js/pages/ai-studio.js; do
  test -f "dist/$path" || { echo "Missing public asset: $path" >&2; exit 3; }
done
for path in functions firebase tests docs node_modules; do
  test ! -e "dist/$path" || { echo "Private/unwanted dist path: $path" >&2; exit 3; }
done
echo "ATLAS_V2_FRONTEND_PASS"
echo "Frontend only. Production was not modified by this verification."
