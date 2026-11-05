# Quizer QN6 checkpoint — authorized future-only activity reports

Date: 2026-11-03. Work branch: `work/quizer-audit-optimization-2026-11`.
Scope: **QN6 only after QN4 and QN5 checkpoint commits**.

## Delivered

- `functions/src/neon/activity-reports.js`: feature-disabled internal SQL report reader with administrator global activity, administrator per-user activity and teacher/admin quiz history. All require verified Firebase actor roles, and quiz ownership comes from injected, trusted Firestore lookup, NOT the incoming request.
- Keyset pagination is bounded to 100 events, signed with a server-held HMAC secret and bound to actor/scope/date/filter. Search parameters are bound, never interpolated. Data is sanitized, without answer/grade payloads.
- New-log-only cutover boundary: each successful page declares `source: neon_future_only`, `historyStartsAt` and `historicalBackfill: false`. No fabricated pre-cutover history. Date-bounded queries cannot fetch older events.
- `tests/unit/qn6-future-reports.test.mjs`: 11 synthetic tests covering default-off behavior, admin and teacher isolation, trusted quiz ownership, pre-cutover boundary, parameterization, cursor tampering/scope and configuration.
- `docs/QUIZER_QN6_FUTURE_REPORTS_AND_LOG_CLEANUP.md`: optional old-test-log cleanup procedure, **no cleanup code and no deletion**; preserves all past quizzes, immutable revisions and assets, attempts and grading data.

## Evidence

- **11/11 isolated V8 mock tests passed** after fixing promise-based admin errors. Not a native Node test run, not Firebase emulator, and not a real PostgreSQL query.
- Current frontend and current `listActivity`, `getAdminUserActivity`, and `getQuizHistory` Firebase handlers are deliberately unchanged and still read Firestore. The Neon report reader is not wired into active dispatch; a future separately approved staging cutover must establish trusted connections and preserve current behavior.
- QN4 real Postgres migration/rehearsal remains unverified due lack of a local `psql`/Postgres server; QN5 outbox relay remains disabled and unscheduled. No end-to-end or cloud CI checks have been executed.

## Stop gate

No QN7 code, benchmarking or experimental mirroring was started. No merge, deployment, cloud resource change, schema execution, production logging switch, or log deletion. Next QN7 requires a new instruction. QN12 frontend improvement and QN13 overall check remain planned.
