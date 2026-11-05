-- QN4R disposable branch ONLY, after initial schema migration.
-- Roles created via the Neon MCP create_postgres_role tool inherited
-- neon_superuser in our observed account; NEVER use those as runtime roles.
-- These SQL-created NOLOGIN roles let us exercise least-privilege grants
-- without creating or storing reusable credentials. QN8 must separately
-- provision vetted LOGIN roles through a reviewed secret-management flow.
BEGIN;
CREATE ROLE quizer_app_limited NOLOGIN INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE quizer_reader_limited NOLOGIN INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA quizer TO quizer_app_limited,quizer_reader_limited;
GRANT SELECT,INSERT,UPDATE ON quizer.problems TO quizer_app_limited;
GRANT SELECT,INSERT ON quizer.problem_revisions TO quizer_app_limited;
GRANT SELECT,INSERT,UPDATE,DELETE ON quizer.problem_tags TO quizer_app_limited;
GRANT SELECT,INSERT ON quizer.import_receipts TO quizer_app_limited;
GRANT SELECT,INSERT ON quizer.activity_events TO quizer_app_limited;
GRANT SELECT ON quizer.activity_events TO quizer_reader_limited;
-- Owner may SET ROLE to run negative tests. It must NOT inherit either role.
GRANT quizer_app_limited TO quizer_owner WITH SET TRUE, INHERIT FALSE;
GRANT quizer_reader_limited TO quizer_owner WITH SET TRUE, INHERIT FALSE;
COMMIT;
