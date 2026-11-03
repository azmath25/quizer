# Quizer QN13-B — Final system-wide release-readiness audit

**Audit date:** 2026-11-04 (Asia/Baku)  
**Repository:** `azmath25/quizer`  
**Audit branch:** `work/quizer-audit-optimization-2026-11`  
**Starting work-branch HEAD:** `fcf13c8150d5598d255e38c0c3ba145958bdccf8`  
**Source + release-boundary test commit:** `f036223bba5692ef10923791c87279edf4b01e2c`  
**CI:** [GitHub Actions run 41733119542](https://github.com/azmath25/quizer/actions/runs/41733119542)  
**Scope:** source, tests, emulator/browser evidence and repository configuration **only**. No real Neon, Firebase Cloud Functions, GCS, billing account, user data or Mimo systems were accessed or changed.

## Executive decision

**QN13-B audit completed at source/test level.**

- **CONDITIONAL GO — plan a separately authorized, isolated Quizer staging rehearsal.** This authorizes *only planning* for the next approval gate, **not** provisioning, migration, merge, or deployment in this milestone.
- **NO GO — production merge/deployment or Neon feature-flag activation.** A green development CI run cannot establish real Firebase–Neon–GCS interoperability, least-privilege database grants, controlled cost or backup and rollback readiness.
- The previous legacy Firestore application remains authoritative. The new QN11 default-OFF staged gateway, private runtime, bank/import coordinator and recovery auditor are **not imported** by the active `functions/src/index.js`, `router.js` or `jobs/worker.js`.
- **No P0 breach was established in the tested, currently active code** from this source inspection. This does **not** mean the yet-unmounted hybrid runtime is safe to activate; several P0 release gates remain unproven.

## Evidence and explicit coverage

| Area | What source/tests support | Final status |
| --- | --- | --- |
| Legacy functionality | Existing Firebase-backed quiz, editor, author, grading and image paths covered by unit, emulator and Chromium checks; unchanged live entrypoints | PASS in test environment; real deployment parity not verified |
| Private question/answer confidentiality | `firebase/storage.rules` denies client read/write of private published bundles and catch-all storage paths; `firestore.rules` denies client writes outside privileged server flow; student question DTOs are keyless in staged tests | PASS static/emulator; actual production GCS/Admin signing unverified |
| Role, sharing, revocation | Firebase author/teacher checks, pinned revisions, current frontier, grade-release logic, same-transaction cross-owner image-grant checks | PASS synthetic/emulator; **trusted cross-owner grant callback and live schema still required** |
| Data immutability | `db/quizer/001_initial_schema.sql` revision UPDATE/DELETE trigger and composite FK; `002_mutation_receipts_DISPOSABLE_ONLY.sql` append-only receipts design | PASS schema inspection/prior disposable rehearsal only; new full restricted-role DB rehearsal required |
| SQL isolation | `neon/project-config.js` requires a distinct Quizer project, TLS and restricted DB role; `sql-port.js` attests project and SQL session privileges | PASS code inspection/mocks; **no actual permitted SQL LOGIN/grants/connection** |
| Cross-store resilience | QN11.3 import receipts, QN11.6.1 attempt/start replay, QN11.6.2 grading lease, QN11.6.3 create-only ZIP and retained assets, QN11.6.4 read-only recovery classification | PASS simulated failures and Firebase emulators; **no real network partition, worker restart or cloud orphan recovery** |
| Signed private images and ZIP | Allowlisted paths, exact generation and SHA-256 readback, two-minute signing, no public bundle link | PASS simulated Storage; real service-account signBlob/permissions unverified |
| 10/100/500 question bounds | Unit tests check 20-item batch sizes, 2 simultaneous frontend prefetch requests, 500-item handling, 2,000 image ID ceiling, 24 MiB private bundle and 128 MiB ZIP bounds | PASS structural checks; NOT benchmarked on real devices or cloud |
| Frontend and accessibility | QN12-B Chromium runner/author phone/tablet/desktop, enlarged text, Flag/Star geometry, save-before-navigation, ARIA and native radio keyboard | PASS Chromium; physical Safari/Android and VoiceOver/TalkBack pending |
| Deployment controls | GitHub Actions workflow uses read-only contents and tests only; staged gateway default OFF; existing production API/worker not cut over | PASS source inspection |
| Budget and operations | No staging invoice measurement, per-user request costs, rate/quota telemetry, on-call alerting or tested rollback recorded | OPEN |

## Release blockers — prioritized

### P0: do not deploy the new hybrid system until closed

**B1 — Complete real end-to-end staging is missing.** The new Neon-backed bank/import, pinned private publish, secure attempt creation, grading, result release, image signing and export ZIP paths have **not** all run together on real, isolated Quizer Neon + Firebase Auth/Firestore + Cloud Storage with the actual Cloud Functions/service identity. The existing active worker and router do not import the new integrated factory. Before production, wire only explicitly opt-in paths in an isolated staging environment, preserve the legacy path and exercise the full workflow with disposable synthetic users.

**B2 — Database restricted role and migration acceptance are missing.** SQL DDL `001_initial_schema.sql` and `002_mutation_receipts_DISPOSABLE_ONLY.sql` are stored as offline artifacts. The second does not create `quizer_app` credentials or grants, and default DB roles must never be assumed to have acceptable privileges. A separately approved, **Quizer-only disposable Neon branch/database** must prove migration, rollback, every key/FK/unique/immutability constraint, SELECT/INSERT/UPDATE/DELETE allowlist, SQL role attestation, least privilege and repeated migrations. Never connect Mimo or any production databases.

**B3 — Cross-store failure/recovery has not been acceptance-tested against real services.** Firebase, Neon and GCS cannot participate in one atomic commit. Test lost ACKs before/after SQL commit, Firestore transaction retries, stale leases, role revocation between preflight/commit, worker crash during publish/export, missing/duplicated Storage generations, real GCS 403/404/412, concurrent retries and manual reconciliation. Record exact expected recovery state and prove no duplicate grades, no orphan public links, no corrupt revision pointers and no leakage of grading keys. Never automatically delete unidentified retained Storage objects.

**B4 — Historical data and rollback have not been proven.** Obtain separately authorized read-only inventory of existing Firestore quizzes, pinned revisions, active and final attempts, grades, asset refs and Storage generations. Produce consistent backups, verify **restoration** into disposable staging, and show a reversible feature-flag switch without overwriting old quizzes or attempts. Preserve the entire legacy API contract and original revision provenance. A synthetic fixture is not a real production inventory.

### P1: must resolve before activating a production traffic percentage

**B5 — Hybrid-sharing and access ports need actual trusted implementations.** `private-staging-runtime.js` accepts injected `authorImagePorts`, `authorizeSharedAsset`, origin and publication actor ports. The Firestore same-transaction sharing fence fails closed if no check is installed. Define and audit concrete Firebase source/grant records, revoke during real publication, verify shared/owned draft image authorization and signing at the precise publication/release boundary.

**B6 — App Check and service-account permissions.** `functions/src/config.js` only enforces App Check when `ENFORCE_APP_CHECK=true`; verify the actual staging/production policy (or document explicitly accepted platform exceptions) and authorized V4 signing identity, IAM, bucket namespace, CORS and function invocation restrictions. Never ship service-account keys or Neon connection strings to the browser. The Firebase web API config in `js/firebase-config.js` is public client configuration, *not* a service credential.

**B7 — Throughput, size and operational costs need real measurements.** Exercise 10/100/500-question import, preview, publish, student answer+grade and ZIP download with realistic diagrams. Measure worker cold start/warm latency, 1/8+/concurrent users, memory (24 MiB bundles / 128 MiB ZIP cap), Neon connection usage (the staged pool caps at 3), signed image requests, GCS reads/writes, Firebase operations, billable Cloud Functions/GCS/Neon resource use and costs. Set an explicit budget alert, quotas and acceptable SLO thresholds before cutover.

**B8 — Monitoring and staged rollback drill.** Create documented toggles and operator runbook: who can opt in, pause publishing, halt imports or grading, drain/renew leases, inspect read-only recovery classifications, and instantly revert to the pinned legacy path. Capture sanitized errors (no question keys or answer text), failure alarms and cost alerts. A backup without a completed restore and rollback drill is insufficient.

### P2: final user-facing acceptance

**B9 — Physical-device and assistive technology checks.** Manual mobile Safari (safe area, IME, enlarged text, VoiceOver), Android Chrome/TalkBack, low-memory devices and long MathJax/images remain unverified. Test the prior flag size stability after real answer/flag transitions and the new keyboard editor tabs.

**B10 — Separate AI/snipping scope.** `feat/ai-browser-snip-ask` stays isolated and unmerged. It is not a core Quizer production blocker unless explicitly promoted into the release.

## Operational staging acceptance checklist (future separate approval)

1. **Identity and isolation proof:** enumerate Quizer project and billing account, intended Firebase test project and Storage bucket, disposable Neon branch/database, restricted SQL role and intended service identity. Confirm that every identifier differs from Mimo and production. Record maximum permitted spend and TTL of test resources; **do not provision in QN13-B**.
2. **Migration + rollback proof:** run approved SQL 001/002 on the disposable Quizer DB, verify grants/triggers/constraint integrity, repeat migrations, rehearse rollback, take snapshots, demonstrate no privileged app SQL session.
3. **Network/service contract test:** execute actual server-side Neon transactions and GCS upload/read/sign with verified service accounts. No SQL work inside Firestore transaction callbacks; confirm private bundle access rules and generation pinning.
4. **End-to-end test matrix:** teacher create/edit/fork/share/trashed/restored problem → imported assets → quiz draft/publish → student attempt + retry → grading/manual correction → authorized result/image release → owner ZIP export/restore. Repeat on historical legacy revision/attempt paths.
5. **Failure/parallelism matrix:** 10/100/500 questions, concurrent students/editors, duplicate request IDs, crash before/after SQL and Storage effects, revoked permission, expired lease, corrupt/missing object, budget and outage alerts.
6. **Human acceptance:** physically test Safari/Android and screen readers. Verify no unexpected layout shifts or radio keyboard navigation, and sign off correct grading/key invisibility.
7. **Production cutover proposal:** only after successful staging evidence, independent P0/P1 closure, documented cost/SLO/backup/rollback and a **new explicit production approval** may a rollout branch/merge/deploy be proposed.

## CI and limitations

Release-boundary tests added in `tests/unit/qn13-b-release-boundaries.test.mjs` (7 tests) assert that new code remains OFF, active production dispatch does not import it, Firebase rules deny client access, Postgres revision writes are immutable by schema, work-branch CI has no deployment action, recovery inspectors cannot delete objects and App Check's true gating is understood. Tests are **static and local**, not a production security scan.

**All 3 GitHub Actions jobs passed** on source+test SHA `f036223bba5692ef10923791c87279edf4b01e2c`: [run 41733119542](https://github.com/azmath25/quizer/actions/runs/41733119542). Results: **355/355 Node unit tests** (including the seven QN13-B release-boundary assertions), **5/5 backend tests** and static verification, **88/88 Firebase demo-emulator integration tests**, **1/1 Firebase transport test**, and Chromium mobile runner and author QA at 320–1024 CSS px plus 390 px enlarged-text tests. The documentation-only audit commits afterward did not change the tested source or tests. No penetration test, remote SQL/Firebase/GCS integration or billable load measurement occurred.

## Final QN13-B decision and stop

**CONDITIONAL GO to plan isolated staging after a separate user approval. NO GO to merging/deploying the integrated production system.** The blockers above are *open gates*, not waived defects.

STOP: leave `main`, `main-backup`, AI/snipping branch, Mimo, protected `studio.html`, all real Neon/Firebase/Google Cloud services, user data, permissions, migrations, billing and deployed routes untouched. Do not run staging or production deployment without explicit authorization.
