# Quizer: approval-gated Firebase + Neon roadmap

Revised: 2026-11-03 (testing-phase data retention clarification; supersedes initial Firebase-only optimization roadmap).
Work branch: `work/quizer-audit-optimization-2026-11`
Base `main` audit SHA: `e5ceb11f110ab85a04033ffe9638fd1a23d85c40`
Companion read-only audit: `docs/QUIZER_NEON_MIGRATION_AUDIT_2026-11.md`

## Goal

Keep Firebase authoritative for sign-in, roles, quiz availability and access,
published quiz delivery, immutable frozen questions/keys, attempts, grades,
results, and image files. Move the reusable problem bank and its content
revisions to **a dedicated Quizer Neon PostgreSQL database**. Use Neon for
**new** activity logs/analytics from the enabled cutover point onward, and an optional asynchronous published-quiz
archive copy **only if measurements justify the writes, storage and latency**.

**Test-stage retention policy:** historical test logs are disposable and require **no historical backfill** to Neon. Previously created quizzes are **not** disposable: preserve quiz IDs, drafts, published and older immutable revisions, questions, grading keys, image/asset bindings, permissions and usable links. Preserve existing attempt/result records unless separately approved for cleanup. Validate inventory and backups before any later cutover; no live deletion is authorized by this document.

**Final storage contract:** For each imported quiz, Firebase Storage keeps **one original `.tex` source object**, uploaded once. Individual parsed problems, answers, tags and immutable revisions live **only in the dedicated Quizer Neon database**; no separate Firestore problem-bank documents for new uploads. Firebase Firestore keeps lightweight quiz/access/draft metadata and ordered problem IDs or revision references (not problem text). **At publish/republish only**, create **one private, immutable compiled quiz bundle per published revision in Firebase Storage** and a small Firestore manifest pointing to that object. Preserve earlier bundles while attempts depend on them, and preserve legacy Firestore-based quizzes/links during transition. The original `.tex` source and a published bundle are distinct objects with different purposes. Image bytes remain in Firebase Storage; Neon stores asset IDs.

**Private bundle security:** the compiled bundle may contain protected answer keys. Never give a student a direct download URL, signed URL or read permission for the whole bundle. Firebase Functions read the pinned private bundle server-side and enforce attempt ownership, question-frontier/no-backtracking, shuffle/order and answer/solution release before returning **only permitted question slices**. Grading reads protected keys server-side. Test memory use, Storage reads, cold/warm latency and costs; a one-file design is not acceptable unless these checks pass.

**A single small edit must never re-upload/rewrite an entire quiz.** Preserve
existing partial slot saves and implement zero-write no-ops, metadata-only
updates and conditional problem revision creation. Do not confuse a new
immutable publish snapshot with an ordinary draft edit.

**Ordinary editing must never restart the original import.** The 1-to-20-problem `importProblemBatch` requests are for initial imports, not quiz rename/settings/points/reorder changes. A title-only edit on a 100- or 500-question quiz sends just `{title}` to the existing authenticated draft mutation and performs only bounded Firebase metadata updates: **zero Neon calls, zero per-problem operations, zero source .tex reads/uploads, and zero publish jobs**. Settings-only edits follow the same principle. Points-only edits update the selected draft slot, while a genuine problem-content change stores only that changed problem's Neon revision and updates the relevant reference. A new Firebase frozen question/answer snapshot is created only when the teacher separately publishes changes. Keep older published revisions and in-progress attempts untouched.

Mimo's existing Neon project remains isolated. The Quizer backend uses
server-side credentials only. Quizer must work normally for students if Neon
or the archive worker is unavailable.

**Keep the problem-bank integration minimal.** Reuse Quizer's existing Firebase-authenticated callable actions and existing page controllers rather than create a separate public problem-bank API, extra service, or proxy hop. Where technical constraints allow, batch needed bank data into existing operations and avoid unnecessary round trips. A tiny server-only Neon data-access module is sufficient; no browser PostgreSQL credentials, browser direct SQL, or duplicated REST interface. Any additional endpoint must be justified by a concrete security, pagination, or performance requirement and approved separately.

## Immutable guardrails

- Change only this GitHub work branch. No merges, rebases of unrelated
  branches, deployments, GitHub Pages settings, production schema/DB writes,
  live Firebase changes or moving production credentials.
- One authorized milestone per turn; run its available tests, record evidence,
  stop and ask approval. Do not presume the next milestone is authorized.
- No provisioning of a Quizer Neon project or test branch without owner
  approval for that specific step; synthetic fixture/local or disposable
  database tests preferred. Never use Mimo project for Quizer tables.
- Keep authorization from current Firebase identity and roles, enforce
  teacher ownership and sharing, preserve admin/audit, deadlines, strict
  no-backtracking, grading keys, and immutable attempt snapshots.
- Neither the client nor Mimo obtains Neon DB credentials.
- Never log user answers, secrets, signed URLs or personally identifying
  snapshots; use synthetic fixtures and minimum necessary event metadata.
- Every external delivery uses version/ID, duplicate suppression, retries,
  checkpoints and reconciliation; cross-store operations are not atomic.
- Historical **test logs** may be pruned in a later *separately approved* maintenance step after confirming they are not needed for a live security investigation or test diagnostics. No cleanup now.
- **Never delete or overwrite past quizzes or their immutable revisions, draft data, keys or required asset references as part of log cleanup.** Preserve quiz identifiers and historical links.
- No destructive legacy cleanup or source-of-truth cutover without separate
  explicit later approval; tests do not constitute deployment approval.

## Dedicated Quizer Neon account decision (2026-11-03)

Initial read-only inventory found only Mimo; **QN4R subsequently created a separate isolated `quizer-dev` project**, which currently has an empty default database and no production schema. A dedicated separate project will be needed before real QN4/8 SQL or staging. See `docs/QUIZER_NEON_BACKEND_DECISION_2026-11.md`. The new `functions/src/neon/project-config.js` defaults OFF and rejects an explicitly configured Mimo project, wrong database/role/host or insecure connection URL. Eleven isolated configuration tests passed (V8 shim harness only; no Neon connectivity). This is a server-only guard, **not** a new API or permission to provision or deploy. QN4 remains unverified and the QN7–QN13 implementation milestones remain pending.

## Milestone map

| Phase | Small deliverable | Gate |
| --- | --- | --- |
| **QN0 — audit** | Read-only current-code audit, unmerged diff-only branch review, connected Neon inventory, new architecture decisions. | **Documented**; running tests and production timings not claimed. |
| **QN1 — draft diff-only** | Review/port frontend/backend `saveQuizDraft` field/item/order diffing and no-op detection. Test unchanged saves, 100/500-question renames, settings/points/order changes and zero TeX reimports/problem writes. | **Code and tests committed on work branch; local pure-helper tests 9 pass, editor check skipped locally, emulator pending**. Stop before QN2. |
| **QN2 — problem save efficiency** | Implement no-op zero-write saves, metadata-only payload/parent updates, and one immutable revision for changed content/answers; preserve existing image references and optimistic version checks; add tests. | **Code and tests committed on work branch**; 9 isolated frontend tests passed, emulator/integration verification pending. Stop before QN3. |
| **QN3 — contracts and schema** | Isolated SQL schema with immutable revision trigger, synthetic fixtures, typed server-only read adapter, and QN4 disposable-only rollback script. No DB connection or execution. | **Code/docs committed; 15/15 isolated mock tests passed. Actual PostgreSQL and full CI not run. Stop before QN4.** |
| **QN4 — local/disposable schema tests** | Commit guarded localhost-only SQL migration/rollback runner and synthetic FK, immutability, tag, receipt, index and paging tests. | **Rehearsal prepared, real PostgreSQL execution BLOCKED** (no local server/psql). See QN4 checkpoint; stop before QN5. |
| **QN5 — future-only activity log relay** | Default-off Firestore audit outbox, private Neon insert/ack relay, CAS ack, retry/collision tests. No historical backfill or scheduled cloud worker. | **Committed; 8/8 isolated V8 mock tests passed. Real Firebase/SQL and CI unverified.** |
| **QN6 — future logs and reports** | Internal, feature-disabled admin/teacher future-event report reader with Firebase-verified quiz ownership, HMAC-signed bounded cursors, explicit cutover boundary, and optional historical-test-log cleanup runbook only. | **Committed; 11/11 isolated V8 mock tests passed. No live handler switch or cleanup. Stop before QN7.** |
| **QN6.5 — midpoint safety audit** | Review QN1–QN6 code, repair broken trigger dollar quoting, fix partial-save retry baseline, install test-only two-job CI and record findings. | **Completed on work branch; both GitHub CI jobs passed** (run 41596426366). No real PostgreSQL rehearsal. |
| **QN4R — real disposable PostgreSQL gate** | Created separate `quizer-dev` Neon project, applied versioned schema to a disposable child branch, ran actual constraint/trigger, replay, least-privilege permissions and index tests; rolled schema back and deleted test branch. | **Completed; both CI jobs passed** in run 41636751257. Critical QN8 follow-up: Neon API-created roles inherited privileged `neon_superuser`; use verified SQL-provisioned least-privilege LOGIN roles instead. |
| **QN7 — optional mirror benchmark** | Avoid any redundant published-bundle copies by default. A compact mirror can be reconsidered only if quantified reliability, cost and storage findings justify it; never block student publishing. | **Deferred / skip by default**; no extra copy or billable SQL work authorized. |
| **QN8 — minimal Neon data access** | Staged trusted server-only transaction writer for create/edit and atomic 20-question import receipts, existing-action gateway, SQL role safety guard, 100/500-item tests. No extra public API, no active dispatcher connection and no database mutation. | **Code/tests/checkpoint committed.** Release still requires QN9 legacy rehearsal and QN11 safe cross-store progress + restricted LOGIN wiring. Stop before QN9. |
| **QN9 — preservation-first migration rehearsal** | Built read-only sanitized Firebase inventory with per-document hashes, 100/500-fixture and v1 history protections; tested old published revision and pinned attempt through Firebase emulator; verified real PostgreSQL synthetic problem/revision owner, key and SHA parity and rollback on a disposable Neon child branch, then deleted that branch. | **Completed; 166/166 unit tests, 5/5 backend tests, static/frontend checks and Firebase emulator integration/transport passed** in CI run 41641124699. Actual production inventory and Storage-object verification remain gated. Stop before QN10. |
| **QN10.1 — private bundle format** | Implemented deterministic canonical JSON protected bundle v1, SHA-256 and generation-pinned Firestore manifest, 24 MiB/500-item cap, internal authorization-before-read contract, explicit private Storage rule and signed-URL exclusion. Added 100/500, tamper, security and emulator regressions. | **Completed; 180/180 unit, 5/5 backend, static and Firebase emulator suites passed** in [CI run 41644098850](https://github.com/azmath25/quizer/actions/runs/41644098850). Legacy Firestore snapshots stay authoritative; no writer, delivery switch or deployment. Stop before QN10.2. |
| **QN10.2 — publish bundle writer** | Refactor publishing to pin validated Neon revisions, stage **one private Firebase Storage bundle per published revision**, and atomically switch a Firestore pointer only after successful verification; retain old published revisions and legacy paths. Tests/fixtures; no deployment. | Stop for approval. |
| **QN10.3 — secure bundle reader/grading** | Adapt existing Firebase delivery and grading functions to read pinned bundles **server-side** without exposing keys/future questions; preserve `allowBack:false`, attempt version pinning, timers, results and release policy; add stress/security tests and latency/read-cost measurements. | Stop for approval. |
| **QN11 — editor/import integration** | Keep the existing source `.tex` → preview → upload-to-Firebase → **Neon-only problem bank** → Firebase draft flow. Change the frontend from one `importProblemBatch` call per question to bounded multi-question batches; preserve resumability, idempotency, image assets, optional Mimo draft import, mobile behavior, authentication and performance. | Stop for approval. |
| **QN12 — frontend improvement & UX audit** | Dedicated mobile-first frontend audit and improvements after backend/schema integration: editor, upload progress/resume, error recovery, preview, batch actions, accessibility, responsive layout, author/student navigation, perceived performance, loading states and API-request counts. Add targeted browser/playwright-style and accessibility regressions; **no frontend deployment**. | Stop for approval. |
| **QN13 — overall system check & readiness** | Whole-app security, schema/legacy parity, unit/backend/emulator/transport/static/browser tests, end-to-end import → edit → publish → student attempt → grading → reporting, 10/100/500-question performance and cost comparisons, Firestore/Neon outage recovery, preserved historical quiz manifests, rollback and optional old-test-log cleanup runbook. **No cleanup, production migration, merge or deploy**. | Stop for explicit future decision. |

## Acceptance criteria

**Small edits**
- Renaming an existing 100-question (and separately 500-question) quiz does **not** call `importProblemBatch`, load all problem content, parse/read/reupload the original `.tex`, call Neon, mutate individual problem records, or republish. Only the quiz title fields and expected metadata/version/audit bookkeeping may change.
- A settings-only edit does not reimport or mutate questions; a one-slot points edit updates only that slot and minimal required draft bookkeeping.
- Editing one problem updates exactly one Neon problem revision/reference, with no changed unrelated problem content. Existing published snapshots stay frozen until explicitly republished.
- Unchanged Save -> 0 write, 0 version increment, no new audit event.
- Title/settings edit -> only changed patch, no unrelated item content upload.
- One point or revision change -> update only the matching slot, preserve all
  other slots/order; safe concurrent version conflict and retry behavior.
- Problem metadata-only edit -> metadata changes only, same revision ID.
- Problem content change -> one immutable revision; no duplicate image upload.
- Measured request bytes, number of reads/writes, and real browser outcomes
  are reported, not inferred.

**Whole LaTeX upload / import**
- For a 100-question `.tex`, Firebase Storage receives **one original source file** (and any image assets), not 100 separately uploaded question files; Neon receives **100 individual problem/revision rows** in bounded batches.
- Importing does **not** create 100 Firestore bank-problem documents; Firebase holds only a lightweight quiz draft, references and job/checkpoint metadata before publication.
- Existing backend `importProblemBatch` can accept up to 20 records per request; target five calls for 100 questions, bounded further if payload size/transaction limits demand it. No assumption of measured speedup until tests.
- Upload retry/resume must avoid duplicate problem IDs, duplicate source asset uploads and partially visible quizzes; malformed/failed imports remain recoverable and must not delete the original source.
- Publishing creates **one private, immutable compiled quiz-bundle Storage object per published revision** plus a Firestore manifest; it does **not** create individual Firebase question documents for new quizzes.
- The original `.tex` file is stored once per import and is **not** rewritten for a title, settings, points, order or question edit.
- Changing the visible quiz title updates Firestore catalog/draft metadata only; previously frozen questions do not need to be rebuilt just to rename the quiz.
- Students never receive a URL or read grant to the complete bundle. Authorized server code returns only permitted question slices and never leaks grading keys or locked future questions.
- No live quiz reads from Neon. Test full-bundle reads, compression, in-memory bounded cache (if safe), concurrent students and warm/cold latency before accepting one-file publishing.
- Existing quizzes and published Firestore snapshots are preserved, with safe legacy behavior during the transition.

**Data ownership and liveness**
- Neon down -> active quiz start, navigation, submit, grading/results function
  from the private, version-pinned Firebase Storage bundle plus Firestore attempt metadata (not degraded).
- Quizer Neon unavailable -> authors see a clear bank/edit availability
  warning; quizzes remain live.
- Existing authenticated problem-bank actions continue to work with the same frontend request shapes; no extra API surface or separate service is added without a demonstrated need.
- Opening a quiz/editor does not fetch the full bank by default; requests are scoped to the current page or explicitly selected problems and batched when justified.
- Publication reads validated canonical problem revision and takes an immutable
  snapshot; leaked keys and broken private sharing rejected.
- Neon archive worker slow or failing -> never blocks publishing.
- Relay retries and duplicate/out-of-order **new** events -> no duplicate Neon rows,
  ordered display by trustworthy timestamp/sequence; reconciliation detects
  gaps, temporary Firebase outbox held until acknowledgment. No old-log replay.
- **Existing quiz IDs, drafts, frozen published revision history, answer keys, image bindings, access policies and links remain available and unchanged.** Preserve referenced problem revision content, including where an old quiz points to Firestore.
- Legacy active attempts, grades, assets and published revisions remain valid; a compatibility reader continues to serve existing per-question Firestore revisions without deleting or rewriting them.
- Log cleanup cannot cascade to quizzes, problems, attempts or grades; post-cleanup admin views explicitly explain the historical boundary.
- Mimo cannot read Quizer SQL data via its existing database credentials.

**Bundle-read performance and security gate**
- Compare one private Storage bundle against current per-item Firestore delivery on 10/100/500 questions, multiple simultaneous students, cold/warm request latency, backend memory/CPU, Storage reads, egress and generated bills. Stop design if unacceptable; reassess format or safe server-side chunking while preserving no separate *problem-bank* records.
- Firebase Storage rules and server responses prevent clients from downloading whole bundles, solutions or locked future questions. `allowBack:false` and results-release security tests are blocking.
- Only the latest ready revision pointer changes at publish; active attempts pin their original immutable bundle, and old revision references never disappear.

**Storage/latency decision**
- Archive uses only compact JSON plus references, never reuploads images.
- Compare snapshot size, compression/JSONB cost, per-revision growth,
  transfer bytes, queue lag, SQL writes, connection churn, and projected
  quota use before approving optional mirroring.
- Prefer compact immutable version-level mirror with dedupe over full rewrite
  on every edit. Optionally disable secondary copy if it costs more than its
  actual recovery/search value.

## Developer checkpoint after every phase

Report branch and commit(s), modified files, source-of-truth semantics,
measurements/tests (including skipped/failed), security checks, unresolved
risks, and exact proposed next phase. Do not advance without explicit owner
approval.

## Current state

- QN0: static GitHub inspection and Neon project/table inventory completed;
  documentation only. Local verification and live timing have **not** been run.
- QN1: frontend diff-only helper/handler, backend no-op detection and no-op receipt suppression, unit and emulator regression tests committed on the isolated branch. Locally, **9 pure-helper tests passed and 1 editor-source check was skipped** (full repo unavailable); the emulator suite and all-repo CI have not been executed in this environment. See `docs/QUIZER_QN1_CHECKPOINT_2026-11.md`.
- QN2: metadata-only/no-op problem-save paths, frontend reduced-payload helpers, quick-edit revision counter fixes and unit/emulator tests committed on the work branch. Local isolated Node tests: **9 passed, 0 failed**; emulator, full CI, and browser checks **not run**. See `docs/QUIZER_QN2_CHECKPOINT_2026-11.md`.
- QN3: repo-only SQL schema, disposable-only rollback, typed server read adapter, synthetic fixtures, and 15 passing isolated V8 mock/structural tests committed. PostgreSQL migration, integration, CI and live verification have **not** run; no Neon resource created. See `docs/QUIZER_QN3_CHECKPOINT_2026-11.md` and `docs/QUIZER_NEON_SCHEMA_CONTRACT_QN3.md`.
- QN4: guarded localhost-only migration/rollback and SQL regression fixtures committed; **actual PostgreSQL DDL and emulator integration not run** because no local Postgres/psql or disposable DB was available. See `docs/QUIZER_QN4_CHECKPOINT_2026-11.md`.
- QN5: future-only audit outbox/relay code and 8 passing isolated mock tests committed; flag OFF by default, no scheduler or database credentials, no real integration test. See `docs/QUIZER_QN5_CHECKPOINT_2026-11.md`.
- QN6: feature-disabled future-log admin/teacher report reader and old-test-log cleanup runbook committed; 11/11 isolated V8 mock tests passed. Existing Firebase log handlers remain active, no backfill or deletion. See `docs/QUIZER_QN6_CHECKPOINT_2026-11.md`.
- QN6.5 midpoint audit: trigger SQL delimiter repaired; 500-slot partial-save retry baseline corrected; new work-branch-only GitHub Actions workflow added. **Both CI jobs succeeded** at [run 41596426366](https://github.com/azmath25/quizer/actions/runs/41596426366): Node unit/backend/static and Firebase emulator integration/transport. See `docs/QUIZER_MIDPOINT_AUDIT_2026-11-03.md`. This supersedes earlier QN1–QN6 checkpoint notes saying CI was unavailable, but does not prove PostgreSQL compatibility.
- **QN4R complete:** separate Neon Free-plan dev project `quizer-dev` (`soft-grass-35754518`) created at 0.25 CU cap, PostgreSQL 17 schema and synthetic replay/privilege/index checks passed on a disposable child branch, rollback verified and the child branch deleted. Quizer default branch remains schema-empty; Mimo untouched. Two-job [GitHub CI run 41636751257](https://github.com/azmath25/quizer/actions/runs/41636751257) passed. See `docs/QUIZER_QN4R_CHECKPOINT_2026-11.md`. **QN8 must provision genuinely limited LOGIN roles**: Neon API-created roles unexpectedly inherited `neon_superuser` and are not safe for runtime use. QN7 mirroring deferred. QN8 staged, with feature disabled and 100/500-item mock regression tests; QN9–QN13 not started. No old-test-log backfill or deletion, no public SQL API, merges or deployments.
- The unmerged `feature/diff-only-quiz-and-problem-saves` remains untouched.
  Review and selectively transplant its code/tests into this branch for QN1/QN2
  after owner approval; **do not merge it**.
- No merge, deployment, migration, production DB, Pages or live cloud changes have occurred; **QN1 work-branch app-code edits exist and are not deployed**.

- QN8 staging checkpoint: `functions/src/neon/write-repository.js` and `functions/src/neon/action-gateway.js` implement the opt-in transactional writer and Firebase-verified action bridge; active Firebase dispatch remains unchanged. Regression suites: `tests/unit/qn8-neon-write.test.mjs` and `tests/unit/qn8-action-gateway.test.mjs`. See `docs/QUIZER_QN8_CHECKPOINT_2026-11.md`. A real SQL driver, privileged-role-free LOGIN credential setup, cross-store job/draft reconciliation, and legacy migration are **not yet implemented**, and these are release blockers until QN9/QN11.

- QN9 staging checkpoint: sanitized historical data plan (including legacy v1 unpinned attempts) and fail-closed synthetic-only migration adapter; Firebase emulator old/new published grading and pinned student result readability; disposable Neon SQL revision ID/owner/hash parity, verified rollback and child-branch deletion. See `docs/QUIZER_QN9_CHECKPOINT_2026-11.md` and `docs/QUIZER_QN9_PRESERVATION_MATRIX_2026-11.md`. [CI run 41641124699](https://github.com/azmath25/quizer/actions/runs/41641124699) passed both jobs (166 unit, 5 backend, Firebase emulators/static/transport). **This is not an inventory or migration of real production data**. No user records, assets, attempts, grades or logs were touched. QN10–QN13 not started; QN8 remains feature-disabled.

- QN10.1 private bundle format checkpoint: `functions/src/bundles/published-bundle.js`, `firebase/storage.rules`, `functions/src/api/assets.js`, `tests/unit/qn10-1-bundle-format.test.mjs`, `tests/rules/security.test.mjs`, docs `QUIZER_QN10_1_BUNDLE_FORMAT_2026-11.md` and `QUIZER_QN10_1_CHECKPOINT_2026-11.md`. Implemented only the protected format, manifest and private read contract, not publishing or student delivery. Old Firestore revisions, attempts and grading remain untouched. QN10.2 and QN10.3 remain separate approval-gated milestones.

- QN10.1 verification: complete work-branch test-only [CI run 41644098850](https://github.com/azmath25/quizer/actions/runs/41644098850) passed two jobs (180 unit, 5 backend, static, Firebase emulator integration and transport). Includes real Storage emulator denials for protected bundles and asset signed-URL guard. The bundled writer and student delivery are NOT implemented. No cloud/data change. QN10.2 remains approval-gated.
