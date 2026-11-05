# Quizer — midpoint implementation audit (QN1–QN6)
Date: 2026-11-03
Branch: `work/quizer-audit-optimization-2026-11`
Scope: code, tests, interfaces, security/data ownership, legacy preservation and release gates.
This is an implementation audit, **not** an authorization to deploy or modify live Firebase/Neon.

## Executive conclusion

**Continue development, but do not release or migrate.** The target architecture remains sound:
- Firebase Storage: exactly one original source TeX object per imported quiz, image assets, and **one private bundle per published revision**.
- Firebase Auth/Firestore: roles, draft and access metadata, attempts, answers and grades. Rename and settings edits do not reimport problems.
- **Dedicated Quizer Neon project** (not Mimo): individual problems, answer-bearing immutable revisions, tags and new activity events.
- Existing authenticated Firebase operations remain the client interface; no browser SQL and no extra public problem-bank API.
- Existing Firestore quizzes, published versions and active attempts must stay valid throughout migration.

## Verified findings and remediation

| Severity | Finding | Status / gate |
| --- | --- | --- |
| **P0 / repaired** | QN3's original `db/quizer/001_initial_schema.sql` used a single `$` instead of PostgreSQL `$$` around the PL/pgSQL trigger body, which is invalid migration SQL. Previous structure-only tests missed it. | **Fixed** on work branch; added explicit delimiter assertions to QN3 and QN4 tests. SQL still needs a *real* Postgres execution. |
| **P1 / repaired for source** | The work branch originally had no `.github/workflows`, hence historical commits had no repository CI workflow/status. | Added a **test-only** two-job GitHub Actions workflow: Node 22 unit/backend/static, and Firebase auth/Firestore/Storage emulator+transport. Work-branch push only, read-only GitHub permission, no deploy commands, path-filtered to avoid doc-only CI cost. Confirm final complete job results before claiming green. |
| **P1 / open** | QN4 migration, constraints, trigger behavior, transaction retry, role grants, index plans and rollback have **never run against a real disposable PostgreSQL instance**. | Blocker before enabling Neon or release. An isolated Quizer dev project or approved disposable Postgres is required; **never Mimo**. |
| **P1 / open** | No dedicated Quizer Neon project exists. The only connected Neon project in the read-only inventory is `mimo`. | Require distinct project plus least-privilege `quizer_app` / read-only role. Project provisioning can incur costs and must be separately approved. |
| **P2 / repaired** | QN1 editor's partially successful multi-batch draft save compared retries against stale `data.items`: reproducible case, 40 changed slots, first 20 saved, retry would resend all 40 and needlessly rewrite 20. | Added `rememberSavedQuizSlots` after acknowledged batches, advanced metadata/order/version baseline after successful final save, and added 500-slot/new-server-ID regression tests. |
| **P2 / open** | Project configuration rejects a declared Mimo project ID and checks URL format but cannot cryptographically prove the URL belongs to the declared Neon project. | At provisioning, compare connection endpoint/project IDs against Neon API, use unique Quizer-only DB and role, never expose credentials to browser. |
| **P2 / intentional** | QN5 future activity relay and QN6 reporting are **disabled, not scheduled/wired**, not yet integration-tested against Firebase and Neon. | Keep off until a trusted worker and verified owner resolver, bounded retries, backlog monitoring, role enforcement and failure-mode tests exist. No old audit log backfill. |
| **P2 / open** | The current frontend import still sends one sequential `importProblemBatch` per problem even though backend accepts up to 20. | QN11 should send bounded batches with checkpoints; 100 questions target about five calls subject to actual transaction/payload limits. |
| **P2 / open** | QN10 private published quiz bundles and secure student delivery are still *design only*. | Never grant client full-bundle read, download URL or protected keys. Verify question-frontier, no-backtrack, release policy, concurrency, latency and legacy attempts before cutover. |

## Test evidence and limitations

- Local **native Node 22** runs of existing QN1 and QN2 pure helper suites succeeded: 9/9 each, with one QN1 source-inspection case skipped in the partial local checkout.
- QN3 (15), QN5 (8), QN6 (11) contract suites previously passed in V8 mock runners; these are not substitutes for integration tests.
- QN4 guard previously passed 7 local-target cases and 6 structural checks; actual DDL, FK and revision trigger SQL have **not** been executed in PostgreSQL.
- **GitHub Actions full two-job run passed** at commit `0efd21e0eef1e4cfdf7fe5c6bbbf933535521203`: `https://github.com/azmath25/quizer/actions/runs/41596426366`. Job `Unit + backend + static`: unit regression, backend regression and static frontend checks **success**. Job `Firebase emulator regressions`: emulator integration and transport checks **success**. Subsequent audit/documentation commits do not affect the code under test (workflow ignores documentation-only changes). These checks do **not** validate actual PostgreSQL, a live Neon connection or browser QA.
- No mobile browser performance, private bundle student-security, 100/500-question bulk imports, Neon budget or cloud latency measurement yet.

## Recommended work order

1. **QN6.5 — audit stabilization (this checkpoint):** fix reproducible source defects, install two CI checks and document all open blockers. Verify current branch's completed checks, not just statuses.
2. **QN4R — real disposable PostgreSQL verification:** once a **distinct Quizer development project** is explicitly approved, apply/rehearse versioned SQL and rollback only against a new disposable target. Test ownership/immutability/indexes and least-privilege roles. Do not touch Mimo.
3. **QN7 optional mirror: DEFER BY DEFAULT.** The user's design requires one original TeX and one private published bundle per revision, not another published-quiz copy. Avoid implementing archive copies unless measured durability/cost arguments justify them. This is a decision, not implementation permission.
4. **QN8 — Neon bank adapter/write path:** add feature-disabled server-side transactions and bounded idempotent imports behind existing Firebase actions. Preserve old Firebase problem paths and old quizzes.
5. **QN9–QN10 — migration rehearsal and secure published bundles:** protect historical links and pinned attempts; no student runtime dependency on Neon.
6. **QN11–QN12 — frontend import/editor integration and full mobile UX audit:** batch 20-problem imports, resume after failure, accessible progress and clear loading/error states.
7. **QN13 — comprehensive system gate:** native tests, Firebase emulator, disposable SQL, mobile browser tests, preserved quiz manifests, attempt/grading security, 10/100/500 loads and cost/outage/rollback evidence.

## Mandatory controls

Stay on `work/quizer-audit-optimization-2026-11`. No merge, production migration, deployment, live database change, old-quiz/attempt/image deletion or historical log cleanup. A disposable development database can only be created and used following explicit permission for that new resource. Mimo is never a Quizer test database.
