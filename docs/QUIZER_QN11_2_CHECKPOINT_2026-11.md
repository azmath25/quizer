# Quizer QN11.2 — default-off orchestration and idempotent SQL edit receipts

Date: 2026-11-03
Branch: `work/quizer-audit-optimization-2026-11`
Source baseline before QN11.2: `ed033c7ceadd9d57f50becfcfc89be8ce2d063c7`
Scope: QN11.2 implementation foundation ONLY. STOP before QN11.3.

## Summary

Added a safe, strictly staged server-only foundation for future Firebase/Neon integration. It is **not installed in the active Firebase callable router**, not deployed, not connected to any real database and not approved for cutover. Existing Firebase problem/quiz/student routes remain authoritative.

Changed:
- `functions/src/neon/sql-port.js` (new): default-OFF, dependency-injected SQL pool/transaction port with independently supplied project-to-host attestation, restricted role query using live connection, bounded pool options, mandatory BEGIN/COMMIT/ROLLBACK, local query timeout and sanitized connection errors. No `pg` driver package, secret, network dial or cloud lookup at module import. Actual pool factory and authoritative project verification must be supplied in a separately approved follow-on.
- `functions/src/neon/orchestrator.js` (new): default-OFF action envelope validator and Firebase-preflight -> **external Neon effect outside Firestore transactions** -> Firebase-effect receipt -> Firebase-commit callback boundary. Rejects an unsafe gateway without replay-safe edit receipts. It requires a trusted, durable injected Firebase coordinator with prepare/recordEffect/finalize; that coordinator is **not yet implemented or mounted**, and production authorization/reconciliation remains blocked.
- `functions/src/neon/write-repository.js`: saveProblemRevision validates/normalizes request, computes a canonical payload fingerprint, acquires a request-scoped transaction advisory lock, reads a matching immutable mutation receipt **before** expectedVersion validation, replays its original result on identical retry, rejects changed-payload collisions, and writes the receipt **within the same PostgreSQL transaction** as any actual metadata/revision change. No-op saves still produce **no write or new receipt**. QN8 writer remains OFF by default.
- `functions/src/neon/action-gateway.js`: advertises `replaySafeEdits` to the orchestrator when backed by the new safe writer.
- `db/quizer/002_mutation_receipts_DISPOSABLE_ONLY.sql` (new): proposed additive table keyed by actor UID and request ID, with action, payload hash and protected result DTO. It revokes PUBLIC, has no destructive statements, grants no runtime permissions and **was NOT executed**. An approved restricted SQL-created `quizer_app` LOGIN and carefully scoped SELECT+INSERT permissions are still required before any authorized disposable rehearsal.
- `tests/unit/qn8-neon-write.test.mjs`, `tests/unit/qn11-2-orchestration.test.mjs`: fake-port idempotency, concurrent identical requests, different-payload conflict, receipt insertion failure rollback, no-op absence, default-off, unsafe SQL roles, independent project attestation, pool lifecycle, rollback, lost Firebase final acknowledgment, action envelope validation and source-level no-router-installation assertions.

## Critical invariants and limitations

1. PostgreSQL + Firestore are **not globally atomic**. The orchestrator callback interfaces do not create durable state on their own; QN11.3 must implement a transactional Firebase coordinator, lease fencing and reconciliation before use. The backend's active `dispatch()` still executes actions inside Firestore `runTransaction`; do **not** mount the gateway there.
2. Exact duplicate problem-edit requests can replay a committed result from the SQL receipt even after the mutable parent version advances. Receipts are stored in SQL inside the same commit as the edit, not in process memory or a separate best-effort callback. Identical no-ops do not modify metadata, versions, audit logs or receipts.
3. Restricted `quizer_app` role is required by the SQL port and again by the QN8 writer. Project identity attestation must be backed by a trusted provisioning-time lookup, not a caller assertion; the module tests only the injected trust boundary. Nothing connects to any Neon project in this milestone. Mimo project access is forbidden.
4. No live `pg` driver or secret factory is installed, no Firebase coordinator implementation yet, no source-of-truth cutover, no migration application and no active live backend routing. The SQL DDL is a staged proposal requiring later disposable-only testing and permission/rollback review; do not label this as a proven real-SQL or real-Firebase integration.
5. The QN11.1 API compatibility table still applies. In particular: list/revision/history/fork/sharing/bulk actions, new/legacy draft source routing, upload resumability, private-bundle publishing/student use and real cross-store failure recovery are NOT implemented by QN11.2.
6. Old Firestore quiz IDs, published revisions, grading, images, historical attempts, teacher permissions, links and live exam functionality are untouched.

## Verification

- GitHub Actions test-only work-branch run: [41692041973](https://github.com/azmath25/quizer/actions/runs/41692041973), code/test commit `cf5e3b6e7c52ec95782fb1051f9caedf6a2cf717`. The Node unit/backend/static job was confirmed successful: **257/257 unit tests**, **5/5 backend tests**, static checks. Confirm emulator and Chromium job conclusions separately before marking the full CI green.
- New QN11.2 checks are mock/injected-port tests. They do **not** establish genuine SQL transaction durability or cloud costs. An independent read-only/production inventory was NOT performed.
- Changes outside this checkpoint: none. The independent AI experiment and `main`/`main-backup` stay untouched.

## Exit gate and next step

**QN11.2 code foundation implemented; leave default OFF. No production readiness or cutover approval.** Stop before QN11.3. The next separately authorized milestone should implement bounded import batches, durable Firebase coordinator/reconciliation, page-reload resume and SQL receipt parity using synthetic tests first. Genuine PostgreSQL work must be confined to a separately approved disposable Quizer branch, never Mimo or production.
