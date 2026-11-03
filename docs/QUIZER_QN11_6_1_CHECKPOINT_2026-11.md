# Quizer QN11.6.1 — trusted Firebase private-attempt admission and atomic start

Checkpoint date: 2026-11-04 (Asia/Baku; GitHub Actions run on 2026-11-03 UTC)
Branch: `work/quizer-audit-optimization-2026-11`
QN11.5 starting branch HEAD: `17cf8749a69e5252d6f0afc7663da61a8fbe0d69`
Verified source/test commit: `51a5c6849a86a242d60604feba6a02e2121050e8`
Status: **QN11.6.1 COMPLETE as DEFAULT-OFF staged code. NO GO for live activation.**
Next gate: QN11.6.2 **not started**.

## Scope / implementation

- **`functions/src/bundles/private-attempt-start.js` (new)** supplies the missing *concrete, trusted* Firebase `preflightStart` and `commitStart` ports required by QN11.5. Preflight is a short read-only Firestore transaction using verified Firebase Auth + current role. Commit is one independent Firebase transaction after private Storage has supplied a valid pinned bundle; it never calls Storage or Neon from Firestore transaction retries. Both reuse the existing Quizer `admission` policy and existing legacy `attemptDTO`, `expire`, `participant`, and `updateStatistics` helpers rather than weakening legacy access rules.
- **Admission and concurrency:** the preflight and commit both enforce verified actor/account, published active quiz, approved/open visibility, opening/closing windows and max attempts + teacher-approved extras. Commit rechecks the participant and quiz versions, current private published revision/hash/generation, and *exact* selected item IDs, options, counts and points. Concurrent submissions cannot consume two attempts: the Firestore participant pointer and counter are authoritative and CAS-retried. Already active unexpired attempts are returned without an unnecessary private bundle download.
- **Frozen retry-incorrect:** only a final, score-released original attempt owned by the same student and quiz is eligible. The server reads the original source attempt and protected grade docs to select its incorrect/skipped items; it pins the **original** private revision, settings, grade version and item identities, not the quiz's newest publication. Commit independently rechecks all of this. A changed grade/revoked score release or stale source results in a denied start, not a switch to newer questions or legacy fallback.
- **Atomic persisted attempt:** creates the same server_v2-compatible attempt DTO and schema as legacy start: random question/option ordering when settings request it, pinned immutable revision, sourceAttemptId, deadline = min(duration, quiz closesAt), currentFrontier/UI state, answer/grade versions, totals and no exposed grading answers. In the same transaction it updates participant count/active pointer, per-revision statistics and audit. An expired active attempt is frozen and its grading job/statistics change is recorded **atomically** with a permitted replacement attempt (or the whole operation fails closed).
- **Idempotency / lost acknowledgement:** a stable caller start `requestId` is admitted through the existing staged API v2 action, and a private `operations/{uid}/requests/{requestId}` receipt with action+payload hash+attempt ID is written in the same transaction. Exact same-request replay recovers the original attempt **even after submission**, without new Storage work. Changed quiz/retry arguments under the same request ID fail. Fresh start requests cannot exceed attempt limits.
- **`functions/src/bundles/private-start-export.js` (updated)** forwards request IDs to the new preflight/commit ports, supports active/resumed start without a private Storage read, and passes the verified frozen source settings to the start plan for retry-incorrect attempts.
- **`functions/src/bundles/private-integration.js` (updated)** accepts the existing start action's optional trusted requestId; other existing action names and route behavior remain unchanged. Legacy attempts still follow their own frozen revision.
- **`functions/src/bundles/private-staging-runtime.js` (updated)** constructs the real Firebase preflight+commit adapters by default *inside its existing `enabled=true` factory*. It still permits paired trusted ports for synthetic tests and fails if only one override is supplied. The factory is **still default OFF and unmounted**; the original active Firebase callable/worker do not import it.
- **`tests/integration/qn11-6-1-private-start.test.mjs` (new)** adds **15 emulator test cases**: disabled factory; normal start and statistics; active resume; exact receipt replay after submission; concurrent double-start fencing; revoked roles and access; public/approval/open/limit/extra-attempt admission; stale quiz/participant versions and republish; deadlines; shuffle; original pinned retries and eligibility changes; expired-active replacement/grade job; a full synthetic private-bundle Storage → preflight → Firebase commit → replay; and fail-atomic Storage outages. All tests use the Firebase **demo emulator only** and synthetic protected bundle bytes, never live Firebase or Neon.

## Security / data preservation

1. No extra client endpoint, direct bundle download URL, answer key in student DTO, client SQL credential or new public database. Protected keys remain server-only in private bundle reads. No external Storage/Neon I/O in the Firestore transaction callback.
2. The independent actor identity, access/participant state and published revision/version are rechecked at commit time to prevent stale admission after revocation, closing or republishing. Server-side scores/grades are the only retry eligibility proof; no client-supplied incorrect-item list.
3. Start receipts are scoped to authenticated UID and stable request ID and store only a fingerprint and immutable attempt ID. Participant/quiz/attempt writes plus statistics/audit/expiry/job are atomic.
4. Existing Firestore quizzes, historical published revisions, grades and active attempts are preserved. The existing live `functions/src/router.js`, `functions/src/index.js`, `functions/src/api/attempts.js` handlers and `functions/src/jobs/worker.js` were **not modified**.
5. No real connection was made to Neon, Firestore production, Google Cloud or Mimo. No SQL schema or credential was changed, no migration or backfill, no branch merge, deployment, protected-branch edit or log cleanup.

## CI / checkpoint evidence

**FULL CI VERIFIED GREEN — 3/3 jobs passing**, [GitHub Actions run 41716208086](https://github.com/azmath25/quizer/actions/runs/41716208086), tested source HEAD `51a5c6849a86a242d60604feba6a02e2121050e8`:

- **309/309** Node unit tests and **5/5** backend unit tests, plus static/frontend validation.
- **63/63** Firebase emulator integration tests (15 added for QN11.6.1), and **1/1** Firebase transport test.
- QN12.1 Chromium mobile runner and QN12.2 author mobile/editor geometry at 320, 390, 430, 768, 844 and 1024 CSS px, plus 390 px simulated enlarged-text, all passed. CI screenshot artifacts: [mobile](https://github.com/azmath25/quizer/actions/runs/41716208086/artifacts/13271170038) and [author](https://github.com/azmath25/quizer/actions/runs/41716208086/artifacts/13269652936).

Initial CI found a first-response object-prototype mismatch in `optionOrder`; it was fixed to match Firestore's plain-object DTO. The final code and both full staged-bundle tests passed. These tests prove the demo Firestore emulator and synthetic private Storage path, **not real cloud deployment, physical iOS/Android devices or actual restricted SQL transactions**.

## Explicit remaining gates and stop

**QN11.6.2 not authorized in this step.** Next separately approved milestone is complete private grading finalization, manual grading and score/solution release policy with statistics/notifications, still default OFF.

Also still needed later: real export ZIP completion; all problem/draft image access contexts; end-to-end Firebase/Neon/Storage cross-store outage/reconciliation, real disposable Quizer restricted PostgreSQL migration/privileges *only on separate approval*; performance/cost validation for 10/100/500 questions; QN12-B postintegration mobile/accessibility; and QN13-B security/release audit. Existing source-of-truth remains Firebase until separate explicit release authorization.

**Stop after QN11.6.1. NO merges, deployments, live migrations, Mimo access, protected-branch changes or QN11.6.2 work.**
