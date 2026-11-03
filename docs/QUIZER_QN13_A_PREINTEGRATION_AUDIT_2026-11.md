# Quizer QN13-A — interim preintegration system audit

Date: 2026-11-03
Branch: `work/quizer-audit-optimization-2026-11`
Reviewed HEAD before audit: `7db6d8adc4efb4111a47eb2e29031dead16cb1b5`
Main baseline (unchanged): `e5ceb11f110ab85a04033ffe9638fd1a23d85c40`

## Decision

**PASS the QN13-A read-only audit checkpoint; CONDITIONAL GO for the next *development-only* QN11.1 design slice. NO GO for any integrated cutover, production migration, deployment, or merge.**

This is a source/CI-evidence audit, not a live capacity test, actual historical inventory, or authorization to switch the source of truth. No PostgreSQL or Firebase production connection was opened and no new test suites were executed for this documentation-only checkpoint.

## Verified baseline and evidence

1. QN4R already verified schema, constraints, immutability, SQL privileges and rollback on an isolated disposable Neon child branch, then removed the child. The Quizer dev default database was left schema-empty. This fact comes from the historical QN4R checkpoint; **no fresh Neon account access was made during QN13-A**.
2. QN8 staged a default-off restricted PostgreSQL problem-bank writer, import receipts, asset verification and an existing-action gateway. Its registered active Firebase actions remain **Firestore-backed**.
3. QN9 rehearsed sanitized historical revisions, pinned attempts, results, Firebase emulator parity and a disposable database scenario. **Real production inventory, original Storage object existence and backup/restore are not verified.**
4. QN10.1–10.3 staged and tested private generation-pinned publication bundles, publication activation, authorized question slices, grading and old-revision fallback. These modules are disabled and are **not** imported into live handlers/worker.
5. QN12.1 and QN12.2 are source-complete and test-only CI green. Final QN12.2 run [41685852261](https://github.com/azmath25/quizer/actions/runs/41685852261) (commit `9ab4284f8d68e8fc685420a8340bd0803b67d802`): **3/3 jobs passed**, including **245/245 Node unit**, **5/5 backend unit**, static, Firebase emulator integration/transport and real headless Chromium QN12.1+12.2. Author browser QA passed at 320, 390, 430, 768, 844 landscape-touch and 1024px plus 390px simulated 200% root text size.
6. The isolated AI snip experiment is separately green ([run 41688203440](https://github.com/azmath25/quizer/actions/runs/41688203440)), but it remains on **`feat/ai-browser-snip-ask`**, unmerged, with placeholder AI inference. It is **not part of QN11's integration dependency**.

### Explicit code entry points inspected

- `functions/src/domain/runtime.js`: `dispatch()` executes action handlers inside a Firestore `db.runTransaction` callback. Existing mutation receipts are Firestore-scoped; external SQL/Storage must not be called inside this callback or retried implicitly.
- `functions/src/index.js` and `functions/src/router.js`: active callable and worker dispatch are unchanged and do not mount QN8/10 staged services.
- `functions/src/api/problems.js`: `listProblems`, `getProblem`, `createProblem`, `saveProblemRevision`, `forkProblem`, sharing, trash/restore, bulk update and revision-history reads still use Firestore.
- `functions/src/api/quizzes.js`: `getQuizDraftItems`, `snapshotSource`, `sourceContent`, `publishQuiz`, `duplicateQuiz`, `importProblemBatch`, `finishImportJob` still assume Firestore problem paths and/or existing Firestore import progress/mappings.
- `functions/src/api/attempts.js`: active `startAttempt` loads every selected frozen question from Firestore; `getAttemptQuestions` reads Firestore snapshots. `functions/src/jobs/worker.js` grades via protected Firestore grading docs.
- `functions/src/api/assets.js`: problem/quiz-draft/attempt/result image authorization resolves Firestore content, including full draft/order scans.
- `functions/src/neon/{action-gateway,write-repository,repository,project-config}.js`, `functions/src/bundles/{firestore-publication-store,firestore-attempt-service,secure-attempt-service}.js`: independent default-off staged adapters reviewed, not active cutover paths.
- `js/pages/quiz-editor.js`: source upload, import, preview, partial draft save and resume behavior; `js/pages/problems.js`: problem-bank workflows.

## Findings / release risk register

| ID | Severity for cutover | Evidence and actual gap | Required gate |
| --- | --- | --- | --- |
| A1 | **P0 release blocker** | Firestore `dispatch()` runs action handlers within `runTransaction`, while the QN8 gateway and QN10 Storage writers require external I/O. A naive inline Neon adapter would perform duplicate/non-atomic side effects on transaction retry. | Introduce a narrow preflight/orchestrate/commit protocol **outside** Firestore transaction callbacks; recheck auth, owner, versions and leases **inside** final Firestore transaction. Define retry/compensate/reconcile state machine and fault injection. |
| A2 | **P0 release blocker** | Active problem read and mutation operations remain Firestore-backed, whereas the proposed new problem source of truth is Neon. QN8 gateway covers only three actions: create, save revision, import batch. | Compatibility plan and tests for list/get/revision history/fork/sharing/trash/restore/bulk update, draft slot lookups, ownership, metadata-only edits and old-vs-new reference routing. Preserve all public action names and response shapes. |
| A3 | **P0 release blocker** | The live publish/job/attempt/result/asset paths still expect Firestore `/items` and `/grading` documents. Private-bundle code is staged but not installed. | Only after source/bundle integration, rewire pinned attempt start/navigation/answer-save transaction checks/grading/results/image authorization and exports; prove old Firestore quiz and in-progress attempt preservation, release boundaries and Neon-down student availability. |
| A4 | **P1 QN11 requirement** | `js/pages/quiz-editor.js` currently uses one `importProblemBatch` API call for each question, although the backend and QN8 writer accept 1–20. `importState = null` is page-local and `done` increments only in memory. | Implement bounded payload-aware 1–20 batches, persist/reconstruct a durable resume checkpoint, reconcile SQL receipts vs Firebase mappings/progress, handle acknowledgement loss and page reload without duplicating assets or making incomplete quizzes visible. |
| A5 | **P1 QN11 requirement** | Persisted Firebase import source is `job.input.sourceAssetId`, whereas QN8 writer consumes `job.sourceAssetId` in its trusted input. QN8 responds with `processedInBatch`/`newlyInserted`, while active Firestore handler uses `processed` and mapping documents. | Make an explicit trusted versioned adapter, not raw job forwarding; validate shape/result parity and exact source-asset provenance under retry. |
| A6 | **P1 QN11 requirement** | Neon read adapter currently lists with `next`, supports search/tag, but active `listProblems` clients expect `nextCursor` and support subject/difficulty filtering. SQL read adapter is not yet a comprehensive bank API. | Implement response/pagination/filter parity; verify stable opaque scoped cursors, teacher-sharing authorization, tag handling and no grading leak to unauthorized roles. |
| A7 | **P1 cutover blocker** | Disposable PostgreSQL schema/privilege rehearsal is real, but live QN8 SQL connection, SQL-created least-privileged LOGIN, trusted project identity check and Firebase-to-Neon authenticated end-to-end import were not performed. | Rehearse restricted server-only connection on **Quizer disposable branch only** with explicit owner approval for any billable provisioning, test reconnect/pool and failure, confirm SQL session privileges; never use Mimo or give browser database credentials. |
| A8 | **P1 cutover blocker** | QN9 tested complete synthetic history, not production Firebase counts, older saved links, real Storage objects, signed backups or restore. Existing published quiz IDs/revisions/attempts cannot be assumed disposable. | Separately authorized read-only paginated inventory and backup/restore validation, then signed counts/hash reconciliation before any active cutover; no deletion, backfill or migration here. |
| A9 | **P1 release performance gate** | Published private bundle is decoded in full on an uncached read (limit 24 MiB); eight concurrent synthetic 500-item reads processed eight whole buffers. No real warm/cold Storage latency, concurrency/cost or 100/500-question import request measurements yet. | Compare 10/100/500 bundles and 1/8+/concurrent students with old Firestore approach; record bytes, memory, cold starts, reads, connection usage, bills and outage. Revise private representation/caching if unacceptable, without exposing whole bundle. |
| A10 | **P2 provenance/UX** | Original upload path constructs a new `File([input.value], sourceFile?.name...)` from current editor text, not necessarily the originally selected .tex bytes. For pasted JSON/backup it can upload a non-.tex representation as a source. | Explicitly distinguish original binary source from edited/pasted/AI-derived source; upload once, record checksum/format/provenance and ensure retries don't upload duplicates. Preserve image/solution asset bindings. |
| A11 | **P2 rollout check** | Chromium viewport/touch simulations are green, including enlarged root text, but real mobile Safari, Android Chrome, physical keyboard/safe-area, VoiceOver/TalkBack and long MathJax/image stress are unverified. | QN12-B regression after integration plus physical device checks before production release. |
| A12 | **P2 documentation drift** | Historical roadmap still lists QN12.2 pending and bundles the whole QN13 under one milestone, despite explicit QN13-A/QN13-B sequencing. | Update the roadmap checkpoint status and distinguish QN13-A now from QN13-B only after QN11/QN12-B, without implying release approval. |

## QN11 entry contract — suggested small, approval-gated slices (not started)

- **QN11.1: orchestration/contract design only.** Map old/new API envelopes/DTOs/handlers and Firestore transactional boundaries; define frozen legacy vs Neon references, receipt/coordinator states and failure matrix. No adapter enablement.
- **QN11.2: trusted connection + compatibility plumbing.** Strictly separate Quizer SQL credentials, verified least-privilege role and default-off read/write ports; synthetic/approved disposable tests, no live migrations or dispatcher flip.
- **QN11.3: resumable 1–20 batch importer.** Page/reload recovery, stable item keys, SQL receipts, Firebase checkpoint CAS, original source/image one-time upload and visibility gate; 10/100/500 fixture and interrupted-network tests.
- **QN11.4: complete bank/draft routing.** All existing teacher problem-bank actions and affected draft/preview/copy reads; legacy fallback, scoped list filters, editing no-ops, ownership/asset permissions, version and concurrency parity.
- **QN11.5: staged publisher and student path.** Private bundle generation, manifest activation, pinned attempt start/questions/saving/grading/results/image links and backup/export; old results and quizzes untouched; feature flag default OFF.
- **QN11.6: resilience/integration acceptance.** Multi-store reconciliation, missed ack and idempotent replay, Neon unavailable, Storage unavailable, collision/lease races, 10/100/500 behavior, security/latency/billing probes, rollback rehearsal. No production cutover until separate permission.

Each sub-slice must have isolated tests, both standard CI suites (plus relevant Chromium QA), checkpoint and an explicit stop. None is authorized by this QN13-A audit alone.

## Acceptance gates before QN12-B and QN13-B

1. Test end-to-end `.tex`/images -> import/resume -> bank edit -> private draft -> bundle publish/republish -> access/approval -> student attempt (including no-back and shuffling) -> save/retry -> grading -> release/results -> teacher report and export, at 10/100/500 problems.
2. Deny unauthorized actors, stale revisions, protected answers, solutions, private bundle URL/data exposure, cross-user assets, stale grading leases and old answer-key leakage. Test deadlines, concurrent edits, duplicate requests and Firestore transaction retries.
3. Prove `Neon down` does not break an existing student exam/grades; prove Storage failure does not activate a corrupt revision; preserve old published revision and active attempt through every failure, with bounded reconciliation.
4. Verify production-like reads/costs (Storage 24 MiB cap), Firebase emulator + genuine isolated SQL + browser/device tests. All proposed billing-related tests require approval when not free/disposable.
5. Validate production history and backup/restore separately before any real migration. Historical test logs can be pruned only in separately approved maintenance, never as part of QN13-A.

## Final safety / stop

**QN13-A checkpoint complete (audit-only).** No source-code change, feature-flag activation, SQL execution, Neon app provisioning, Mimo access, Firebase prod access, old-log deletion, merge, deployment, or new CI run. A new documentation-only commit records this audit on the Quizer work branch. Stop before QN11.1. The AI snipping branch remains separate.
