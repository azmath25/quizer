# Quizer PROD1 — guarded implementation and release checkpoint
Date: 2026-11-04 (Asia/Baku)
Branch: `work/quizer-audit-optimization-2026-11`
Scope: **core Firebase + Neon math quiz only**. PROD2 AI, browser snipping and
Mimo integration are excluded until a later independent release.

## Authoritative deployment reality

- GitHub Pages publishes public `dist/` from this work branch. Its success
  does not change or deploy Google Cloud Functions, Firebase security rules,
  Firestore data or Neon.
- Existing Firebase `functions/src/index.js` still registers the Firestore
  `dispatch` router plus `runJob`; it does **not** import or activate the
  QN11 staged hybrid gateway or the new PROD1 bank runtime.
- PROD1 SQL schema lives on dedicated Neon project `soft-grass-35754518`,
  branch `br-lucky-lake-b9pocorx`, database `quizer`.
- SQL-created `quizer_app` role was verified to be non-superuser and to
  inherit the limited application grants. The user's last Cloud Shell
  report showed **no Google Secret Manager URL**; do not assume it exists.
- Firebase Hosting was previously used accidentally; it is not the intended
  Quizer frontend host. The deployment shortcut for it was removed.
- No production merge, Firebase backend deployment, hybrid feature flag
  activation, irreversible migration or Mimo operation is authorized here.

## Newly prepared PROD1 source (not yet live)

| Artifact | What it does | Safety boundary |
| --- | --- | --- |
| `functions/src/neon/sat-quiz-live-sql.js` | Verifies exact Quizer project, TLS, pooled Neon host, restricted SQL role | Disabled by default, never browser-imported |
| `functions/src/prod1/firebase-bank-ports.js` | Reads actual Firebase role/account status, verifies author-owned ready assets, import job and Firestore problem provenance, provides bounded legacy keyset listings | Never trusts role/owner from browser request |
| `functions/src/prod1/bank-runtime.js` | Composes Neon SQL read/write adapters, Firestore mutation receipts, bank compatibility and import coordinator | Default OFF; accepts only bank/import action names, explicitly refuses quiz/publish/student paths |
| `functions/src/prod1/draft-reader.js` | Stage read-only mixed legacy/Neon draft item resolution with Firestore transactional pin/version recheck and old published snapshot fallback | Refuses hybrid draft mutation until separately implemented and tested |
| `scripts/prod1/readiness.mjs` | Read-only project, current branch, required APIs, Secret Manager existence and enabled-version inventory | Cannot authorize deployment or reveal a secret |

Unit tests: `prod1-bank-runtime.test.mjs`,
`prod1-draft-reader.test.mjs`, `prod1-readiness.test.mjs`;
plus earlier `sat-quiz-live-sql.test.mjs`.

## Product target

1. Firebase Auth and Firestore authorize users, teacher/student/admin roles,
   quiz/attempt metadata, access, attempts, results and grade release.
2. Neon is authoritative for NEW reusable problem content, revision hashes,
   tags, idempotent teacher bank writes and bounded initial import receipts.
3. Original quiz `.tex` and images reside in Firebase Storage. One private,
   create-only published bundle per revision lives there; answer keys and
   future locked questions are never directly accessible to students.
4. Previously published exams continue to run and grade through Firebase even
   during a Neon outage. Never reread current bank problems mid-attempt.
5. Ordinary title/settings-only draft saves never call Neon or reupload TeX.
   Only a changed problem creates an immutable Neon revision. Publishing is
   a separate explicit step, with old revisions retained.

## Remaining independent CODE work — cannot claim PROD1 complete

1. Implement and test a full **hybrid draft write adapter** for
   `saveQuizDraft`, `getQuizDraft`, `getQuizDraftItems` and
   `finishImportJob`, including safe new-slot allocation, exact old/new
   problem refs, role/revision checks and metadata-only no-op behavior.
   Current PROD1 draft reader is intentionally read-only.
2. Replace Firestore-only `snapshotSource` and `sourceContent`
   assumptions in `publishQuiz`, `duplicateQuiz` and old publication
   jobs with an explicit, pinned provenance protocol. Never perform SQL I/O
   within a Firebase Firestore transaction callback.
3. Build real trusted Firebase Storage/asset/actor/share-grant ports for
   `createQuizerStagedPrivateRuntime`. An absent shared-asset permission
   verifier must refuse publication. Verify signed image and ZIP access.
4. Wire the complete hybrid gateway and private-job dispatch through the
   active Cloud Functions entrypoint behind **explicit disabled-by-default
   feature flags** and bound Secret Manager values. Existing legacy handlers
   must remain compatible; do not reissue a failed Neon mutation in Firestore.
5. Add real-service staging smoke tests and cross-store outage/crash/retry
   regression evidence. All existing QN11 tests are synthetic/emulator only.
6. Complete release documentation, safe rollback/restore rehearsal and
   reasonable billing/IAM/App Check checks, plus real 100/500-question
   import/quiz performance and physical Android/iOS accessibility QA.

## Owner/cloud dependencies (cannot be silently bypassed)

- Quizer `quizer_app` password/Neon URL must be entered privately on the
  owner's Cloud Shell, saved to Secret Manager, and bound to the specific
  Firebase Functions using `defineSecret` / `secrets`.
- Verify exact Cloud Functions service-account IAM (Secret Manager accessor,
  Firebase permissions, Cloud Storage signing) and billing scope.
- Verify GitHub Pages domain `azmath25.github.io` in Firebase Auth
  authorized domains and test the real Google sign-in callback.
- Review existing real quizzes, attempts and immutable revisions; choose
  preservation or separately authorize a clean start. No silent deletion.
- Authorize a controlled staging backend deployment, then separately approve
  the actual production cutover and any merge into `main`.

## Release decision

**GO for further isolated source, unit, emulator and no-write preflight work.
NO GO for production activation.** GitHub CI alone does not establish a
real-cloud Firebase–Neon–Storage end-to-end pass.

The dedicated PROD2 AI/snipping branch remains separate and is not needed
for core PROD1 release.
