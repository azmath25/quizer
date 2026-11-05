# Quizer STG1-F.1 — restricted runtime SQL access preflight

Checkpoint date: 2026-11-04 (Asia/Baku)
Repository: azmath25/quizer
Branch: work/quizer-audit-optimization-2026-11
Status: **SQL RUNTIME ACCESS NOT READY — STG2 NO GO**.

## Read-only Neon inventory

Read-only Neon management queries targeted only Quizer project soft-grass-35754518 and disposable child branch br-sweet-rice-b9ehdv9i.

- The child stg1b-disposable-2026-11-04 retains parent br-wispy-night-b9ug6kub; both default and primary are false.
- Database quizer exists, owned by quizer_owner.
- Reported roles: quizer_owner (password login), quizer_app_limited (NOLOGIN), quizer_reader_limited (NOLOGIN).
- **Dedicated runtime SQL LOGIN quizer_app does not exist.** Never use quizer_owner for runtime app traffic.
- Role metadata alone does not prove underlying SQL grants, privilege flags, TLS for app connections or endpoint attestation. No SQL connection was opened.

## Files committed on the work branch

1. scripts/staging/quizer-stg1f-access-gate.mjs — Pure offline safety inspector. It rejects wrong project/default branch, credentials, elevated or incomplete SQL attestation and missing Firebase proofs. Even synthetic all-green evidence is never an authorization to deploy. It has no network, SQL driver, write actions or secrets.
2. tests/unit/stg1f-access-gate.test.mjs — Safety tests for isolation, role privileges, credential refusal, stage status, and SQL query read-only structure.
3. tests/sql/stg1f_runtime_access_attestation_READ_ONLY.sql — Single read-only SELECT prepared for an independently approved operator to run **as actual quizer_app**, not quizer_owner, only on the disposable Quizer child. Checks LOGIN, elevated role flags, neon_superuser membership, current database, connection TLS, schema CREATE/USAGE and table permission matrix. The endpoint_attested column deliberately remains NULL: external trusted Neon endpoint identity must be verified separately.

**The attestation SQL has NOT been executed**: no runtime SQL LOGIN exists. JSON inputs to the offline checker are not trusted live evidence.

## Runtime least-privilege contract — not yet applied

| SQL object | Required app grants | Forbidden |
| --- | --- | --- |
| quizer.problems | SELECT, INSERT, UPDATE | DELETE |
| quizer.problem_revisions | SELECT, INSERT | UPDATE, DELETE |
| quizer.problem_tags | SELECT, INSERT, UPDATE, DELETE | — |
| quizer.import_receipts | SELECT, INSERT | UPDATE, DELETE |
| quizer.activity_events | SELECT, INSERT | UPDATE, DELETE |
| quizer.quiz_revision_mirrors | None, feature disabled | All access |
| quizer.mutation_receipts | SELECT, INSERT | UPDATE, DELETE |
| schema quizer | USAGE | CREATE |

The actual SQL runtime role must have rolcanlogin=true, and rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls and inherited neon_superuser all false. Do not create it via API and trust the default grant state: earlier Quizer rehearsal found unexpectedly powerful inherited rights from API-created roles. A later approved provisioning operation must establish and independently prove the final role privileges.

## Pending gates

- One-time approved restricted SQL LOGIN creation and direct server-only secret delivery; no passwords in GitHub, browser, transcript or model files.
- Independent endpoint-to-project mapping and TLS, exact table-level permission-negative tests, migration ledger and reviewed executor.
- Real staging Google sign-in, final role-aware Firestore rules, Storage/Functions/App Check, cross-store publish/read/grade and failure recovery.
- Staging billing still last reported disabled; owner $1/month budget target is not a hard overall cost cap. No Blaze upgrade or paid service provisioning authorized.
- Real restore/rollback drill and documented explicit STG2 approval.

## Isolation and stop declaration

No Mimo, Quizer production, main/main-backup, AI/snipping branch, deployed routes, Firebase/IAM/billing, Neon schemas/roles, passwords or secrets were modified. Only read-only Neon metadata and work-branch source/tests/docs were involved.

The next bounded milestone, **STG1-F.2**, is a separately approved procedure for secure role provisioning and secret delivery. It must not be executed merely because this report exists. STG1 overall remains incomplete and STG2 remains NO GO.
