-- QN3 DESIGN ONLY — NEVER RUN AGAINST MIMO OR A PRODUCTION DATABASE.
-- Intended for a NEW, independent Quizer PostgreSQL project.
-- QN4 may run this on an explicitly authorized disposable test database.
-- Use a DIRECT (not pooled) migration connection, with a separate least-privilege app role.
BEGIN;

CREATE SCHEMA quizer;
REVOKE ALL ON SCHEMA quizer FROM PUBLIC;

CREATE TABLE quizer.problems (
  problem_id varchar(128) PRIMARY KEY
    CHECK (problem_id ~ '^[A-Za-z0-9_-]+$'),
  owner_uid varchar(128) NOT NULL
    CHECK (owner_uid ~ '^[A-Za-z0-9_-]+$'),
  owner_display_name varchar(200) NOT NULL DEFAULT '',
  title varchar(200) NOT NULL CHECK (length(btrim(title)) > 0),
  search_title varchar(200) GENERATED ALWAYS AS (lower(title)) STORED,
  subject varchar(80) NOT NULL DEFAULT '',
  difficulty varchar(40) NOT NULL DEFAULT '',
  bank_visibility text NOT NULL DEFAULT 'private'
    CHECK (bank_visibility IN ('private', 'teachers')),
  lifecycle text NOT NULL DEFAULT 'active'
    CHECK (lifecycle IN ('active', 'trashed')),
  latest_revision_id varchar(128) NOT NULL
    CHECK (latest_revision_id ~ '^[A-Za-z0-9_-]+$'),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  source_problem_id varchar(128),
  source_problem_revision_id varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  trashed_at timestamptz,
  CHECK (updated_at >= created_at)
);

-- Each revision holds the question and protected grading together.
-- The two JSON values are served only by authenticated, authorized server code.
CREATE TABLE quizer.problem_revisions (
  revision_id varchar(128) PRIMARY KEY
    CHECK (revision_id ~ '^[A-Za-z0-9_-]+$'),
  problem_id varchar(128) NOT NULL
    REFERENCES quizer.problems(problem_id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  content_json jsonb NOT NULL CHECK (jsonb_typeof(content_json) = 'object'),
  grading_json jsonb NOT NULL CHECK (jsonb_typeof(grading_json) = 'object'),
  source_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_json) = 'object'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_by_uid varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (problem_id, revision_id),
  UNIQUE (problem_id, revision_number)
);

-- Revision bodies/answer keys are append-only; old quizzes may reference
-- any earlier revision. Refuse UPDATE/DELETE even if an app bug tries it.
CREATE FUNCTION quizer.reject_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Problem revisions are immutable';
END;
$$;
CREATE TRIGGER quizer_problem_revision_immutable
BEFORE UPDATE OR DELETE ON quizer.problem_revisions
FOR EACH ROW EXECUTE FUNCTION quizer.reject_revision_mutation();

-- The newest revision is guaranteed to belong to this very problem.
-- Deferred FK allows parent+first revision to be created in ONE transaction.
ALTER TABLE quizer.problems
  ADD CONSTRAINT fk_quizer_latest_revision
  FOREIGN KEY (problem_id, latest_revision_id)
  REFERENCES quizer.problem_revisions(problem_id, revision_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE quizer.problem_tags (
  problem_id varchar(128) NOT NULL
    REFERENCES quizer.problems(problem_id) ON DELETE RESTRICT,
  tag varchar(60) NOT NULL CHECK (length(btrim(tag)) > 0),
  PRIMARY KEY (problem_id, tag)
);

-- Firebase import job is the orchestration authority. These rows only make
-- each extracted item idempotent across retries; source .tex remains in Storage.
CREATE TABLE quizer.import_receipts (
  job_id varchar(128) NOT NULL,
  import_item_key varchar(128) NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  problem_id varchar(128) NOT NULL,
  revision_id varchar(128) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, import_item_key),
  FOREIGN KEY (problem_id, revision_id)
    REFERENCES quizer.problem_revisions(problem_id, revision_id)
    ON DELETE RESTRICT
);

-- Future events only. event_id uniqueness is also the delivery receipt;
-- no historical test-log backfill and no separate duplicated receipt table.
CREATE TABLE quizer.activity_events (
  event_id varchar(128) PRIMARY KEY,
  actor_uid varchar(128) NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('student','teacher','admin','system')),
  action varchar(120) NOT NULL,
  target_type varchar(40) NOT NULL,
  target_id varchar(128) NOT NULL,
  quiz_id varchar(128),
  quiz_owner_uid varchar(128),
  changed_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);
COMMENT ON TABLE quizer.activity_events IS
  'Future-only minimal audit events; event_id is the idempotent Firebase outbox receipt. Never store student answers, secrets or signed URLs.';

-- OPTIONAL, DISABLED BY DEFAULT: compact archived metadata or published quiz
-- copies if QN7 benchmarking justifies it; NEVER the live student read path.
CREATE TABLE quizer.quiz_revision_mirrors (
  quiz_id varchar(128) NOT NULL,
  revision_id varchar(128) NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(snapshot_json) = 'object'),
  source_bundle_path text, -- private Storage path only, never a signed URL
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quiz_id, revision_id)
);

CREATE INDEX problems_owner_updated_idx
  ON quizer.problems (owner_uid, lifecycle, updated_at DESC, problem_id DESC);
CREATE INDEX problems_shared_updated_idx
  ON quizer.problems (updated_at DESC, problem_id DESC)
  WHERE bank_visibility = 'teachers' AND lifecycle = 'active';
CREATE INDEX problems_title_prefix_idx
  ON quizer.problems (search_title varchar_pattern_ops);
CREATE INDEX problem_tags_tag_idx ON quizer.problem_tags (tag, problem_id);
CREATE INDEX problem_revisions_history_idx
  ON quizer.problem_revisions (problem_id, revision_number DESC);
CREATE INDEX activity_actor_time_idx
  ON quizer.activity_events (actor_uid, occurred_at DESC, event_id DESC);
CREATE INDEX activity_quiz_time_idx
  ON quizer.activity_events (quiz_id, occurred_at DESC, event_id DESC)
  WHERE quiz_id IS NOT NULL;
CREATE INDEX activity_owner_time_idx
  ON quizer.activity_events (quiz_owner_uid, occurred_at DESC, event_id DESC)
  WHERE quiz_owner_uid IS NOT NULL;

REVOKE ALL ON ALL TABLES IN SCHEMA quizer FROM PUBLIC;
COMMIT;
