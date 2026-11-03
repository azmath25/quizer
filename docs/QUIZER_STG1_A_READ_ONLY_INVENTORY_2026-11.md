# Quizer STG1-A — read-only isolated staging inventory and gate

Date: 2026-11-04 (Asia/Baku)
Repository: `azmath25/quizer`
Work branch at beginning of inspection: `044f81f7f429d3040467e193d87e62dabddfb638`
Milestone: **STG1 preparation / read-only inventory only**.
Release sequence: **STG → PROD → AI → PROD2**. AI branch must not be merged before the core production release.

## Decision

**STG1-A READ-ONLY INVENTORY COMPLETE.**
**NO GO for staging deployment/migration yet.** The existing **Quizer-only** Neon development project is suitable to be evaluated as a source for a fresh disposable rehearsal branch, but no staging Firebase project, restricted PostgreSQL LOGIN or approved budget cap has been verified. The staging runtime is still disabled/unmounted. Prepare the missing isolation and permissions on separately approved milestones before STG2.

No project/branch/database/role/compute/bucket changes were performed during this read-only inspection. No SQL DDL/DML was run. Only Neon project/branch/role/endpoint/table metadata and GitHub work-branch repository files were read. Never inspect or modify Mimo.

## Verified Neon inventory — Quizer-only

| Field | Verified current value | Interpretation |
|---|---|---|
| Project name / ID | `quizer-dev` / `soft-grass-35754518` | Existing dedicated Quizer dev project |
| Org plan | `free_v3` | Does NOT guarantee no billable activity; review quota/cost alerts |
| Region / PostgreSQL | `aws-eu-central-1` / 17 | Matches documented Quizer architecture |
| Main branch | `main` / `br-wispy-night-b9ug6kub` | Default branch; **DO NOT apply rehearsals here** |
| Branch list | Exactly one branch, `main` | Former QN4R disposable rehearsal was removed |
| `quizer` DB tables | 0 tables | New staging schema NOT migrated on default branch |
| PostgreSQL roles | Only `quizer_owner` | Restricted `quizer_app` and `quizer_reader` LOGIN roles **do not exist** |
| Endpoint | `ep-sparkling-field-b9h5d5ux` | Read/write endpoint on default branch |
| Compute | idle; autoscaling fixed min/max 0.25 CU | Avoid waking compute unnecessarily; no measured cost baseline |
| Pooling | `pooler_enabled=false` at inspection | Staging application pool configuration is not verified |
| Existing Quizer schema/mutation migrations | Repo SQL 001 and 002 available but **unapplied** to main | Run only in separately approved disposable branch |

The prior QN4R checkpoint `docs/QUIZER_QN4R_CHECKPOINT_2026-11.md` documents a successful disposable SQL/rollback rehearsal and a serious permission warning: **Neon API-created roles were observed to inherit `neon_superuser`, `CREATEDB`, and `CREATEROLE`**. Those were in a subsequently deleted disposable branch and must not be reused. A staging role must be created/proven by an independently reviewed SQL least-privilege process; do not assume an API-created role is safe.

## Verified Firebase/repo state

- Public browser Firebase config `js/firebase-config.js` currently points at **`sat-quiz-fd317`** and its existing Storage bucket. This is an existing app configuration; treat it as **protected**, not a dedicated staging target. Its actual ownership, billing, Firebase IAM and deployment state were **not verified** here.
- `functions/src/config.js` and `js/app-config.js` set Functions region `europe-west1`. The frontend config has `emulators.enabled=false`. Do not reuse this client config for isolated staging without separate environment-specific build/deploy configuration.
- `firebase.json` provides Auth/Firestore/Functions/Storage emulator settings plus deployment definitions. It does **not** create a separate staging Firebase project or staging alias.
- The work-branch Actions workflow `.github/workflows/quizer-verify.yml` runs only read-only-source unit/backend/static, Firebase **demo emulator** and local Chromium verification. It does **not** deploy, provision cloud, test real Neon or certify actual cloud signing.
- `functions/src/neon/project-config.js` requires an explicit Quizer project distinct from the supplied Mimo project ID, `QUIZER_NEON_ENABLED=true`, an approved server-only TLS DB URL, an app/reader user and `quizer*` DB name; `functions/src/neon/sql-port.js` independently refuses elevated SQL roles. **No database credentials were requested, printed or saved** during STG1-A.
- `functions/src/bundles/private-full-staging.js` and the related QN11 gateway are still deliberately **unmounted** from `functions/src/router.js`, `functions/src/index.js` and `functions/src/jobs/worker.js`; a green emulator run is not real hybrid integration.

## Required next approvals: small bounded slices

### STG1-B — disposable Quizer-only Neon branch (separate approval)
- In **project `soft-grass-35754518` only**, create an explicitly named **disposable child branch** of the empty Quizer dev `main`. Verify it contains no production/test history; record ID and intended cleanup. Keep default `main` unmodified.
- Apply exact reviewed `db/quizer/001_initial_schema.sql` then `002_mutation_receipts_DISPOSABLE_ONLY.sql` **only on that disposable branch** with a direct migration connection. Test constraints, immutable revisions, receipts, rollback and reapply idempotency. NEVER run destructive rollback on `main`.
- **Do not create an API `neon_superuser` role for the application.** Define a restricted `quizer_app` LOGIN using an explicitly reviewed SQL/IAM secrets workflow. Prove no CREATEDB, CREATEROLE, SUPERUSER, BYPASSRLS, inherited `neon_superuser` and no forbidden table DDL/DML; test actual SQL driver and project attestation. Keep privileged connection details out of GitHub/frontend/logs.
- If role/secret creation cannot be made safe, **stop and report**; no runtime activation. **Do not delete any branch without explicit approval.**

### STG1-C — isolated Firebase/GCS readiness (separate approval)
- Establish and verify a **distinct Firebase staging project, Auth user dataset, Firestore database, Storage bucket and Functions identity**. The existing `sat-quiz-fd317` project must be kept unchanged and **never used as the staging database/bucket**.
- Configure staging-only public frontend values, explicit Functions region, staging auth redirect domains and independent service account; verify V4 object signing, Firestore rules/indexes and Storage CORS with synthetic users.
- Run a no-production-change dry-run of the staged gateway wiring and feature flags; ensure live clients keep using current legacy routing.

### STG1-D — spending, access and release gate (separate approval)
- Agree a small explicit trial spending ceiling and cleanup policy before creating billable Firebase/GCS or Neon resources. Use only the existing Quizer project, not Mimo. Review quotas, usage alerts, Cloud Functions/Storage cost, connection caps and idle behavior.
- Prepare synthetic teacher/student accounts and datasets; never copy real quiz/answer data or historical production Storage objects into staging without separate explicit authorization.
- Verify CI/role guard, runbook and external approvals before STG2; document every project/branch/resource ID without leaking passwords or secret tokens.

## Exit checklist: STG1-A

- [x] Existing dedicated Quizer Neon project identity verified.
- [x] Default branch confirmed empty of tables, with only an elevated owner role.
- [x] No additional Neon branches or restricted app/reader roles present.
- [x] Existing public frontend Firebase project distinguished from proposed staging.
- [x] Correct work branch and QN13-B audit identified.
- [x] No Mimo, production, protected branch, deployment or database mutation.
- [ ] Disposable branch and restricted SQL credentials reviewed/approved/tested.
- [ ] Independent Firebase staging project and protected staging Storage bucket verified.
- [ ] Explicit budget cap/alerts, TLS/IAM, and monitoring established.
- [ ] Actual cross-store end-to-end and fault-recovery staging rehearsal completed.

**Stop after STG1-A.** New authorization required before STG1-B, STG1-C or any resource mutation. No merges/deployments/migrations/production changes. AI remains parked until the post-PROD AI phase.
