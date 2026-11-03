# Quizer QN8 checkpoint — staged Neon problem-bank writer

Date: 2026-11-03
Branch: work/quizer-audit-optimization-2026-11
Scope: **QN8 only.** No merges, deployments, Firebase production migrations, changes to Mimo, or live student delivery changes.

## Implemented

- **functions/src/neon/write-repository.js**: disabled-by-default, server-side transactional writer for createProblem, saveProblemRevision and importProblemBatch. Uses existing problem schema, validates normalized question and protected answer content, and stores individual records in Neon only when explicitly configured later.
- Every enabled write checks the real SQL session identity/role flags. It refuses a database role that is not quizer_app, that has CREATEDB/CREATEROLE/SUPERUSER/REPLICATION/BYPASSRLS, or that belongs to neon_superuser. This addresses QN4R's observed Neon-API role privilege issue; no privileged credentials are accepted as a shortcut.
- **20-item maximum** per import transaction, with deterministic problem/revision/item IDs, per-job-item receipt hashes, PostgreSQL transaction-scoped advisory locks ordered by import key, duplicate replay reuse, collision rejection and all-or-nothing transaction boundaries.
- Firebase image and original-TeX asset IDs are accepted only after a *required trusted Firebase asset verification callback*; the whole batch is verified once using distinct asset IDs. No original TeX bytes or image bytes are stored in SQL.
- Problem edits support exact no-op saves (no insert/update), metadata-only parent updates without rewriting unchanged tags/revision rows, and new immutable question+answer revisions after real content changes. SQL writes use bound parameters and optimistic version checks.
- **functions/src/neon/action-gateway.js**: disabled-by-default staged gateway with the existing action names createProblem, saveProblemRevision and importProblemBatch; it resolves Firebase actor/role from a trusted backend callback and import-job state from an injected Firestore lookup. It rejects caller-supplied actor/owner/job information.
- No new public REST endpoint, Neon Data API, browser database client, extra cloud service or production Firebase dispatcher path.

## Tests

- **tests/unit/qn8-neon-write.test.mjs**: unit tests using transactional SQL/asset-port doubles: default-off behavior, verified restricted role refusal, duplicate-safe create, metadata-only updates, immutable revisions and version conflicts, 100-question import in five 20-item transactions, 500-question import in 25 transactions, concurrent identical replay, input limits, all-or-nothing rollback, missing asset permissions and bound SQL parameters.
- **tests/unit/qn8-action-gateway.test.mjs**: seven action-contract and Firebase identity/job boundary tests.
- CI is the work-branch-only GitHub Actions workflow at .github/workflows/quizer-verify.yml (unit/backend/static, Firebase emulator integration/transport).
- Earlier QN4R proved the schema, trigger, idempotent receipts and index/privilege behavior on *real PostgreSQL 17* using a disposable Neon child branch, and removed that branch afterward. This QN8 module has **not** been connected to a live Neon SQL client or tested end to end against an authenticated Firebase callable.

## Important limitations / QN9-QN11 dependencies

1. The writer is deliberately not installed into functions/src/router.js or dispatched by active Firebase functions. Its contract uses an injected restricted transaction port (for example a later server-only pg pool) but does not provision a LOGIN role, install server secrets, or run a production database. **No new Neon tables are present on the Quizer dev main branch**.
2. QN9 must inventory and rehearse legacy Firebase problems, quizzes, published versions, access controls, assets, attempts and results before any live cutover; never overwrite old revision IDs.
3. QN11 must integrate the gateway **outside Firestore transaction callbacks**, provide a transaction-safe cross-store import/reconciliation state machine, idempotent Firebase draft-slot commits and job progress, and wire true least-privilege PostgreSQL login credentials. Do not enable Neon for existing callables until these tests pass.
4. QN10 separately creates one private published bundle per revision and backend-only student delivery. QN8 does **not** expose answer keys, nor change student exam/grade paths.
5. Quizer Neon development project soft-grass-35754518 is isolated from Mimo and remains schema-empty after QN4R's rollback. The current feature flags remain OFF.
6. No costs/latency claims for actual QN8 SQL traffic can be made from fake transaction tests alone.

## Stop gate

QN8 repo-only staged writer and regression checks. Stop before QN9. Reassess any failing CI results before marking the milestone complete.
