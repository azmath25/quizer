# Quizer STG2.1 — staging backend integration bridge checkpoint

Date: 2026-11-04 (Asia/Baku)
Scope: `azmath25/quizer`, branch `work/quizer-audit-optimization-2026-11`.
**Status: code-level staging composition created; real cloud integration not deployed.**

## What changed

- `functions/src/bundles/stg2-callable-bridge.js`: opt-in server-only Firebase callable/API v2 envelope bridge with authenticated request checks, verified staging project identity, normalized output, exact worker authorization and no catch-and-replay fallback when Neon fails. Disabled by default.
- `functions/src/bundles/stg2-staging-composition.js`: connects the **existing** `createQuizerStagedFullRuntime` (Neon bank, import, private bundle, grades and export) behind the bridge. Does not create a second backend or migrate historical data.
- `tests/unit/stg2-1-callable-bridge.test.mjs` and `tests/unit/stg2-1-staging-composition.test.mjs`: check safe default, authority partition, project isolation, wrapper compatibility, worker invocation gate, actual composed full factory and Neon outage without legacy replay.

## Explicitly not active

No import/registration in `functions/src/index.js`, `router.js`, `jobs/worker.js`. No Firebase Function route is deployed, no secrets/SQL credentials are available, no runtime server provider adapters are injected, and no stage Auth/Storage/Neon end-to-end execution was performed. Source CI is a necessary but insufficient condition for runtime activation. Historical data remains untouched. Existing production `sat-quiz-fd317`, protected `main`/`main-backup`, Mimo and AI branches were not modified.

## Clean-start policy

The user has allowed loss/omission of historical data **as a planning priority**, not authorized deletion of current production resources. Synthetic staging setup does not need to import old quizzes/grades. A future production cutover still needs an explicit destructive change decision.

## Acceptance gates

STG2.1 is complete at **default-OFF code-assembly level** when unit, backend, emulator and Chromium tests are green. To deploy later, STG2.2 must provide a dedicated stage runtime service account, proven restricted `quizer_app` login and TLS endpoint, non-public staging Storage/Functions secret handling, verified stage-only Firebase rules/App Check and billing/cost controls. The trusted Firebase origin, storage access, actor/asset grants, and Neon read/write provider adapters remain runtime integration work requiring real staging verification.

No merges, deployments, billing activation, data changes or schema migrations were performed.
