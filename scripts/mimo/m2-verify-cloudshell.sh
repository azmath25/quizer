#!/usr/bin/env bash
# M2 pure local LaTeX conversion acceptance. No deployment or paid provider.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  echo "STOP: Node 22 required." >&2
  exit 2
fi
echo "Checking M2 Quizer LaTeX converter and UI syntax…"
node --check shared/mimo-quizer-latex.js
node --check functions/shared/mimo-quizer-latex.js
node --check js/pages/ai-studio.js
node --check tests/unit/mimo-quizer-latex-m2.test.mjs

echo "Checking M2 + existing chat, math, PDF and TikZ tests…"
node --test \
  tests/unit/mimo-quizer-latex-m2.test.mjs \
  tests/unit/ai-studio-m1-native.test.mjs \
  tests/unit/ai-studio-focus.test.mjs \
  tests/unit/t1-mimo-png-viewer.test.mjs \
  tests/unit/ai-chat-markdown.test.mjs \
  tests/unit/restore-floating-snip.test.mjs \
  functions/test/mimo-batch.test.mjs

echo "Checking static routing, full shared backend mirror and site build…"
node scripts/verify-static.mjs
node scripts/build.mjs
cmp shared/mimo-quizer-latex.js functions/shared/mimo-quizer-latex.js
test -f dist/ai.html
test -f dist/shared/mimo-quizer-latex.js
test -f dist/assets/css/ai-studio-latex-m2.css
test -f dist/js/pages/ai-studio.js
grep -q 'm2-latex-20261108' dist/ai.html
echo "M2_STATIC_TESTS_PASS"
echo "No GitHub Actions, production deploy, new Mimo runs, writes, or import occurred."
echo "Interactive manual source/answer/figure check is next, not M1 design QA."
