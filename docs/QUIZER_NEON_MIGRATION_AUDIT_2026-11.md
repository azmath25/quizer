# Quizer — Firebase/Neon split: read-only architecture audit

Audit date: 2026-11-03
Repository: `azmath25/quizer`; audited `main` at `e5ceb11f110ab85a04033ffe9638fd1a23d85c40`.
Related unmerged optimization branch: `feature/diff-only-quiz-and-problem-saves` (4 commits ahead, 0 behind `main` when checked).
Working documentation branch: `work/quizer-audit-optimization-2026-11`.

## Scope and limitations

This was a **source audit using GitHub and read-only Neon metadata inspection**.
No local unit or emulator tests, real request timings, Firebase deployment inspection,
production data reads, SQL writes, database migrations or cloud deployments were
performed in this checkpoint. The repo's `docs/VERIFICATION.md` describes older
checks but not a fresh run in this audit. No cost reduction is claimed.

The October `quizer-backend-request-map.md` and `quizer-target-operations-map.md`
are historical context, not current truth: their Firebase-only ownership proposal
has been superseded by the owner's 2026-11-03 storage split.

## Observed current behavior

1. The app uses Firebase Auth for identity, Firestore roles, drafts, problems,
   published revisions, attempts, grades, auditEvents, and Cloud Storage for assets.
   Cloud Functions define authenticated operations.
2. `functions/src/api/problems.js`: `createProblemRecord` writes problem metadata,
   immutable revision content, separate grading, and references to assets in Firestore.
   `saveProblemRevision` on current `main` creates a new immutable revision even
   if only metadata changes or content remains equal.
3. `functions/src/api/quizzes.js`: `saveQuizDraft` accepts `patch`,
   `upsertItems` (up to 20), `removeItemIds` (up to 20), and optional
   `itemOrder`; changed item slots are written separately. However every
   accepted save also rewrites draft and quiz documents and increments versions.
   It does not currently have a no-op exit.
4. `js/pages/quiz-editor.js` on `main` already compares changed slots, but
   the final save *always* sends `patch: values()` with the full editor fields,
   including settings, and `itemOrder: order`. It then refetches the draft.
   This is unnecessary request/write work for an unchanged save, **not** evidence
   that the browser reuploads all question text or image bytes.
5. The existing unmerged `feature/diff-only-quiz-and-problem-saves` branch
   contains: frontend field/settings/order diffing and a no-touch save path;
   backend no-op draft detection; problem content-hash and metadata-only
   updates; related integration tests. It has not been merged. This is a
   candidate for review/porting, not verified complete or deploy-ready.
6. `functions/src/domain/runtime.js` writes `auditEvents` as part of
   Firestore operations; `functions/src/api/reports.js` and
   `functions/src/api/accounts.js` read them for teacher/admin views.
   Migrating logs requires changing readers and maintaining trustworthy
   authorization and delivery semantics.
7. `snapshotSource` and `sourceContent` in `quizzes.js` directly dereference
   Firestore problem revisions; publication, image ownership and legacy quiz
   snapshots must be refactored for Neon-authored problems.
8. Prior November changes on `main` already batch-prefetch quiz content and
   improve image signing. Verify on tests; do not assume October request counts.

## Neon inventory

The linked Neon account has exactly one listed project in this audit:
`mimo` (`late-pine-40973150`, AWS `eu-central-1`). Read-only table listing
showed Mimo schemas/tables for workflows, runs, checkpoints, usage, etc.
**No separate Quizer project is present.** Do not create Quizer tables in
the existing Mimo project. No Neon project was created or changed.

## Revised source-of-truth boundaries

| Domain | Authority | Notes |
| --- | --- | --- |
| Auth identity and canonical roles | Firebase Auth / Firestore | Firebase UID is stable external identity in Neon; server verifies role on sensitive requests |
| Quiz catalog, policies, drafts and slots | Firestore | Diff-only saves; preserve access/ownership/version guards |
| Frozen published revisions, grading keys, delivery | Firestore + Firebase Storage | Publish once from validated problem revisions, pin attempts; no Neon in quiz session path |
| Attempts, answers, grades, results, deadlines | Firestore | Server authoritative, stable under Neon outage |
| Reusable problem bank and immutable problem revisions | **Dedicated Quizer Neon database** after safe cutover | Metadata, statement, options, grading, tags, ownership and provenance; no browser DB credential |
| Image bytes and derived files | Firebase Storage | Neon holds immutable asset identifiers and provenance, never image bytes by default |
| Historical activity/audit analytics | Neon as long-term searchable copy | Retain minimal durable Firebase event/outbox until Neon acknowledgment; critical security history cannot be silently lost |
| Published quiz archive copy | Optional Neon mirror | Async, versioned, hash-verified, no raw image bytes; never blocks publish or starting attempt |
| Mimo jobs and workflow execution | Existing Mimo project | Keep isolated; integration only through approved versioned APIs |

## Desired request paths

### Edit a quiz draft

Browser sends only changed metadata fields, changed slot IDs/points/revisions
and reordered IDs only when the order actually changed. Server validates
owner/expected version and performs bounded updates; no-op means **zero write,
zero version increment, zero new audit event**. A changed individual problem
creates or updates one Neon problem revision as appropriate; a metadata-only edit
must not create a new content revision. Images upload only if new/changed.

### Publish or republish

Teacher requests publish with expected draft/version. Trusted worker resolves
all pinned Neon problem revisions (during transition: approved fallback for old
Firestore records), validates ownership/sharing and hashes, and materializes a
new frozen Firebase quiz revision. Preserve old published revision until the
new one is ready; failures never partially expose content or answer keys.
Publish only changed revision when content hash differs; no unintended
republish when the draft is unchanged. Avoid external SQL calls inside
Firestore transactions; stage and verify external reads before the final
Firestore commit. Concurrent edits must cause conflict/revalidation.

### Long-term logs and optional archive

A committed Firebase operation writes a small durable outbox/event in its
own transaction. A separate bounded worker transfers safe event metadata to
Neon via idempotent `event_id` uniqueness; retries are safe under reordered
or duplicated triggers. Neon dashboards read Neon only after role authorization.
Preserve a Firebase fallback (or explicit 'unavailable') until backfill,
reconciliation and cutover acceptance. Avoid student answer text, secrets,
tokens or signed URLs in logs.

After a successful publication, enqueue optional archive of a versioned
JSON metadata/content snapshot to Neon. De-duplicate by
`(quiz_id, revision_id, content_hash)`. Keep image references rather than
bytes. Archive worker runs asynchronously, with retries and a bounded
payload/throughput budget; a failed mirror must never fail publication.
Measure data bytes, write count, queue lag, storage growth, latency and cost
before enabling the mirror. Disable or rate-limit archival if expensive.

## Security and failure requirements

- Quizer browser never connects directly to PostgreSQL. The existing trusted
  Firebase backend verifies identity/roles and speaks to a Quizer-specific
  server-side DB adapter. Do not introduce a new always-on service by default.
- Cross-store transactions are unavailable: use explicit ownership, immutable
  IDs, transactional outboxes, idempotent consumers, and a reconciliation job.
- Student paths have **zero** Neon dependency after publication. Strict
  `allowBack: false` continues to prohibit future question disclosure.
- Publication does not expose protected grading keys before release.
- Teacher-owned/shared problems must be authorized using current Firestore
  roles and server-side ownership policy; revocation and stale role changes
  need tests.
- No snapshot deletion, retention cleanup, destructive migration or irreversible
  source switch until a separate later approval and tested rollback.
- Mimo credentials and budget must not become Quizer dependencies.

## Risks and evidence still needed

- Cross-cloud latency from Firebase Functions to Neon; benchmark only with
  permission and isolate cost, connections, timeouts, and cold starts.
- Problem import and publication workers currently assume Firestore paths.
- Changed vs untouched payload bytes and write counts have not been measured.
- Need estimate size of compressed vs raw quiz copies and growth from
  multiple published revisions before deciding whether archival is worth it.
- Need a safe sanitized fixture dataset, migration parity checks, conflict
  tests, permissions/tests for teacher/admin log readers, legacy active
  attempts, and version-pinned results.
- SQL schema, per-service budget and retry limits require verification before
  any implementation, provisioning or deploy.

## Recommended execution sequence

First integrate **reviewed diff-only editing** and its tests on the isolated
working branch (this reduces unnecessary writes immediately without moving
data). Next design the Quizer-specific Neon adapter and schema using synthetic
fixtures. Next implement log mirroring, optional archive benchmarking, staged
problem-bank data migration, and publish materialization. Readiness review is
the final milestone; live migration and deployment remain explicitly excluded.
