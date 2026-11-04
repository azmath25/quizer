# Quizer frontend context/layout milestone — 2026-11-05

## Scope and immutable backend baseline

- New isolated branch: `design/frontend-context-layout-2026-11-05`.
- Created from work branch commit `0c1648762a38a192cebbba27a1a84cc692ff8020`, containing the newer production-compatibility corrections in `js/components/ui.js`, `js/core/date-time.js`, `js/pages/results.js`, the latest backend request-id gate, and associated tests.
- Ported responsive changes and `ai.html` from `design/ai-studio-single-page-2026-11-04` as frontend-only files. `ai.html` remains a standalone visual prototype with simulated responses, not a working Mimo/AI integration.
- Preserved all backend Cloud Functions, database migrations, authentication, scripts, result/date parsing, and deployment workflow from the work branch; no frontend API contracts changed.
- This is a design branch only: do not merge or deploy until the backend work is frozen and end-to-end compatibility is verified.

## Actual UI improvements

- Role-oriented canvas widths: students are touch-first; teachers/admins have a wider desktop work area.
- Problem bank selection: sticky right inspector on desktop, top compact rail on tablet, safe fixed mobile selection dock with DOM order synchronized to visual focus order.
- Context-aware actions: existing selected-problem actions, quiz publish/save bar and problem save bar remain attached to their work. A new desktop inspector toggle makes the long editor full width without changing draft state.
- Teacher productivity: Ctrl/⌘+S submits the **existing validated form** in each teacher editor, so diff-only saves, dirty guard, server version checks and errors stay under the original handlers. Ctrl/⌘+K focuses existing problem search; Apply remains the only query trigger.
- User profile: Sign out is next to identity details rather than detached at the bottom of an unrelated sidebar.
- Shared CSS spacing/control conventions support consistent heading/toolbars/rails and mobile learner pages.
- No AI/backend wiring added; no database writes occur until an authenticated user operates the original forms.

## Recommended verification before promotion

1. Run `npm ci`, `npm test`, and `npm run build` in this branch; the source-level test is in `tests/unit/workspace-controls-responsive.test.mjs`.
2. In a locally served **staging-only** build, inspect 360px, 390px, 768px, 900px, 1100px, 1440px and 200%-zoom layouts; in particular bank selection focus order, sticky bars and mobile bottom navigation.
3. Test keyboard focus/Tab, Ctrl+S/Cmd+S, Ctrl+K/Cmd+K, read-only problem editors, preview collapse, browser resize across 900px.
4. Verify publish/update/no-change draft operations and results date/attempt display against the latest staged backend contract.
5. Rebase or port frontend-only changes on the work branch's **newest reviewed head** after the other AI finishes its changes. Do not replace the newer backend or date utilities with an older snapshot.

## Prohibited actions honored

No production or staging deployment, merges, existing branch updates, backend edits, database edits, or workflow dispatch.

## Connector-backed verification in this checkpoint

- **11/11** existing/new source contract tests passed in an isolated JavaScript harness (no GitHub Actions was dispatched).
- Syntax parse succeeded for the changed quiz/problem-bank/profile modules and the preserved results module; modified CSS rule blocks were balanced.
- Simulated UI events confirmed Ctrl/⌘+S passes the real submit button to `requestSubmit`, respects disabled/focus states and cleans up listeners. The inspector collapse/expand updates its ARIA attributes, and Ctrl/⌘+K focuses the existing bank search.
- Since this branch's pinned backend snapshot, the work branch acquired additional documentation/test-only commits. Those do **not** change the backend contract. Re-check the latest head before any later promotion.
- Browser/real device testing, full `npm test`, and staging backend integration **were not executed** in this checkpoint.
