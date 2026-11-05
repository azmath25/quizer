-- STG1-F.2: REVIEW-ONLY, TRANSACTIONAL DRY RUN.
-- DO NOT APPLY AGAINST NEON WITHOUT A SEPARATE APPROVAL.
-- Target ONLY quizer-dev / soft-grass-35754518,
-- non-default child br-sweet-rice-b9ehdv9i, database quizer.
-- Must use direct (non-pooled) owner connection from an approved operator.
-- No password is included. No LOGIN credential is issued by this script.
-- ROLLBACK IS INTENTIONAL. DO NOT REPLACE IT WITH COMMIT BY ACCIDENT.
-- Never run on Mimo, main/default, production, or Firebase resources.

BEGIN;

-- An intentionally *new* SQL-created role, not a Neon API-created role.
-- All elevated role bits must also be independently audited after approval.
CREATE ROLE quizer_app
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

-- Explicit permission contract; do not rely on default table grants.
GRANT CONNECT ON DATABASE quizer TO quizer_app;
REVOKE ALL ON SCHEMA quizer FROM quizer_app;
GRANT USAGE ON SCHEMA quizer TO quizer_app;
REVOKE ALL ON ALL TABLES IN SCHEMA quizer FROM quizer_app;

GRANT SELECT, INSERT, UPDATE ON quizer.problems TO quizer_app;
GRANT SELECT, INSERT ON quizer.problem_revisions TO quizer_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON quizer.problem_tags TO quizer_app;
GRANT SELECT, INSERT ON quizer.import_receipts TO quizer_app;
GRANT SELECT, INSERT ON quizer.activity_events TO quizer_app;
GRANT SELECT, INSERT ON quizer.mutation_receipts TO quizer_app;

-- Intentionally no grants on quizer.quiz_revision_mirrors (disabled).
-- DO NOT grant membership in neon_superuser, quizer_owner or any admin role.
-- A real approved promotion must separately arrange secret handling and
-- recheck current_user and every allow/deny permission AS quizer_app.

ROLLBACK;
