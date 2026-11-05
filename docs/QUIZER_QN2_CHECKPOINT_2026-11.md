# Quizer QN2 — problem-save efficiency checkpoint

Date: 2026-11-03
Work branch: `work/quizer-audit-optimization-2026-11`
Scope: **QN2 only; no QN3 implementation, no merges or deployments.**
Reviewed the existing unmerged `feature/diff-only-quiz-and-problem-saves`; selectively adapted only its problem-saving logic.

## Changes

1. **Backend:** `functions/src/api/problems.js` now treats `saveProblemRevision` as three distinct operations:
   - Validated no-op: unchanged normalized metadata and same content hash, or unchanged metadata with omitted content/grading. Return the existing `revisionId` and `version`, `unchanged: true`; **no parent, content, grading, image-retention or audit writes**.
   - Metadata-only: accept `metadata` with no `content`/`grading`; update searchable parent fields/version only, audit `problem.metadata_updated`, keep the same `revisionId` and `revisionNumber`; **no content/grading/asset update**. A fully submitted unchanged content payload follows the same path when the content hash matches.
   - Content/answer/asset change: validate both content and grading together, retain only referenced assets and write exactly one *new immutable revision* and its grading record; leave previous revision untouched.
   - Reject a request supplying content without grading or vice versa. Preserve server-side owner, role, active-lifecycle and optimistic-version checks.
2. **Runtime:** `functions/src/domain/runtime.js` now skips idempotency receipt writes for genuine `saveProblemRevision` no-ops only, alongside the QN1 no-op draft exception. Other actions and changed problem saves keep normal receipts.
3. **Frontend:** Added pure `js/components/problem-save-diff.js` to omit unchanged question content, grading and image bindings from metadata-only updates.
   - `js/components/problem-form.js` stores a deep-cloned baseline, transmits metadata only when appropriate, and refreshes baseline after success. New problems still send full content.
   - `js/components/problem-tools.js` quick edit uses the same metadata-only payload logic and no longer increments a displayed revision number for metadata-only/no-op operations. Restoring a historical revision continues to send content and grading; its revision counter only increases when a new revision is created. The quick-edit button now reads "Save changes."
4. **Tests:** `tests/unit/problem-save-diff.test.mjs` has nine isolated cases for metadata-only, unchanged, new problems, statement/points, grading, images, tags and mutable choices. `tests/integration/qn2-problem-save.test.mjs` checks no-op receipts/audits, metadata-only root updates with preserved immutable docs, conflicts, malformed partial content, content/answer changes and version history using an emulator.

## Verification evidence (not overstated)

- Local Node 22 isolated test run of a byte-for-byte manually copied `problem-save-diff.js` and its nine matching committed unit tests: **9 passed, 0 failed, 0 skipped** (`node --test tests/unit/problem-save-diff.test.mjs`).
- Local `node --check` succeeded on the pure helper and its standalone unit test file.
- Example synthetic payload measurement: with one short arithmetic question, metadata-only JSON request **161 bytes** vs full request **458 bytes**, a **64.8%** reduction for that synthetic fixture. It is not a production bandwidth/latency measurement; actual savings depend on LaTeX/image metadata size.
- Re-fetched changed GitHub files and inspected the actual backend/front-end branches, no-op receipt guard and committed emulator assertions.
- **Not run:** Firebase emulator tests, full-repo unit/backend/transport suite, browser QA, `verify:static`, deployment preview or CI workflow. The container cannot resolve github.com for a full clone and does not contain the Firebase emulator dependencies. The existence of committed emulator tests is **not** proof they passed. CI statuses to be inspected separately.
- No live Firestore writes or source data migrations were made.

## Important limits / risks

- The metadata-only path avoids reading the previous content/grading Firestore revision entirely; it still reads the problem parent and verifies authorization/version.
- Content comparison for fully supplied saves uses the previously stored `contentHash`; unexpected legacy revisions lacking that hash conservatively follow the content-write path until a later audited migration strategy.
- New content revision creation **reuses** previous image asset IDs through retain/references; it does not upload image bytes again as part of this save call.
- Need emulator verification of Firestore update timestamps, audit expectations, ownership/version conflicts and historical revision immutability before release.
- No Neon adapter, SQL schema, new problem API endpoint, source-TeX bundle design, quiz publish changes, database provisioning or live file deletion in QN2.
- QN12 dedicated frontend review and QN13 overall-system verification remain in the roadmap.

## Gate

QN2 code/tests committed to the designated work branch; **stop before QN3**.
QN3 (separate Quizer Neon schema and trusted adapter contracts, repo-only synthetic fixtures) is the next authorization gate. No branch merge, deployment, production schema write, Mimo project change or destructive log cleanup was performed.
