# QN10.2 — private published bundle writer checkpoint

Date: 2026-11-03
Branch: work/quizer-audit-optimization-2026-11
Scope: QN10.2 only. Stop before QN10.3.

## Repository changes

- functions/src/bundles/publish-writer.js: separate, default-disabled private publisher. It loads a trusted frozen publication job, requires 1–500 pinned Neon revision IDs and SHA-256 content hashes, resolves the exact immutable source revisions, validates grading, creates one canonical QN10.1 bundle, uploads it create-only and verifies the exact object before requesting a Firestore commit.
- functions/src/bundles/private-storage.js: Admin SDK Storage port for published-bundles/v1 private object paths. Upload precondition ifGenerationMatch=0, private/no-store metadata, no download tokens, generation-pinned reads and byte/hash validation. It exposes no signer or deletion method. A 412 collision only allows reuse after complete readback verification.
- functions/src/bundles/firestore-publication-store.js: default-disabled, trusted Firebase coordinator. Preflight checks owner/staff role, publication job, lease, source and draft hashes, revision building state, and previous published pointer. A single Firestore transaction rechecks all conditions AFTER object verification and atomically records ready revision + manifest, next pointer, job success, public catalog state and audit event. Network Storage and Neon operations are OUTSIDE Firestore transaction callbacks.
- tests/unit/qn10-2-publish-writer.test.mjs: default-off, 100/500 source validation, one-object creation, corrupted hash and token rejection, concurrent/replayed upload, 412 duplicate reuse, failed upload, failed activation, stale source, and previous revision/attempt retention.
- tests/integration/qn10-2-bundle-publish.test.mjs: real Firebase Auth, Firestore and Storage emulators using synthetic teacher, quiz, old answer and attempt. It tests generation-pinned object creation, atomic pointer activation, stale draft and changed-lease failures with old snapshots preserved.

## Execution and safety model

1. Only the trusted backend can provide job and source data; the public client cannot submit raw bundle content, grading or owner identity.
2. The staged job must explicitly specify private_bundle_v1 plus exact pinned Neon problem/revision IDs and immutable normalized content hashes. Existing live publish jobs are not compatible, by design, and continue through the existing Firestore worker.
3. An object is created at a revision- and SHA-specific private Storage path. Never overwrite, sign, export or return a bundle URL.
4. Object metadata, generation, SHA-256, exact bytes and canonical schema must verify BEFORE a transaction marks the revision ready.
5. Firestore retries only encompass Firestore reads/writes. The activation transaction rechecks job lease, draft version, frozen input, previous published pointer and ownership. A stale write cannot replace an old published revision.
6. Crash after Storage creation but before Firestore commit can leave an unreferenced private object; safe retries reuse only a matching verified generation. No automatic orphan cleanup/deletion has been implemented.
7. Completed publication retry returns an already-published receipt without resetting a later publication pointer.
8. Existing historical snapshots, student attempts, grades, source TeX, images and older revision IDs remain untouched.

## Cutover gates

QN10.2 modules are not imported by the active Firebase job worker or dispatch. No new live bundle-only quiz is published: current student delivery and grading still require their legacy Firestore snapshots. QN10.3 must provide server-authorized question slices, answer-key separation, release rules, attempt pinning, grader integration and legacy fallback before any live switch.

The pinned source resolver is injected and tested with synthetic immutable revisions. Actual credentialed Neon read integration, least-privileged roles, upload/Neon reconciliation and frontend batching remain QN11 work. There are no live Neon or Firebase writes from this milestone.

The new 24 MiB bundle reads are bounded; real latency/concurrency and Storage costs remain a QN10.3/QN13 release gate.

## CI

Work-branch test-only GitHub Actions runs Node unit/backend/static plus Firebase emulator integration/transport. Final CI run and count must be recorded after verification.

No merges, deployments, cloud mutations, production migrations, Mimo changes, deletions or QN10.3 work.
