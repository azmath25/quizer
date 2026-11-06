# Quizer -> Mimo Teacher Chat: Test Checkpoint (2026-11-06)

## Verified prerequisites
- Quizer Firebase project: sat-quiz-fd317.
- Secret: QUIZER_MIMO_PROJECT_KEY in Quizer Secret Manager. The operator created versions 1 and 2; latest is version 2. No value was exposed to source code or this report.
- Mimo Execution: https://mimo-execution-993130348924.europe-west1.run.app.
- Published chat workflow: c_mw4j0tz4_mpyp7v, version 1.
- Mimo API project: chat_test (CHAT TEST), active; read-only Neon lookup confirmed a run grant to that published workflow/version.
- Outbound Mimo REST connectors are not needed for Quizer calling Mimo.

## Scope of this feature branch
- functions/src/mimo/client.js: existing dedicated server-only project-key client, extended to support a synchronous call with a bounded timeout.
- functions/src/mimo/teacher-chat.js: teacher-only validation using Firebase caller identity plus Firestore roles/{uid}; permit only teachers/admins with verified email and active account status. Atomic Firestore quota: 4 unique requests per rolling minute and 25 per UTC day per teacher. Stable idempotency identifier. Hard Mimo per-run cost_limit_usd=0.05.
- functions/src/index.js: adds ONLY the new callable mimoTeacherChat, bound to defineSecret("QUIZER_MIMO_PROJECT_KEY"), without changing existing api, processJob, scheduledMaintenance behavior.
- js/services/mimo-chat.js: Quizer browser -> Firebase callable transport; it knows no provider key, Mimo workflow ID or upstream URL.
- js/components/ask-ai-popup.js: existing popup uses Mimo for teachers, limited session-local conversation history (8 messages) and authorized visible page context; all other users retain the prior placeholder behavior.
- functions/test/mimo-teacher-chat.test.mjs and functions/test/mimo-client.test.mjs: fake upstream/Firestore tests. These do not create live model calls.

## Important limits / assumptions
- This is a proof of concept for a **single synchronous, sequential chat workflow**, not full history/memory or streaming.
- Function timeout 120 seconds; request timeout 95 seconds; one Firebase callable per message.
- Never retry a message automatically after ambiguous transport failure: Mimo may already have billed it. Retry intentionally using the same request ID and exactly the same input.
- Credentials and workflows cannot be chosen by the browser. The one project key is accessible only to the new function.
- The popup may display an answer only if the upstream run completed and returned output.exports.reply as nonblank text.
- Firestore role/quota reads and transaction do add small Firebase usage. This design is for low-volume testing, not optimized production traffic.
- The Firebase callable's App Check policy inherits ENFORCE_APP_CHECK; production policy must be reviewed before wider rollout.
- Historical users may still see the old popup until the Quizer frontend is separately deployed.

## Verification status
- GitHub feature branch source and JavaScript syntax inspected. Local mock tests on the corresponding implementation passed, but run the branch's test files in Cloud Shell before deployment.
- The real server-side key has **not** been read by the assistant.
- **No Firebase deployment, production Mimo model call, merge, Neon migration or main-branch write was performed.**

## Read-only fetch, test, then scoped deployment

Run in Quizer Cloud Shell after confirming project sat-quiz-fd317. Use a fresh directory: do not overwrite a modified existing checkout.

    gcloud config set project sat-quiz-fd317
    git clone --depth 1 --single-branch --branch feature/quizer-mimo-api-bridge-20261106 \
      https://github.com/azmath25/quizer.git ~/quizer-mimo-chat-test
    cd ~/quizer-mimo-chat-test
    node --test functions/test/mimo-client.test.mjs functions/test/mimo-teacher-chat.test.mjs
    npm ci --prefix functions --omit=dev --no-audit --no-fund
    node scripts/sync-functions-shared.mjs

Only after all commands pass, opt in to this exact *single-function* deployment (do not use "functions" alone):

    firebase deploy --only functions:mathquiz:mimoTeacherChat --project sat-quiz-fd317

If the CLI proposes deleting or replacing other functions, **answer No and stop**. Secret Manager v2 will bind QUIZER_MIMO_PROJECT_KEY version 2 to the newly deployed function.

## First live smoke test: browser console on Quizer while signed in as teacher

    const c = await import("./js/firebase-client.js");
    const firebase = await c.getFirebaseServices();
    const invoke = firebase.functionsSDK.httpsCallable(firebase.functions, "mimoTeacherChat", {timeout:115000});
    const result = await invoke({
      message:"Solve 2x+3=7 in one sentence.", history:[], context:"",
      requestId:crypto.randomUUID()
    });
    console.log(result.data.reply);

This makes ONE real Mimo call and might incur provider/Cloud Run charges. Do not paste Firebase ID tokens or Mimo keys into chat. If successful, the popup frontend can be deployed separately later.

## Future optimization (not in this milestone)
Dedicated Mimo token exchange or verified Firebase ID tokens for direct browser-to-Mimo invocation; streaming; Neon chat history; workflow routing. Each requires its own security/testing milestone.
