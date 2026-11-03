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

## Milestone map

| Phase | Small deliverable | Gate |
| --- | --- | --- |
| **QN0 — audit** | Read-only current-code audit, unmerged diff-only branch review, connected Neon inventory, new architecture decisions. | **Documented**; running tests and production timings not claimed. |
| **QN1 — draft diff-only** | Review/port frontend/backend `saveQuizDraft` field/item/order diffing and no-op detection. Test unchanged saves, 100/500-question renames, settings/points/order changes and zero TeX reimports/problem writes. | **Code and tests committed on work branch; local pure-helper tests 9 pass, editor check skipped locally, emulator pending**. Stop before QN2. |
| **QN2 — problem save efficiency** | Review/port unchanged-content and metadata-only behavior from unmerged optimization branch; preserve immutable changed-content revisions, references and assets; add tests. | Stop for approval. |
| **QN3 — contracts and schema** | Define independent Quizer Neon SQL schema (problems, revisions, ownership, tags, audit log, outbox receipts, optional quiz mirrors) and typed server adapter; create synthetic fixtures and migration SQL in repo. No live Neon changes. | Stop for approval. |
| **QN4 — local/disposable schema tests** | Rehearse reversible schema changes on an explicitly authorized disposable PostgreSQL/Neon dev branch; verify uniqueness, foreign keys, indexes, pagination, idempotency, rollback. Never touch Mimo or production. | Stop for approval. |
| **QN5 — future-only activity log relay** | Design/implement trusted Firebase outbox → Neon log relay for **new events only**; retry/idempotency tests, no old-log backfill. Disabled by default. | Stop for approval. |
| **QN6 — future logs and reports** | Implement teacher/admin Neon log readers for events after cutover, with pagination, authorization and clear pre-cutover boundary. Define optional old-test-log cleanup runbook **without executing it**. | Stop for approval. |
| **QN7 — optional quiz mirror benchmark** | Benchmark feature-flagged, asynchronous, deduplicated metadata/compact published-bundle copies in Neon (never re-upload raw images or block publishing). Keep disabled unless independently approved after byte/latency/cost measurements. | Stop for approval. |
| **QN8 — minimal Neon data access** | Keep existing authenticated problem-bank operations; implement a small server-only Neon repository and **bulk import of extracted questions**. Upload **one original .tex** to Firebase Storage; insert per-question records only into Neon in bounded, idempotent batches (existing `importProblemBatch` supports up to 20 records/request); no extra public API or backend service. Feature-disabled until cutover. | Stop for approval. |
| **QN9 — preservation-first migration rehearsal** | Inventory **all prior quizzes/drafts/published revisions/asset links** and their referenced problems; test sanitized problem migration to disposable Neon with checksums, IDs, revision/ownership parity, legacy quiz readability, and rollback. No real data movement or log backfill. | Stop for approval. |
| **QN10.1 — private bundle format** | Define deterministic versioned bundle schema, integrity hash, Firestore manifest, restricted Storage permissions, release policy, maximum size and backward-compatible reader interface. Synthetic fixtures/tests only. | Stop for approval. |
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
- QN2–QN13: not started. Historical test logs will **not** be migrated; existing quizzes remain mandatory preservation targets. Problem bank reuses existing authenticated operations; no new public API. No logs deleted.
- The unmerged `feature/diff-only-quiz-and-problem-saves` remains untouched.
  Review and selectively transplant its code/tests into this branch for QN1/QN2
  after owner approval; **do not merge it**.
- No merge, deployment, migration, production DB, Pages or live cloud changes have occurred; **QN1 work-branch app-code edits exist and are not deployed**.
