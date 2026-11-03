# Quizer QN12.2 — author/editor mobile UX checkpoint

Date: 2026-11-03
Branch: work/quizer-audit-optimization-2026-11
Scope: **QN12.2 only**. Stop before QN13-A interim system audit, QN11 integration or QN12-B postintegration regression.

## Source review

Reviewed the teacher problem bank, selected-problem dock, quiz draft slot editor, LaTeX import view, independent problem form, responsive shell, mobile fixed navigation and problem-card toolbars.

Confirmed risks: selected-problem move/remove buttons were 26 × 26px; quiz-slot actions were 36 × 40px and their mobile implicit grid could squeeze the points input into a 28px column. Small phone bank toolbars compressed controls to 30px; selected dock obscured content without collapse; draft/import/image status was not marked for screen readers; and author sticky bars assumed a fixed mobile navigation height.

## Implemented (style-preserving)

1. assets/css/pages/editor.css: >=44px selected-problem and slot controls; explicit named mobile CSS grid rows for title, points and actions; wrapped controls; image/import/source input column bounds and visible save bar.
2. js/pages/problems.js: accessible expandable/collapsible selected-problem dock, initially compact on phones, preserving selected revisions/points/order. Its button uses aria-controls and aria-expanded. Desktop defaults to expanded.
3. assets/css/problem-card.css: responsive wrapping problem toolbar with >=44px actions/checkbox hit area; avoids stuck tooltip on touch.
4. js/core/device.js: shared measured mobile navigation clearance on resize/ResizeObserver/visualViewport changes; editor sticky save and selection dock use the value, retaining safe-area fallback.
5. js/pages/quiz-editor.js and js/components/problem-form.js: role=status and polite live announcements for import, draft-save and image upload status. Existing import, draft, publish and grade API behavior remains unchanged.

## Tests and verification

- tests/unit/qn12-2-author-responsive.test.mjs: 11 focused source contracts for 44px sizing, grid areas, collapse semantics, import/save status, nav clearance and bank toolbar.
- tests/qa/mobile-author-browser.py: test-only real Chromium rendering against synthetic Firebase emulators; widths 320,390,430,768,1024 plus 390px at simulated 200% root text size. Inspect quiz editor action sizes and points, import progress, problem bank selection dock, overflow, nav clearance and collapse/expansion. Capture screenshots.
- .github/workflows/quizer-verify.yml: original QN12.1 browser run followed by new QN12.2 author browser run in the Chromium QA job, with separate screenshot artifacts. Existing unit/backend/static and emulator jobs remain.
- Record confirmed CI run, real browser findings and artifact URL when fully completed. Never imply actual iOS Safari/Android physical-device validation.

## Remaining risks and boundary

- Physical iOS Safari, Android Chrome, keyboard-safe areas, actual OS text-size scaling and VoiceOver/TalkBack are still manual device checks. Chromium simulation is not a substitute for these.
- Real 100/500-problem import latency and API request counts are still integration risks. The active import frontend currently sends one importProblemBatch API request **per problem**; QN11 is responsible for bounded resumable batching. No backend changes are part of QN12.2.
- No actual Firebase/Neon writes beyond demo emulators; no production data, migration, Mimo access, merge, deployment or main/main-backup modifications.
- Next after QN12.2: **QN13-A interim preintegration audit**; then QN11 integration, QN12-B frontend regression and QN13-B final system audit.
