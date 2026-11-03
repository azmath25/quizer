# Quizer mobile and device-sensitivity audit — 2026-11-03

Status: **static source review + narrow quiz-runner correction**, not a completed full-device or full-browser visual audit.
Branch: work/quizer-audit-optimization-2026-11. No merge, deployment, Firebase/Neon cloud mutation or Mimo changes.

## What was checked

- Quiz runner HTML generation and state updates: js/pages/quiz.js.
- Responsive quiz CSS: assets/css/pages/quiz.css.
- Shared mobile navigation and button sizing: assets/css/layout.css and components.css.
- Input-device detection: js/core/device.js.
- Editor mobile CSS and its selection panel: assets/css/pages/editor.css.
- Existing test tools and breakpoints, including page viewport-fit=cover, safe-area padding, reduced-motion and dark-mode tokens.
- Existing backend QN10.3 and QN11–QN13 milestone release constraints, unchanged.

## Confirmed source-code issues and narrow fixes

| Finding | Code evidence | Response |
| --- | --- | --- |
| Flag/Star state caused layout shift | quiz.js used Flag->Flagged and Star->Starred on auto-width buttons, inside a wrapping .actions row | **Fixed:** visible captions remain Flag/Star; aria-pressed, aria-label, filled icon and flagged question list communicate state. Buttons have 44px minimum height and stable minimum width. |
| Narrow question grid had undersized tap targets | quiz.css at max-width 760px used six columns, and the circular buttons had no min-height; 320px wide devices could have columns below 44px | **Fixed for <=420px:** auto-fill columns with 44px min width and 44px min height, including narrower CSS viewports during zoom. |
| Sticky Previous/Next could compete with bottom mobile nav | on touch below 760px .runner-footer was sticky at bottom:0 while #mobile-nav was fixed at bottom:0 with higher z-index | **Mitigated:** sticky footer bottom offset now accounts for approx. 72px mobile nav plus safe-area inset. Requires real visual-device confirmation before release. |
| Hover transforms could stick on touchscreens | .choice:hover translated the entire choice and .question-grid button:hover scaled to 110% without pointer gating | **Fixed:** transformations apply only to hover-capable fine-pointer devices. |
| Long quiz title could squeeze timer on phones | title flex child lacked explicit min-width:0 and long text wrapping; timer did not opt out of flex shrink | **Mitigated:** title can wrap within available width; clock is non-shrinking with tabular numerals. |

Tests: tests/unit/qn-fe-mobile-controls.test.mjs contains seven source-contract regressions for stable labels, accessibility, touch sizing, input modality and timer. These checks do NOT replace Playwright/real-browser screenshots.

## Remaining QN12 mobile audit — priority list

1. **Visible save feedback on touch — QN12.1 fix implemented:** the prior `display:none` on touch is removed. `save-status` and contextual retry/conflict controls now live in one compact sticky footer row above Previous/Next. QA must exercise failed-save/retry and confirm no overlap with mobile navigation; answer persistence internals are unchanged.
2. **Small editor controls:** assets/css/pages/editor.css contains .sel-ctl .icon-button { width:26px; height:26px; min-width:0 }. Audit selected-problem actions and drag affordances for 44x44 accessible touch targets, avoiding a reflow of list rows.
3. **Real browser layout and device tests:** verify 320/360/375/390/430px phones, 768px tablets, 1024px landscape/tablet and desktop widths; Android Chrome and iOS Safari; portrait and landscape; fine/coarse/hybrid pointers; browser text-size at 100/200%, device safe-area insets, on-screen keyboard opening, and dynamic viewport changes. No horizontal overflow or hidden buttons permitted.
4. **Quiz state changes:** capture before/after button geometry (x,y,width,height) for Flag/Star pressed and unpressed, timer from 10:00 to 09:59 and 01:00 to 00:59, answered/flagged grid states, navigation and submit flow. Target: zero geometry shift for toggle controls and no button overlap.
5. **Latex/image and accessibility:** long MathJax formulas, images, manual textarea with mobile keyboard, answer selection, scroll anchoring, focus rings, semantic aria labels/pressed state, reduced motion and dark mode, keyboard-only navigation and voice-over/screen-reader output.
6. **Sticky bars — QN12.1 measured clearance:** new ResizeObserver/viewport measurement sets `--runner-mobile-nav-clearance`, with CSS safe-area fallback. Chromium screenshot checks cover 320–1024px, but real landscape keyboard/OS safe-area and iOS Safari still require QN12.2 hardware review.
7. **Perceived performance and network behavior:** editor 100/500-question scroll, quiz cold/warm first question, flag/save/navigation requests, offline retries, duplicate request suppression, answer recovery and API request count comparisons. QN11 and QN13 need integration before claiming real app improvements.

## Current status and boundary

- Existing live Quizer remains on its original published Firebase handlers. QN8/10 staged backend is disabled. QN11 is still pending for Neon bank, cross-store authoring, student attempt and grading wiring. QN12 remains the full mobile UI/accessibility/browser test milestone; QN13 remains end-to-end performance, data-preservation and release-readiness.
- This update touches only js/pages/quiz.js, assets/css/pages/quiz.css, a new static regression test and this audit/roadmap documentation. It does **not** claim screenshots, real Safari/Android testing, mobile hardware validation or full QN12 acceptance.
- **No changes to the site's overall design system, other page styles, core quiz data flow, main, main-backup or Mimo.**

## QN12.1 follow-up (2026-11-03)

The quiz-only improvements are committed on the feature branch: persistent Save/Retry feedback, safe-area-aware footer clearance measured independently of input mode, fixed-width timer readout, disabled locked flagged links, touch-safe swipes and 44px problem grid targets. Nine further static regressions and a real Chromium-rendered emulator device matrix passed at 320/360/390/430/768/1024 CSS pixels. **All three CI jobs green** in [run 41665053664](https://github.com/azmath25/quizer/actions/runs/41665053664) (230/230 unit; 5/5 backend; Firebase emulator integration/transport and Chromium). Screenshots: [QN12.1 QA artifact](https://github.com/azmath25/quizer/actions/runs/41665053664/artifacts/13245761223). Browser QA found and drove fixes for footer/nav overlap at 360px and undersized sidebar buttons at 1024px. Browser emulation is distinct from real hardware Safari/Android, and must not be called hardware certification. See `docs/QUIZER_QN12_1_CHECKPOINT_2026-11.md` for exact evidence.
