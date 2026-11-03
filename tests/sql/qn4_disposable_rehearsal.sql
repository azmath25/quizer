-- QN4 only: run on newly created localhost database
-- quizer_qn4_disposable_* with separate explicit approval.
-- Assumes db/quizer/001_initial_schema.sql was already applied.

INSERT INTO quizer.problems
  (problem_id,owner_uid,title,latest_revision_id,revision_number,version)
VALUES ('prb_test','teacher_demo','Synthetic','rev_1',1,1);
INSERT INTO quizer.problem_revisions
  (revision_id,problem_id,revision_number,content_json,grading_json,content_hash,created_by_uid)
VALUES
  ('rev_1','prb_test',1,'{"statementLatex":"x+1"}','{"acceptedAnswers":["2"]}',
   repeat('a',64),'teacher_demo');

-- FK is deferred: forward reference in same transaction is valid.
DO $$
BEGIN
  IF (SELECT count(*) FROM quizer.problems WHERE problem_id='prb_test') <> 1 THEN
    RAISE EXCEPTION 'initial problem missing';
  END IF;
END $$;

-- A non-existing latest revision cannot become committed: force validation
-- inside a subtransaction and assert the FK is rejected.
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO quizer.problems (problem_id, owner_uid, title,
      latest_revision_id, revision_number)
    VALUES ('prb_invalid','teacher_demo','Wrong FK','rev_missing',1);
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN foreign_key_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'deferred FK failed to reject bad revision'; END IF;
END $$;
SET CONSTRAINTS ALL DEFERRED;

-- Immutable previous revision: both UPDATE and DELETE must fail.
DO $$
DECLARE blocked boolean;
BEGIN
  blocked := false;
  BEGIN
    UPDATE quizer.problem_revisions SET content_json='{}'
    WHERE revision_id='rev_1';
  EXCEPTION WHEN raise_exception THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'revision UPDATE not blocked'; END IF;
  blocked := false;
  BEGIN
    DELETE FROM quizer.problem_revisions WHERE revision_id='rev_1';
  EXCEPTION WHEN raise_exception THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'revision DELETE not blocked'; END IF;
END $$;

INSERT INTO quizer.problem_tags (problem_id,tag) VALUES ('prb_test','parity');
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO quizer.problem_tags (problem_id,tag) VALUES ('prb_test','parity');
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'tag uniqueness failed'; END IF;
END $$;

INSERT INTO quizer.import_receipts
 (job_id,import_item_key,payload_hash,problem_id,revision_id)
VALUES ('job_test','q1',repeat('b',64),'prb_test','rev_1');
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO quizer.import_receipts
      (job_id,import_item_key,payload_hash,problem_id,revision_id)
    VALUES ('job_test','q1',repeat('c',64),'prb_test','rev_1');
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'import receipt uniqueness failed'; END IF;
END $$;

INSERT INTO quizer.activity_events
(event_id,actor_uid,actor_role,action,target_type,target_id,occurred_at,payload_hash)
VALUES ('evt_test','teacher_demo','teacher','problem.created','problem','prb_test',
 now(),repeat('d',64));
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO quizer.activity_events
      (event_id,actor_uid,actor_role,action,target_type,target_id,occurred_at,payload_hash)
    VALUES ('evt_test','teacher_demo','teacher','problem.created','problem','prb_test',
      now(),repeat('d',64));
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'event uniqueness failed'; END IF;
END $$;

-- Metadata updates must not affect old question revisions.
UPDATE quizer.problems
SET title='Renamed',version=version+1 WHERE problem_id='prb_test';
DO $$
BEGIN
  IF (SELECT revision_number FROM quizer.problems WHERE problem_id='prb_test') <> 1
    OR (SELECT content_json->>'statementLatex' FROM quizer.problem_revisions
      WHERE revision_id='rev_1') <> 'x+1'
  THEN RAISE EXCEPTION 'metadata update mutated old revision'; END IF;
END $$;

INSERT INTO quizer.problem_revisions
(revision_id,problem_id,revision_number,content_json,grading_json,content_hash,created_by_uid)
VALUES ('rev_2','prb_test',2,'{"statementLatex":"x+2"}','{"acceptedAnswers":["3"]}',
 repeat('e',64),'teacher_demo');
UPDATE quizer.problems SET latest_revision_id='rev_2',revision_number=2,
version=version+1 WHERE problem_id='prb_test';

DO $$
BEGIN
  IF (SELECT count(*) FROM quizer.problem_revisions
      WHERE problem_id='prb_test') <> 2 THEN
    RAISE EXCEPTION 'old immutable revision lost'; END IF;
  IF (SELECT count(*) FROM pg_indexes
      WHERE schemaname='quizer') < 8 THEN
    RAISE EXCEPTION 'expected indexes missing'; END IF;
  IF (SELECT count(*) FROM quizer.problems
      WHERE owner_uid='teacher_demo'
        AND (updated_at,problem_id) <= (now(),'zzzz')) <> 1 THEN
    RAISE EXCEPTION 'keyset paging predicate incorrect'; END IF;
END $$;
