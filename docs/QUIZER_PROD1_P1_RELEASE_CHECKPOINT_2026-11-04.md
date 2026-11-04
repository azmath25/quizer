# Quizer PROD1 P1 — guarded release integration checkpoint

**Date:** 2026-11-04  
**Working branch:** `work/quizer-audit-optimization-2026-11`  
**Target:** `sat-quiz-fd317` / `europe-west1`  
**Status:** P1 implementation staged; **NOT activated or deployed**.

## Implemented in P1

1. `functions/src/index.js` uses a single safe PROD1 bridge for existing
   Firebase callable `api`, `processJob` Firestore trigger and the
   scheduled maintenance `sweep`. The old APIs and triggers retain their
   identities; this does not introduce an unapproved public endpoint.
2. `functions/src/prod1/release-gate.js` contains a **hard OFF source
   approval flag**. Even setting `QUIZER_PROD1_ENABLED=true` cannot
   enable hybrid service paths unless this reviewed source gate changes AND
   the runtime Firebase project ID is exactly `sat-quiz-fd317`.
3. Conditional secret bindings use
   `firebase-functions/params.defineSecret` and the standard v2
   `secrets` options for both the callable function and job/scheduler
   functions. Secrets:
   - `QUIZER_NEON_DATABASE_URL` — exact restricted `quizer_app` pooled URL.
   - `QUIZER_BANK_CURSOR_KEY` — random >=32-character signing key.
   Neither value is exposed in the repo, static bundle or audit output.
   **Both need an enabled version in this Firebase project before approval.**
4. The hybrid runtime factory is lazy and cached per function instance.
   Only hybrid author/bank, draft, publishing and protected-quiz actions
   read those secrets. Ordinary account, dashboard and access calls retain
   the Firestore dispatcher without Neon initialization.
5. Worker routing preserves existing legacy publication, grading and export.
   Private publication is selected from persisted job `bundleMode`.
   Private grading and export use a persisted **ready published revision
   with a private bundle**, transactionally revalidate attempts/jobs,
   acquire fenced leases and run the secure protected-key/ZIP pipeline.
   Private grading batches <=20 items; transient failures expire only the
   owned lease; bounded retries cannot modify a prior published revision.
6. `scripts/prod1/p1-cloud-audit.mjs` performs read-only Cloud Shell
   inventory of exact Firebase project number `476816329871`, branch,
   Secret Manager metadata and enabled versions, deployed gen2 Functions,
   Storage bucket, and service-account policy metadata. It NEVER reads
   secret values, adds IAM grants or deploys.
7. Dedicated regression tests cover the OFF release gate, secret isolation,
   project pinning, private/legacy worker isolation, private grading/export
   and Cloud inventory command allowlists.

## Read-only Neon attestation

Neon project `soft-grass-35754518`, branch
`br-lucky-lake-b9pocorx`, database `quizer` was inspected.
`quizer` schema contains **7 tables**. Application role
`quizer_app` can log in and belongs to `quizer_app_limited`; it is
not a member of `neon_superuser`.

No actual database write or Google Cloud secret read was made.

## Cloud handoff — read-only, no activation

After pulling the existing work branch in **Cloud Shell with project
sat-quiz-fd317**, run:

```bash
cd ~/quizer-staging-audit/quizer
git pull --ff-only
node scripts/prod1/p1-cloud-audit.mjs
```

It returns sanitized JSON and exits with a nonzero code while any
human approval/effective-IAM/E2E item remains. **Never paste a connection
string or password into chat, git, shell history or build logs.**

Review two secret versions and effective accessor rights for the service
accounts running `api`, `processJob` and `scheduledMaintenance`.
Effective policy may inherit from folders/org and requires more than a
single direct IAM membership match. Verify the deployed Storage bucket,
Cloud Storage signing credentials, Firebase Auth authorized domain
`azmath25.github.io`, App Check enforcement and billing quotas.

## Real-cloud acceptance (NOT yet performed)

Run using only synthetic/test users and isolated new quiz content:

1. Teacher logs in, creates and revises a Neon problem, attaches a figure,
   and makes a title-only no-op save without rewriting problem revisions.
2. Teacher creates a 2–5-question mixed Firestore/Neon draft, publishes
   through a private job; verify immutable bundle manifest, signed
   image access and no exposed grading keys.
3. Student opens the GitHub Pages site, starts the newly published quiz,
   answers, navigates/times out, submits; a private grading job must
   finalize correctly without Neon reads.
4. Teacher reviews results, releases scores and exports quiz with
   original TeX and protected images.
5. Retry intentional worker interruption and duplicate request IDs.
   Verify no double publishing or grades, and that an older quiz remains
   usable while Neon is unavailable.
6. Observe 100/500-question workloads, actual Functions/Neon calls and
   billing; confirm acceptable mobile interactions.

**NO production activation until all tests have evidence, cloud IAM is
verified and a separate deployment approval is given.**

## Deployment / rollback policy

- Do not merge the work branch into `main` or modify Firebase Hosting;
  the public frontend remains on GitHub Pages.
- Do not alter `PROD1_RELEASE_APPROVED=false` during source audit or the
  initial read-only Cloud Shell audit.
- Prepare a pinned backend image/build and know the previously deployed
  `api`, `processJob` and `scheduledMaintenance` versions.
- A release requires explicit approval to bind the secrets, deploy the
  reviewed backend, test the feature with real Firebase/Neon, and separately
  enable the feature flag.
- On failure, restore all three Functions to their last known-good revision
  and turn the code/runtime gate off; do not delete old published revisions,
  attempts, assets, users, or database tables.

## P1 release boundary

This checkpoint can verify **source integration and CI**. It cannot
independently prove the deployed Google Cloud credentials, live Firebase
Auth/Firestore/Storage behavior, effective IAM permissions or live end-to-end
performance without an authorized Cloud Shell/service deployment.

No Mimo project, default/main Neon branch, production Firebase data or
GitHub `main` branch has been modified.
