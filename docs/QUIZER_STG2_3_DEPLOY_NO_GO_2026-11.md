# Quizer STG2.3 — isolated backend deployment decision

Date: 2026-11-04 (Asia/Baku)
Work branch: `work/quizer-audit-optimization-2026-11`
Release order: STG → PROD → AI → PROD2

## Decision: **NO GO — backend staging deployment not executed**

STG2.1 passed source/emulator CI and produced an unmounted default-OFF bridge. This is **not** a registered or runnable cloud staging route. STG2.2 passed offline infrastructure-inventory tests but could not establish these live prerequisites:

1. A restricted SQL LOGIN `quizer_app` on the Quizer disposable Neon child `br-sweet-rice-b9ehdv9i`. The last read-only role inventory reports only `quizer_owner` (password) and the two NOLOGIN fixtures. Never use the owner for runtime traffic.
2. A dedicated Quizer staging Firebase Functions v2 service identity, its effective IAM privileges, and a Secret Manager secret scoped to `quizer-staging-az26` only.
3. Real cloud billing status, explicitly approved billable services, budget alerts and quotas. The user chose about $1/month, which ordinary alert budgets cannot guarantee.
4. Verified staging-only Storage/Firestore policies, signing permissions, App Check, server-side Neon connection/endpoint attestation, and actual server ports supplied to the full staging factory.
5. A previously tested staging release artifact and a rehearsal proving safe cleanup of *synthetic* new staging state. No historical production data migration is necessary for this staging build.

Firebase access is not connected in the current tool environment. The user has not provided the cloud identity/credential destination and we must not create credentials through ChatGPT or paste them into the repository. **Do not run `firebase deploy`, create billing links, enable APIs, provision roles, merge, or expose a staging endpoint merely because the code CI passed.**

## What was verified and preserved

- [STG2.1 CI run](https://github.com/azmath25/quizer/actions/runs/41750818180): 3/3 jobs passed with 400/400 unit tests, 5/5 backend tests, Firebase emulator and Chromium QA.
- [STG2.2 CI run](https://github.com/azmath25/quizer/actions/runs/41751489710): 3/3 jobs passed with 405/405 unit tests, 5/5 backend tests, Firebase emulator and Chromium QA.
- Both GitHub work-branch source changes remain default-OFF and unmounted from active `functions/src/index.js`, `router.js` and `jobs/worker.js`.
- No live Google Cloud, Neon SQL, Firestore/Storage, Mimo or production resource was modified. User's data-loss flexibility applies to *disposable staging* only unless a separate production deletion decision is approved.

## Next independent work

**STG2.4 can proceed offline**: validate the separately built staging frontend, maintain production/staging identity separation, inspect mobile flag size/viewport/MathJax/image handling, and verify browser QA against emulators. It cannot be called a successful *deployed* staging frontend until a genuine staging backend and hosting target exist. STG2.5 may run synthetic end-to-end tests; STG2.6 may prepare and rehearse isolated synthetic reset, never production deletion.

**Stop before any live staging backend deployment.** This checkpoint documents an unresolved dependency rather than claiming STG2.3 completed.
