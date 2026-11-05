# Quizer QN11.6.4 — Cross-store resilience and reconciliation checkpoint

Date: 2026-11-04 (Asia/Baku)
Repository: `azmath25/quizer`
Branch: `work/quizer-audit-optimization-2026-11`
Verified source/test commit: `2b1c7b4442ae7564bcdbb1013fb253638d61ed3d`
GitHub Actions: https://github.com/azmath25/quizer/actions/runs/41727248370
Status: **COMPLETE for development-only, DEFAULT-OFF simulated resilience. NOT REAL-CLOUD ACCEPTANCE.**

## QN11.6.4 changes

- **Shared-image authorization race fixed** in `functions/src/bundles/private-asset-retention.js`: before each bounded Firebase retention batch commits, an asset owned by someone other than the quiz owner requires a **current, trusted Firestore-only `authorizeSharedAsset` check in the same transaction** as the retained-reference changes. If the callback is absent or revocation has occurred, the entire transaction fails closed; neither the image ref nor the reference count is created. The staged factory exposes this separate *optional*, trusted callback; without it, cross-owner publishing cannot be activated. Existing owner-owned images remain supported. Tested in Firebase emulator with denied grant, revoked grant, accepted grant, reference-count idempotency and zero partial writes.
- **Read-only incident classification** in `functions/src/bundles/private-recovery-inspector.js`: classifies pinned private publication and ZIP export states as `consistent`, `integrity_alert`, `in_flight`, `unlinked_private_object`, `retryable_missing_object` or `manual_review`. Requires a trusted job/quiz/revision snapshot and checked Storage object; succeeded objects need the **computed SHA-256 of exact pinned bytes**, matching type, generation and byte length. Firebase Timestamp leases are handled correctly. It NEVER lists, deletes, overwrites, promotes, retries or grants access to objects. A 404 may mean absent; 403/timeouts must NOT be downgraded to missing.
- **Failure-matrix tests** in `tests/unit/qn11-6-4-recovery-budget.test.mjs`: completed and missing/corrupt private object, stale versus live lease, orphaned private ZIP, lost acknowledgment, untrusted job identity, no unauthorized cleanup, maximum 24 MiB bundle policy, 10/100/500-item image-bound simulation and rejection above the 2,000-image ceiling. All are synthetic, not remote latency measurements.
- Existing QN11.6.1–3 transaction receipt, attempt start, grading lease, and ZIP 412/readback coverage remains passing. Simulated object failures do not update published pointers, historical revisions or student attempts.

## Recovery decisions

| State | Allowed action under this milestone |
|---|---|
| Consistent pinned object | Record health; do not change it |
| Live worker lease | No action; original worker retains fence |
| Missing object with expired job | Report as retry candidate, **do not automatically retry** |
| Unlinked object with expired job | Report protected orphan candidate; **never delete or publish automatically** |
| Wrong generation, SHA, byte length or content type | Integrity alert; **no fallback to legacy** |
| Shared asset grant revoked | Abort and leave existing old published revisions untouched |

No cleanup or automatic rollback was implemented. A private orphan may be needed to reconcile a lost acknowledgment and may also be referenced by historical attempts. Safe reclamation requires a later separately authorized retention/backup inspection.

## CI

**All 3/3 GitHub Actions jobs passed** on `2b1c7b4442ae7564bcdbb1013fb253638d61ed3d`:
[run 41727248370](https://github.com/azmath25/quizer/actions/runs/41727248370).

- **340/340** Node tests
- **5/5** backend tests and static checks
- **88/88** Firebase emulator integration tests
- **1/1** emulator transport test
- Chromium QN12.1 mobile runner + QN12.2 author/edit/import/bank UI checks at supported responsive test widths, including enlarged-text simulation

## Explicitly NOT verified

1. **No real Neon Postgres test** with restricted `quizer_app` LOGIN, migrations, grants, TLS or live SQL transactions. A Quizer-only disposable Neon branch/database rehearsal requires separate approval. No Mimo or default database was touched.
2. **No actual GCS/Cloud Run/Firebase production calls**, real Storage quotas, network partitions, tail latency or billing measurements. File access, zip generation, SHA, object generations and signing were exercised through mocks/synthetic bytes or demo emulators.
3. The 10/100/500 cases verify bounded source handling and image-ID limits, not 500 concurrent real users, expensive production queries, or realistic throughput.
4. The end-to-end live dispatcher/worker is still the old Firebase runtime. It has not been switched to the staged adapter; old quizzes and attempts remain authoritative.
5. Real cross-owner grants must be connected to a verified Firestore permission schema and tested against sharing revocations around publication activation before private publishing is enabled.

## Exit gate

**QN11.6.4 development-only resilience milestone completed.** QN11.6.5 is a separate default-OFF combined gateway/composition checkpoint in the next document. No merges, deployments, production migrations, Mimo access, protected branch changes, or deletion of historical data.
