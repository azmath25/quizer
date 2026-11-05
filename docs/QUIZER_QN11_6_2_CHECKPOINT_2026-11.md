# Quizer QN11.6.2 — trusted private grading finalization, manual marking, result release

Checkpoint date: 2026-11-04 (Asia/Baku; GitHub CI run on 2026-11-03 UTC)
Repository/branch: `azmath25/quizer` / `work/quizer-audit-optimization-2026-11`
Source+test commit verified by CI: `5045a245e4b35998d2b200f9c4f8a91df46d1b04`
Scope: **QN11.6.2 ONLY. STOP before QN11.6.3.**
Status: **COMPLETE as default-OFF, unmerged staged implementation. No production activation approval.**

## Implemented components

1. **`functions/src/bundles/private-grade-finalization.js` (new)** — trusted Firebase transaction adapters:
   - `finalizeGradeJob` completes grading only for a frozen, pinned attempt with a running `grade_attempt` job, unexpired matching lease, `gradeVersion=0`, matching grading job ID and 100% processed order. It reads all private grade *records* from Firestore, verifies exactly one grade per item and the frozen points total, computes `summarize`, then **atomically** updates attempt totals, `gradeState` (pending_manual/final), gradeVersion/finalizedAt, aggregate statistics, job success/lease clearance, audit and exactly-once teacher/student notifications. A completed job returns its prior result without duplicate effects. Missing/extra grades, wrong pin, incomplete job and expired/foreign lease fail closed.
   - `saveManualGrade` commits a teacher/admin-only manual mark after a trusted private-bundle rubric preflight. It rechecks current role/owner, gradeVersion, the attempt's immutable revision/item ID, original grade status/version/hash, saved answer hash, points, correction reason and current manual-eligibility state inside Firestore. Atomic grade replacement, per-question grade event with reason, totals, gradeVersion/state, statistics, audit, student notification and immutable request receipt. It preserves the legacy incorrect-answer penalty when a manual zero-point answer is marked incorrect.
   - `completedManualGrade` returns an identical committed request receipt after authorization without rerunning private-bundle preflight; avoids spurious gradeVersion conflicts on lost acknowledgments even if another correction has subsequently happened. Changed-payload collisions fail.
   - `releaseResults` requires a current owner/admin, up to 25 distinct attempts from the same quiz, frozen **final** grades and compatible score/solution-release policies. Explicit release of either `never` policy is refused. Valid changes and audit/notification writes are atomic; repeated identical releases do not send duplicate notifications. An invalid attempt prevents all writes.
2. **`functions/src/bundles/secure-attempt-service.js` (updated)** — `previewManualGrade`: staff-only private Storage/legacy-source resolution **outside Firestore retry transactions**, validates the pinned manual-answer mode, saved nonblank response, gradeVersion and correction reason; computes `gradeSnapshotAnswer` using protected key but returns only a narrow signed-by-server *internal* proof (grade, answer hash, prior grade hash/version, pin and actor), **not** the protected key, solution or rubric. The existing student question/result paths and source-release rules remain unchanged.
3. **`functions/src/bundles/private-integration.js` (updated)** — stages existing callable v2 `saveManualGrade` and `releaseResults` action names plus trusted-worker `finalizeGradeJob`. Requires current verified Firebase actor, explicit private or historical Firestore source provenance, replay-safe request IDs and staff/owner permissions. For all-legacy release requests, delegates to the existing Firestore handler; mixed historical/private batches fail closed instead of partially mutating. Only private frozen attempts may use the new grading worker completion. Manual receipt lookup precedes protected key preflight.
4. **`functions/src/bundles/private-staging-runtime.js` (updated)** — registers the concrete Firestore finalization port within the **existing `enabled=true` factory only**. This factory is **default OFF** and is NOT imported into the live `functions/src/router.js`, `functions/src/index.js`, or `functions/src/jobs/worker.js`. Existing active Firestore actions remain authoritative.
5. **Tests**:
   - `tests/integration/qn11-6-2-private-grading.test.mjs`: 12 genuine demo-Firebase-emulator transaction scenarios: pending/final totals, job completion/notification idempotence, stale/missing grade/lease/active attempts, manual grade changes, audit/events and statistics, rejected student/revoked teacher, changed saved answer, correction reason and version race, never policies and mixed-quiz rollback, retry-incorrect statistics exemption, and negative penalty preservation.
   - `tests/unit/qn11-6-2-manual-preflight.test.mjs`: 3 protected source/rubric tests for no-key disclosure, private staff-only grading, invalid automatic questions, changed grade state, missing answer and correction reason.
   - `tests/unit/qn11-5-private-integration.test.mjs`: added staged manual/release/worker source-routing and replay gates to existing tests.

## Invariants and release limitations

- **No private grading keys in Firestore write callbacks or client-visible results.** The private Storage object is fetched and authenticated by server-only code before the Firestore transaction. Protected keys and solutions remain in the immutable private bundle.
- The private finalizer only operates on verified immutable pinned revisions, frozen attempts and valid grading leases. It never silently reads or rewrites historical Firestore grades. Once-only grading notifications are part of the same transaction as the grade state change; Firestore transaction retries cannot duplicate them.
- The published scoring policies `immediate`, `afterClose`, `manual` and `never` continue to be interpreted by the existing `released()` reader. Explicit teacher release requires completed grading and respects `never`. Manual corrections are auditable and follow existing gradeSnapshotAnswer scoring.
- **Real worker wiring remains separate and default-OFF.** The original deployed Firebase grading worker, router and report APIs were NOT modified. No production grading execution, Neon connection, actual private Cloud Storage read, physical phone test, SQL role provisioning or migration has been performed.
- QN11.6.3 is a separate required milestone for full asset/ZIP export routing; QN11.6.4–5 cross-store failure/performance/reconciliation, QN12-B postintegration accessibility and QN13-B final security/release audit all remain pending.
- The complete action DTO and external adapter composition still require the full default-off integration test/cutover reviews. Passing emulator and injected-port tests is NOT a production readiness claim.
- Mimo, `studio.html`, `main`, `main-backup`, independent AI snipping branch, Google Cloud, Firebase production, real Neon databases, historical attempts and private storage were **not changed**. No merge, deployment, migration, backfill or cleanup.

## Full CI verification

**ALL THREE TEST-ONLY JOBS GREEN** — [GitHub Actions run 41719750860](https://github.com/azmath25/quizer/actions/runs/41719750860), source/test head `5045a245e4b35998d2b200f9c4f8a91df46d1b04`:

- **314/314 Node unit tests**, including QN11.6.2 private manual preflight/route contract.
- **5/5 backend unit tests**, static checks.
- **75/75 Firebase emulator integration tests**, including 12 QN11.6.2 grade/release/failure tests; **1/1 Firebase transport test**.
- Headless Chromium QN12.1 student mobile runner + QN12.2 author/editor responsive QA (320/390/430/768/844/1024 CSS px and 390 px enlarged-text simulation) passed.
- These are **synthetic private-bundle/SQL mock + genuine demo Firebase emulator and Chromium** validations only.

Test corrections before green: a synthetic automatic-answer fixture required an accepted answer; forged student grading proofs correctly fail early; and a manual zero-point mark must retain the configured negative penalty. All were addressed before the final passing CI run.

## Exit gate

**QN11.6.2 staged implementation finished, all CI passed. STOP before QN11.6.3.**
Do not activate any private integration flags, merge, deploy, run production/disposable SQL migrations without independent authorization, touch Mimo or protected branches, or start QN11.6.3 without a new explicit user approval.
