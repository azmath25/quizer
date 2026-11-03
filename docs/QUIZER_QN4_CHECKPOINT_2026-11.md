# Quizer QN4 checkpoint — disposable PostgreSQL migration rehearsal

Date: 2026-11-03. Branch: `work/quizer-audit-optimization-2026-11`.

**Result: runnable rehearsal and safety tests committed; actual PostgreSQL execution BLOCKED.** The environment has Node.js but lacks `psql`, `initdb` and a PostgreSQL server. No disposable Quizer database was provided. Existing Neon/Mimo or production databases were not contacted.

## Implemented (QN4 only)

- `scripts/qn4-local-rehearsal.mjs`: rejects non-loopback hosts and any database not named `quizer_qn4_disposable_*`; requires explicit `QUIZER_QN4_APPROVAL=YES_LOCAL_DISPOSABLE`. Refuses a database already containing the `quizer` schema. Applies versioned SQL, runs regression SQL, and cleans up the test schema in a `finally` block. Sanitizes stderr and overrides inherited libpq host address/service settings. Does not create databases or remotely provision anything.
- `tests/sql/qn4_disposable_rehearsal.sql`: transaction-scoped synthetic tests for initially-deferred FK and missing target, immutable revision UPDATE/DELETE rejection, tag/import/event uniqueness, metadata preservation, newer immutable revision, eight indexes and keyset query.
- `tests/unit/qn4-disposable-guard.test.mjs`: guarded connection tests, production/nonlocal refusal, explicit approval, SQL/checkpoint structural assertions.
- Rollback remains `db/quizer/001_rollback_DISPOSABLE_ONLY.sql`; it destroys only the newly created `quizer` schema inside the approved localhost disposable database.

## Isolated verification performed

- **7/7** localhost safety-target cases passed by executing the exact committed guard function in V8 with a URL shim (valid disposable target, missing approval, remote host, Mimo DB, production DB, URL override, wrong protocol).
- **6/6** structural assertions passed against committed SQL and runner source, including the transaction boundary, FK/immutability tests, rollback and inherited-libpq-host overrides.
- **No PostgreSQL server was available:** these results do **not** verify that the schema applies or that the SQL assertions/rollback execute successfully.

## Next operator verification (not performed)

Provision a **new local empty** PostgreSQL database with a name beginning `quizer_qn4_disposable_` and grant its test role sufficient DDL rights, then from a complete checkout run:

```bash
QUIZER_QN4_APPROVAL=YES_LOCAL_DISPOSABLE \
QUIZER_QN4_DATABASE_URL='postgresql://local_tester:REDACTED@127.0.0.1:5432/quizer_qn4_disposable_test' \
node scripts/qn4-local-rehearsal.mjs
node --test tests/unit/qn4-disposable-guard.test.mjs
```

Use a fresh disposable target; the script verifies that the schema doesn't preexist. No live DB credentials are ever accepted by the guard. A full DDL apply, SQL assertion pass, rollback, permission/EXPLAIN plan inspection, and CI execution are **not yet verified**.

## Gate

QN4 code/checkpoint only. No merge, deployment, production data change, Mimo changes, Neon project creation, or deletion of old quizzes/logs. QN5 may proceed only as disabled-by-default repo code and mock tests; QN4's real database evidence remains an open release blocker.
