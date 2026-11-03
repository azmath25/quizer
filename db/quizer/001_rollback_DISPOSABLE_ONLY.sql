-- DANGEROUS: QN4 DISPOSABLE DATABASE ONLY.
-- Destructively removes all QN3 Quizer schema tables and data.
-- NEVER execute on production, Mimo, or any database containing real quizzes.
-- This file is a rehearsable rollback artifact, NOT an automatic migration.
BEGIN;
DROP SCHEMA quizer CASCADE;
COMMIT;
