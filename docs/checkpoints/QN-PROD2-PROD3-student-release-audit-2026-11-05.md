# QN-PROD.2/3 — Student workflow and release-boundary audit
Date: 2026-11-05
Repository: azmath25/quizer
Branch: work/quizer-audit-optimization-2026-11

## Executed and verified
- Read actual v2 frontend callable transport, quiz runner submission path, legacy attempt transaction, hybrid entrypoint, private integration request validator, worker provenance router, results parser, and GitHub Actions workflow.
- Added `tests/unit/qn-prod2-submit-boundary.test.mjs`: confirms the hybrid-enabled entrypoint leaves `submitAttempt` on legacy Firestore dispatcher; repeated identical submission request routes consistently and does not initialize Neon; `getAttemptResult`, `getAttemptQuestions`, `saveAnswers`, and `navigateAttempt` remain hybrid.
- Existing `tests/integration/core.test.mjs` verifies duplicate legacy submit returns same grading job. Existing `tests/unit/qn11-5-private-integration.test.mjs` includes the read-only `requestId` regression. Existing `tests/unit/prod1-live-factory.test.mjs` and result-page parsing tests cover ISO and Firestore timestamp objects.
- GitHub Actions run: https://github.com/azmath25/quizer/actions/runs/41908803810. The unit/backend/static job passed on the new test commit; emulator and Chromium jobs were still in progress at the time of writing. Check their final GitHub results before accepting a green checkpoint.
- Earlier complete green run: https://github.com/azmath25/quizer/actions/runs/41907236162.

## Distinct boundaries and release risks
- `submitAttempt` does not appear in `PROD1_ROUTED_ACTIONS`: the legacy atomic freeze creates a grading job; the worker detects private-bundle revision provenance and routes private grading accordingly.
- The frontend retains an idempotency key across transport retries and saves answers before submission. A failed results render after submission does not itself imply that submission was rolled back.
- Hybrid `saveAnswers` validates protected answer material before the commit layer looks up its idempotency receipt; a replay after state freeze deserves an explicit emulator regression to establish its behavior under timeouts. Do not promise replay safety for all temporal orderings solely from existing unit tests.
- `.github/workflows/quizer-github-pages.yml` automatically publishes from this work branch for HTML/JS/static dependency changes. No such files were changed in this audit. Do not edit these paths without a separate publication gate.
- No live Firebase, Neon, Storage, billing, or deployment service was accessed by this audit. No production smoke run was performed. Source-level CI success is not sufficient to authorize deployment.

## QN-PROD.3 assessment
Release state: HOLD.
To authorize release, independently check current serving GitHub Pages and Cloud Functions revision/image, cloud secrets/IAM, real account sign-in domain, end-to-end cross-service synthetic student flow in staging, and rollback. These cloud checks cannot be inferred from GitHub Actions alone. User approval required before merging or deploying.
