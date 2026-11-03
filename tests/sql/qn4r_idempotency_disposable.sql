-- QN4R ONLY. A disposable Quizer migration test branch, never production or Mimo.
-- Run after 001_initial_schema.sql and tests/sql/qn4_disposable_rehearsal.sql.
-- Verifies insert/replay/collision behavior. No historical records involved.
BEGIN;
DO $qn4r$
DECLARE event_count integer; receipt_count integer;
DECLARE event_hash text; receipt_hash text;
BEGIN
  INSERT INTO quizer.activity_events
    (event_id,actor_uid,actor_role,action,target_type,target_id,occurred_at,payload_hash)
  VALUES ('evt_qn4r_retry','teacher_demo','teacher','problem.saved','problem','prb_test',
    '2026-11-03T10:00:00Z',repeat('e',64))
  ON CONFLICT (event_id) DO NOTHING;

  -- Idempotent replay is a non-mutating conflict.
  INSERT INTO quizer.activity_events
    (event_id,actor_uid,actor_role,action,target_type,target_id,occurred_at,payload_hash)
  VALUES ('evt_qn4r_retry','teacher_demo','teacher','problem.saved','problem','prb_test',
    '2026-11-03T10:00:00Z',repeat('e',64))
  ON CONFLICT (event_id) DO NOTHING;

  -- Conflicting payload cannot silently overwrite the first event.
  INSERT INTO quizer.activity_events
    (event_id,actor_uid,actor_role,action,target_type,target_id,occurred_at,payload_hash)
  VALUES ('evt_qn4r_retry','teacher_demo','teacher','problem.saved','problem','prb_test',
    '2026-11-03T10:00:00Z',repeat('f',64))
  ON CONFLICT (event_id) DO NOTHING;

  SELECT count(*),min(payload_hash)::text
    INTO event_count,event_hash FROM quizer.activity_events
    WHERE event_id='evt_qn4r_retry';
  IF event_count <> 1 OR event_hash <> repeat('e',64) THEN
    RAISE EXCEPTION 'Event replay was not idempotent';
  END IF;
  IF event_hash = repeat('f',64) THEN
    RAISE EXCEPTION 'Event collision was not observable';
  END IF;

  INSERT INTO quizer.import_receipts
    (job_id,import_item_key,payload_hash,problem_id,revision_id)
  VALUES ('job_qn4r_retry','q1',repeat('a',64),'prb_test','rev_1')
  ON CONFLICT (job_id,import_item_key) DO NOTHING;
  INSERT INTO quizer.import_receipts
    (job_id,import_item_key,payload_hash,problem_id,revision_id)
  VALUES ('job_qn4r_retry','q1',repeat('a',64),'prb_test','rev_1')
  ON CONFLICT (job_id,import_item_key) DO NOTHING;
  INSERT INTO quizer.import_receipts
    (job_id,import_item_key,payload_hash,problem_id,revision_id)
  VALUES ('job_qn4r_retry','q1',repeat('b',64),'prb_test','rev_1')
  ON CONFLICT (job_id,import_item_key) DO NOTHING;

  SELECT count(*),min(payload_hash)::text
    INTO receipt_count,receipt_hash FROM quizer.import_receipts
    WHERE job_id='job_qn4r_retry' AND import_item_key='q1';
  IF receipt_count <> 1 OR receipt_hash <> repeat('a',64) THEN
    RAISE EXCEPTION 'Import retry was not idempotent';
  END IF;
  IF receipt_hash = repeat('b',64) THEN
    RAISE EXCEPTION 'Import collision was not observable';
  END IF;
END;
$qn4r$;
COMMIT;
