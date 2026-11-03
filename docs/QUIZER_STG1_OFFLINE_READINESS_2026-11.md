# Quizer STG1 — offline readiness and remaining external blockers

Date: 2026-11-04 (Asia/Baku)
Work branch: `work/quizer-audit-optimization-2026-11`, repository `azmath25/quizer`
Release order: **STG → PROD → AI → PROD2**
Scope: additional **local-only audits** and an explicitly no-execution migration gate. No production or Mimo access.

## Readiness decision

**STG1 is NOT fully complete. STG2 staging deployment is NO GO.**
This is a precise environment readiness checkpoint, not an implicit authorization to change cloud infrastructure.

| Gate | Result | Evidence / open item |
| --- | --- | --- |
| STG1-A: Quizer-only inventory | PASS | `QUIZER_STG1_A_READ_ONLY_INVENTORY_2026-11.md` |
| STG1-B: disposable Neon schema/permission/rollback rehearsal | PASS | `QUIZER_STG1_B_DISPOSABLE_REHEARSAL_2026-11.md`, child `br-sweet-rice-b9ehdv9i`; 7 tables, 17 indexes, 1 trigger, no real quiz rows |
| STG1-B2: migration version safety | **CODE-ONLY** | `scripts/staging/quizer-migration-gate.mjs` validates exact repository blob hashes, ordered applied-version ledger and the *named disposable Quizer branch*. It returns a plan but intentionally has NO SQL execution or connection |
| STG1-B2: restricted database LOGIN | **BLOCKED** | Previous `quizer_app_limited` and reader roles are NOLOGIN security test fixtures. No separate LOGIN identity and runtime Secret Manager delivery has been proven. No password was created, copied, logged or exposed |
| STG1-C: isolated Firebase Auth/Firestore/Storage/Functions | **BLOCKED** | Firebase connection not confirmed in ChatGPT. Existing browser config refers to `sat-quiz-fd317`; **do not reuse it for disposable staging**. No separate staging project/IAM/bucket/Functions identity was verified or created |
| STG1-D: spending and access controls | **BLOCKED** | No verified Google Cloud billing account, spending alert, cost cap, IAM/Secrets/quotas, teardown controls or tested stage-only CORS and rules |
| STG1-F: readiness to start STG2 | **NO GO** | Requires prior gates above, authenticated real service checks, deployment and rollback plan, and separate explicit deployment approval |

## Additional offline protection implemented

The new pure Node module `scripts/staging/quizer-migration-gate.mjs` is **not** a migration executor. It pins `db/quizer/001_initial_schema.sql` to Git blob `c0c7c8db0cbe424fed69d79c4124ddf705c323ea`, and `db/quizer/002_mutation_receipts_DISPOSABLE_ONLY.sql` to `07d2391efdedfab7bcfc093eb87f5717beab39f9`. It refuses any other project, parent/default branch, database name or missing/invalid applied-ledger prefix. It cannot connect, create roles, run SQL, roll back or deploy. This prevents claiming that already-run, non-idempotent SQL can be replayed automatically.

The standalone unit suite `tests/unit/stg1-offline-migration-gate.test.mjs` checks exact pinned file bytes, ledgers that are complete or partial, drift/duplicates/missing rows, wrong branch/prod targets, and absence of any network/database driver.

**This is a code-level guard, not a versioned migration table or privileged runtime credentials.** A real version ledger still needs an approved database schema, exact SQL role grants, reviewed migration executor, authorized credential integration and recorded restore rehearsal. Existing checked-in 001/002 remain unchanged.

## Required actions before STG2

1. **Secure database login and secret delivery:** choose an approved method that creates a restricted SQL role with a secret transferred directly to a dedicated Quizer staging service/secret store, never a browser, repository, response or transcript. Prove runtime `current_user=quizer_app` with no `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `BYPASSRLS` or `neon_superuser` membership. Independently check SELECT/INSERT/UPDATE/DELETE/DDL permissions, project and endpoint attestation, TLS and connection pool max=3. No role was created in this offline audit.
2. **Separate Firebase staging access:** connect the Firebase integration in ChatGPT or provide separately approved staging project IAM access. Check an explicitly **new staging project ID**, Auth tenant/users, Firestore/Storage rules and indexes, Functions identity, App Check plan, CORS and allowed domains. Keep current `sat-quiz-fd317` unchanged. Do not build a staging frontend with live web-app config.
3. **Cost and cleanup:** obtain an explicit staging budget ceiling from the owner and verify actual alerts and quota settings before enabling billable Functions or Storage. Confirm the isolated Neon disposable branch's compute is suspended when idle and do not delete it without explicit consent. Record who can terminate staging jobs.
4. **Final STG1-F check:** verify GitHub CI, protected branches, role proof, backups, stage-only Firebase+Neon scope, budget alerts, secret handling, read-only recovery inspection and rollback plan. Give an explicit pass/fail decision and wait for STG2 approval.

## Invariants

- No Mimo, production, protected `main`/`main-backup`, deployed `sat-quiz-fd317`, or isolated AI/snipping branch changes.
- No merges, deployments, Firebase project creation, database migrations, new SQL LOGIN/password, Secret Manager writes or production cutovers from this offline work.
- No async/background processing or promised completion after this conversation turn.
- User can install/connect the available Firebase integration using the ChatGPT Plugins UI. Until connection is confirmed, DO NOT claim Firebase staging is accessible.

**Stop at the blocked gates. The core application remains on the proven release sequence STG → PROD → AI → PROD2.**
