# Quizer QN9 — historical preservation matrix and release boundary

Date: 2026-11-03
Work branch: work/quizer-audit-optimization-2026-11

**Scope:** repository behavior and sanitized synthetic data only. This is NOT an inventory of actual user/production Firebase records. No real quiz, personal data, exam answer, or production image was read, copied, modified or deleted.

## 1. Authoritative Firebase document paths

| Legacy category | Firebase source path and preservation rule | Neon QN9 action |
| --- | --- | --- |
| Quiz identity/access | quizzes/{quizId}: owner, published/last revision pointer, lifecycle, access, visibility, links | **Keep original unchanged** |
| Working draft | quizzes/{quizId}/drafts/current; draftItems/{itemId}: ordered references, version, points, retained snapshot fallback | **Keep unchanged**, future Neon bank references only after QN11 |
| Published revisions | quizzes/{quizId}/revisions/{revisionId} and /items/{itemId}, /grading/{itemId} | **Keep every historical item and protected answer key unchanged** |
| Problem bank | problems/{problemId}, /revisions/{revisionId}, /grading/main | Synthetic rehearsal copies original problem/revision **IDs**, ownership, versions, answer content, creation time and hashes to Neon |
| Source TeX and images | assets/{assetId}, assets/{assetId}/refs/{referenceHash}, bytes in Firebase Storage | **No byte copy to Neon.** Preserve asset IDs and source provenance in Neon revisions. Storage object/ACL verification is a later gate |
| Attempts/answer history | attempts/{attemptId}, /answers/{itemId}, /answers/{itemId}/changes/{changeId}, /grades/{itemId}, legacyAnswers | **Remain Firebase-only**; preserve pinned quiz revision and old answer/grade bytes |
| Older v1 source and results | quizzes/{id}/content/main, earlier users/{uid}/attempts/{id}, imported results with provenance=legacy_client_v1, sometimes quizRevisionId=null | **Preserve as is**, warn on legitimate unpinned v1 attempt; do not create fake revision ID |
| Permissions | quizzes/{id}/participants, joinLinks, roles, user records and approvals | Remain Firebase; do not silently change visibility |
| Catalog/job records | catalog/{quizId}, jobs/{jobId}, operation receipts, usage/quotas | Remain Firebase, including interrupted imports and recovery state |
| Prior audit logs | auditEvents, test logs; optional pending activityOutbox | No backfill, no cleanup or deletion; QN5/6 new-event relay stays off |

**Important:** An old quiz or active attempt can legitimately reference a *frozen published snapshot* even when a problem is no longer shared or has been trashed. Never treat a missing live bank record as permission to delete or rewrite a published item. Current student attempt/grade paths do not depend on Neon.

## 2. Rehearsal contract

- **functions/src/neon/legacy-preservation.js**: pure, read-only manifest builder accepting an **explicit, sanitized, complete document map**. Detects missing draft/quiz/attempt references, missing published protected grading, broken content hashes and asset metadata; maintains a SHA-256 hash of every provided document path.
- **functions/src/neon/legacy-rehearsal.js**: default-OFF, **synthetic-only**, all-or-nothing transaction adapter; refuses the Mimo/default branch, incomplete inventory, a nonempty destination or non-synthetic owner/problem IDs. Readback before commit compares protected content, grading, source reference, ownership, revision IDs and version numbers. No Firebase write path or connection credentials.
- **tests/fixtures/qn9-sanitized-legacy.mjs**: synthetic one-to-500-problem fixture with two revisions per problem, two frozen published quiz revisions, a student attempt pinned to the old revision, answered/graded result, source file and image asset records and an older v1 quiz record.
- **tests/unit/qn9-preservation.test.mjs**: complete/preserved inventory, 100/500 coverage, missing pointer/key/asset/hash fail-closed cases, v1-without-revision exception, readback mismatch, partial transaction rollback, refusal of unsafe SQL target and unchanged source checks.
- **tests/integration/qn9-legacy-readability.test.mjs**: Firebase emulator-only test calls actual getQuizDraft, previewQuizRevision and getAttemptResult handlers; confirms old and latest grading differ as expected, old student result remains pinned and historical Firestore update timestamps do not change.
- **tests/sql/qn9_sanitized_migration_DISPOSABLE_ONLY.sql**: exact sanitized historical problem with two revisions and immutable grading hashes, tested against real PostgreSQL 17 on the temporary Quizer child branch.

## 3. Boundaries and unresolved release gates

1. **Actual historical count is unknown.** QN9 deliberately did not scan production Firebase or export user data. A future explicitly authorized *read-only*, paginated production inventory must enumerate every collection/document and nested subcollection, compare counts, surface orphan/legacy documents and verify original hashes against a signed snapshot before migrating real problems.
2. Firebase Storage objects must be validated for existence, retention, owner permissions, MIME type and reference paths by a privileged backend audit. **Metadata alone cannot prove an image file is present**.
3. Older v1 documents may use null quizRevisionId and legacyAnswers. They are kept untouched with an explicit warning; silently synthesizing a pinned revision or answers would be incorrect.
4. QN9 does not attempt any real-user migration. The synthetic-only rehearsal module refuses real IDs. No production export, snapshot or historical grade is in the GitHub repository.
5. QN10 must implement one private published Storage bundle per immutable published revision, ensuring historical and future students can read pinned old revisions without exposing answer keys.
6. QN11 must implement cross-store reconciliation, resumable 20-item imports, old/new bank reference routing, asset-retention checks and restrictive-login Neon credentials. No active handler switch is authorized by this rehearsal.
7. Release gate: back up and restore-test complete Firebase collections, link tokens, old quiz revisions, attempts/grades/assets and verify signed checksums in a *separately authorized* staging review before any real cutover.

QN9 performs **no Neon archive mirroring, no user-quiz data migration and no production cleanup**. The only SQL writes were the isolated disposable Quizer-dev child branch, subsequently rolled back and deleted. Original Quizer dev main and the separate Mimo project remain unchanged.
