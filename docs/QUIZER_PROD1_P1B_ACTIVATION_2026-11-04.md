# Quizer P1-B — direct production activation (2026-11-04)

**Scope:** Firebase `sat-quiz-fd317` / `europe-west1`, work branch `work/quizer-audit-optimization-2026-11`. No staging, Mimo, main branch, Hosting, Firestore rules, migrations, or Neon mutations.

**P1-A evidence:** The three v2 Cloud Functions deployed successfully with gate OFF. A live `listPublicQuizzes` guest call returned HTTP 200, `apiVersion:2`, one item. This does **not** establish teacher/Auth/App Check, private bundle, or grading functionality.

**P1-B code changes:** The reviewed source gate is TRUE. Activation additionally requires `QUIZER_PROD1_ENABLED=true` **and** `GCLOUD_PROJECT=sat-quiz-fd317` at runtime. Both existing Secret Manager names are bound unconditionally as deployment options on the three functions, because runtime dotenv variables are not available for computing deployment-time options. Secret values are never included in git or dotenv files. Nonhybrid routes still use the legacy dispatcher.

## Controlled activation — Cloud Shell

1. Confirm branch/project and complete CI first; inspect existing `functions/.env` and `functions/.env.sat-quiz-fd317` without printing any secret content. Make certain no conflicting runtime value is set.
2. Preserve the legacy-serving rollback revisions:
   - API: `api-00008-ciq`
   - worker: `processjob-00007-mod`
   - maintenance: `scheduledmaintenance-00008-ceq`
3. Set ONLY `QUIZER_PROD1_ENABLED=true` in the **ignored, project-specific** `functions/.env.sat-quiz-fd317`. Never put database URLs or private keys in the file. The local shell must not print those values.
4. `npm ci && npm ci --prefix functions && npm run prepare:backend && npm test && npm run test:backend`.
5. Deploy ONLY `functions:mathquiz:api,functions:mathquiz:processJob,functions:mathquiz:scheduledMaintenance` with `--project sat-quiz-fd317 --non-interactive`.
6. Check all three functions ACTIVE and serving new revisions. Check `serviceConfig.secretEnvironmentVariables` includes both secret names on all functions; check runtime environment `QUIZER_PROD1_ENABLED=true` without printing other environment data.
7. Repeat the public guest smoke. Then **test exactly one disposable teacher-owned Neon problem** with existing teacher credentials, followed by mixed-source quiz publication, student grading, export/retry, and legacy quiz compatibility. No user content migration or bulk production writes.

## Safety / rollback

**STOP** if CI, branch/project pinning, static secret binding, Function deployment, or smoke tests fail. Do not run a second blind deployment. Emergency rollback target is the three legacy-serving revision names above. Restoring Cloud Run traffic can undo the serving code, but may not restore all Cloud Functions trigger/configuration changes. For a controlled follow-up redeploy, set `QUIZER_PROD1_ENABLED=false` in the project-specific dotenv file and verify runtime effect. Do not delete Neon data, secrets, Firestore jobs, attempts, or assets.

**No real E2E acceptance is implied by this commit.** Production activation happens only after a separate, successful Firebase CLI deployment initiated by the operator.
