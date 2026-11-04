-- STG1-F.1 READ-ONLY runtime-role attestation template.
-- For a SEPARATELY AUTHORIZED future operator, connected AS quizer_app
-- to DATABASE quizer on Quizer disposable branch br-sweet-rice-b9ehdv9i.
-- Never run as quizer_owner: that does not prove app-level privileges.
-- No role creation, grants, passwords, IAM changes or data reads/writes.
-- TLS is checked for this backend connection; endpoint-to-project mapping
-- MUST be independently verified by trusted Neon management metadata.
-- "endpoint_attested" stays NULL, deliberately requiring that separate proof.
-- The query's permission matrix exactly matches the staged app role contract.
SELECT
  current_user AS role_name,
  current_database() AS database_name,
  r.rolcanlogin,
  r.rolsuper,
  r.rolcreatedb,
  r.rolcreaterole,
  r.rolreplication,
  r.rolbypassrls,
  EXISTS (
    SELECT 1 FROM pg_roles AS s
    WHERE s.rolname='neon_superuser'
      AND pg_has_role(current_user,s.oid,'MEMBER')
  ) AS inherited_neon_superuser,
  (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())
    AS tls_verified,
  NULL::boolean AS endpoint_attested,
  has_schema_privilege(current_user,'quizer','USAGE') AS schema_usage,
  has_schema_privilege(current_user,'quizer','CREATE') AS schema_create,
  (
    has_table_privilege(current_user,'quizer.problems','SELECT')
    AND has_table_privilege(current_user,'quizer.problems','INSERT')
    AND has_table_privilege(current_user,'quizer.problems','UPDATE')
    AND NOT has_table_privilege(current_user,'quizer.problems','DELETE')
    AND has_table_privilege(current_user,'quizer.problem_revisions','SELECT')
    AND has_table_privilege(current_user,'quizer.problem_revisions','INSERT')
    AND NOT has_table_privilege(current_user,'quizer.problem_revisions','UPDATE')
    AND NOT has_table_privilege(current_user,'quizer.problem_revisions','DELETE')
    AND has_table_privilege(current_user,'quizer.problem_tags','SELECT')
    AND has_table_privilege(current_user,'quizer.problem_tags','INSERT')
    AND has_table_privilege(current_user,'quizer.problem_tags','UPDATE')
    AND has_table_privilege(current_user,'quizer.problem_tags','DELETE')
    AND has_table_privilege(current_user,'quizer.import_receipts','SELECT')
    AND has_table_privilege(current_user,'quizer.import_receipts','INSERT')
    AND NOT has_table_privilege(current_user,'quizer.import_receipts','UPDATE')
    AND NOT has_table_privilege(current_user,'quizer.import_receipts','DELETE')
    AND has_table_privilege(current_user,'quizer.activity_events','SELECT')
    AND has_table_privilege(current_user,'quizer.activity_events','INSERT')
    AND NOT has_table_privilege(current_user,'quizer.activity_events','UPDATE')
    AND NOT has_table_privilege(current_user,'quizer.activity_events','DELETE')
    AND NOT has_table_privilege(current_user,'quizer.quiz_revision_mirrors','SELECT')
    AND NOT has_table_privilege(current_user,'quizer.quiz_revision_mirrors','INSERT')
    AND NOT has_table_privilege(current_user,'quizer.quiz_revision_mirrors','UPDATE')
    AND NOT has_table_privilege(current_user,'quizer.quiz_revision_mirrors','DELETE')
    AND has_table_privilege(current_user,'quizer.mutation_receipts','SELECT')
    AND has_table_privilege(current_user,'quizer.mutation_receipts','INSERT')
    AND NOT has_table_privilege(current_user,'quizer.mutation_receipts','UPDATE')
    AND NOT has_table_privilege(current_user,'quizer.mutation_receipts','DELETE')
  ) AS permission_matrix_pass
FROM pg_roles AS r
WHERE r.rolname=current_user;
