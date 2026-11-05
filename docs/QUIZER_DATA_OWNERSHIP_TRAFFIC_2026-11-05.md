# Quizer architecture and traffic optimization checkpoint — 2026-11-05

Status: **implementation slice P-TRAFFIC.1 on an isolated branch**, based on the
verified but still unmerged PR #13 (`fix/quizer-publish-noop-and-manage-tabs-2026-11-05`).
No production release, database migrations, or `main` changes authorized by this checkpoint.

## Single-writer ownership; current and target

| Data | Current writer / system of record | Proposed steady state | Migration condition |
| --- | --- | --- | --- |
| Login, verified Firebase identity | Firebase Auth | Firebase Auth | Keep |
| Role and account flags | Firestore `roles`/user profile | Backend-verified role adapter, eventual Neon mirror only if justified | Do not move identity authorization during attempt cutover |
| Reusable problem, immutable revision | Neon for PROD1 routed bank; historical Firestore problem revisions remain | Neon PostgreSQL append-only revision table | Reconcile legacy refs by origin |
| Teacher quiz/draft, order/access | Firestore | Neon quiz and quiz-item tables eventually | Explicit versioned cutover with old quiz adapter |
| Immutable published question+grading | Private Storage bundle (PROD1) or older Firestore revision | Immutable Storage bundle, Firestore/Neon minimal manifest by ownership | Preserve SHA-256/generation pin and key secrecy |
| Upload images/TeX/PDF | Firebase Storage, metadata Firestore | Firebase Storage and lean manifest | No browser direct SQL access |
| Active attempts, answer changes, grades | Firestore; private service reads protected bundles for PROD1 | Neon transactional attempt/answer/grade tables | New attempts only after completion of Neon API, auth, timeout, concurrency and grade acceptance tests |
| Notifications and public catalog | Firestore | Read-optimized projection / outbox, not second mutable authority | Measure volume before introducing cache |
| Events and limited historical imports | Firebase job log + Neon receipts/outbox | Idempotent outbox/event stream | No dual-writer truth |
| Source PDFs or rendered TikZ | Storage; not a built-in Quizer TikZ compiler | Keep binary Storage; Mimo API integration separately | Service integration requires explicit scope |

**Avoid live dual writes.** Cross-store links must include the origin type,
immutable revision ID, and version/hash; SQL should not be called inside a
Firestore transaction retry callback. Auth must be verified server-side.

## Measured code-level traffic problem and first change

`js/services/api.js` previously used
`/^(get|list|setStar)/` as its read classification and coalesced *all* in-flight
actions with the same payload. This treated `setStar` as read-only and could
silently conflate two independent mutations. A pending SWR read could also
restore an older cache entry after a mutation invalidated it.

P-TRAFFIC.1 centralizes a fail-closed action classification in
`js/services/request-policy.js` and changes the wire behavior:

- Identical **verified read-only** requests in flight share one Firebase callable.
- Separate writes get unique request IDs, unless callers explicitly supply
  the same request ID for a retry. A transport-uncertain failure may be replayed
  with the original ID on the next deliberate call.
- The small 60-second SWR cache admits only list/dashboard summaries and
  excludes attempts, answer keys, private draft content and signed asset URLs.
- A mutation or logout fences obsolete pending cache responses; old reads
  cannot repaint new state.
- Long-running job polling starts at 1.5s but progressively slows to 5s,
  under a total 270s waiting budget. Terminal success/failure remains prompt.

**Production behavior is not changed until a separate merge/deployment approval.**
Costs cannot be claimed reduced without pre/post metrics. Suggested measurements:
`api` actions per logical operation, Cloud Functions billed invocations,
Firestore document reads/writes, private Storage GETs, Neon SQL statements/rows,
start-attempt latency p50/p95, job progress latency and user-perceived time.

## Follow-up milestones (one at a time)

- **P-TRAFFIC.2 — verified publication reuse:** Build from PR #13's no-op
  case. Keep full immutable new output but load existing pinned bundle once,
  compare slot identity + content hash, reuse unchanged content only, revalidate
  authorization/asset retention, and fetch changed Neon/Firestore revisions
  only. Test 1/500 edit, reorder-only, revoked share, changed answer key,
  mismatched bundle generation/hash, parallel publishers and retries.
  Modules: `functions/src/prod1/publication-gateway.js`,
  `functions/src/bundles/publish-writer.js`, `published-bundle.js`.
- **P-TRAFFIC.3 — quiz start performance:** Audit `getQuizOverview`,
  `startAttempt`, firstQuestion and `getAttemptQuestions` with 1, 40 and 500
  items. Reuse the already-loaded first item and avoid redundant Storage
  reads; test timer, offline, back/forward restrictions and browser QA.
- **P-TRAFFIC.4 — durable frontend edit delta:** Use existing
  `js/pages/quiz-save-diff.js` and `saveQuizDraft` rather than the import
  path; send only changed slots/order/metadata, journal successfully saved
  batches, and return no job when no content changed. Test retries/collisions.
- **N-A1 — Neon attempt design:** Versioned relational schema, read/write API
  contracts, constrained server-side role, idempotency receipts, immutable
  quiz revision references, and deadline/grade rules on a **disposable Neon
  branch**. No live migration.
- **N-A2 — Neon attempt engine:** Atomic save batch and submit; server-controlled
  deadline and grading; snapshot access to grading keys exclusively on server.
  Strict old-Firebase adapters.
- **N-A3 — safe cutover:** Existing attempts continue on Firestore until done.
  New attempts pinned to one backend; no state written to both. Read-only
  reconciliation before any live switch; backout without orphaning attempts.
- **A-FINAL — module simplification:** Remove superseded Firestore-Neon
  compatibility layers *only after* all consumers and live records are verified;
  keep one public callable API boundary for the frontend.

## Release gate

Use protected saved main backup. First verify root unit+backend+static/build,
Firebase emulator integration, browser quiz tests and Cloud release scripts.
Before any production cutover capture current versions, rollback candidates and
a real authenticated quiz smoke; do not create/destroy Neon live tables or
change Cloud functions, Rules, or GitHub Pages from this optimization branch.
