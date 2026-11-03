# Quizer QN3 checkpoint — database schema and trusted repository contract

Date: 2026-11-03
Work branch: work/quizer-audit-optimization-2026-11
Scope: **QN3 only.** No live DB, Neon provisioning, migration, merge, deployment, or frontend change.
Next phase QN4 remains approval-gated.

## Committed deliverables

1. **db/quizer/001_initial_schema.sql** — standalone Quizer PostgreSQL schema (six tables, eight indexes, foreign keys, revision immutability trigger, import/event deduplication, optional archive table). This file has **not** been applied to any database.
2. **db/quizer/001_rollback_DISPOSABLE_ONLY.sql** — destructive test-only schema removal. **Never run against Mimo, live Firebase, or any non-disposable database**.
3. **functions/src/neon/contracts.js** and **functions/src/neon/ports.d.ts** — Firebase-trusted actor contract, validated ID/hash/paging utilities, DTO shapes, source-asset redaction. Types and functions are only imported by the new adapter/tests.
4. **functions/src/neon/repository.js** — injected, read-only SQL query adapter: protected owner/shared-teacher/admin reads, parameterized search and tag filters, indexed literal title-prefix LIKE, stable internal keyset paging. **No connection, credentials, SQL execution on import, or active Firebase action wiring**.
5. **tests/fixtures/neon/qn3-synthetic-problem.json** — synthetic rows for one teacher-owned/shared revision, content/answer, import receipt and future activity log.
6. **tests/unit/qn3-neon-contracts.test.mjs** — 15 committed tests for input validation, teacher/admin/student access, shared-source redaction, query parameter safety, pagination, fixture invariants and SQL structural checks.
7. **docs/QUIZER_NEON_SCHEMA_CONTRACT_QN3.md** — authority boundaries and future import/publish/log cutover contracts.

## Verification evidence

- **15 / 15 tests passed** in a standalone V8 test run which fetched the exact committed JavaScript and test bodies from GitHub and supplied minimal Node assert/fs/URL shims, plus a mock database query port. Tests passed after the literal-prefix search change and revision-immutability trigger addition. **Not a native Node test runner or real PostgreSQL/emulator test.**
- Re-fetched the version-controlled source/fixture/migration and verified their current GitHub blob SHAs.
- No network SQL query or database API connection was initiated. No Neon project (including Mimo) or Firebase data was changed.
- **Not run:** npm test, npm run test:backend, npm run test:integration, npm run verify:static, browser QA, PostgreSQL schema apply/rollback, SQL permission/trigger tests, and CI. Native Node/backend test dependencies and PostgreSQL are unavailable in the isolated working environment; actual schema execution belongs to separately approved QN4.
- **No timing/cost claims:** Read-query performance, PostgreSQL index plans, connection startup and dollar cost were not measured.

## Design and safety observations

- One source TeX file and image assets stay in Firebase Storage; only parsed per-problem content/revisions are intended for Neon.
- The existing Firebase actions remain unchanged and are the future authentication boundary; browser SQL and a standalone problem-bank API are both intentionally absent.
- The read adapter requires injected server-origin identity and parameters; QN8 will integrate full writes behind existing operations, transaction limits, source/asset permissions and feature flags.
- Historical Firestore quizzes, revisions and attempts remain untouched and must continue to work. Future published-quiz bundles are **QN10**, not QN3.
- SQL schema includes deferred same-problem latest-revision FK and BEFORE UPDATE/DELETE revision trigger. Both must be validated with *actual* PostgreSQL in QN4.
- The future audit table accepts new events only: event ID is the delivery receipt. Old test logs are not migrated or deleted.
- Optional published quiz archive stays disabled pending QN7 benchmark; it cannot affect student availability.
- The runtime role guard is an extra check; the integration code must pass the Firebase-verified Context.actor, **not any user-provided actor object**.
- Default future application permissions are not yet provisioned; QN4 must exercise least-privilege roles before QN8 integration.

## Stop gate and next approval

**QN3 repository design is complete and isolated test checks pass.** The schema has **not** been executed, and full PostgreSQL behavior remains unverified. Stop before QN4.

QN4, if specifically approved, should use a clearly disposable Quizer PostgreSQL instance only; exercise actual DDL up/down, deferred FK, immutable revision trigger, owner/visibility indexes, keyset paging, idempotent receipts, credentials and safe rollback. Never test by modifying Mimo or production.

No merges, deployments, live resource writes, deletion of old logs or real data migrations occurred.
