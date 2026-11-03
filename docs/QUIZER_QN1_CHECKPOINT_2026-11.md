# Quizer QN1 checkpoint — diff-only draft saving

Date: 2026-11-03
Scope: **QN1 only**, on `work/quizer-audit-optimization-2026-11`.
Status: **implementation and isolated helper tests completed; full repository/emulator verification pending**.
The unrelated unmerged `feature/diff-only-quiz-and-problem-saves` branch was inspected, **not merged**.

## Changes

- `js/pages/quiz-save-diff.js`: pure helpers detect changed title/description/subject/difficulty, individual settings and order; identify changed slots in linear time using a Map/Set.
- `js/pages/quiz-editor.js`: send up to 20 changed slot records per request as before, but send no final save request for unchanged drafts, and send only actual field/order changes when required. Unchanged Save is handled locally. No TeX parsing, source reupload, import, Neon query or publish job is invoked in this save handler.
- `functions/src/api/quizzes.js`: validate request/version/order, then return `unchanged: true` without updating the quiz, draft or creating an audit event when nothing changed. Audit `changedFields` now reports slots and order only when changed.
- `functions/src/domain/runtime.js`: suppress the generic idempotency receipt **only** for `saveQuizDraft` when it returns `unchanged: true`. Otherwise a no-op still produced a Firestore write. All other actions and changed saves keep the receipt behavior.
- `tests/unit/quiz-save-diff.test.mjs`: 100/500-question title-only, settings-only, unchanged, one-point, one-revision and ordering regressions, plus a source check ensuring the save handler has no import/upload/publish actions.
- `tests/integration/qn1-draft-save.test.mjs`: Firebase emulator test seeds 100 and 500 draft item slots and checks no-op versions, zero receipt/audit writes and unchanged update timestamps; rename/settings do not touch problem slots; a points-only change touches exactly one slot; no publication is created.

## Verification performed

- **Local, standalone Node 22 unit helper tests:** 9 passed, 0 failed; 1 editor-source check skipped because the runtime cannot clone the repository or access its full source tree.
- **Measured synthesized title-only request payload:** 74 UTF-8 JSON bytes for both 100 and 500 questions, using the same synthetic ID/title fixtures. This is a local payload-size measurement, **not** a measured browser/network trace.
- **Committed GitHub source read-back:** verified the modified editor, helper, backend no-op return, targeted receipt skip, and both test files exist with the intended code patterns.
- **GitHub commit status:** no reported commit-status checks on the branch head at the time of inspection (`statuses: []`). **This is NOT a CI pass**.
- **Not run:** Firebase emulator/backend integration suite, full `npm test`, `npm run test:backend`, `npm run verify:static`, browser QA. The isolated container cannot resolve github.com to clone the repository, and Firebase SDK/CLI dependencies are not installed locally. No fresh end-to-end or latency measurements are claimed.
- To verify later from a full local checkout: `npm ci`, `npm --prefix functions ci`, `npm test`, `npm run test:backend`, `npm run test:integration`, `npm run verify:static`; also test actual mobile editor save behaviors before approval for release.

## Security/integrity and limits

- Version conflict checks, quiz ownership, publishing-state restrictions and 20-slot batch limits remain in the existing backend path.
- Neither the original TeX nor image assets are reuploaded by the ordinary edit save; publication continues to be an explicit separate operation.
- No new Neon integration or database schema, API, storage migration, removal of existing quiz revisions, or changes to `functions/src/api/problems.js` were made. The proposed one-file private published bundle is **later QN10**, not QN1.
- No-op saves do not get a request receipt; they carry no writes, and unchanged version validation remains enforced. A repeated no-op request after a concurrent edit will correctly require revalidation rather than reuse a persisted receipt.
- Backend emulator tests must still confirm Firestore update-time and audit expectations; unit assertions alone do not prove server behavior.
- Existing Firebase per-question revisions and current quiz content remain unchanged.

## Later-stage roadmap additions

- **QN12:** dedicated mobile-first frontend improvement/UX audit: import and edit flows, responsiveness, accessible controls, progress, loading/error states, and browser regression tests.
- **QN13:** full-system verification and release-readiness audit (unit, emulator, transport, auth, import/publish/attempt/grading, legacy preservation, costs and rollback).
- Neither later milestone was implemented in QN1.

## Gate and next decision

**Stop here, before QN2.** QN1 is committed for review, but full emulator/CI results remain open. Do not merge, deploy, create a Neon project, run a production migration, change cloud settings or delete logs. QN2 (efficient problem revisions) requires a new explicit instruction.
