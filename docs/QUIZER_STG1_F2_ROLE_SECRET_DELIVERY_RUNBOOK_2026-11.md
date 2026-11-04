# Quizer STG1-F.2 — secure SQL role and secret-delivery preparation

Date: 2026-11-04 (Asia/Baku)
Repository: azmath25/quizer
Branch: work/quizer-audit-optimization-2026-11
Release order: STG → PROD → AI → PROD2

**Decision: PREPARED FOR INDEPENDENT REVIEW ONLY. NOT PROVISIONED. STG2 NO GO.**

## Verified scope / baseline

This milestone prepared a rollback-only SQL role/grant recipe, automated static tests, and this future operator runbook. It does not authorize or perform a database connection, SQL role creation, password assignment, data mutation, secret upload, cloud API enablement, IAM grant, deployment, merge or billing change.

Existing STG1-F.1 read-only inventory, not newly re-attested as a runtime login here:

- Quizer Neon project: soft-grass-35754518 (quizer-dev).
- Quizer disposable child: br-sweet-rice-b9ehdv9i (stg1b-disposable-2026-11-04), non-default, parent br-wispy-night-b9ug6kub.
- Database quizer, owner quizer_owner.
- Existing roles: quizer_owner (password login), quizer_app_limited (NOLOGIN) and quizer_reader_limited (NOLOGIN). The required runtime SQL role quizer_app was absent at last inspection.
- Firebase staging project quizer-staging-az26: billing last verified disabled; the user-selected $1/month target is NOT a hard project-wide cap.
- Existing Quizer Firebase project sat-quiz-fd317, Mimo, main/main-backup, AI/snipping branches and all production resources are excluded.

## Review-only SQL and tests

The SQL template at tests/sql/stg1f2_role_grants_DRY_RUN_ONLY.sql explicitly defines a fresh non-elevated SQL LOGIN, exact least-privilege grants, and an intentional final ROLLBACK. It has no password and no COMMIT. It is not wired to any migration executor or runtime. It is not a completed role provision. An operator must never change the ending to COMMIT casually.

tests/unit/stg1f2-role-review.test.mjs checks exact statement count, final rollback, no passwords, exact SQL grants, no privileges on the disabled mirror table, and no runtime or deploy references. The tests are static code-level checks, not an authorized real SQL session.

## Five-stage future operator procedure — NOT EXECUTED

### 0. Explicit new approval and identity checks

Obtain an explicit separate approval for real role provisioning on the named disposable child ONLY. Independently verify the exact project, child ID, parent/default flags, database owner, applied schema and role inventory immediately before any SQL. Stop on mismatches. Use a **direct, non-pooled** owner connection for DDL, never a browser or a default-branch connection. Do not use the Neon API role-creation shortcut: earlier Quizer tests observed unexpected neon_superuser inheritance.

### 1. Establish the approved secret destination before issuing credentials

Decide which dedicated **staging-only server-side service identity** will consume the credential. The preferred future destination is a dedicated Google Cloud Secret Manager secret scoped to quizer-staging-az26 and accessible solely to this runtime identity. Before any secret creation or IAM grants, the operator must independently verify billing policy, availability, actual service identity and secret-scoped minimum permissions. Billing is currently last known disabled, so there is NO authorization to enable Secret Manager billing, Blaze, Cloud Functions or cloud APIs. Never use Mimo's project, service account or secret store as an intermediate destination.

### 2. Create only the approved least-privilege SQL LOGIN

After explicit approval, a human operator may use the direct owner connection to adapt the reviewed SQL recipe into a **separately reviewed transactional apply script**. Use a SQL-created login, not an API-created role with unverified default Neon grants. Role quizer_app must have NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, and no membership in owner or neon_superuser groups. It must not own schemas or tables, have schema CREATE, or see disabled mirrors.

Required grants: schema USAGE; database CONNECT; SELECT/INSERT/UPDATE on quizer.problems; SELECT/INSERT on quizer.problem_revisions, quizer.import_receipts, quizer.activity_events and quizer.mutation_receipts; SELECT/INSERT/UPDATE/DELETE on quizer.problem_tags; no other table access. Treat any conflicting prior grants as an alarm, not as a reason to relax this contract.

### 3. Interactive password setting and server-only delivery

Only after the approved staging secret destination exists, set a strong random password through an operator-owned secure interactive procedure (for example psql's interactive \password quizer_app), not as a literal SQL command, GitHub file, shell argument, stdout, logs, or ChatGPT message. Build the TLS-enabled app connection URL only within that protected operator environment. The password must be URL-escaped correctly where needed. Use a reviewed secret-upload path that avoids command-line plaintext, exposed temporary files, clipboard/history and terminal echo; **never paste any secret into this chat**. Grant Secret Manager Secret Accessor on **only the exact staging secret** to the exact runtime service identity, not to anonymous users, entire projects or Mimo. Pin an explicit secret version on an approved future deployment, rather than relying on an implicit latest alias.

Google documentation warns that plaintext command-line secret values can leak via process lists and shell history: https://cloud.google.com/secret-manager/docs/add-secret-version. Access change propagation is not instantaneous: https://cloud.google.com/secret-manager/docs/reference/consistency.

### 4. Independent real SQL role validation (as runtime user)

Only after an approved connection as **actual quizer_app**, run the read-only tests/sql/stg1f_runtime_access_attestation_READ_ONLY.sql on the verified disposable child. It checks current_user, current_database, LOGIN, forbidden elevated privilege flags, neon_superuser membership, active TLS, schema CREATE/USAGE, exact table privileges and denial. Its endpoint_attested field is intentionally NULL: trusted management API evidence must independently prove endpoint mapping. Separately test *actual negative* UPDATE/DELETE/DDL with disposable, rolled-back transactions, and verify the two NOLOGIN fixtures remain NOLOGIN. Record sanitized booleans, identifiers and secret version numbers only.

### 5. Do not mount or deploy yet

Keep QUIZER_NEON_ENABLED=false and the integrated runtime unmounted. Legacy Firebase remains authoritative. Real staging Auth, Firestore rules/indexes, Storage, Cloud Functions, App Check, image signing, failure recovery, backups and measured costs, plus mobile physical-device checks, still require independent acceptance. The existence of a role or secret is not deployment authorization.

## Failure handling, rollback and retention

On any wrong endpoint, untrusted service identity, unexpectedly elevated role, broken grant matrix, exposed secret, missing budget evidence or incomplete independent attestation: STOP. Do not fall back to quizer_owner, a default branch or production credentials. If a future operator partially provisions resources, disable access and rotate credentials under separate approval; deletion or cleanup of committed roles/secrets also requires scope-specific approval. No automatic cleanup of unrelated resources.

## Result and next gate

STG1-F.2 is a **preparation** milestone. The SQL role, password, server-only Secret Manager destination, cloud billing controls and real integration remain UNPROVISIONED / UNVERIFIED. Next separately approved stage: choose and attest exact Quizer staging runtime service identity and secret destination, review billing limitations and only then consider actual restricted role creation and independent attestation.

**No merges, production changes, Neon SQL execution, Firebase/GCP changes or Mimo access. STG2 NO GO.**
