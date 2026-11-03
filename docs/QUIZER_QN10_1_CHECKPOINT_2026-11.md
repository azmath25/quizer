# Quizer QN10.1 checkpoint — private bundle format and reader security

Date: 2026-11-03
Work branch: work/quizer-audit-optimization-2026-11
Scope: **QN10.1 only. Stop before QN10.2.**

## Implemented, in repository only

- functions/src/bundles/published-bundle.js implements a deterministic v1 bundle schema with question content, protected grading, pinned quiz revision, original bank source IDs, image-asset references, frozen quiz settings, exact item order, count and total points.
- Canonical JSON UTF-8 encoding, maximum 500 items and **24 MiB** encoded bytes, SHA-256 over exact bytes, content-addressed private Storage object name, generation-pinned small Firestore manifest, no URLs or answer keys in manifest.
- Strict normalization detects duplicate slots, invalid order, unsafe IDs, wrong totals, invalid nested/extra fields, inconsistent grading version, corruption, noncanonical encoding, oversized input, mismatched hashes/generations and wrong publication IDs.
- readPrivatePublishedBundle is a **trusted backend-only** helper requiring two injected dependencies: a pinned-revision authorization callback and a generation-constrained private Storage read callback. The authorization callback is invoked **before** any object read and must be implemented by QN10.3 using independently verified Firebase/Firestore state. The method returns protected grading only within backend code, NEVER to a client.
- firebase/storage.rules adds an explicit deny-all for published-bundles/v1 paths. Other existing Storage rules remain unchanged.
- functions/src/api/assets.js refuses to create signed/download URLs for private published-bundles/ paths, including in emulator mode, protecting against Admin SDK signed-URL bypass of Storage rules.
- tests/unit/qn10-1-bundle-format.test.mjs verifies 100/500 item limits, deterministic/pinned versioning, signed-path rejection, manifest secret minimization, authorization-before-read, hash/generation/canonical tamper rejection and size guard.
- tests/rules/security.test.mjs uploads a synthetic bundle with emulator security rules disabled, then verifies guests, students and teachers cannot read, obtain download URLs, list, replace or delete the real existing fixture.

## Design and transition safety

- New v1 storage path: published-bundles/v1/{quizId}/{revisionId}/{sha256}.json. MIME application/json, encoding canonical-json-utf8 (no compression in v1). New format changes require deliberate versioning.
- On QN10.2 publication, **one** object must be create-only (ifGenerationMatch:0), generation-pinned and readback-verified *before* the Firestore revision goes ready and the published pointer is atomically updated. This writer is NOT implemented in QN10.1.
- Active student attempts already pin quizRevisionId. QN10.3 must enforce this pin, deadlines, allowBack:false, score and solution release; students must never obtain the full bundle, its grading or its future locked questions.
- Published legacy Firestore item/grading paths remain authoritative if an old revision lacks a bundle manifest. No old quizzes/attempts/grading images or source TeX files are deleted, republished, rewritten or migrated.
- Some pathological 500-question bundles may exceed 24 MiB: fail without publishing; benchmark compression/new encoding separately before release. No truncation or unverified size assumptions.
- No new public API, Firebase callable, Storage writer, scheduled job, code deployment, Neon SQL, cloud resource or production mutation in QN10.1.

## Tests and stop gate

- GitHub Actions work-branch CI: https://github.com/azmath25/quizer/actions/workflows/quizer-verify.yml .
- Latest QN10.1 code/test commit: 67d464eb82cf5f6aa62dee315881cec3e9aaa3a1. CI run 41643820337 initiated; check for its final result before claiming green.
- Documentation of format, permissions and threat model: docs/QUIZER_QN10_1_BUNDLE_FORMAT_2026-11.md .
- STOP before QN10.2 (bundle writer and publication pointer cutover), QN10.3 (student slice and grading), QN11–QN13. No merge/deploy.

No real Firebase or Neon object is read or modified. Mimo remains untouched.
