# Quizer — proposed $1/month staging billing and cost-cap plan

Date: 2026-11-04 (Asia/Baku). Repo: `azmath25/quizer`, branch: `work/quizer-audit-optimization-2026-11`.
**Decision: PLANNING ONLY. DO NOT ACTIVATE BILLING, BLAZE, APIS, IAM, SECRETS, DATABASE ROLE OR DEPLOYMENT.**
User-requested scope is *only* GCP/Firebase project `quizer-staging-az26`, number `509423933910`. Do not change `mimo-backend-513412`, Quizer production `sat-quiz-fd317`, Neon default branch, protected GitHub branches or user data.

## Verified current audit, with confidence levels

The user's Cloud Shell result from `scripts/staging/stg2-infra-readonly-audit.py`:
- Project ID/number verified; Firestore `(default)` database in `europe-west3`.
- `billingEnabled:false`; no dedicated `quizer-stg-runtime@quizer-staging-az26.iam.gserviceaccount.com` detected. This is a **proposed** future service account, not a real resource.
- API/Function/Run/secret inventory queries returned `*_UNVERIFIED`, which are **not evidence of absence**.
- Project IAM summary contains service agents and one owner user, and no public principal in that *project-level* binding list. Effective/inherited, service-specific, and secret-level IAM remain unverified.
- Later user command queried `gcloud services list --enabled --project=quizer-staging-az26` and piped through `grep ... || true`; it displayed no matching API names. Its exit status was hidden by the pipeline, so this is **no matching output**, not definitive proof the selected APIs are disabled.
- Independent Quizer Neon disposable child read-only role inventory showed `quizer_owner` LOGIN, `quizer_app_limited` and `quizer_reader_limited` NOLOGIN, and **no `quizer_app` LOGIN**. Do not substitute the SQL owner for application traffic.
- Current `functions/src/index.js` declares an API callable with maxInstances 10, job worker maxInstances 5, and `scheduledMaintenance` every minute with maxInstances 1. These are **not** approved low-budget staging settings, and stage code remains default OFF/unmounted.

## Spending goal and safeguards

**Owner-selected operating target: USD $1 per calendar month for this single staging project. THIS IS NOT AN ENFORCEABLE WHOLE-PROJECT HARD LIMIT.**

1. After a **separate explicit future billing approval**, link **only** `quizer-staging-az26` to an appropriate Google Cloud billing account / Firebase Blaze. Check billing account identity carefully: shared account quotas and free tiers may already be used by Mimo and other projects. Do not accept console suggestions to enable anything on the current Cloud Shell default project (which may still be Mimo).
2. Before deploying billable functionality, create an **alerts-only whole-project** monthly specified-amount budget of **$1.00**, scoped exclusively to `quizer-staging-az26`, all services, with alerts proposed at **25%, 50%, 80%, 100%**. Ensure an email recipient is actually subscribed and confirm test notification path. Ordinary alerts do not pause usage and are subject to reporting lag.
3. If available to this billing account, configure **spend-cap enforcement budgets** for **Cloud Run ($0.30)** and **Cloud Run functions ($0.30)** separately, scoped to the same staging project and each single eligible service. These are planning thresholds, not a prediction. Don't silently assume v2 Firebase Functions will be billed under both names or that caps double-count; inspect the deployment's actual service SKU/cost classification before relying on coverage. Spend caps do not cap all services, can lag/overshoot, and do not pause persistent fixed costs. If this feature is unavailable, STOP for a cost-risk review rather than interpreting alerts as caps.
4. Keep **$0.40 unallocated contingency** as an *operational target*, NOT a cap: other spending can arise from Storage/egress, Firestore, Cloud Build, Artifact Registry, Eventarc, Scheduler, Logging and Secret Manager. A $0.30 + $0.30 + $0.40 split is **not** a guaranteed maximum of $1.00.
5. Conservative acceptance rule: all required APIs, project billing, service accounts, IAM, bucket location, Firebase rules, Neon role and rollback policy must be confirmed **before** enabling any new staging runtime.
6. Even after activation, keep traffic synthetic and manually initiated. Disable/remove `scheduledMaintenance` from the **separately built staging** function deployment. Reduce both HTTP and worker functions to explicit stage-only limits (initial target `minInstances=0`, `maxInstances=1`, concurrency/rate controls, short timeouts as requirements permit); **do not deploy the current source's 10/5/maxInstances or every-minute schedule to staging unmodified**. Deploy only the strictly required callable route and essential worker triggers, not the whole existing functions codebase.
7. Keep Neon staging on a separate Free-plan project/branch if the account's current Neon plan and compute usage permit; **Google's $1 project budget does not cover Neon charges**. Confirm any paid plan/storage/compute charges separately.
8. Avoid unnecessary Function redeploys (Cloud Build and container artifacts may have storage/usage fees); keep Artifact Registry image retention deliberately bounded after validating rollback constraints. Keep Storage uploads very small, no bulk ZIP tests or 500-question import until monitoring works. Keep low-retention development logs, avoid verbose errors with protected data, don't configure minimum warm instances.
9. Watch Cloud Billing's **project-filtered** current month actual and estimated spending after each synthetic deployment/test session. Pause *manually* at the first alerts or unexpected usage; do not count on an instant stop. If the spending cap is reached, assume the covered service may stop serving, and postpone testing until the next period or after a separately approved decision.

## Pricing evidence and limitations (checked November 4, 2026)

- Whole-project alerts are not caps: https://docs.cloud.google.com/billing/docs/how-to/budgets .
- Spend caps cover eligible *one-service / one-project* scopes, currently including Cloud Run and Cloud Run functions, with possible overshoot and unaffected persistent resource usage: https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps .
- Firebase Storage requires Blaze, even for the default bucket; new `*.firebasestorage.app` buckets have Always Free Cloud Storage location quotas only in `US-CENTRAL1`, `US-EAST1`, `US-WEST1`, so **do not assume** a new European bucket is free: https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024 .
- Secret Manager free tier (per billing account, shared across projects): first 6 active versions and 10,000 access operations per month: https://cloud.google.com/secret-manager/pricing .
- Cloud Build first 2,500 e2-standard-2 default-pool minutes/month free **per billing account**, subject to changing promotional limits: https://cloud.google.com/build/pricing .
- Artifact Registry first 0.5 GiB-month of stored artifacts free per billing account; larger image retention adds costs: https://cloud.google.com/artifact-registry/pricing .
- Cloud Run free tier is aggregated across projects of the **same billing account**, and a deployment from source can also incur separate Cloud Build/Artifact Registry/Eventarc/networking charges: https://cloud.google.com/run/pricing .
- Standard Firestore's first eligible database has free quota of 1 GiB stored, 50K document reads/day, 20K writes/day, 20K deletes/day; PITR, backups and extra named DBs are billable: https://firebase.google.com/docs/firestore/quotas and https://cloud.google.com/firestore/pricing .
- Cloud Scheduler first 3 jobs/month free **per billing account**, then $0.10 per job-month; free job allowance does not waive Function executions or downstream costs: https://cloud.google.com/scheduler/pricing .
- Firebase Functions staging resource minimum instances incur idle costs. Set zero and tightly bound scaling: https://firebase.google.com/docs/functions/manage-functions .

These are public rate/free-tier references, **not** an exact invoice projection, guarantee, entitlement claim, or confirmed account-level remaining quota.

## Read-only API availability confirmation (no mutation)

The user's previously run grep pipeline returned no lines but masked errors. Repeat it only if necessary, without changing the Cloud Shell active project, preserving exit status:

```sh
cd ~/quizer-staging-audit/quizer
echo "========== QUIZER API CHECK (READ ONLY) =========="
if enabled_apis="$(gcloud services list --enabled --project=quizer-staging-az26 --format='value(config.name)')"; then
  printf '%s\n' "$enabled_apis" | grep -E '^(cloudfunctions|run|secretmanager|cloudbuild|artifactregistry)\.googleapis\.com$' || echo "No listed target APIs found"
else
  echo "Cannot verify enabled APIs; CLI returned an error. NO changes made."
fi
```

Do not run `gcloud config set project`, `gcloud services enable`, `firebase deploy`, `gcloud billing projects link`, `gcloud secrets versions access` or production/Neon SQL commands as part of this planning step.

## Controlled future decision gates

**Gate A (NOW):** billing disabled, no APIs/roles/secret provisioned. Audit and plan only. **PASS for no-change plan; deployment NO GO.**

**Gate B (requires new approval):** choose billing account, approve Blaze activation ONLY for `quizer-staging-az26`, create scoped alerts/spend caps where supported, confirm actual Free-plan/Blaze charges, use strict stage-only resource limits. Stop if enforcement unavailable and user's risk threshold requires it.

**Gate C (requires new approval after B):** approve dedicated staging Functions IAM and a one-secret scoped store; create independently attested restricted `quizer_app` **on the disposable Quizer child only** using separately reviewed SQL; no connection values in GitHub, shell history or chat. Run negative-grants and TLS/endpoint tests.

**Gate D (requires new approval after C):** deploy only the isolated minimal stage backend/frontend, test synthetic teacher/student flows, measure actual cloud usage and manual rollback. Still no production data migration or deletion.

**Not approved:** PROD1; all production cutovers, protected-branch merges, Mimo changes, default-Neon-branch changes and experimental AI/PROD2 release.
