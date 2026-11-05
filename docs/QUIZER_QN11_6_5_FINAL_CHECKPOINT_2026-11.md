# Quizer QN11.6.5 — final development-stage integrated gateway checkpoint

Date: 2026-11-04 (Asia/Baku)
Repository: `azmath25/quizer`
Work branch: `work/quizer-audit-optimization-2026-11`
Last source/test commit verified: `2b1c7b4442ae7564bcdbb1013fb253638d61ed3d`
Verified CI: https://github.com/azmath25/quizer/actions/runs/41727248370

## Decision

**QN11.6.1–QN11.6.5 DEVELOPMENT STAGING COMPLETE.**
**GO** to a separately approved QN12-B *postintegration frontend/a11y audit* of the work branch.
**NO GO** for production release, public Neon-backed API activation, production migrations or deployment. Final QN13-B audit, approved real disposable staging, and an independently authorized monitored rollout remain necessary.

This is a staged, default-disabled integrated **code and emulator** checkpoint, NOT a claim that a complete live application was exercised against actual Neon, Firebase Cloud Functions and GCS.

## What has been added since QN11.6.3

1. **Durable bank Firestore coordinator**, `functions/src/neon/firebase-bank-coordinator.js`:
   - Implements concrete Firebase `prepare`, `recordEffect`, `finalize` receipt transactions for the verified teacher's bank mutation.
   - Bounded, request-ID-scoped immutable payload digest, 30–300s claim leases, UUID fencing, identical replay after lost ACK, collision rejection and actor-role/account checks. A stale holder cannot commit a later SQL effect, and a changed effect cannot replace an already acknowledged one.
   - Stores only bounded, non-sensitive metadata. Explicitly rejects grading/source answer keys, source LaTeX and nested protected fields from Firestore mutation receipts. Neon operations run **outside** Firebase retry transactions. PostgreSQL's separately staged immutable edit/import receipts remain the SQL-side authority for idempotent external writes.
2. **Strict combined action and worker gateway**, `functions/src/bundles/private-staged-gateway.js`:
   - Partitions the existing Firebase API v2 action names into bank, import, private published-quiz/student/grade/export and an **explicit allowlist** of unaffected legacy actions.
   - Does NOT catch Neon, Storage or Firebase exceptions and reroute them as legacy. Unknown or overlapping action names, invalid action envelope, unauthenticated calls and unsupported private job kinds fail closed. Private worker batch limits are checked before dispatch.
3. **Fully composed opt-in development factory**, `functions/src/bundles/private-full-staging.js`:
   - Wires QN11.4's bank compatibility router to the new concrete bank coordinator and QN11.3's durable import coordinator and QN11.2's SQL action gateway, alongside QN11.5–QN11.6.3 private runtime.
   - Requires independently trusted Neon reader/writer, verified Firebase actor and problem-origin callbacks, explicit legacy handlers/allowlist, and a nonblank server secret for signed bank cursors. All components are default **OFF**, require explicit trusted injection and are **unmounted**.
   - It is not imported by live `functions/src/router.js`, `functions/src/index.js` or `functions/src/jobs/worker.js`; old Firestore API behavior therefore remains authoritative.
4. **Read-only recovery audit composition**, `functions/src/bundles/private-recovery-audit.js`:
   - Uses a trusted owner-authorized Firebase snapshot transaction, then a separate Admin Storage inspection against an allowlisted protected bundle/ZIP path, bounded byte length, exact pinned generation and computed SHA-256. Only genuine 404 is treated as missing; authorization failures, network errors and corrupted data fail closed.
   - The inspector has no mutation, delete, list, overwrite, cleanup or promotion capability. `private-staging-runtime.js` exposes this through its disabled-by-default private runtime only.
5. **Cross-owner asset retention defense**, from QN11.6.4:
   - Shared images cannot be pinned through the staged publisher without a fresh, trusted permission check inside each Firebase retention transaction. Missing permission callbacks or revoked grants fail closed; same-owner assets still work.

## Verification of integrated code

**All three GitHub Actions CI jobs passed** on source/test SHA `2b1c7b4442ae7564bcdbb1013fb253638d61ed3d`, run [41727248370](https://github.com/azmath25/quizer/actions/runs/41727248370):

- **340/340 Node tests**, including 15 new QN11.6.4/5 tests of recovery classification and 10/100/500 bounds, explicit legacy/private/bank/import gateway routing, full staged factory composition and fail-closed behavior.
- **5/5 backend tests** and static validation.
- **88/88 Firebase emulator integration tests**, including 6 new QN11.6.4/5 tests for shared-image revocation and real Firestore bank receipt fencing: 12 simultaneous same-request claims, stale token, role revocation, lost ACK, changed payload and no protected grading in Firebase.
- **1/1 Firebase transport test**.
- Chromium QN12.1 mobile runner and QN12.2 responsive author/editor/import/bank UI checks at 320/390/430/768/844/1024 CSS px, including simulated enlarged text.

### Boundaries of verification

These tests exercise synthetic/fake Neon and Storage ports and the genuine **demo Firestore emulator**, not a real Neon SQL server, actual Cloud Run/Firebase production services, or real GCS bucket. Tests of 10/100/500 questions and 2,000 image IDs verify structural bounds, not cloud latency, invoice cost or large real-user throughput. Passing the CI suite is **not** permission to activate the new feature flag.

## Work remaining after QN11.6

### QN12-B — final integrated frontend review
Review mobile/tablet/desktop layouts, keyboard and screen-reader navigation, the previously reported flag-button resizing, snipping/Ask AI **only if separately included in scope**, question-loading and import performance, author/editor responsiveness and failure/retry UX. Browser CI is not a replacement for manual physical Safari/Android verification.

### QN13-B — independent final release-readiness audit
Review role/permission matrix; cross-owner sharing schema and revocation fences; Neon independent-project identity and restricted `quizer_app` grants; real SQL DDL/rollback proof on a **separately authorized disposable Quizer-only database**; actual Firebase/Neon/Storage end-to-end; backups, historical Firestore preservation, orphan ref/ZIP reconciliation and safe retention; 500-question data/throughput/cost; errors/quotas/alerts; staging/production feature flags, emergency rollback and operator go/no-go.

### Separately approved staging and deployment
A real staging environment must be explicitly approved, and production launch must receive a separate approval after QN13-B. No branch merge, protected-branch edit, live credential provisioning, migrations, production database connection, Google Cloud deployment, Mimo access, object deletion or feature activation occurred in this milestone. The experimental browser AI/snipping branch remains completely isolated.

## Final stop

**QN11.6 is closed as verified, disabled development staging. STOP before QN12-B or deployment.** Treat the activation and real-cloud acceptance gates as open, not implicitly waived. A real staging failure can reopen an integration defect despite successful emulator CI.
