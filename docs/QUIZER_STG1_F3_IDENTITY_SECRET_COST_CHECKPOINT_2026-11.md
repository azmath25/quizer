# Quizer STG1-F.3 — staging runtime identity, secret IAM and cost preflight

Date: 2026-11-04 (Asia/Baku)  
Repository: `azmath25/quizer`  
Branch: `work/quizer-audit-optimization-2026-11`  
Release order: **STG → PROD → AI → PROD2**

**Decision: SOURCE/COST PREFLIGHT PREPARED; LIVE CLOUD SECURITY NOT VERIFIED. STG2 NO GO.**

## Evidence and scope

The only audited project names are Firebase/Google Cloud `quizer-staging-az26` (project number `509423933910`) and Quizer's isolated Neon project `soft-grass-35754518`, disposable child `br-sweet-rice-b9ehdv9i`. These identifiers were previously user-verified; this milestone has **not** authenticated to Google Cloud, read live service-account or Secret Manager IAM policies, checked current billing, deployed Functions, or touched Google Cloud/Neon resources. The last Google Cloud read-only billing check reported disabled. Previous Neon read-only checks reported the restricted `quizer_app` runtime login absent; STG1-F.2 did not create it.

The work-branch source `functions/src/index.js` declares three **Firebase Functions v2** entrypoints without any `serviceAccount` override: `api` (`maxInstances:10`), `processJob` (`maxInstances:5`, retry on), and `scheduledMaintenance` (`every 1 minutes`, `maxInstances:1`). The source `functions/src/config.js` defaults to `europe-west1`. Staging Firestore was created in `europe-west3`. This is a cross-region layout requiring explicit latency/egress review, not a proven cost. Current source config **must not** be blindly deployed to staging: its scheduler may run continuously and the default Functions runtime identity is too broad a starting assumption for a Neon credential.

## New offline code

- `scripts/staging/quizer-stg1f3-identity-gate.mjs` — a **pure, offline, fail-closed** untrusted-metadata inspector. Pins Quizer-only project/branch, demands a dedicated staging service account and secret-only accessor evidence, refuses default service account, wrong project, credential-shaped fields, unreviewed scheduler/scaling/region and unverified cost alerts. Its returned authorization fields are **always false**, even with forged all-positive metadata. It cannot run gcloud, SQL or Firebase; user-supplied booleans are not proof.
- `tests/unit/stg1f3-identity-gate.test.mjs` — tests scope isolation, missing evidence, secret exposure rejection, secret-level IAM, $1 alerts vs hard caps, scheduler/scaling review and inability to authorize changes/deployment. Tests verify current source still lacks a custom service account and includes an every-minute schedule.

No application entrypoints or deployment configuration changed.

## Future identity and secret contract — proposed, NOT created

- Create a dedicated **Quizer staging-only** runtime service account (proposed example, not an existing verified identity: `quizer-stg-runtime@quizer-staging-az26.iam.gserviceaccount.com`). No default Compute Engine service account, Mimo account or production account should receive Neon secrets.
- Assign the dedicated service account explicitly to the appropriate **staging-only** Firebase Functions v2 routes *in a future reviewed, separately approved staging build*, not by modifying active production entrypoints. A service account attached to an app's source is not evidence that the actually deployed runtime uses it.
- Proposed secret metadata resource name: `projects/quizer-staging-az26/secrets/quizer-staging-neon-url`. This is a placeholder, **not proof the secret exists**; do not create it without cost, destination, IAM and credential-handoff authorization.
- If approved, grant `roles/secretmanager.secretAccessor` to only the dedicated runtime service account **at the single secret resource**, not the project. Independently check all effective/inherited access and forbid public grants. Never download or print a secret payload in a diagnostic.
- Current SQL access remains disabled and its connection pool is limited to 3. Even a perfect secret policy does not authorize enabling SQL or mounting the new hybrid gateway.

## Exact, READ-ONLY Cloud Shell evidence to collect in a later authorized audit

Run commands **only with explicit `--project=quizer-staging-az26`**, no global `gcloud config set project`; the Cloud Shell quota project previously pointed to Mimo and must not be silently used or modified. **Decline prompts to enable APIs or create resources.** Do not run these automatically as part of STG1-F.3.

```sh
gcloud projects describe quizer-staging-az26 \
  --format="yaml(projectId,projectNumber,lifecycleState)"
gcloud billing projects describe quizer-staging-az26 \
  --format="yaml(billingEnabled)"
gcloud iam service-accounts list --project=quizer-staging-az26 \
  --format="table(email,disabled)"
gcloud functions list --project=quizer-staging-az26 \
  --format="table(name,environment,serviceConfig.serviceAccountEmail)"
gcloud secrets list --project=quizer-staging-az26 \
  --format="table(name)"
```

Only **if a named staging secret already exists**, inspect its IAM binding metadata with `gcloud secrets get-iam-policy quizer-staging-neon-url --project=quizer-staging-az26` in an authorized read-only review. Do not use `gcloud secrets versions access`: that reads the protected credential value. Check whether a secret-level accessor exists, whether principal identity matches the actual runtime, whether any project/folder/org grants can broaden access, and whether public/inherited privileges exist. A one-secret IAM listing alone is not effective-permissions proof. If `gcloud` asks to enable a missing API, **decline** and report as unverified; there is no permission to enable APIs here.

Do not paste full IAM lists containing personal email addresses into public issues or reports. Summarize only role, scope, principal type/class and public-binding flags, plus optionally the proposed dedicated Quizer service-account identity.

## Cost gate

The owner-selected target is **$1 per calendar month** for `quizer-staging-az26`. Google **alerts-only budgets are not hard caps**; support for spend caps applies only to qualifying individual services (Cloud Run / Cloud Run functions are among them). No hard *project-wide* $1 cap was verified. Before **separate** approval to link billing/Blaze, examine expected monthly costs for deployment/build/artifact storage, Firebase Storage operations, Firestore, Secret Manager, Cloud Functions, network egress, scheduled invocations and Neon compute/storage. Proposed alert thresholds are 25%, 50%, 80%, 100%, but actual alerts have **not** been created. Cloud Scheduler has an account-level free-job allowance that cannot be assumed unused for this staging project; the every-minute job may still incur runtime, database and logging operations even if scheduling itself is free.

Current role entrypoints use up to 10 API and 5 worker instances. **Do not ship those exact instance settings or the every-minute scheduler to low-budget staging without a reviewed staging-only override.** A preferable staged design is to disable the scheduled job entirely and enable only the explicitly necessary small, bounded test function(s), subject to separate approval.

Official docs:
- https://firebase.google.com/docs/functions/manage-functions
- https://docs.cloud.google.com/secret-manager/docs/access-control
- https://docs.cloud.google.com/billing/docs/how-to/budgets
- https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps
- https://firebase.google.com/docs/functions/quotas
- https://cloud.google.com/scheduler/pricing

## Decision and next bounded step

**STG1-F.3 = OFFLINE PREFLIGHT.** Runtime service identity, a secret resource, secret-scoped binding, actual budget alerts, and current service inventory are **not verified live**. The safe next milestone would be **STG1-F.4**, exclusively read-only Google Cloud metadata verification (no secret contents), followed by a new approval before any real credential, service-account creation, billing, IAM change, deployment, branch merge or data migration.

Production Quizer, Mimo, protected `main`/`main-backup`, AI/snipping branches, deployed resources and real user data remain untouched.

## Backup / rollback clarification (owner question, 2026-11-04)

**Do not deploy Quizer staging or production on the assumption that a single backup can be "applied" if anything breaks.** A backup is necessary but insufficient for the new hybrid Firebase–Neon–Storage architecture.

| Surface | Safer rollback / recovery plan |
| --- | --- |
| Static frontend | Keep a pinned, tested previous build; revert Hosting release or republish verified prior GitHub Pages artifact as appropriate |
| Firebase Functions | Republish the verified old function source with proper identities, configuration and triggers; do not assume Hosting rollback reverts Functions |
| Firestore rules/indexes | Republish previously tested rules/index configuration; these do not have the same automatic release rollback as Hosting |
| Firestore data | Test restore of a separately captured backup/export/PITR point into a disposable database and reconcile newer legitimate records, rather than overwrite live student attempts/grades blindly |
| Neon data | Use an independent disposable branch/snapshot and a controlled reconciliation; turning off the new feature flag leaves legacy Firestore authoritative |
| Private images/bundles | Retain generation-specific objects and independently verify storage soft-delete/versioning/restore; don't assume database restore recreates binary files |
| Cross-store consistency | Log write receipts and request IDs, stop new writes, verify the missing/duplicated operations, inspect recovery classification, then resume only after reconciliation |

Firebase documentation:
- https://firebase.google.com/docs/cli (Hosting rollback vs rules)
- https://firebase.google.com/docs/firestore/manage-data/export-import (import overwrite and requirement for billing/Blaze)
- https://firebase.google.com/docs/firestore/backups (database backup restore limitations)
- https://docs.cloud.google.com/storage/docs/protection-backup-recovery-overview (binary object recovery options).

**Release decision:** Staging deployment remains **NO GO** while runtime identity, server-only secret destination, restricted SQL LOGIN, Firebase Storage/Functions, billable controls and actual restore drill are unverified. The staging project has no verified full working application to roll back to; its current client Firestore rules are intentionally deny-all. Production must stay untouched.


## CI and cleanup policy checkpoint (2026-11-04)

**PASS:** [GitHub Actions 41749537524](https://github.com/azmath25/quizer/actions/runs/41749537524), exact source/test SHA `f5761e055f9c3b4e2b3d3cf6d124b1cb0ad8dbb8`. All **3/3 jobs** succeeded: **387/387 unit tests**, **5/5 backend tests**, static verification, Firebase demo emulator regressions/transport and Chromium mobile/author QA. Documentation changes afterward do not change source/test files.

**Updated staging data preference:** The owner states current data is not a high priority. For the isolated Quizer *staging* environment, use fresh synthetic fixtures and allow separately authorized reset/recreation of the disposable staging database instead of making historical-data migration and snapshot/restore a staging prerequisite. Do not infer authorization to delete existing production Firestore quizzes, Storage assets, grades or attempts. Data loss acceptance for *production* must be separately scoped and explicit. A clean-start staging strategy does not waive service credential isolation, IAM, Firebase rules, budget, or technical recovery tests for in-flight writes.

**Result:** STG1-F.3 offline source/cost/identity preflight COMPLETE. Actual staging runtime identity, secret store, billing access, and restricted SQL login remain unverified/unprovisioned. **STG2 NO GO**; no merges, deployment or cloud mutations were performed.
