# Quizer STG2.6 — disposable reset and restore rehearsal

Date: 2026-11-04 (Asia/Baku)
Work branch: `work/quizer-audit-optimization-2026-11`
Status: **synthetic Firestore emulator rehearsal implemented; real staging reset/rollback NOT proven**.

## Scoped test

`tests/integration/stg2-6-emulator-reset-restore.test.mjs` requires the `demo-mathquiz-v2` Firestore emulator, creates a uniquely named `stg2Synthetic/stg2reset_<random>/records/` namespace with three **fake** records (problem, quiz, attempt), and:

1. Captures and checks an exact snapshot of its synthetic fixture records.
2. Deletes only the three allowlisted fixture documents and confirms the namespace is empty.
3. Restores the snapshot via **create-only** writes, checks byte-equivalent data structure and confirms a second restore cannot overwrite an occupied record.
4. Deletes only those same synthetic fixture documents and verifies the final cleanup.
5. Refuses to run if the Firebase emulator environment is absent; the test initializes its own Firebase Admin app pinned to the `demo-mathquiz-v2` emulator project.

The companion `tests/unit/stg2-6-synthetic-reset-scope.test.mjs` statically forbids real Quizer/Mimo project identifiers, global collection wipes and any Neon/Google Cloud administration in the test. The reset is deliberately *not* built into any production backend or deployment executable.

## What can be simplified under the new data policy

We **do not need** to import historical production quizzes, old images or grades into the staging database. Staging may start with generated teacher/student accounts and synthetic fixtures. If a future staging rollout fails, we can choose a reset of **only the disposable staging environment**, after independently rechecking the target and deliberately authorizing destructive cleanup. This does **not** make a global database wipe safe, or automatically reconstitute cross-store data and object generations.

This test does **not** delete or restore a real Neon branch, Storage bucket, Firestore staging database, Hosting release, deployed Function, production application or Mimo service. It is not a backup policy for future production records.

## Remaining release gates / result

- STG2.1: staging code composition verified, default-OFF.
- STG2.2: infrastructure preflight code and CI verified; real SQL LOGIN, IAM, secrets and billing controls blocked.
- STG2.3: live staging backend deployment **NO GO**, not attempted.
- STG2.4: offline staging frontend bundle and mobile QA verified; hosting not deployed.
- STG2.5: synthetic Firebase-emulator integration verified; Neon/Storage still fake.
- STG2.6: emulator-only reset and create-only restore rehearsal. Real staging reset and deployment rollback remain blocked until staging exists.

Before a production release (PROD1), require new explicit go/no-go, exact production project/branch identification, a deliberate acceptance of any historical data loss, a production data-retention choice and a verified new-system cutover plan. The user explicitly excluded PROD1 from this batch, so **no production work is authorized**. AI/PROD2 deployment also remains excluded because the core system is not released.

**No merges, cloud deployment, database role/migration changes, billing changes, actual data deletion or production/Mimo access.**
