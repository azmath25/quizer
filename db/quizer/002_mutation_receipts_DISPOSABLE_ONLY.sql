-- QN11.2 STAGED SQL ONLY. DO NOT RUN AGAINST PRODUCTION OR MIMO.
-- Separate, explicit future approval required for a disposable Quizer branch.
-- This migration does NOT create roles, credentials, connections or privileges.
-- It is deliberately NOT applied in QN11.2.
BEGIN;
CREATE TABLE quizer.mutation_receipts (
  actor_uid varchar(128) NOT NULL
    CHECK (actor_uid ~ '^[A-Za-z0-9_-]+$'),
  request_id varchar(128) NOT NULL
    CHECK (request_id ~ '^[A-Za-z0-9_-]+$'),
  action text NOT NULL
    CHECK (action IN ('saveProblemRevision','setProblemSharing',
      'trashProblem','restoreProblem','bulkUpdateProblems','forkProblem')),
  payload_hash char(64) NOT NULL
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result_json jsonb NOT NULL
    CHECK (jsonb_typeof(result_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_uid, request_id)
);
REVOKE ALL ON quizer.mutation_receipts FROM PUBLIC;
-- Before a separately authorized runtime rehearsal, independently verify
-- SQL-provisioned LOGIN quizer_app is genuinely least-privileged; only then
-- GRANT SELECT, INSERT ON quizer.mutation_receipts TO quizer_app.
-- NEVER grant UPDATE or DELETE; completed receipts are immutable.
COMMIT;
