# Quizer PROD1 — M1 publication gateway checkpoint

Date: 2026-11-04
Branch: `work/quizer-audit-optimization-2026-11`
Scope: trusted publication planning for Neon-only quizzes, **not production activation**.

## Implemented

- `functions/src/prod1/publication-gateway.js` now detects a committed
  `publishQuiz` request receipt *before* reading a draft or contacting Neon.
  A retry after the quiz enters the publishing state returns the original
  job/revision pair; a conflicting action or request body cannot reuse a
  receipt. The replay also verifies the job's persisted owner, quiz and
  revision identity in Firebase.
- Source reads remain anchored to an immutable exact problem-revision ID.
  Unknown source types and mixed Firestore/Neon quizzes fail closed. The
  existing all-Firestore path stays untouched.
- Neon publication preflight reads run in bounded groups of **eight**, with
  original ordering preserved. Asset verification must return explicit true.
  No SQL or Storage request is placed inside a Firestore transaction.
- The queued private publication job, revision metadata, quiz publishing
  pointer, request receipt, and actor audit event commit in the **same**
  Firestore transaction.
- A newly added `tests/unit/prod1-publication-gateway.test.mjs` exercises
  pinned metadata (no answer keys stored in job), fast-path idempotency,
  cross-action receipt collision, stale versions, disabled roles, invalid
  content hashes, rejected assets, legacy-only fallback, mixed-source
  rejection and concurrent ordered preflight.

## Verification

GitHub Actions:
`https://github.com/azmath25/quizer/actions/runs/41835416908`

The Unit + backend + static CI job passed after the final source/test commit
`82c946eb07cf26b0390ef07f3bf09cda7dd4eaba`.
Check the linked run for emulator and Chromium job conclusions.

The staging gateway is **not imported by**
`functions/src/index.js`. There was no merge, database mutation,
Firebase deployment, worker activation, Google Cloud update, or Mimo change
in this milestone. The existing GitHub Pages Actions auto-build is a
repository policy outside the new backend gateway, not evidence of backend
activation.

## Remaining critical gaps (M2 and later)

1. **M2 — Private publish worker:** route `bundleMode=private_bundle_v1`
   to the existing isolated publisher, retain strict lease fencing and keep
   legacy publication jobs on the old worker. Add crash/retry tests.
2. **M3 — Mixed-source publication:** safely preserve pinned Firestore
   revisions when a quiz also contains Neon sources; maintain old attempt
   compatibility and reject unsupported grants.
3. **M4 — Full draft/import compatibility:** finish unmounted hybrid handlers
   and cross-store reconciliation for editing, import, image retention.
4. **M5 — Guarded deployment wiring:** bind secrets and feature switches in
   Functions only after controlled integration tests and owner approval.
5. **M6 — Cloud acceptance:** real Firebase/Neon/Storage/Auth checks, IAM,
   recovery, cost and mobile performance.

**Decision: GO for M2 development; NO GO for backend production activation.**
