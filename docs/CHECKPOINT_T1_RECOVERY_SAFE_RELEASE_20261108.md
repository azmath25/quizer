# T1 release preparation: preserve deployed PDF recovery (2026-11-08)

**Scope:** authenticated retrieval of an existing compiled Mimo PNG from the teacher's Quizer document job. No new source upload, model run, review/edit/import rewrite, image auto-association, main merge, GitHub Actions, Firebase Hosting/site configuration changes, secrets or data migrations.

## Why this release branch exists

The original `fix/t1-authenticated-tikz-png-20261108` branched from `main`, which does **not** include the more recent, successfully deployed PDF checkpoint recovery. Deploying the old T1 branch's backend unchanged would regress production. This branch was created from `fix/pdf-completed-checkpoint-recovery-20261108`, then ported only T1 PNG changes. It still contains `functions/src/mimo/completed-page.js` and all related recovery tests.

## T1 isolated changes

- `functions/src/mimo/batch.js`: existing teacher/owner-checked `mimoBatchImage` GET response now includes byte length and SHA-256; retains all recovery logic.
- `functions/src/mimo/extraction.js`: binary download must be `image/png`, not a successful JSON error response.
- `js/services/mimo-extraction.js`: messages for missing/malformed/unavailable PNGs.
- `js/components/mimo-png-viewer.js`: reusable authenticated preview/download/retry component.
- `js/pages/ai-studio.js`: completed PDF page displays the viewer independently of question approval forms; overview has an opt-in viewer; existing recovery warning remains intact.
- `ai.html`: T1 script cache-busting reference.
- `tests/unit/t1-mimo-png-viewer.test.mjs` and additive `functions/test/mimo-batch.test.mjs` coverage; old checkpoint tests retained.
- `scripts/mimo/t1-controlled-release-cloudshell.py`: one-off, fail-closed single-function backend release.
- `scripts/mimo/t1-browser-smoke-console.js`: signed-in production browser smoke test; only owner-scoped Quizer list/status/image GETs, never paid provider operations.

## Existing verified artifact (NO new run needed)

Mimo run `7e8f42c3-514c-407c-b93a-4f85fe54bd71` (page 2), workflow `c_mw5e6wmr_wma1bg` version 1:
- Diagram gate chose yes; TikZ compiled successfully.
- PNG: 13,527 bytes; 160 DPI.
- SHA-256: `47c01a3158bdf1a84bb8b687f2cb8046bc9651f781193d6c060c2e346f5901f4`.
- The owner downloaded the private object in Cloud Shell. **No actual Quizer browser download has yet been confirmed.**

## Source test evidence / limitations

- User-reported pass for original T1 test branch: `T1_QUIZER_PNG_TESTS_PASS` (unit + backend mock tests, static refs).
- The separately reconciled **release branch** passed source-level JavaScript parsing for all eight changed/tested JavaScript files, including the console smoke snippet.
- Full Node 22 suite on the **release branch** remains unverified until running the release script. Do not reuse the old branch's test results as proof this branch passes.
- **No Firebase production deployment has been executed by ChatGPT**: its GitHub/Neon connectors cannot operate the user's authenticated Cloud Shell.
- **No GitHub Actions**: Quizer's existing GitHub Pages site is published via `actions/deploy-pages` from `main`. Under the explicit constraints of no Actions and no merge to main, this release does not republish the actual website or change GitHub Pages settings. The browser smoke script temporarily inserts the result into the already signed-in Quizer page to verify live Firebase-to-browser PNG retrieval. Persistent frontend publication requires a separate authorized publishing mechanism/decision.

## Controlled Firebase deploy, approved T1-only boundary

From the existing Quizer Cloud Shell checkout:
```bash
cd ~/quizer-queue-release
export PATH="$HOME/.local/node-v22.23.4/bin:$PATH"
git fetch origin fix/pdf-completed-checkpoint-recovery-20261108 release/t1-png-recovery-safe-20261108
git switch --detach origin/release/t1-png-recovery-safe-20261108
python3 scripts/mimo/t1-controlled-release-cloudshell.py --apply
```

The script rejects a nonmatching origin/HEAD, mismatched GCP project, older Node, dirty tracked tree, missing prior recovery code and wrong source branch. It runs mock tests, static checks, builds `dist`, and deploys **only** `functions:mathquiz:mimoBatchImage` to `sat-quiz-fd317`. No Mimo POST or background job is triggered.

Only if Cloud Shell prints `T1_FIREBASE_IMAGE_DEPLOY_PASS` is that single callable deployment known to have succeeded. If it fails, stop. Do not deploy unrelated callables.

## Live signed-in browser acceptance

Open `https://azmath25.github.io/quizer/ai.html` as the original document's teacher. Paste the content of `scripts/mimo/t1-browser-smoke-console.js` from this branch into the browser's developer console; it identifies the existing run in the teacher's recent owned jobs, calls the authenticated `mimoBatchImage` callable, validates the downloaded 13,527-byte image and expected SHA-256, displays it in the page, and exposes a download link. A successful `T1_BROWSER_PNG_PASS` output proves browser retrieval. This is a read-only temporary smoke UI; it does **not** prove persistent frontend publishing, automatic figure attachment or visual geometric accuracy.

Stop after T1 browser evidence and checkpoint. T2 remains separate.
