# Quizer STG1-B — isolated real Neon migration and rollback rehearsal

Checkpoint date: 2026-11-04 (Asia/Baku; Neon event timestamps 2026-11-03 UTC).
Work branch: `azmath25/quizer` / `work/quizer-audit-optimization-2026-11`.
Test-only source commit: `4a19f4994a7896b9ca86ed46d934ef09fff6f2d8`.
CI: [GitHub Actions 41737127845](https://github.com/azmath25/quizer/actions/runs/41737127845).
**Status: REAL DISPOSABLE SQL REHEARSAL PASSED; RUNTIME LOGIN / SECRET PROVISIONING REMAINS AN OPEN STAGING GATE.**
**Stop before new STG1-B credential work, STG1-C Firebase provisioning or STG2 deployment.**

## Exact resource boundary

| Property | Result |
| --- | --- |
| Quizer project | `quizer-dev` / `soft-grass-35754518` only |
| Region/engine/plan | `aws-eu-central-1`, PostgreSQL 17, existing `free_v3` |
| Parent/default | `main` / `br-wispy-night-b9ug6kub`; **not a migration target** |
| New child | `stg1b-disposable-2026-11-04` / `br-sweet-rice-b9ehdv9i` |
| Child compute endpoint | `ep-spring-term-b98uf237`, min/max 0.25 CU |
| Initial child state | 0 application tables; only pre-existing owner role |
| Final child state | 7 tables, 17 indexes, 1 immutable-revision trigger, **0 problem rows, 0 mutation-receipt rows** |
| Final compute | Child endpoint manually suspended; Neon reported `current_state=idle` and a `suspended_at` timestamp |
| Parent schema | Independently verified **0 tables** in database `quizer` after rehearsal |
| Child retention | Kept for a separately approved next staging step; **not deleted** |

No role/password or connection string was copied into GitHub, frontend files or logs. No Mimo project was accessed. No Firebase, Cloud Run, billable Google Cloud deployment, real user record, production database, protected branch, or AI/snipping branch was changed.

## Database migration execution

Only on the child branch, against database `quizer` and migration owner `quizer_owner`:

1. Applied exact Git blob `c0c7c8db0cbe424fed69d79c4124ddf705c323ea`: `db/quizer/001_initial_schema.sql`, **21 SQL DDL statements in one transaction**.
2. Applied exact Git blob `07d2391efdedfab7bcfc093eb87f5717beab39f9`: `db/quizer/002_mutation_receipts_DISPOSABLE_ONLY.sql`, **2 SQL DDL statements in one transaction**.
3. PostgreSQL schema introspection showed **7 tables** (problems, immutable problem revisions, tags, import receipts, activity events, optional revision mirrors, mutation receipts), **17 indexes**, **1 revision immutability trigger**. The receipt table has the expected `actor_uid,request_id` composite PK, action/hash/JSON-object CHECK constraints.
4. Ran the exact `tests/sql/qn4_disposable_rehearsal.sql` (blob `0997d800b28136801ee7fc3effffc231bbf9ef9a`) as 17 statements inside one real PostgreSQL transaction. **PASS**: same-transaction deferred FK, invalid FK rejection, immutable previous revisions on UPDATE/DELETE, duplicate tag/import/event keys, metadata-only updates, preserving old revision after append, indexes and keyset predicate.
5. Ran exact `tests/sql/qn4r_idempotency_disposable.sql` (blob `94eb5feb9bfc92582d987d8d73d7791b64368090`) as one DO block. **PASS**: duplicate/conflicting event and import receipts cannot overwrite the first transaction's payload hash.
6. Ran a real SQL mutation-receipt test: duplicate replay, changed-hash conflict, invalid action, malformed digest, non-object JSON and duplicate primary key were all correctly handled.
7. Both original migration files were then deliberately re-executed against the existing schema. Each **rejected safely and atomically**: `001` returned `schema "quizer" already exists`; `002` returned `relation "mutation_receipts" already exists`. Table count remained 7. **Important:** these DDL migrations are NOT automatically idempotent; production/staging migration tooling must track applied versions instead of blindly replaying.
8. After verifying the exact child branch ID, parent, `default=false` and `primary=false`, executed the checked-in `001_rollback_DISPOSABLE_ONLY.sql` `DROP SCHEMA quizer CASCADE` **only against the child**. Post-rollback readback: **schema absent, 0 tables, 0 revision triggers**.
9. Reapplied exact migrations `001` and `002` from scratch successfully (21 + 2 statements). Final PostgreSQL readback: **7 tables, 17 indexes, 1 trigger, 0 problems, 0 mutation receipts**. This proves a clean rollback/recreate sequence, not online production migration behavior.
10. Committed and executed `tests/sql/stg1b_mutation_receipts_DISPOSABLE_ONLY.sql`, exact Git blob `c13ea3231026c6e3ec50a210bf66d401fa11dccc`. Its four SQL statements run receipt collisions/checks inside a SAVEPOINT and `ROLLBACK TO SAVEPOINT`, then verify the test-role security matrix. **PASS**, leaving no synthetic receipt rows.

## Permission and runtime-identity tests

- Ran the exact previous reviewed fixture `tests/sql/qn4r_least_privilege_DISPOSABLE_ONLY.sql` (blob `93d31ffa193d25dd8d6960e0d1b986cb5ec0a863`) on the child only, defining SQL `quizer_app_limited` and `quizer_reader_limited` **NOLOGIN** test roles. Also granted `SELECT, INSERT` on the new `mutation_receipts` table only to the test app role. Reapplied the table-level grants after the destructive rollback/recreate.
- Verified both have `rolcanlogin=false`, `rolsuper=false`, `rolcreatedb=false`, `rolcreaterole=false`, `rolreplication=false`, `rolbypassrls=false` and **no inherited `neon_superuser` membership**.
- Real `SET LOCAL ROLE` PostgreSQL tests:
  - Reader SELECT activity events — **allowed**.
  - Reader SELECT protected `problem_revisions` — **permission denied**.
  - Reader INSERT activity events — **permission denied**.
  - App SELECT problem metadata — **allowed**.
  - App INSERT mutation receipt — **allowed**.
  - App UPDATE mutation receipt — **permission denied**.
  - App SELECT optional `quiz_revision_mirrors` — **permission denied**.
  - App UPDATE immutable problem revision — **permission denied**.
- The SQL test roles are deliberately **not** connection identities. **No actual `quizer_app` LOGIN, password, TLS credential-based SQL session or Firebase Secret Manager injection has been provisioned or tested.** This is a release blocker: the staged SQL port requires a real, attested restricted LOGIN, not these NOLOGIN fixture roles. Past QN4R testing showed Neon API-created login roles could inherit dangerous elevated privileges; this milestone **did not** use that role-creation API.

## GitHub reproducibility / CI

New files on the isolated Quizer work branch:

- `tests/sql/stg1b_mutation_receipts_DISPOSABLE_ONLY.sql`: exact self-cleaning live SQL receipt/security fixture.
- `tests/unit/stg1b-sql-rehearsal.test.mjs`: four static source-contract tests of the two migrations, explicit NOLOGIN grants, protected rollback and disposable fixture. A false-positive regex initially matched a SQL *comment*; this was corrected to match executable statement starts. The corrected source/test head is `4a19f4994a7896b9ca86ed46d934ef09fff6f2d8`.

[GitHub Actions run 41737127845](https://github.com/azmath25/quizer/actions/runs/41737127845) provides Node/backend/static, disposable Firebase emulator and Chromium mobile/author QA; **GitHub Actions itself never connects to live Neon, and the live-Neon evidence comes from the separate, explicitly scoped transactions above**.

## Remaining gates

1. **STG1-B credentials (not yet approved):** review a secret-management process for a genuinely restricted SQL-created `quizer_app` LOGIN with unique credentials, no elevated membership, fully enumerated table privileges, project/endpoint attestation and actual credential-based SQL session. Never use Neon MCP/API auto-created elevated roles or expose DB URLs in the frontend.
2. **Migration tracking:** the 001/002 source files are not independently idempotent; staging deployment requires a migration ledger and version-gated execution/rollback plan. Do not silently change the already rehearsed 001/002 SQL in place.
3. **STG1-C:** establish a distinct Firebase staging project/Auth/Firestore/GCS, private signing identity and explicitly staging-only web build; do not use the current `sat-quiz-fd317` as staging.
4. **STG1-D:** explicitly approved budget alerts, idle/cleanup policy and role/bucket access controls. The Free plan does not guarantee zero spend. The suspended disposable branch persists until explicit approval to remove it.
5. **STG2:** real authenticated Firebase–Neon–GCS end-to-end only after separate authorization, first using synthetic data; no production or legacy-user migration.

## Stop

**STG1-B database schema/recovery/permission rehearsal completed; runtime LOGIN and migration-runner gates remain OPEN.** The disposable branch was kept isolated and suspended. **No merge, deployment, production migration, Mimo access, Google Cloud changes or protected-branch changes.** Stop before any new resource mutation, credential provisioning or STG1-C.
