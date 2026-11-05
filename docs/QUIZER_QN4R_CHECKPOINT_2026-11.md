# Quizer QN4R — real disposable Neon/PostgreSQL rehearsal checkpoint

Date: 2026-11-03. Branch: `work/quizer-audit-optimization-2026-11`.
Scope: **QN4R only. Stop before QN8.** No GitHub merge, deployment, Firebase production change, Mimo mutation or Quizer production migration.

## 1. Newly provisioned isolated development project

| Attribute | Verified value |
| --- | --- |
| Neon project | `quizer-dev` |
| Project ID | `soft-grass-35754518` |
| Organization / plan | Existing account organization, Free-plan subscription `free_v3` at inspection |
| Region | `aws-eu-central-1` |
| PostgreSQL | 17 |
| Project compute cap | min 0.25 CU / max 0.25 CU |
| Retained history | 3600 seconds (one hour) |
| Idle suspend | Account-controlled default (returned `suspend_timeout_seconds: 0`); an attempt to set 60 seconds was rejected HTTP 412 |
| Default branch | `main` / `br-wispy-night-b9ug6kub`, database `quizer` |
| Disposable SQL rehearsal branch | `qn4r-disposable-2026-11-03` / `br-solitary-salad-b9kogyja`, **deleted after verified rollback** |

Before migration, the disposable branch had no `quizer` schema. After cleanup, a read of the default Quizer `main` confirmed `has_quizer_schema=false`, and listing project branches returned **only `main`**. The pre-existing Neon `mimo` project remained separate and was never used as a database target.

The Free-plan account/compute cap does **not** establish a guaranteed zero dollar cost; further storage, activity and provider quota/billing remain subject to Neon plan limits. The user explicitly authorized creation of a separate project.

## 2. Real PostgreSQL migration, integrity and rollback

Migrated the exact version-controlled `db/quizer/001_initial_schema.sql` file at blob SHA `c0c7c8db0cbe424fed69d79c4124ddf705c323ea` by executing its 21 non-BEGIN/COMMIT DDL statements in a single Neon PostgreSQL transaction on the disposable branch. **Success.** Schema inspection found:

- **6** application tables in schema `quizer`;
- **16** indexes including implicit primary-key/unique indexes (eight explicit `CREATE INDEX` statements in the migration);
- **1** immutable-revision UPDATE/DELETE trigger.

Executed the exact `tests/sql/qn4_disposable_rehearsal.sql` source, split into 17 statements inside one SQL transaction. **All passed** on PostgreSQL 17. Its assertions exercised:

- Initial same-transaction problem + first revision and deferred circular FK;
- Rejection of invalid latest-revision FK;
- Rejection of UPDATE and DELETE against existing immutable revision rows;
- Duplicate problem-tag, import-item receipt and audit-event IDs;
- Metadata-only title updates preserving content and revision number;
- Appending a new revision without altering older content;
- Index presence and keyset paging.

An `EXPLAIN (COSTS OFF)` on the owner/recent bank query showed `Index Scan using problems_owner_updated_idx`. This validates access path on the tiny synthetic fixture, **not** real 100/500-question performance or cost.

`tests/sql/qn4r_idempotency_disposable.sql` was committed, and its actual Postgres DO block was executed successfully. Additionally eight explicit SQL statements tested identical replay and conflicting payload hashes for an event ID and an import job/item key. Results for each: first INSERT returned one row; duplicate and conflicting INSERT ... ON CONFLICT DO NOTHING returned no row; exactly **one** record remained with the original hash; the conflicting hash was detectably different. This verifies the database invariant; application-level collision handling and retries still need QN8 integration tests.

## 3. Actual least-privilege permission tests and critical provisioning discovery

**Important risk discovered:** Neon API/MCP `create_postgres_role` produced `quizer_app` and `quizer_reader` with `CREATEDB`, `CREATEROLE` and membership in `neon_superuser` by default. A test attempt to `REVOKE neon_superuser` failed with **permission denied**. These API-created roles must **never** be used for the Quizer app/reporting runtime. They existed **only** on the disposable branch, which was deleted.

To test actual restricted SQL privileges safely, we instead used SQL-created **NOLOGIN** `quizer_app_limited` and `quizer_reader_limited`, both with no createdb/createrole and **no inherited roles**. Their setup is documented in `tests/sql/qn4r_least_privilege_DISPOSABLE_ONLY.sql`; no passwords are stored.

Real PostgreSQL `SET LOCAL ROLE` checks yielded:

| Action | Result |
| --- | --- |
| Reader SELECT future activity events | **Allowed** |
| Reader SELECT protected question revisions | **Denied — permission denied** |
| Reader INSERT event | **Denied — permission denied** |
| App SELECT bank problem metadata | **Allowed** |
| App UPDATE immutable revisions | **Denied — permission denied** |
| App SELECT optional published-quiz archive | **Denied — permission denied** |

The SQL NOLOGIN test roles are not production connection roles. **QN8 provisioning blocker:** create legitimate restricted LOGIN roles through a reviewed PostgreSQL and secret-management procedure, prove no privileged role memberships, and verify real credential-based login. Do not rely on MCP-created roles or merely on the URL-guard from the earlier roadmap. This must be resolved before wiring credentials to Firebase. Do not create credentials or a live app adapter in QN4R.

## 4. Rollback and cleanup

Confirmed the branch was `default=false`, `primary=false`, parented to Quizer's newly created `main`, and had the exact expected disposable name/ID. Executed the destructive statement from `db/quizer/001_rollback_DISPOSABLE_ONLY.sql` **only on that disposable branch**:

```sql
DROP SCHEMA quizer CASCADE;
```

Verification afterward: `quizer_schema_exists=false`, `quizer_tables=0`, `residual_triggers=0`. Deleted the disposable branch after rollback to avoid continued storage/compute resource overhead. Re-verified default Quizer `main` is empty and separate Mimo still listed alongside `quizer-dev`.

## 5. Repository changes, CI and remaining gates

- `tests/sql/qn4r_idempotency_disposable.sql`: reproducible synthetic replay and collision scenarios.
- `tests/sql/qn4r_least_privilege_DISPOSABLE_ONLY.sql`: test-only SQL-created non-login roles and explicit scoped grants.
- `tests/unit/qn4r-live-sql-contract.test.mjs`: static assertions for fixed PL/pgSQL dollar-quoting, idempotency fixture, NOLOGIN least-privilege setup and disposable rollback.
- CI: Work-branch-only test workflow `.github/workflows/quizer-verify.yml`, running Node unit/backend/static and Firebase emulator integration/transport. **Verified: both GitHub Actions jobs passed** on QN4R code commit `3a5fa50f32156b87610ac4bb315d81b0aa66fba9`: [run 41636751257](https://github.com/azmath25/quizer/actions/runs/41636751257). Unit tests, backend tests, static frontend verification, Firebase emulator integration and transport steps all concluded `success`. Later documentation-only commits are path-filtered and do not change the tested source. CI does not test live Neon, which was tested directly and recorded in this checkpoint.

**No QN8 code was started.** A dedicated development project exists but it contains no Quizer tables and no runtime app role or connection configured. Future QN8 requires distinct approval, proper least-privilege login credentials, a new disposable branch for rehearsals, connection/transaction tests, legacy-quiz preservation and feature-disabled backend integration. Do not merge, deploy, publish private bundles, migrate production quizzes, or modify Mimo.
