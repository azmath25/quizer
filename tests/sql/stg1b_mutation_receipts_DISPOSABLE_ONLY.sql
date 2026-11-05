-- STG1-B disposable Quizer CHILD branch ONLY; NEVER default main, production or Mimo.
-- Prerequisites: 001_initial_schema.sql + 002_mutation_receipts_DISPOSABLE_ONLY.sql.
-- Test-only NOLOGIN roles from qn4r_least_privilege_DISPOSABLE_ONLY.sql
-- plus GRANT SELECT,INSERT ON quizer.mutation_receipts TO quizer_app_limited.
-- This test is transactionally self-cleaning: synthetic receipts do not persist.
BEGIN;
SAVEPOINT stg1b_synthetic;
DO $stg1b$
DECLARE n integer; saved_hash text; blocked boolean;
BEGIN
  INSERT INTO quizer.mutation_receipts
    (actor_uid,request_id,action,payload_hash,result_json)
  VALUES ('teacher_demo','stg1b_req_001','saveProblemRevision',
    repeat('a',64),'{"problemId":"prb_test","version":2}'::jsonb)
  ON CONFLICT DO NOTHING;
  INSERT INTO quizer.mutation_receipts
    (actor_uid,request_id,action,payload_hash,result_json)
  VALUES ('teacher_demo','stg1b_req_001','saveProblemRevision',
    repeat('a',64),'{"problemId":"prb_test","version":2}'::jsonb)
  ON CONFLICT DO NOTHING;
  INSERT INTO quizer.mutation_receipts
    (actor_uid,request_id,action,payload_hash,result_json)
  VALUES ('teacher_demo','stg1b_req_001','saveProblemRevision',
    repeat('b',64),'{"problemId":"different"}'::jsonb)
  ON CONFLICT DO NOTHING;
  SELECT count(*),min(btrim(payload_hash)) INTO n,saved_hash
    FROM quizer.mutation_receipts
    WHERE actor_uid='teacher_demo' AND request_id='stg1b_req_001';
  IF n<>1 OR saved_hash<>repeat('a',64) THEN
    RAISE EXCEPTION 'Mutation receipt replay/first-writer invariant failed';
  END IF;
  blocked:=false;
  BEGIN
    INSERT INTO quizer.mutation_receipts
      (actor_uid,request_id,action,payload_hash,result_json)
    VALUES ('teacher_demo','stg1b_invalid_action','createProblem',
      repeat('a',64),'{}'::jsonb);
  EXCEPTION WHEN check_violation THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Invalid receipt action accepted'; END IF;
  blocked:=false;
  BEGIN
    INSERT INTO quizer.mutation_receipts
      (actor_uid,request_id,action,payload_hash,result_json)
    VALUES ('teacher_demo','stg1b_invalid_hash','saveProblemRevision',
      'bad_hash','{}'::jsonb);
  EXCEPTION WHEN check_violation THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Invalid receipt digest accepted'; END IF;
  blocked:=false;
  BEGIN
    INSERT INTO quizer.mutation_receipts
      (actor_uid,request_id,action,payload_hash,result_json)
    VALUES ('teacher_demo','stg1b_invalid_json','saveProblemRevision',
      repeat('a',64),'[]'::jsonb);
  EXCEPTION WHEN check_violation THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Array result receipt accepted'; END IF;
  blocked:=false;
  BEGIN
    INSERT INTO quizer.mutation_receipts
      (actor_uid,request_id,action,payload_hash,result_json)
    VALUES ('teacher_demo','stg1b_req_001','saveProblemRevision',
      repeat('a',64),'{}'::jsonb);
  EXCEPTION WHEN unique_violation THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Duplicate receipt PK accepted'; END IF;
END $stg1b$;
ROLLBACK TO SAVEPOINT stg1b_synthetic;
DO $stg1b_security$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,
      rolbypassrls,pg_has_role(rolname,'neon_superuser','MEMBER') AS privileged
    FROM pg_roles WHERE rolname IN ('quizer_app_limited','quizer_reader_limited')
  LOOP
    IF r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
       OR r.rolbypassrls OR r.privileged THEN
      RAISE EXCEPTION 'Staging test role has elevated permissions: %',r.rolname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN
      ('quizer_app_limited','quizer_reader_limited')) <> 2 THEN
    RAISE EXCEPTION 'Expected two SQL-created NOLOGIN test roles';
  END IF;
  IF NOT has_table_privilege('quizer_app_limited',
      'quizer.mutation_receipts','INSERT')
     OR has_table_privilege('quizer_app_limited',
      'quizer.mutation_receipts','UPDATE')
     OR has_table_privilege('quizer_reader_limited',
      'quizer.problem_revisions','SELECT')
     OR NOT has_table_privilege('quizer_reader_limited',
      'quizer.activity_events','SELECT') THEN
    RAISE EXCEPTION 'Least-privilege SQL matrix is incorrect';
  END IF;
END $stg1b_security$;
COMMIT;
