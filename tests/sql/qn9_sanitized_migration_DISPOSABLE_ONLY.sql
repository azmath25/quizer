-- QN9: SANITIZED SAMPLE ONLY on a verified NEW disposable Quizer-dev branch.
-- Never execute on default/main, production, or Mimo.
-- Mirrors syntheticLegacySnapshot(1) problem/revisions; the quiz and
-- historical student attempt remain only in Firebase and are NOT copied.
-- Expected SHA-256 values are from JS canonical ({content,grading}) hash.
BEGIN;
INSERT INTO quizer.problems
(problem_id,owner_uid,owner_display_name,title,subject,difficulty,
 bank_visibility,lifecycle,latest_revision_id,revision_number,version,
 created_at,updated_at)
VALUES ('prb_synth_0','teacher_synthetic','Synthetic teacher',
'Synthetic problem 0','Math','Practice','private','active','prv_0_2',
 2,2,'2026-10-01T10:00:00Z','2026-10-01T10:00:00Z');

INSERT INTO quizer.problem_revisions
(revision_id,problem_id,revision_number,content_json,grading_json,source_json,
 content_hash,created_by_uid,created_at)
VALUES
('prv_0_1','prb_synth_0',1,
 '{"type":"open","answerMode":"auto","statementLatex":"Find 1+1","options":[],"defaultPoints":2,"questionAssetBindings":{"synthetic-figure.png":"ast_figure"}}'::jsonb,
 '{"gradingVersion":1,"correctOptionId":null,"acceptedAnswers":["2"],"tolerance":0.000001,"explanationLatex":"","rubricLatex":"","solutionAssetBindings":{}}'::jsonb,
 '{"importJobId":null,"sourceAssetId":"ast_original_tex","originalQuestionId":"q_0"}'::jsonb,
 'ff5a16276cbf6c9a9b6ed958ba1ab798a725c65d20b4d1b01dcd3ad579d3f53d',
 'teacher_synthetic','2026-10-01T10:00:00Z'),
('prv_0_2','prb_synth_0',2,
 '{"type":"open","answerMode":"auto","statementLatex":"Find 2+1","options":[],"defaultPoints":2,"questionAssetBindings":{"synthetic-figure.png":"ast_figure"}}'::jsonb,
 '{"gradingVersion":1,"correctOptionId":null,"acceptedAnswers":["3"],"tolerance":0.000001,"explanationLatex":"","rubricLatex":"","solutionAssetBindings":{}}'::jsonb,
 '{"importJobId":null,"sourceAssetId":"ast_original_tex","originalQuestionId":"q_0"}'::jsonb,
 '9694675f1574c45378441f178d17e21dffdc9f5e5f058f651d07416b553df718',
 'teacher_synthetic','2026-10-01T10:00:00Z');
INSERT INTO quizer.problem_tags (problem_id,tag) VALUES ('prb_synth_0','synthetic');

DO $qn9$
DECLARE
  owner_id text;
  latest_id text;
  v integer;
  rev_count integer;
  old_answer text;
  latest_answer text;
  old_hash text;
  latest_hash text;
  source_id text;
BEGIN
  SELECT owner_uid,latest_revision_id,version
    INTO owner_id,latest_id,v
    FROM quizer.problems WHERE problem_id='prb_synth_0';
  IF owner_id <> 'teacher_synthetic' OR latest_id <> 'prv_0_2' OR v <> 2 THEN
    RAISE EXCEPTION 'QN9 ownership/version/pinned pointer mismatch';
  END IF;
  SELECT count(*) INTO rev_count FROM quizer.problem_revisions
    WHERE problem_id='prb_synth_0';
  IF rev_count <> 2 THEN RAISE EXCEPTION 'QN9 revision count mismatch'; END IF;
  SELECT grading_json->'acceptedAnswers'->>0,content_hash::text
    INTO old_answer,old_hash FROM quizer.problem_revisions
    WHERE revision_id='prv_0_1';
  SELECT grading_json->'acceptedAnswers'->>0,content_hash::text,
         source_json->>'sourceAssetId'
    INTO latest_answer,latest_hash,source_id FROM quizer.problem_revisions
    WHERE revision_id='prv_0_2';
  IF old_answer <> '2' OR latest_answer <> '3'
    OR old_hash <> 'ff5a16276cbf6c9a9b6ed958ba1ab798a725c65d20b4d1b01dcd3ad579d3f53d'
    OR latest_hash <> '9694675f1574c45378441f178d17e21dffdc9f5e5f058f651d07416b553df718'
    OR source_id <> 'ast_original_tex' THEN
      RAISE EXCEPTION 'QN9 protected grading/hash/source parity failure';
  END IF;
  IF (SELECT count(*) FROM quizer.quiz_revision_mirrors) <> 0 OR
     (SELECT count(*) FROM quizer.activity_events) <> 0 THEN
    RAISE EXCEPTION 'QN9 must not copy published quizzes or historical audit logs';
  END IF;
  -- A successful UPDATE is an error: only the trigger may stop it.
  DECLARE blocked boolean := false;
  BEGIN
    BEGIN
      UPDATE quizer.problem_revisions SET grading_json='{}'
        WHERE revision_id='prv_0_1';
    EXCEPTION WHEN raise_exception THEN
      blocked := true;
    END;
    IF NOT blocked THEN
      RAISE EXCEPTION 'QN9 immutable revision UPDATE unexpectedly succeeded';
    END IF;
  END;
END;
$qn9$;
COMMIT;
