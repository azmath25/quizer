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

**A single small edit must never re-upload/rewrite an entire quiz.** Preserve
existing partial slot saves and implement zero-write no-ops, metadata-only
updates and conditional problem revision creation. Do not confuse a new
immutable publish snapshot with an ordinary draft edit.

Mimo's existing Neon project remains isolated. The Quizer backend uses
server-side credentials only. Quizer must work normally for students if Neon
or the archive worker is unavailable.

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
| **QN1 — draft diff-only** | Review/port just frontend and backend `saveQuizDraft` no-op/field/item/order detection; ensure one title edit writes only needed records; add tests and baseline byte/write counters. | Stop for approval. |
| **QN2 — problem save efficiency** | Review/port unchanged-content and metadata-only behavior from unmerged optimization branch; preserve immutable changed-content revisions, references and assets; add tests. | Stop for approval. |
| **QN3 — contracts and schema** | Define independent Quizer Neon SQL schema (problems, revisions, ownership, tags, audit log, outbox receipts, optional quiz mirrors) and typed server adapter; create synthetic fixtures and migration SQL in repo. No live Neon changes. | Stop for approval. |
| **QN4 — local/disposable schema tests** | Rehearse reversible schema changes on an explicitly authorized disposable PostgreSQL/Neon dev branch; verify uniqueness, foreign keys, indexes, pagination, idempotency, rollback. Never touch Mimo or production. | Stop for approval. |
| **QN5 — future-only activity log relay** | Design/implement trusted Firebase outbox → Neon log relay for **new events only**; retry/idempotency tests, no old-log backfill. Disabled by default. | Stop for approval. |
| **QN6 — future logs and reports** | Implement teacher/admin Neon log readers for events after cutover, with pagination, authorization and clear pre-cutover boundary. Define optional old-test-log cleanup runbook **without executing it**. | Stop for approval. |
| **QN7 — optional quiz mirror benchmark** | Implement feature-flagged, async, hash-deduplicated archive of published revision JSON (not image bytes) into Neon; measure fixture bytes, lag, overhead, failure and growth. Owner separately approves whether to enable it at all. | Stop for approval. |
| **QN8 — problem bank adapter** | Implement Neon-backed CRUD/search/filter/versions/teacher sharing behind existing Firebase-authenticated API, disabled until migration; no browser SQL. | Stop for approval. |
| **QN9 — preservation-first migration rehearsal** | Inventory **all prior quizzes/drafts/published revisions/asset links** and their referenced problems; test sanitized problem migration to disposable Neon with checksums, IDs, revision/ownership parity, legacy quiz readability, and rollback. No real data movement or log backfill. | Stop for approval. |
| **QN10 — publish materialization** | Stage and verify pinned Neon problem revisions; create immutable Firebase published snapshot with stable hashes, safe partial failures, concurrency guards, legacy Firestore fallback. Test active attempts unchanged. | Stop for approval. |
| **QN11 — editor/bank integration** | Update problem bank/import/editor to use the guarded Neon adapter, preserve image uploads, optional Mimo draft import contract, mobile usability; test server identity boundaries and latency. | Stop for approval. |
| **QN12 — full verification & readiness** | Unit/backend/emulator/transport/static/browser verification; preservation manifests and recovery tests for **past quizzes**; performance/cost comparison; future-log cutover plan and optional old-test-log cleanup procedure. No actual cleanup, production migration, merge or deploy. | Stop for explicit future decision. |

## Acceptance criteria

**Small edits**
- Unchanged Save -> 0 write, 0 version increment, no new audit event.
- Title/settings edit -> only changed patch, no unrelated item content upload.
- One point or revision change -> update only the matching slot, preserve all
  other slots/order; safe concurrent version conflict and retry behavior.
- Problem metadata-only edit -> metadata changes only, same revision ID.
- Problem content change -> one immutable revision; no duplicate image upload.
- Measured request bytes, number of reads/writes, and real browser outcomes
  are reported, not inferred.

**Data ownership and liveness**
- Neon down -> active quiz start, navigation, submit, grading/results function
  from Firebase using published snapshot (not degraded).
- Quizer Neon unavailable -> authors see a clear bank/edit availability
  warning; quizzes remain live.
- Publication reads validated canonical problem revision and takes an immutable
  snapshot; leaked keys and broken private sharing rejected.
- Neon archive worker slow or failing -> never blocks publishing.
- Relay retries and duplicate/out-of-order **new** events -> no duplicate Neon rows,
  ordered display by trustworthy timestamp/sequence; reconciliation detects
  gaps, temporary Firebase outbox held until acknowledgment. No old-log replay.
- **Existing quiz IDs, drafts, frozen published revision history, answer keys, image bindings, access policies and links remain available and unchanged.** Preserve referenced problem revision content, including where an old quiz points to Firestore.
- Legacy active attempts, grades, assets and published revisions remain valid.
- Log cleanup cannot cascade to quizzes, problems, attempts or grades; post-cleanup admin views explicitly explain the historical boundary.
- Mimo cannot read Quizer SQL data via its existing database credentials.

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
- QN1–QN12: not started. Historical test logs will **not** be migrated; preservation of all existing quizzes is mandatory. No logs have been deleted.
- The unmerged `feature/diff-only-quiz-and-problem-saves` remains untouched.
  Review and selectively transplant its code/tests into this branch for QN1/QN2
  after owner approval; **do not merge it**.
- No deployment, migration, DB change, Pages change or app-code edit has
  occurred as part of this roadmap.
