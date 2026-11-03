# Quizer AI workspace — browser-only snipping and Ask AI entry points

Date: 2026-11-03
Branch: **feat/ai-browser-snip-ask** (forked from existing **feat/ai-workspace**)
Status: isolated preview implementation. **Not merged or deployed.**

## Existing AI branch discovered

The user already had an unmerged AI workspace with \`ai.html\`, \`js/pages/ai.js\`, \`js/components/assistant.js\`, existing \`js/components/snip.js\`, a teacher-only Ask AI shortcut in the problem bank, and a teacher-only "AI chat" shortcut on visible quiz problems. The AI service explicitly sets \`AI_CONNECTED = false\` and returns a **demo/placeholder response**. The interface is not proof of a real connected vision or reasoning model.

## Two separate browser-native "snip" modes

1. **Snip page content (default):** click scissors on the floating assistant or AI chat, drag a rectangle over currently visible page material, then review the exact extracted text/MathJax LaTeX and overlapping image descriptions. Only after explicit confirmation is this text added to the chat. It stays inside the browser page and does **not** invoke Windows/macOS Snipping Tool, download software, show a screen-share chooser, access the device clipboard, or require a browser extension. Implementation: \`js/components/page-snip.js\`. This is **not a bitmap screenshot**, and images are represented by alt/figure context rather than pixels.
2. **Visual snip (optional):** for graph/diagram **pixels**, use the separate tab-capture button. \`js/components/snip.js\` uses browser \`getDisplayMedia\` to request an explicit browser-tab sharing choice, immediately grabs a frame, stops the stream, and opens an in-page rectangle crop; returns a PNG. It does **not** invoke an OS screenshot program or device file picker. Screen/window capture is rejected when the browser reports a non-tab display surface. The browser-controlled sharing chooser cannot be bypassed for a real pixel screenshot under standard web permissions. Browsers without tab capture can still use page-content snips.
3. The snip overlay supports pointer drag, touch-action:none, Escape, cancel button and automatic DOM cleanup. Only visible DOM text and math items are eligible; nodes hidden/inert/aria-hidden, collapsed answer details, navigation/header, assistant UI, and off-rectangle content are excluded. Clip text is bounded to 8,000 characters and the preview uses escaped HTML.

## Ask AI buttons

- **Quiz overview:** a visible **Ask AI** button is available only if the authenticated caller has teaching capability **and** \`getQuizOverview.canManage\`; sends public quiz title/subject/description/count only, not grading keys, unpublished revisions or student answers.
- **Visible quiz question:** relabeled the existing teacher-only "AI chat" shortcut to **Ask AI**. It uses the displayed question statement, not grading/solutions. Active student quiz attempts do **not** acquire an unrestricted AI entry point.
- **Problem detail:** added a visible teacher-only **Ask AI** button that passes the authorized problem statement to a chat.
- **Problem-bank cards:** retained their teacher-only AI toolbar icon, changed its accessible label/tooltip to **Ask AI about this problem**.

## Unresolved cutover/security points

- **Real AI inference is not connected.** The existing provider boundary is a stub and must be wired with a server-side authenticated model gateway, image payload validation, request limits, prices/budgets and observability in a later AI milestone. Never expose provider API keys in GitHub Pages JavaScript.
- **Active-exam integrity:** student Ask AI remains disabled. If teachers later opt into practice-mode hints, enable it through explicit per-quiz settings and **server-side** enforcement, not only hidden buttons. No answer keys, unreleased solutions, later questions or attempt tokens may be sent.
- Image/vision prompts can only be evaluated once a real provider can consume binary images. A tab snip currently supplies a PNG File to the pre-existing frontend placeholder. It does not magically make vision work.
- Browser tab capture requires user authorization, and its permission picker is a normal browser security control. Text snipping does not.
- User-provided screenshots and selected text should not be uploaded or retained before confirmation. Chat messages are persisted by the existing chat service after user approval; data retention and deletion policy needs review before rollout.
- The AI workspace is older than the Quizer QN12 mobile work. Any eventual integration must be rebased/reconciled deliberately, not merged blindly.

## Verification

- \`tests/unit/ai-browser-snip.test.mjs\`: geometry and bounded text, no native OS picker, distinct content vs visual capture, preview before send, and staff-role/quiz-owner gates.
- \`tests/qa/ai-snip-fixture.html\` and \`tests/qa/ai-snip-browser.py\`: synthetic browser-only page with visible math and figure plus hidden key, testing rectangle capture and Escape at phone and desktop widths. No Firebase or AI connection is needed for this synthetic UI test.
- \`.github/workflows/ai-browser-snip-verify.yml\`: test-only GitHub Actions on this AI branch, with Node syntax/static/contract checks plus headless Chromium. No deployment jobs.
- CI status should be recorded after confirmed completion; do not call the browser capture verified before then.

**Boundary:** no main/main-backup or QN12 work-branch changes; no merges, deployments, Firebase/Neon changes, production user data or Mimo access. QN13-A remains the next step in the primary Quizer improvement plan, not part of this separate AI experiment.
