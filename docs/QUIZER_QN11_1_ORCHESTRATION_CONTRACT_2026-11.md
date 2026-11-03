# Quizer QN11.1 — Firebase–Neon orchestration and compatibility contract

Date: 2026-11-03
Status: DESIGN ONLY — implementation, live connections and migrations NOT STARTED
Branch: work/quizer-audit-optimization-2026-11
Reviewed code baseline: 13ab48fe3b3b9f9239ca382044ee18e0e56367c4
Related: QUIZER_QN13_A_PREINTEGRATION_AUDIT_2026-11.md and QUIZER_IMPROVEMENT_ROADMAP_2026-11.md

## 1. Decision and non-negotiable boundaries

**Decision:** retain one existing authenticated Firebase callable named api and its apiVersion=2 action envelopes. For new bank content, PostgreSQL in the independent Quizer Neon project is the authoritative immutable problem/revision store; Firebase continues to own identity, role/access decisions, import and publication job/coordinator state, lightweight quiz draft/order metadata, user attempts/answers/grades and Storage assets. An immutable private published-revision bundle in Firebase Storage serves new published quizzes **only after** authenticated server-side slice/grade integration is proven. Old Firestore problem revisions, quiz snapshots, attempts and results remain readable indefinitely until a separately approved preservation/cutover plan says otherwise.

**No SQL/Storage/network calls inside a Firestore db.runTransaction callback.** The existing functions/src/domain/runtime.js dispatch calls def.fn in a transaction; do not call the QN8 SQL gateway inside a current handler. Introduce a separate, feature-OFF orchestration boundary *before* invoking Firestore transaction callbacks, with a durable Firebase coordinator. Existing Firestore-only action paths remain the default.

No browser SQL credential; no additional public REST endpoint or extra service; no Neon Auth; no Mimo access; no production data or migrations; no AI-branch merge. The isolated AI snipping/placeholder inference branch is outside QN11.

## 2. Current source truth and pinned reference contract

| Object | Authority before any cutover | Intended new path after separate approval | Lifetime invariant |
| --- | --- | --- | --- |
| Firebase UID, role, approval, verification | Auth + Firestore roles | Unchanged | Recheck from verified callable identity, never request JSON |
| Legacy bank problem/revisions | Firestore problems / revisions / grading | Legacy read route remains | Preserve all IDs, answers, image refs |
| Newly imported/created problem + protected grading | Active Firestore today | Quizer Neon problems + immutable problem_revisions | Never serve grading to students |
| New quiz draft/order/settings/points | Firestore | Firestore with problem/revision refs, not question text | No full quiz rewrite for metadata edit |
| Original source and image bytes | Firebase Storage | Same; source uploaded once | Retain generation, checksum, owner and ref bindings |
| New published revision | Active Firestore items/grading today | One private generation-pinned bundle + Firestore manifest | No direct student bundle URL; old revisions preserved |
| Attempts, answers, scoring, results | Firestore | Remain Firestore | Pinned revision, deadline/no-back and release rules |
| Import receipts | Firestore mappings today | Neon SQL receipts + durable Firestore job reconciliation | Replay returns same item/revision IDs |
| New activity log delivery | Firebase audit event/outbox | Optional future-only Neon event relay | Default OFF, no historical backfill |

Proposed internal discriminant, never inferred from an ID prefix:

- Legacy reference: sourceKind=firestore_legacy, problemId, revisionId, relevant frozen snapshot path if applicable.
- New reference: sourceKind=neon_revision, problemId, revisionId, validated canonical contentHash; only the server fetches content/keys.
- Published reference: sourceKind=private_bundle_v1, quizId, publishedRevisionId, object generation and SHA-256 manifest.
- Unknown/missing discriminant from historical docs => explicitly legacy only when the existing historical path can be verified. Do not silently synthesize Neon origin or rewrite old records.
- Draft slot DTO remains itemId, problemId, problemRevisionId, points, reuseFromQuizRevisionId. Add provenance in server-owned metadata or a validated internal sidecar as needed; preserve existing response shapes.

## 3. Existing callable API compatibility matrix

All calls retain the existing envelope {apiVersion:2, action, requestId, ...payload}, returned data wrapper and errors. Field lists below are present-day, not new public parameters.

| Actions / source | Existing expectations | Design requirement before active cutover |
| --- | --- | --- |
| listProblems; getProblem; listProblemRevisions | List filters/paging, teacher sharing, body+grading only for authorized staff, revision history | Legacy/Neon routing with same item/header DTO, nextCursor, search, subject/difficulty/tag, ownership and stable paging |
| createProblem; saveProblemRevision | Idempotent request, metadata-only save, immutable content revision, version conflict | Restricted Neon writer behind verified Firebase actor; no Firestore bank duplicate; no-op = no write |
| forkProblem | Copy an authorized selected revision into own private problem | Fetch authorized source outside Firestore transaction, retain assets, create target idempotently and recheck ownership |
| setProblemSharing; trashProblem; restoreProblem; bulkUpdateProblems | Owner/admin, versioned metadata/lifecycle, up to 50 bulk updates | Neon metadata transactions with unchanged response/version semantics; sharing/trash cannot rewrite immutable revisions |
| createImportJob; getJob; importProblemBatch; finishImportJob; cancelJob | Job has Firebase owner/progress; order/mapping and retry are stable | Firebase job controls admission/recovery; SQL receipts are authoritative for item imports; reconcile before finish |
| getQuizDraft; getQuizDraftItems; saveQuizDraft | Lightweight slot edits, 20 changes/batch, title/settings no problem writes | Route new refs to Neon read OUTSIDE Firestore transaction; final version/role checks in Firestore; preserve old snapshot fallback |
| publishQuiz; listQuizRevisions; previewQuizRevision; duplicateQuiz | Pinned publication, immutable history, teacher preview/copy | New publish job sources tagged neon_revision with immutable hashes; old Firestore publish path remains for legacy until explicitly supported |
| startAttempt; getAttempt; getAttemptQuestions; saveAnswers; navigateAttempt | Server pinned revision, shuffle/frontier, no-back, deadline and retry receipts | Bundle-only new revisions read from trusted private Storage outside transaction; Firestore commit rechecks attempt version/frontier; old attempts unchanged |
| endActiveAttempt; grading worker; getAttemptResult/report/exports | Scores, protected keys, manual grading, release, history, exports | Server-only grading from pinned immutable key, Firestore lease/version compare-and-set; no Neon read on student path |
| getAssetLinks | Context-specific image authorization and short-lived image links | Resolve only authorized currently visible question and released-solution IDs; server never signs whole private bundle |
| existing activity/teacher/admin views | Firebase permissions and tests | Preserve existing semantics; optional Neon future-event relay remains OFF |

Observed mismatches to address (not yet implemented):
1. Current js/pages/quiz-editor.js calls importProblemBatch once per problem; handler and staged writer both allow 1–20 per batch.
2. Active Firestore import job keeps source in job.input.sourceAssetId; staged QN8 writer expects job.sourceAssetId. Build a trusted normalized job adapter, not a spread of client fields.
3. Active batch returns mappings and processed; staged QN8 returns mappings plus processedInBatch/newlyInserted. Present compatible client progress based on reconciled Firebase state, not just attempted SQL rows.
4. Active Firestore listProblems uses nextCursor and subject/difficulty filters; current Neon listProblemHeaders returns an internal next cursor and supports search/tag. Supply adapter parity, opaque signed/scoped cursors and stable sort.
5. Existing snapshotSource/sourceContent, getQuizDraftItems, getAssetLinks, publishQuiz, duplicateQuiz and worker paths dereference Firestore bank docs. New Neon refs require prefetch outside transaction plus verified immutable source hashes.
6. QN10 publisher expects a neon_revision source with contentHash, while today's publishQuiz writes Firestore problem/snapshot sources. Separate legacy vs new publisher paths; mixed legacy/new draft handling needs explicit tested policy.

## 4. Transaction protocol — mutation / import

This is a design contract, NOT executable code.

Stage F1 — FIRESTORE INTENT (short transaction):
- Verify Firebase callable auth and current Firestore role, account status, ownership, maintenance, expected version and job status. Reserve a deterministic request/operation ID and record an immutable payload fingerprint and approved scope/record keys in a private Firebase coordinator. Replays with same ID+different hash are errors. Do not call Neon here.
- For imports, persist expected total, item keys, source asset reference/generation/hash, input hash, job target and short admission lease/epoch. Keep job/draft invisible while incomplete. F1 is not a success receipt for the whole operation.
- Never persist grading keys in public coordinator fields or logs.

Stage N — NEON EFFECT (outside Firestore transactions):
- Revalidate actor and permitted assets using trusted server callbacks; run only bound SQL with the verified quizer_app restricted role and one atomic transaction for up to 20 items (also obey bounded request bytes and Firestore limits).
- Use (jobId, importItemKey, exact canonical payload hash) unique SQL receipts and deterministic IDs; unchanged replay returns identical mappings, mismatched payload rejects.
- For standalone create/edit, a **new durable request fingerprint / result receipt is required before enabling**. The current staged saveProblemRevision checks expectedVersion *before* replay and has no dedicated edit receipt: lost response after SQL commit would otherwise become VERSION_CONFLICT on same-request retry. Metadata-only saves need this protection too. Determine receipt schema in QN11.2; any SQL migration requires separate disposable-only approval.
- Database rows committed without final Firebase acknowledgement remain not-yet-visible to quiz/draft/catalog paths; no dangerous deletion or rewrite of immutable revisions.

Stage F2 — FIRESTORE FINALIZE (short transaction):
- Re-read intent, exact request hash, lease/fence, actor status, role/ownership and applicable quiz/draft/job versions. Validate the full returned SQL mapping against intended item keys and hashes. Compare-and-set progress/mappings/revision refs, job state and business audit; record completed operation receipt once.
- Never query Neon or Storage inside F2. If role, sharing, draft or job version changes, do not attach/activate invalid records. Keep a recoverable rejected/reconcile state with no student-visible partial quiz.
- Return the existing API DTO only after committed F2. Response loss after F2 must replay the stored result, not rerun effects.

Stage R — RECONCILIATION (trusted worker or explicit server retry):
- Enumerate incomplete Firebase intents and their bounded SQL receipts by stable keys. Classify missing SQL, committed SQL/no Firebase acknowledgement, Firebase acknowledged, conflicting hashes, stale lease, cancelled/import incomplete.
- Idempotently retry the absent side, repair only matching mappings under current permissions/versions or fail closed for manual resolution. Store stage, attempts, bounded errors and timestamps; never store secrets/answers; never delete historical quiz data to reconcile.
- Invariant: total processed counts equal the number of distinct acknowledged keys, not number of requests, retries or inserted rows.

Recommended private coordinator states (subject to QN11.2 schema review):
prepared -> neon_committed -> firebase_committed -> complete
prepared -> retryable_error -> prepared
neon_committed -> reconcile_required -> firebase_committed | quarantined
Any changed payload/invalid ownership -> quarantined (no public read).

Absolute atomicity across Firestore, PostgreSQL and Storage does NOT exist. A revocation crossing an external operation is a policy race: require a fresh server-side authorization proof before effect and an F2 recheck; define/test how sharing revocation between the SQL proof and Firebase finalization is handled. Do not claim global serializability.

## 5. Import / restart / upload exactness

- Batch contiguous importItemKey values, 1–20 items, but reduce count when request JSON approaches the existing 1.5 MB callable bound. 100 and 500 problem imports target 5/25 calls only when size limits allow. Never reimport on rename, points-only reorder/settings edit or publish.
- Do not rely on importState.done in current page memory. On reload, recover by trusted Firebase import job, durable item-key/hash ledger and SQL receipts. Client may cache resume UI but it must never be authority. The current getJob response provides progress only; extending an existing authorized action or a narrowly justified read projection requires explicit contract/test, not a second public bank API.
- Distinguish the selected original .tex bytes from edited/pasted/generated source, backup ZIP and JSON. Current editor constructs a File from textarea text, which may differ from original. Specify sourceFormat, exact bytes SHA-256, asset generation and provenance; original source uploaded **once per import job**, images also deduped by stable assets. Do not falsely label JSON/ZIP as original .tex.
- Job completion requires exactly the advertised unique item keys, server-verified source and asset refs, no unexpected mapping, and consistent counts/points/order. Bank-only jobs must not create quiz drafts. Incomplete drafts must not appear in public catalog.
- Cancellation/retry: cancellation cannot erase successful SQL immutable revisions, uploaded assets or historical quizzes. Mark unreferenced data for separately approved retention review; reconcile rather than destructively roll back.
- Enforce a bound on max concurrent chunks per job to avoid conflicting progress and double finalize. Same-item concurrent replay is safe via SQL receipts; different-item batches still need Firebase compare-and-set on aggregate progress.

## 6. Published revision and student read/grade protocol

- New publish starts from a Firebase-owned snapshot of draft order, 1–500 pinned revision IDs and canonical per-revision hashes; do not read mutable latest revisions after pinning.
- Trusted worker resolves all required protected Neon revisions OUTSIDE Firestore transactions; verifies pinned content and asset-retention rights, creates exactly one private canonical bundle per published revision (existing 24 MiB maximum), reads object back at exact generation and SHA, then atomically activates Firestore manifest/pointer after job lease/draft/version recheck. Already published revision and old attempt remain unchanged on any failure.
- New published students use verified Firebase identity/attempt ownership/frontier and server-side authorized 1–20 item slices, never a bundle URL. Fetch/revalidate bundle outside Firestore retry callback, then check attempt version/frontier/deadline again at answer/save/navigation commit. No new student-time Neon dependency.
- Grade worker reads the same pinned immutable keys outside transaction, final grading writes/lease state rechecked in Firestore. Never expose grading, future no-back items, unreleased solutions/rubrics or complete bundle bytes to students.
- Legacy Firestore frozen revisions continue on old reader/worker; older v1 results with missing pinned revision stay untouched. Mixed legacy and Neon sources must have an explicit publish resolution policy, tests and clean rollback before cutover.
- Optimize only after measured 10/100/500 problem concurrency, cold/warm bundle reads, memory, Storage egress and costs. Eight concurrent uncached readers of a full bundle are eight reads until proven otherwise. A bounded cache is a separately tested security/cost decision.

## 7. Failure / replay matrix required for QN11 implementation

| Injected failure | Must remain true | Recovery |
| --- | --- | --- |
| Firestore F1 fails | Zero SQL/Storage effect; old quiz intact | Retry same ID |
| Neon unavailable before commit | Intent pending; published student paths still work | Retry with backoff |
| SQL commits, response lost | Never double-create revisions/items; no duplicate progress | Read SQL receipt; finalize F2 |
| SQL same ID with changed hash | No mutation accepted | Conflict/quarantine |
| Standalone edit commits, response lost | No stale-version false conflict for identical replay | New durable edit receipt gate (currently missing) |
| Firebase F2 fails after SQL commit | No half-visible quiz; old publish unaffected | Reconcile by receipt |
| Role revoked/job cancelled/lease expires mid-flight | No unauthorized published or draft activation | Revalidate, quarantine stale effect |
| Concurrent import chunks overlap | Exactly-once mapping and unique aggregate counts | Compare-and-set progress/receipt |
| Source/image upload succeeded, browser reload | No duplicate source upload, no data loss | Recover asset refs/checksums from job |
| Private Storage object written, activation fails | Existing revision pointer and attempt preserved | Re-verify generation/hash; retry CAS |
| Bad/corrupt/wrong-generation private bundle | No question/key leak, no activation | Fail closed; preserve legacy |
| Neon outage during running student attempt | Existing student quiz/answers/grades still available | Bundle+Firestore-only route |
| Firestore outage during author mutation | No externally visible partial edit | Retry/reconcile |
| Legacy Firestore quiz, revision or unpinned v1 attempt | Same link/grades and permitted result | Old paths untouched |

Mandatory tests include role/ownership changes, 10/100/500 item imports, payload caps, edit no-op/metadata-only, restricted SQL role, read DTO equivalence, old vs new marker, duplicate requestId, 1–20 question slices, allowBack=false, release policies, actor/attempt frontier, lease races, missing/expired/corrupt assets, 200%-text UI, mobile browser save/retry. Use Firebase emulator and a **separately approved disposable Quizer PostgreSQL target** only; no production.

## 8. Small next milestones and non-goals

**QN11.1 (this change):** architecture/DTO/failure documentation ONLY. No source code modification, no new tests, no test-run claims, no connector to Mimo/Neon production.

**QN11.2 (NOT STARTED):** implement default-off trusted orchestration and server-only restricted SQL port/role/idempotent edit receipt handling; validate existing action envelope compatibility and transaction isolation in synthetic/fake-port tests first; an approved disposable SQL migration may be a separate required gate. Stop after CI and checkpoint, no deployment.

**QN11.3 (NOT STARTED):** bounded resumable import + durable reconciliation and browser reload tests.

**QN11.4 (NOT STARTED):** full problem-bank/draft legacy+Neon compatibility and protected asset routing.

**QN11.5 (NOT STARTED):** feature-disabled private publish+student/grade/asset/export wiring with legacy fallback.

**QN11.6 (NOT STARTED):** fault-injection and end-to-end acceptance; hand off to QN12-B UI and QN13-B final audit.

No feature flag enabled or cutover authorized by this document. Earlier passing QN12.2 CI run 41685852261 remains the tested source baseline; doc-only commits do not constitute fresh CI verification. This QN11.1 step MUST stop before QN11.2.
