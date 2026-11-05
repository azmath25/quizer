# Quizer QN10.1 — private published-quiz bundle format and threat model

Date: 2026-11-03
Repository branch: work/quizer-audit-optimization-2026-11
Scope: **format, manifest, private reader contract and security tests only**. QN10.2 writer and QN10.3 student delivery are NOT implemented.

## Format v1

Format identifier: quizer.published_bundle.v1
Encoding: canonical-json-utf8 (UTF-8 JSON with recursively sorted object keys, no whitespace or noncanonical serialization)
Content-Type: application/json
Maximum encoded bundle size: **24 MiB** (25,165,824 bytes; reject before any upload)
Maximum items: 500 (current backend schema limit)
Compression: **none in v1**. Compression must be benchmarked and assigned a new compatible format/encoding contract, not silently changed in the same version.

One complete bundle is frozen PER PUBLISHED REVISION. It contains all its question content and protected answer/grading data together, but is NEVER a client-facing API response:

- format, quizId, revisionId, revisionNumber
- title, description, subject, difficulty
- validated immutable settings snapshot (duration, shuffle, allowBack, penalty, scoreRelease, solutionRelease)
- itemOrder (IDs), itemCount, totalPoints
- items array, exactly in itemOrder, each:
  - itemId, problemId, problemRevisionId, points
  - normalized content (type, answerMode, statementLatex, choices, defaultPoints, questionAssetBindings)
  - normalized protected grading (correctOptionId, acceptedAnswers, tolerance, solution/rubric LaTeX, solutionAssetBindings, gradingVersion)

All items are validated using the existing shared problem/settings validators. Duplicated, reordered, mismatched, missing or oversized items are refused. Hash SHA-256 is computed over the exact canonical UTF-8 bytes; both publisher and reader must agree on these exact bytes. Unknown fields, unsafe IDs, sparse arrays, invalid numbers and prototype-pollution keys are refused. Existing original .tex stays in Firebase Storage once per import; image asset objects are retained separately and referenced by immutable IDs, not copied into the bundle.

**Important:** The 24 MiB limit is conservative for a first version; the 500-question worst-case source text can exceed it. The future publisher must fail cleanly (leaving the old published revision intact) and later benchmarks must decide whether a new compressed format is needed. Do not truncate or split the bundle silently.

## Object naming, immutability and Firestore manifest

Private Firebase Storage object name (not a URL):

published-bundles/v1/{quizId}/{revisionId}/{sha256}.json

Path components must be safe IDs; SHA-256 is 64 lowercase hexadecimal characters. A new published revision gets its own object and immutable hash. For a retry on the exact same published revision/bytes, a verified matching generation may be reused; never overwrite an existing generation. QN10.2 MUST upload with generation precondition ifGenerationMatch:0 (create-only), no firebaseStorageDownloadTokens, no signed/download URL, private/no-store metadata, and read back exact generation+hash before committing any Firestore pointer.

New revisions will store a **small bundle manifest** in the existing Firestore publication-revision document. It is independent of the existing draft/source manifestHash field:

bundle: {
  format, encoding, contentType,
  quizId, revisionId,
  storagePath, generation,
  sha256, byteLength, itemCount, totalPoints
}

The manifest MUST NOT contain text, protected grading, student/teacher answer data, access tokens, signed URL, or original TeX bytes. No manifest is publicly readable under current Firestore rules. The Firestore publication state must remain "building" until the private object and manifest have been verified. QN10.2 may then atomically mark the revision "ready" and change the publishedRevisionId pointer in one validated Firestore transaction. A failure leaves the prior ready revision and its pinned active attempts untouched; old objects must not be garbage-collected.

The existing published Firestore item/grading subcollections are **legacy authority**. If an old revision lacks a new bundle manifest, the future reader MUST use its old Firestore snapshot path; never synthesize a new source revision ID or repin an active attempt. QN9's preservation audit remains a mandatory gate.

## Storage security and signed URL threat

The current Firebase Storage rules already deny all direct reads except staff one-time uploads to staging. QN10.1 makes explicit that ALL unauthenticated, student, teacher and administrator SDK clients have NO read/list/create/update/delete rights at published-bundles/v1 paths. Admin SDK is the only intended writer/reader, subject to narrowly scoped backend service identity.

A Firebase Storage rule cannot prevent Admin SDK from creating V4 signed URLs. The existing asset signer has therefore been hardened to refuse any published-bundles/ object; the writer must also avoid Firebase download-token metadata. An accidental signed URL would expose the entire answer bank to any recipient until expiry. Never return, log, email or cache a full-bundle URL in a browser.

## Trusted reader contract

readPrivatePublishedBundle requires:
1. Validated manifest matching both requested quizId and revisionId.
2. An injected authorizePinnedRead callback that independently inspects trusted Firebase Auth/session/Firestore ownership or attempt state and returns permission for the **same** pinned revision. Browser-supplied actor IDs, owner IDs, success flags or requested revision values cannot establish permission.
3. An injected readObject callback using Admin SDK on the exact manifest storagePath and exact immutable generation, subject to the 24 MiB byte ceiling. This callback MUST NOT generate URLs.
4. Exact object content type, generation, byte length, SHA-256, canonical JSON and full bundle metadata/order/points parity.

The helper returns protected data only to trusted server code. QN10.3 MUST NOT return its result directly from a callable. Instead it will filter at most 20 authorized question items, enforce attempt state/deadline, currentFrontier and allowBack=false, strip answer keys/solution images, check score/solution-release policy, and grade server-side against the pinned snapshot. No live Neon query is needed for student attempts. A full-buffer read, decode/memory use, 10/100/500 student concurrency and Storage cost must be benchmarked before release.

## QN10.1 testing and remaining gates

- tests/unit/qn10-1-bundle-format.test.mjs: deterministic bytes, 100/500 item bounds, immutable revision separation, no manifest secrets, path/generation/hash tampering, unauthorized read prevention, noncanonical/corrupt bytes, 24 MiB limit, unsafe property rejection, and signer blocking.
- tests/rules/security.test.mjs: a REAL preseeded Storage emulator bundle denies guest, student and teacher read, direct download URL, list, upload/replace and delete.
- No production Storage uploads/reads or Firebase publication changes.
- QN10.2: publish-time writer and atomic manifest activation, stale version/retry/cleanup tests; stop for explicit approval.
- QN10.3: authorized backend slices and protected grading, release rules, legacy compatibility, latency/cost/security benchmarks; stop for explicit approval.
- QN11–QN13: editor integration, mobile UX, and system-wide verification continue later.

No merge, deployment, production data mutation, Neon SQL, or Mimo changes are authorized in QN10.1.
