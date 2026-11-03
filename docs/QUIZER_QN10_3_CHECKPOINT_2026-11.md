# Quizer QN10.3 — secure private bundle attempt checkpoint

Date: 2026-11-03
Work branch: work/quizer-audit-optimization-2026-11
Scope: QN10.3 ONLY. Stop before QN11. No merges, deployments, live cloud changes, production migrations, historical cleanup or Mimo modifications.

## Implemented

1. functions/src/bundles/secure-attempt-service.js: separate DEFAULT-OFF server-only service for authenticated question slices, answer validation prechecks, released result pages, trusted grading batches and permitted image IDs.
2. functions/src/bundles/firestore-attempt-service.js: separate DEFAULT-OFF trusted Firebase Admin adapter. It resolves actor identity from verified callable auth + Firestore role records, loads persisted attempt and exact pinned published revision, checks a live grading-job lease, and reads Storage objects using the QN10.2 exact-generation private port.
3. Historical published revisions without a bundle manifest continue to use original Firebase /items and protected /grading Firestore documents. There are no student-time Neon reads.
4. The existing public callable router, active attempt start/navigation/answer-save handlers and grade worker are NOT changed or switched.

## Security rules

- Question reads require verified caller authorization by attempt student UID or staff quiz owner/admin; active and unexpired attempt; 1–20 unique item IDs contained in the attempt-pinned revision. The existing allowBack=false currentFrontier rule is enforced BEFORE any private Storage read.
- Student question results include only the existing studentItem fields and previously saved answer, never grading keys, rubric, solution-image IDs, full bundle bytes or its object URL. Total response is bounded to 1,000,000 bytes; a single oversized question is rejected.
- Answer precheck accepts only actual student requests for valid frontier/choice IDs and existing input length limits (20 changes, 256 KiB). This does NOT persist responses: final transaction-time version/frontier checks remain mandatory at QN11 cutover.
- Grading requires a persisted authorized running grade_attempt job, matching target/lease, non-active attempt and gradeVersion 0. It grades 1–20 items using the existing gradeSnapshotAnswer against the PINNED key. Return data contains grades, not answers/solution keys. Grade writes and finish state require transaction-time lease rechecks during QN11 integration.
- Result pages match existing score-release and solution-release semantics, including never/manual/afterClose and staff-only rubric. Images are authorized only for visible question content; solution assets only after proper release or staff authorization.
- For manifests, readPrivatePublishedBundle validates SHA-256, canonical JSON, exact generation, object size, content type, item count and ordered revision IDs before service delivery. Full bundle download links remain prohibited.

## Regression coverage

- tests/unit/qn10-3-secure-reader.test.mjs: 19 targeted unit scenarios covering default-off, denied alien users, deleted/locked future questions, expired attempts, choice and answer limits, manual/never release, teacher rubric, protected images, grader lease, no old key leakage, historical Firestore fallback and corrupt manifest rejection.
- The unit suite also benchmarks 100/500-item authorized 20-question slices, plus eight concurrent 500-question synthetic pages, recording elapsed local processing time and bytes per read. It is NOT a production latency or billing measurement.
- tests/integration/qn10-3-private-attempt.test.mjs: five Firebase Auth/Firestore/Storage emulator scenarios exercise real private object creation, pinned student current/locked items, graded old Firestore results, live grading-job auth, manual/never result restrictions and expired deadlines.
- VERIFIED GREEN CI: GitHub Actions run 41657878729, on final QN10.3 code commit 235fd85308b9e49ee1520c8557879e0d86d84d8b (https://github.com/azmath25/quizer/actions/runs/41657878729). Both jobs passed: 214/214 Node unit tests, 5/5 backend tests, static frontend verification and Firebase emulator integration/transport suites. The QN10.3 emulator tests exercised real Firebase Auth/Firestore and private Admin Storage with synthetic data only. Documentation-only follow-ups do not change tested code.
- The CI unit-test diagnostic measured **146.04 ms** local wall-clock for eight simultaneous 20-question slices over a **500-item, 210,690-byte** canonical bundle, with eight full-buffer reads. That is **1,685,520 bytes (approx. 1.61 MiB)** of logical payload, without cloud-network/billing measurements. Treat timing as an illustrative CI-run sample only, not a performance guarantee.

## Explicit remaining integration gates

1. The secure bundle service is NOT installed in active Firebase calls. Old Firestore snapshot delivery/attempts remain authoritative. QN11 must connect startAttempt, navigation, answer-save transaction, grading job persistence/finish, asset links, teacher reports and retries to the new data model WITHOUT any Storage or Neon IO inside Firestore retry callbacks.
2. Before enabling, QN11 needs restricted Neon LOGIN credentials and source reader, asset-reference retention, and cross-store reconciliation; QN12 and QN13 need browser and production-like performance/security/outage coverage.
3. The service currently fully decodes a bounded 24 MiB private bundle for each uncached request. Eight concurrent requests imply eight full object reads. Safe bounded caching or an alternative compressed format requires separate measured evaluation, never guesses.
4. Existing v1 results without a pinned revision are preserved unchanged and continue via existing legacy routes. No revision IDs, student grades or old images have been rewritten.
5. No live Firebase/Neon reads or writes, no Mimo changes, no deployments, no merges and no QN11 work.

STOP before QN11.
