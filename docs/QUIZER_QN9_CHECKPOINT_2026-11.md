# Quizer QN9 checkpoint — preservation-first synthetic migration rehearsal

Date: 2026-11-03
Branch: work/quizer-audit-optimization-2026-11
Scope: **QN9 only.** No merge, deployment, production Firebase reads or writes, real user-data movement, Mimo changes or production migrations.

## Completed source and rehearsal work

1. **Read-only inventory and cryptographic manifest:** functions/src/neon/legacy-preservation.js detects missing draft slots, current/pinned published revisions and protected answer keys, historical content hash mismatches, missing asset metadata and invalid source references. It hashes every document path supplied in an explicitly sanitized snapshot. Older schemaVersion 1 quizzes and genuine legacy_client_v1 attempts with no pinned revision are preserved with warnings, not forged into a new format.
2. **Synthetic-only transactional migration rehearsal:** functions/src/neon/legacy-rehearsal.js is disabled by default. Its target gate requires the separate Quizer development project and a nondefault freshly approved disposable branch. It categorically refuses non-synthetic owner/problem IDs, any broken source manifest and a nonempty SQL destination. In one transaction it inserts original bank IDs, ownership, versions, tags, protected answer revisions, source asset IDs and hashes; reads every revision back before commit, with rollback on mismatch.
3. **Sanitized fixture/testing:** tests/fixtures/qn9-sanitized-legacy.mjs generates 1–500 problems with two immutable revisions, two old/current published snapshots, an old pinned student attempt, answers and grades, source/image asset metadata, catalog/participant/job records and a v1 quiz. tests/unit/qn9-preservation.test.mjs verifies completeness, 100/500 paths, no-op source preservation, missing key/asset/pointer/hash failures, legacy unpinned attempts, SQL collision refusal, simulated partial transaction failure and protected-data parity.
4. **Firebase emulator history/readability:** tests/integration/qn9-legacy-readability.test.mjs seeds ONLY synthetic emulator documents, calls existing getQuizDraft, previewQuizRevision and getAttemptResult, checks the old attempt stays pinned to the old answer key even after a newer revision exists, and compares historical update timestamps before and after reads. No Neon handler is activated.
5. **Real PostgreSQL 17 test:** created Quizer-dev child branch qn9-disposable-2026-11-03 (br-blue-forest-b951yld8) from empty Quizer dev main. Applied the exact 21-statement version-controlled QN3 migration in one transaction. Ran four statements from tests/sql/qn9_sanitized_migration_DISPOSABLE_ONLY.sql including its PostgreSQL assertion block. **Passed.** Readback: exactly one synthetic owner-owned problem, two original revision IDs, original version 2 and latest pointer, two expected answer keys, two SHA-256 hashes and original source-asset reference. Immutable old-revision UPDATE rejected. No activity events, published bundle mirrors or import receipts were added.
6. **Rollback and cleanup:** verified explicit disposable branch identity and parent; dropped its Quizer schema using the checked-in disposable-only rollback, rechecked schema=false, 0 tables, 0 revision triggers; deleted the disposable child branch. Rechecked Quizer dev main: no Quizer schema. Its only remaining branch is main. Existing Mimo project was not accessed for these tests.

## Exact parity evidence from the real SQL readback

| Field | Verified value |
| --- | --- |
| problemId | prb_synth_0 |
| Firebase-synthetic owner UID | teacher_synthetic |
| Revision IDs in numerical order | prv_0_1, prv_0_2 |
| latestRevisionId | prv_0_2 |
| problem version / revision count | 2 / 2 |
| Protected old/current accepted answers | 2 / 3 |
| Old revision hash | ff5a16276cbf6c9a9b6ed958ba1ab798a725c65d20b4d1b01dcd3ad579d3f53d |
| New revision hash | 9694675f1574c45378441f178d17e21dffdc9f5e5f058f651d07416b553df718 |
| Original source reference | ast_original_tex |

All IDs and values above are synthetic, not private user data.

## Verification limits and stop gate

- **No production inventory has been performed.** It is not possible to prove real historical quiz coverage without a later explicitly approved read-only backup/inventory with complete pagination and nested subcollections. No production Firebase credentials or user data were accessed.
- **Storage object bytes/ACLs were not audited**; synthetic metadata existence alone is insufficient to prove real image files are retained. This is a later cutover gate.
- QN9 SQL rehearsal uses a committed sanitized SQL fixture; the JS rehearsal adapter was verified through mock SQL unit tests, not connected to a live client. Cross-store live import, restricted LOGIN credentials, full answer-bank switchover and private published bundles are future milestones.
- Existing Firebase handlers, user quizzes, student sessions and grades were not modified. No historical audit-event backfill, deletion, cleanup or Neon mirroring occurred.
- **Stop before QN10.** No publishing bundle implementation was started.

See docs/QUIZER_QN9_PRESERVATION_MATRIX_2026-11.md for the full collection/asset/attempt preservation matrix.
