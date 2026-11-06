# Quizer — Mimo teacher chat popup checkpoint (2026-11-06)

## Branch and boundary

- Repository: azmath25/quizer
- Baseline integration branch: feature/quizer-mimo-api-bridge-20261106
- Isolated implementation branch: feature/quizer-mimo-teacher-chat-ui-20261106
- Draft PR: https://github.com/azmath25/quizer/pull/18
- Existing deployed Firebase v2 callable: mimoTeacherChat, europe-west1, Firebase project sat-quiz-fd317.
- Existing Mimo workflow/version, Firebase project secret, authorization, quotas and budget **not modified**.
- No merge, deploy, Firebase secret rotation, Neon migration, production DB write, or protected-branch update.

## Changed files

- js/services/mimo-chat.js — existing Firebase callable only, verified active teacher/admin client gate, post-response session epoch guard, exact once-per-send invocation, bounded history/context, mapped quota/auth/Mimo outcome errors. Backend Firestore authorization remains authoritative.
- js/components/ask-ai-popup.js — accessible responsive modal, distinct user/assistant messages, focus trap and restoration, Enter/Shift+Enter, typing indication, New Chat, no duplicate send, draft held during processing and retained on error, only completed turns added to last-eight history, new request ID per send and no automatic retry.
- js/components/ai-chat-markdown.js — escaped and structurally constructed Markdown + restricted MathJax input; no model response inserted as HTML or executable script; safe-link protocols.
- assets/css/ask-ai-popup.css — modern scoped dialog, mobile sheet with safe-area padding, consistent button sizing, reduced motion, focus visibility, overflow-safe math.
- js/pages/problems.js — only authorized teachers get the Ask AI button, guarded handler, selected statement/choices only; no grading key or solution.
- js/pages/results.js — only authorized teachers get Ask AI controls, guarded handler; avoid automatically sharing submitted responses, private marks, feedback, or released solutions in problem context.
- tests/unit/mimo-teacher-chat.test.mjs — transport/role/quotas error handling/credential exclusion/history bounds/single-call/session invalidation.
- tests/unit/ai-chat-markdown.test.mjs — safe model output, Markdown, LaTeX, XSS, links and length bounds.
- tests/unit/ask-ai-popup.test.mjs — submission, loading state, draft preservation, duplicate prevention, request ID uniqueness, history and New Chat, unknown outcome, keyboard/focus and mobile style contracts.
- .github/workflows/mimo-teacher-chat-ui-verify.yml — branch/PR-scoped, **verification-only**, frontend build/unit/static and backend/emulator/transport checks; no deployment.

## Verification

GitHub Actions run 42178870063 on commit d2250e8cea8f149fd861ed25ea1c6bf2595ee535 was **success** for both jobs (before this documentation-only checkpoint commit).

- npm test: **633 passed / 0 failed**.
- npm run test:backend: **21 passed / 0 failed**.
- npm run test:integration: **97 passed / 0 failed** (Firebase emulator/rules).
- npm run test:transport: **1 passed / 0 failed**.
- npm run verify:static: **passed**, 16 routes and local asset/import checks.
- npm run build: **passed**.
- GitHub Actions jobs: "Frontend, unit, static and build" and "Existing quiz backend, emulator and transport tests" both **success**.

Initial CI failed due to two fake-DOM fixture methods missing and missing functions dependency installation in the CI unit job. Both were fixed; the successful run above is the authoritative verification.

**Limits of verification:** the static responsive/accessibility tests and fake-DOM interaction tests do not replace a hands-on screen reader, Safari/iOS, Android/Chrome or keyboard walkthrough. No new billable live Mimo request was made by this change; the original callable's real-chat success was provided by the requester, not retested here. The existing floating legacy AI assistant and AI Studio remain outside this popup-only milestone.

## Security and behavior

The browser sends only the user message, supplied authorized page context (up to 4,000 characters), up to eight previous completed messages (up to 1,200 chars each), and a client-generated unique requestId, through Firebase httpsCallable("mimoTeacherChat", {timeout:115000}).

The project key is never used in browser source. Backend continues to require verified teacher/admin role, enforce rolling 4/min and 25/UTC-day quotas and per-run $0.05 policy. No second API bridge, uploads, browser snipping, streaming, Neon persistence, silent retries or workflow routing were introduced. UNKNOWN results retain draft and show the request reference for support; no automated reconciliation is implemented.

## Release instructions — require explicit approval

1. Review draft PR #18 against the integration branch. Confirm only the files listed above changed.
2. Inspect the no-deploy GitHub Actions results (run 42178870063), or rerun \`npm ci && npm ci --prefix functions && npm run prepare:backend && npm test && npm run verify:static && npm run build\`, followed by \`npm run test:backend\`, \`npm run test:integration\`, and \`npm run test:transport\`.
3. Perform manual staging browser QA with an authorized verified teacher/admin and a student: problem bank and results visibility, mobile narrow view, keyboard Tab/Escape, Enter/Shift+Enter, math, double-click submission, unknown/quota errors. Avoid production quota/cost consumption without approval.
4. Only after explicit user permission, merge the approved frontend work and deploy **only the intended frontend** using Quizer's established controlled release process. No Firebase callable/backend/secret/Mimo/Neon redeploy is required for this milestone.
5. If validation fails, keep draft PR unmerged and production unchanged.

**STOP checkpoint:** code and automated verification complete; waiting for explicit approval for any merge or deployment.
