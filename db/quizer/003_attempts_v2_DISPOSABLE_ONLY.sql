-- QUIZER N-A1: CREATE-ONLY / DISPOSABLE NEON BRANCH REHEARSAL.
-- NEVER apply to the live sat-quiz-live-2026-11 branch without a separate
-- reviewed migration, backout plan, authorized Firebase-verified gateway,
-- and confirmed pg role permissions. Quizer remains Firebase-attempt-owned.
-- No Mimo project/database or client-side database connection is involved.
BEGIN;

CREATE TABLE quizer.attempts_v2 (
  attempt_id varchar(128) PRIMARY KEY
    CHECK (attempt_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  firebase_project_id text NOT NULL DEFAULT 'sat-quiz-fd317'
    CHECK (firebase_project_id = 'sat-quiz-fd317'),
  quiz_id varchar(128) NOT NULL
    CHECK (quiz_id ~ '^[A-Za-z0-9_-]+$'),
  quiz_revision_id varchar(128) NOT NULL
    CHECK (quiz_revision_id ~ '^[A-Za-z0-9_-]+$'),
  bundle_sha256 char(64) NOT NULL
    CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  bundle_generation varchar(23) NOT NULL
    CHECK (bundle_generation ~ '^[1-9][0-9]{0,22}$'),
  student_uid varchar(128) NOT NULL
    CHECK (student_uid ~ '^[A-Za-z0-9_-]+$'),
  teacher_uid varchar(128) NOT NULL,
  source_attempt_id varchar(128),
  attempt_mode text NOT NULL DEFAULT 'standard'
    CHECK (attempt_mode IN ('standard','retry_incorrect')),
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active','submitted','abandoned','expired','terminated')),
  grade_state text NOT NULL DEFAULT 'not_started'
    CHECK (grade_state IN ('not_started','grading','pending_manual','final','failed')),
  answer_version bigint NOT NULL DEFAULT 0 CHECK (answer_version >= 0),
  ui_version bigint NOT NULL DEFAULT 0 CHECK (ui_version >= 0),
  item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 500),
  settings_json jsonb NOT NULL
    CHECK (jsonb_typeof(settings_json) = 'object'),
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz,
  frozen_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (deadline_at IS NULL OR deadline_at >= started_at),
  CHECK ((state='active' AND frozen_at IS NULL)
      OR (state<>'active' AND frozen_at IS NOT NULL))
);
CREATE UNIQUE INDEX quizer_active_attempt_per_student_v2
  ON quizer.attempts_v2 (quiz_id, student_uid)
  WHERE state='active';
CREATE INDEX quizer_attempts_by_student_v2
  ON quizer.attempts_v2 (student_uid, started_at DESC);
CREATE INDEX quizer_attempts_by_teacher_v2
  ON quizer.attempts_v2 (teacher_uid, started_at DESC);
CREATE INDEX quizer_attempts_by_quiz_v2
  ON quizer.attempts_v2 (quiz_id, started_at DESC);

-- Every valid item is captured from an independently verified published bundle
-- by trusted server code at attempt start. No student may create an item pin.
CREATE TABLE quizer.attempt_items_v2 (
  attempt_id varchar(128) NOT NULL
    REFERENCES quizer.attempts_v2(attempt_id) ON DELETE RESTRICT,
  item_id varchar(128) NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 499),
  problem_id varchar(128) NOT NULL,
  problem_revision_id varchar(128) NOT NULL,
  points numeric(12,6) NOT NULL CHECK (points > 0 AND points <= 1000),
  PRIMARY KEY (attempt_id,item_id),
  UNIQUE (attempt_id,ordinal)
);

CREATE TABLE quizer.attempt_answers_v2 (
  attempt_id varchar(128) NOT NULL,
  item_id varchar(128) NOT NULL,
  answer_text text NOT NULL
    CHECK (octet_length(answer_text) <= 65536),
  answer_revision bigint NOT NULL CHECK (answer_revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id,item_id),
  FOREIGN KEY(attempt_id,item_id)
    REFERENCES quizer.attempt_items_v2(attempt_id,item_id) ON DELETE RESTRICT
);
CREATE INDEX quizer_attempt_answers_updated_v2
  ON quizer.attempt_answers_v2(attempt_id,updated_at DESC);

CREATE TABLE quizer.attempt_answer_events_v2 (
  attempt_id varchar(128) NOT NULL,
  item_id varchar(128) NOT NULL,
  answer_revision bigint NOT NULL CHECK (answer_revision >= 1),
  answer_text text NOT NULL CHECK (octet_length(answer_text) <= 65536),
  actor_uid varchar(128) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id,item_id,answer_revision),
  FOREIGN KEY(attempt_id,item_id)
    REFERENCES quizer.attempt_items_v2(attempt_id,item_id) ON DELETE RESTRICT
);

-- Committed request IDs always return their original response, including
-- after an uncertain network failure. No secrets or answer keys in receipts.
CREATE TABLE quizer.attempt_receipts_v2 (
  actor_uid varchar(128) NOT NULL,
  request_id varchar(128) NOT NULL,
  attempt_id varchar(128) NOT NULL
    REFERENCES quizer.attempts_v2(attempt_id) ON DELETE RESTRICT,
  operation text NOT NULL
    CHECK (operation IN ('startAttempt','saveAnswers','submitAttempt',
      'abandonAttempt','saveAttemptUiState','navigateAttempt')),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_uid, request_id)
);
CREATE INDEX quizer_attempt_receipts_target_v2
  ON quizer.attempt_receipts_v2 (attempt_id,created_at DESC);

CREATE TABLE quizer.attempt_grades_v2 (
  attempt_id varchar(128) NOT NULL,
  item_id varchar(128) NOT NULL,
  grade_version bigint NOT NULL CHECK (grade_version >= 1),
  status text NOT NULL CHECK (status IN
    ('correct','incorrect','skipped','partial','pending_manual')),
  awarded_points numeric(12,6) NOT NULL CHECK (awarded_points >= 0),
  feedback_text text NOT NULL DEFAULT '',
  graded_by_uid varchar(128) NOT NULL,
  graded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id,item_id,grade_version),
  FOREIGN KEY (attempt_id,item_id)
    REFERENCES quizer.attempt_items_v2(attempt_id,item_id) ON DELETE RESTRICT
);

CREATE TABLE quizer.attempt_results_v2 (
  attempt_id varchar(128) PRIMARY KEY
    REFERENCES quizer.attempts_v2(attempt_id) ON DELETE RESTRICT,
  grade_version bigint NOT NULL CHECK (grade_version >= 1),
  score numeric(12,6) NOT NULL CHECK (score >= 0),
  possible numeric(12,6) NOT NULL CHECK (possible > 0),
  pending_manual integer NOT NULL DEFAULT 0 CHECK (pending_manual >= 0),
  score_release text NOT NULL CHECK (score_release IN
    ('immediate','manual','afterClose')),
  solution_release text NOT NULL CHECK (solution_release IN
    ('immediate','manual','afterClose','never')),
  computed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (score <= possible)
);

-- Firestore notification/catalog projections are derived, never second
-- mutable truth. At-least-once relay consumes only committed outbox rows.
CREATE TABLE quizer.attempt_outbox_v2 (
  event_id varchar(128) PRIMARY KEY,
  attempt_id varchar(128) NOT NULL
    REFERENCES quizer.attempts_v2(attempt_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN
    ('attempt.started','attempt.submitted','attempt.abandoned',
     'attempt.expired','attempt.terminated','grade.completed')),
  event_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(event_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0)
);
CREATE INDEX quizer_attempt_outbox_pending_v2
  ON quizer.attempt_outbox_v2 (created_at,event_id)
  WHERE delivered_at IS NULL;

-- Firestore+Neon cannot share a transaction. Receipts and outbox are
-- append-only event evidence; mutable delivery status belongs to the relay.
CREATE FUNCTION quizer.reject_attempt_v2_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Quizer v2 attempt history and receipts are immutable';
END; $$;
CREATE TRIGGER quizer_attempt_events_v2_immutable
  BEFORE UPDATE OR DELETE ON quizer.attempt_answer_events_v2
  FOR EACH ROW EXECUTE FUNCTION quizer.reject_attempt_v2_immutable();
CREATE TRIGGER quizer_attempt_receipts_v2_immutable
  BEFORE UPDATE OR DELETE ON quizer.attempt_receipts_v2
  FOR EACH ROW EXECUTE FUNCTION quizer.reject_attempt_v2_immutable();

-- Fail closed: migrating a table must not grant browser or generic PUBLIC
-- access. Future role grants require a separate verified release.
REVOKE ALL ON quizer.attempts_v2,
  quizer.attempt_items_v2,quizer.attempt_answers_v2,
  quizer.attempt_answer_events_v2,quizer.attempt_receipts_v2,
  quizer.attempt_grades_v2,quizer.attempt_results_v2,
  quizer.attempt_outbox_v2 FROM PUBLIC;
COMMIT;
