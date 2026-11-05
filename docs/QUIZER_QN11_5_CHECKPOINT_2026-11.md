# Quizer QN11.5 — private publication, student path and server-side CAS integration checkpoint

Checkpoint date: 2026-11-04 (Asia/Baku; CI run UTC 2026-11-03)
Branch: `work/quizer-audit-optimization-2026-11`
Starting branch HEAD: `4591f4101f4cf02e739486d5032be43d567fde38`
Verified source/test HEAD: `5a9e3d6369b87c013793c3f7d3803110865e7636`
Scope: **QN11.5 ONLY**. No QN11.6 integration acceptance, rollout, merges or deployment.

## Decision

**COMPLETE for default-OFF development staging; NO GO for any live Firebase/Neon integration, public cutover or production release.** All staged pieces are present and the entire existing test-only branch CI passed; the live Firebase dispatcher and worker have NOT imported these modules.

## Implementation

1. **`functions/src/bundles/publish-writer.js`** passes its *trusted Firestore publication preflight* to the source resolver. The existing QN10 create-only, generation-pinned, SHA-verified private writer and manifest/lease activation semantics remain intact.
2. **`functions/src/bundles/pinned-neon-source.js`** (new) binds each publisher worker read to the exact immutable `(problemId,revisionId,contentHash)` in the verified plan. It loads the teacher from a trusted publication-role callback, rechecks Neon sharing/immutable grading, normalizes content, compares canonical hashes, and verifies both question and solution asset references **before** Storage write. Source/job/role cannot be provided by browser request JSON. Unknown/corrupt/revoked source fails closed.
3. **`functions/src/bundles/secure-attempt-service.js`** extends the existing QN10.3 protected reader with a `navigationPreview` operation. Server verifies the caller, deadline, active status, pinned revision and no-back frontier, then reads only the authorized question/answer (no grading or bundle URL). It returns an expected frontier + UI version for the subsequent Firestore commit.
4. **`functions/src/bundles/private-attempt-commits.js`** (new) provides *concrete, independently tested Firebase transaction callbacks* for answer save, navigation and leased grading batches. All Storage/Neon reads finish **before** entering short Firestore transactions. The transaction rechecks verified owner/role, active/deadline, pinned revision, answer/attempt/UI versions, exact item frontier, grade-job lease, gradeVersion and contiguous progress. Answer/navigation writes and their idempotent request receipts commit atomically; identical lost-ack requests can replay even after an attempt is subsequently submitted, but fresh writes cannot alter frozen attempts. Grading writes only protected per-item grades and progress, not exposed keys or a falsely final grade.
5. **`functions/src/bundles/private-start-export.js`** (new) verifies an independently authorized Firebase attempt preflight and reads the exact private Storage generation/hash before constructing a *keyless* item/option/point start plan for an injected Firestore commit. An internal, worker-only export-source operation likewise authorizes a persisted export job/lease, reads the protected pinned bundle, checks retained image assets and returns protected records only to the export worker. **The concrete secure `preflightStart`, `commitStart`, ZIP writer and job-finalization adapters are NOT yet provided; no claim that students can start private exams in the live application.**
6. **`functions/src/bundles/private-image-signer.js`** (new) signs only already-authorized, ready, generation-pinned image objects on strictly checked `assets/<uid>/<id>/image.<supported-ext>` paths for **two minutes**. It rejects source files, incomplete assets, private bundles, download tokens, duplicate IDs, and non-HTTPS URLs. It is applied only after the QN10 attempt-frontier/solution-release access check. The sign callback remains a trusted injected Firebase Storage implementation.
7. **`functions/src/bundles/private-integration.js`** (new) stages the existing callable API v2 action names: `startAttempt`, `getAttemptQuestions`, `saveAnswers`, `navigateAttempt`, `getAttemptResult`, `getTeacherAttempt`, `getAdminAttempt`, `getAssetLinks` (attempt/result contexts), plus worker-only `publishJob`, `gradeJobBatch`, `exportSource`. Strictly pin-routes old Firestore attempts to the existing code, never falls back to legacy on Storage or Neon errors, verifies staff/admin access, derives visible image item IDs from trusted Firebase attempts, validates receipt/lease proofs and refuses legacy grading in the new worker. **Retry attempts route by their original pinned revision**, even when the quiz now points at a private revision.
8. **`functions/src/bundles/private-staging-runtime.js`** (new) assembles QN10 private Storage, QN10 Firestore publisher+secure attempt reader, QN11.5 Neon pin resolver, Firebase CAS commits, private start/export, image signer and action bridge behind **one explicit `enabled=false` factory**. Owner and attempt provenance are resolved from server-verified Firebase Auth/Firestore documents. Any missing trusted callback blocks opt-in. The factory itself is **not registered or imported by the production worker/callable router**.
9. **Tests:** new `tests/unit/qn11-5-private-integration.test.mjs`, `tests/unit/qn11-5-staging-runtime.test.mjs`, `tests/integration/qn11-5-private-commits.test.mjs`, plus QN10.3 navigation regression extensions. Unit ports reject bogus actor/provenance, corrupt hashes, unsafe asset signatures, future/no-back questions, wrong release, mixed revision routes and unverifiable publication plans. Firebase emulator tests exercise genuine transaction durability for answer history/replay, revoked/expired actors, stale frontier, signed receipts after submission, and batch grade lease/progress.

## Security and preservation invariants

- The existing `functions/src/router.js`, `functions/src/index.js`, `functions/src/jobs/worker.js`, `functions/src/api/{attempts,quizzes,assets,reports}.js` remain the **authoritative deployed code**. No source-of-truth flip, feature-flag activation, public API change, copied answer keys, client database credentials or raw private Storage bundle signing.
- New published-revision Storage objects remain create-only, unlisted, unsigned and generation-pinned with SHA verification before the Firestore publication pointer is activated. Failed uploads, bad generation, stale lease, corrupt manifests, role revocations and historical frozen attempts cannot automatically change an older published revision.
- Existing Firestore quiz links, old published item/grading snapshots, old attempts (including retry-incorrect pins), prior grades and private author data are not rewritten. Unknown provenance fails closed.
- Student endpoints return bounded question slices; `secure-attempt-service` enforces release policy for scores and solutions. The bridge signs only image assets that the privileged reader has authorized; answer keys, future no-back questions, private bundles and original TeX source objects have no student download URLs.
- All external private Storage and future Neon I/O takes place outside Firestore retry callbacks. Current Firebase CAS ports enforce version/lease invariants at write time. Firebase/Neon/Storage remain **non-atomic across stores**, so QN11.6 needs reconciliation and outage tests.
- Student and teacher identity uses verified server Firebase Auth and current role/account records; no user-supplied owner, role, source-origin, job lease or grading material is trusted.

## CI verification

**FULL CI GREEN — all 3 jobs successful** on the source/test commit `5a9e3d6369b87c013793c3f7d3803110865e7636`:
[GitHub Actions run 41712832762](https://github.com/azmath25/quizer/actions/runs/41712832762).

- **309/309** Node unit regressions passed.
- **5/5** backend unit tests and static/frontend syntax checks passed.
- **48/48** Firebase emulator integration tests passed, including all seven QN11.5 CAS/lease/ack tests.
- **1/1** Firebase transport test passed.
- Headless Chromium QN12.1 mobile runner and QN12.2 author/editor layout checks passed at **320, 390, 430, 768, 844, 1024** CSS px and **390 px enlarged-text** simulation.
- Captured CI artifacts: [mobile runner](https://github.com/azmath25/quizer/actions/runs/41712832762/artifacts/13268556985), [responsive author](https://github.com/azmath25/quizer/actions/runs/41712832762/artifacts/13268491793).

CI proves synthetic/fake-Neon interfaces and Firebase emulator consistency; it does **NOT** prove actual Neon SQL privileges or round-trip latency, real Firebase cloud production behavior, physical iOS Safari/Android Chrome, real server billing or a complete deployed hybrid workflow.

## Critical blockers for QN11.6 / release

1. The factory is default OFF and the active Firebase router/worker **does not call** it. Wiring must be a separate fail-closed, opt-in change after all original action DTOs and receipt semantics are reconciled; never put external Storage/SQL into current `dispatch()` transaction callbacks.
2. The new private start method still requires concrete privileged Firebase `preflightStart` + `commitStart` ports with admission, authorized retry-incorrect, attempt-count/active-attempt CAS, ordering/shuffle, deadline and statistics. Current factory accepts these only as injection dependencies, not a production-ready implementation.
3. The private grade batch currently writes grades and job progress, but **does not** finalize totals, manual grades, release, notifications or statistics. Legacy worker remains authoritative for old attempts. The final secure worker job/grade coordinator, retries and grade completion are QN11.6.
4. Private quiz backup `exportSource` is an internal protected read contract; actual ZIP writer, export-job lease completion, retained images and link signing still require integration. Existing legacy export stays unchanged.
5. New image bridge handles **attempt/result** contexts; legacy source/upload contexts and QN11.4 Neon problem/draft image permissions must be connected carefully before any whole-router swap. QN11.4 remains separately default OFF.
6. Real restricted-role `quizer_app` PostgreSQL login, receipt DDL on approved disposable Quizer branch, trusted firebase/neon coordinator, source/asset rights checks and Cloud Storage integration must be rehearsed before active writes. No real Neon connection or migration occurred in QN11.5.
7. Read/latency/billing cost of private 100/500-question bundles and repeated image authorization scans is **unmeasured**. QN11.6 must exercise cold/warm Storage, concurrent users, 24 MiB byte caps, outages, lease clashes, cancellation, materialization, 10/100/500 imports and rollback, without exposing protected material.
8. QN12-B postintegration mobile/accessibility regressions and QN13-B final audit remain pending. Do not claim live student exam readiness from passing simulated Chromium and emulator checks.

## Stop statement

**QN11.5 complete as verified default-OFF staging. STOP before QN11.6.**
No merges, deployments, production migrations, old-log cleanup, Google Cloud changes, Mimo access or changes to `main`, `main-backup`, the experimental AI branch or the original `studio.html`.
