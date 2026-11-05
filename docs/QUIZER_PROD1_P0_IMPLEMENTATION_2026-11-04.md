# Quizer PROD1 P0 — Implementation checkpoint
Date: 2026-11-04
Branch: `work/quizer-audit-optimization-2026-11`
Scope: core quiz backend **only**; no AI/Mimo/PROD2 work.

## Change set

The following P0 components are now staged in source but **NOT** deployed
or imported into `functions/src/index.js` or `functions/src/jobs/worker.js`.

| P0 requirement | Implementation |
| --- | --- |
| Private publication gateway | `functions/src/prod1/publication-gateway.js`; role-, version- and receipt-fenced private job and revision creation. Bounds Neon reads to 8 at once, verifies content digests and owned/authorized assets, stores no question/answer text in job metadata. |
| Private publication worker | `functions/src/prod1/worker-router.js`; routes only persisted `bundleMode=private_bundle_v1` jobs to `publishJob`. Legacy jobs stay with the existing worker. A 590s transactionally fenced lease prevents overlapping workers during a 540s Function execution. Retries are bounded to five, interrupted owned leases are released for sweep retry, cancelled or exhausted jobs are terminal, and the previous published revision is never overwritten by a failed job. |
| Mixed-source private bundle | `functions/src/prod1/legacy-publication-source.js`, `functions/src/bundles/publish-writer.js` and `functions/src/bundles/private-staging-runtime.js`; a single protected bundle can freeze both a pinned Firestore legacy revision and an immutable Neon revision. Revoked legacy access can use an *exact*, previously published legacy slot snapshot, never an arbitrary revision or fallback after Neon failure. |
| Draft and import compatibility | `functions/src/prod1/draft-reader.js`, `functions/src/prod1/draft-mutations.js`, and `functions/src/prod1/import-finisher.js`. Read-only source resolution is transactionally revalidated; changed Neon draft slots store refs only. Import finalization validates bounded receipt batches, mapped items, slot identity and older pre-Neon Firestore receipts before invoking the existing atomic Firebase finalizer. |
| Full staged composition | `functions/src/prod1/live-factory.js`, `functions/src/prod1/private-runtime.js`; the disabled-by-default server factory now intercepts staged `publishQuiz`, `saveQuizDraft`, `getQuizDraftItems` and `finishImportJob` and offers an exclusive private/legacy worker factory. Other existing API behavior remains behind its original trusted gateway. |
| Author images and hybrid drafts | `functions/src/prod1/author-image-ports.js`; resolves Neon-only and mixed draft image scopes, rechecks Firebase role/ownership/draft order and version before allowing any author-only signed figure link. Uses the existing `private-author-image-scope.js` and `private-image-signer.js` authorization and signing contracts. |

## New regression suites

- `tests/unit/prod1-publication-gateway.test.mjs`
- `tests/unit/prod1-mixed-publication.test.mjs`
- `tests/unit/prod1-mixed-bundle-worker.test.mjs`
- `tests/unit/prod1-worker-router.test.mjs`
- `tests/unit/prod1-import-finisher.test.mjs`
- `tests/unit/prod1-author-image-ports.test.mjs`

These test author figure scopes and immutable pinning, owner/role loss, stale Firestore versions, source hash mismatch,
duplicate request receipts, old/new source composition, protected answer material, Storage
creation versus final activation, cancellation, worker retry fencing, exhaust behavior and
legacy import compatibility.

## Final P0 CI checkpoint

Latest code SHA: `1b43c03481922745a49735ad137d00b3a1d74e4d`.

[GitHub Actions run 41841719728](https://github.com/azmath25/quizer/actions/runs/41841719728):

- Unit + backend + static: **PASS**
- Firebase emulator regressions: **PASS**
- Chromium mobile runner + author QA: **PASS**

The CI result verifies synthetic/unit/emulator/browser behavior for the
work-branch sources. It does **not** prove live SAT QUIZ Secret Manager
credentials, Google Cloud IAM, real Neon ↔ Firebase service connectivity,
or production backend cutover.

## Release boundary

- NO merge to `main`, NO Firebase Cloud Functions/Hosting/Storage deploy,
  NO live Neon SQL or Mimo mutation, and NO feature flag activation.
- These source-level P0 paths still require a **P1** Functions secret binding,
  explicit production entrypoint/trigger integration, Firebase IAM verification,
  security rules review, and end-to-end real-cloud staging acceptance.
- The browser/front-end remains GitHub Pages; the backend remains its
  original Firestore dispatcher until separately authorized release.
- No automatic staged code should write to production, nor should a failed
  private action be retried through legacy handlers.
- Legacy third-party shared images are blocked where the trusted shared
  image grant verifier is not configured; explicit source authorization is
  preferable to a silent permission bypass.
- Existing batch-duplication behavior for fully Neon-backed quizzes is not
  claimed ready. It is outside the minimum P0 draft/import/publication path
  and should be separately routed and tested before cutover.

## Decision

**P0 source implementation: COMPLETE and CI-VERIFIED on the work branch.**
**Production activation: NO-GO** pending CI and P1 real-cloud gates.
See `.github/workflows/quizer-verify.yml` for the authoritative latest
unit, emulator and Chromium results for the current head.
