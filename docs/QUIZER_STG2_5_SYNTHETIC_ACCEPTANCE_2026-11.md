# Quizer STG2.5 — synthetic integrated end-to-end acceptance checkpoint

Date: 2026-11-04 (Asia/Baku)
Branch: `work/quizer-audit-optimization-2026-11`
Status: **Synthetic Firebase-emulator-backed tests only; real staging cross-store acceptance blocked**.

## Test implementation

`tests/integration/stg2-5-staging-bridge-emulator.test.mjs` launches under the existing `demo-mathquiz-v2` Firebase Firestore emulator test runner and uses the genuinely composed `createQuizerStg2StagingRuntime` source path. This adds integration checks for:

1. Teacher creates a problem via the newly staged Neon action gateway, with **fake** Neon I/O and a **real emulator** Firestore mutation receipt.
2. Retried identical request IDs return the same result without a second external effect; changed payload with reused request ID is rejected. Protected question/answer details are not persisted in the Firebase operation receipt.
3. A student is forbidden from teacher-only problem creation and bank reads, even when the v2 callable transport is syntactically valid.
4. Student `startAttempt` reaches the injected staged private runtime, while unrelated legacy dashboard actions retain their v2 result shape.
5. Synthetic Neon outage fails closed and never reissues the action as a legacy Firebase write; untrusted worker invocation is refused.

The full pre-existing emulator suites continue to cover the **legacy active** end-to-end teacher create → publish → student access/answers → grading/manual marks/results, image access, role revocation, export, idempotency and concurrency. The QN11 simulated QN10 private Storage and Neon suites remain in CI.

## Important limitations

- The new test's Neon reader/writer and private bundle runtime are deliberately **in-memory synthetic ports**. Only Firestore operates against an emulator.
- No real Google Auth sign-in, Cloud Functions, Neon restricted `quizer_app`, Firebase Cloud Storage, private GCS generation/signing, paid workload or cross-region latency has been exercised end to end.
- All STG2.2/2.3 blockers remain. The live staging backend is still **not deployed**; do not say STG2.5 live acceptance passed.
- No actual user records are imported or deleted. Tests run only against disposable `demo-mathquiz-v2` emulators.

## Next step

STG2.6 may prepare a **synthetic-only reset and recovery rehearsal** and validate that the entire browser/emulator state is disposable without any production data deletion. A live deployment/reset still requires separately verified cloud identities, billing safety, rules and restricted SQL login. PROD1 remains excluded.
