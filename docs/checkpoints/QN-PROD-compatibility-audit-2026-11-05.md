# QN-PROD — compatibility audit checkpoint (2026-11-05)

Scope: source inspection only, on `work/quizer-audit-optimization-2026-11`. No production changes, merges, deployments, or database modifications.

## Verified by source inspection
- `js/services/api.js` sends `{apiVersion:2, action, requestId, ...data}` to the Firebase callable API. The legacy `functions/src/domain/runtime.js` accepts `requestId` in the allowed envelope.
- The configured hybrid entrypoint routes student attempt actions through `functions/src/prod1/live-factory.js` to `private-runtime.js`. The exact downstream request-field validators must be checked separately for each routed action; acceptance by legacy dispatch does not establish hybrid acceptance.
- `prod1CallableResponse` invokes `wire` to convert Firestore timestamp objects to ISO timestamps; `js/core/date-time.js` handles ISO and timestamp-object representations and rejects invalid dates.
- `js/pages/results.js` uses `minutesBetweenDates` for elapsed time and `date` for display. A new regression test covers valid, invalid, and missing date values.
- Frontend submission retry safety depends on mutation idempotency and the precise hybrid transport contract. Do not assume that an error following submission means no attempt was saved.

## Added tests
- `tests/unit/date-time-compat.test.mjs` checks ISO strings, Unix milliseconds, Firestore object shapes, malformed values, and elapsed-minute behavior.

## Not verified / release blockers
1. Full callable envelope and idempotency support (`requestId`) across hybrid student routes using the production-configured adapter.
2. A representative student end-to-end emulator test: start, save, reload, flag, submit once, open results, poll grading, view student history.
3. Duplicate submit / timeout / transient failure replay safety for hybrid routes.
4. Authorization and response compatibility for `getAttemptResult` versus `getAdminAttempt`.
5. Actual Node test suite, emulator integration tests, browser smoke tests, and CI status: they were not executed in this session; CI statuses were not available from the connector for the added test commit.
6. No production verification was performed.

## Next safe gate
Run unit and emulator suites against this work branch in a disposable environment, inspect hybrid action validators and adapt mismatches, then complete student browser E2E regression. Only recommend a deployment after an independently reviewed green checkpoint, a documented rollback path, and explicit authorization.

## Self-service follow-up verification
- GitHub Actions run 41907236162 (commit be3ea69) **succeeded**: unit/backend/static, Firebase emulator integration + callable transport, and Chromium mobile runner + author QA all passed. https://github.com/azmath25/quizer/actions/runs/41907236162
- Source inspection of `functions/src/bundles/private-integration.js` confirms callable envelope includes `requestId` for every action, including reads. Legacy dispatcher also accepts it. No reproducible `requestId` rejection is established in the inspected work branch.
- `tests/unit/prod1-live-factory.test.mjs` checks Firestore timestamp ISO conversion and `tests/unit/prod1-datetime-regression.test.mjs` checks invalid timestamp tolerance. Additional `date-time-compat.test.mjs` was included in green CI.
- **Remaining distinction:** the full configured production hybrid path has not been exercised against actual serving revisions. A green synthetic/emulator suite must not be described as a production smoke test. No release recommendation yet.
