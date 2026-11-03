# Quizer QN12.1 — Mobile quiz-runner responsiveness checkpoint

Date: 2026-11-03
Work branch: work/quizer-audit-optimization-2026-11
Scope: **QN12.1 only: quiz-taking UI**. No main/main-backup merges, deployments, production Firebase/Neon migrations, Mimo changes, student attempt schema changes, or live backend integration.

## Baseline and user-reported issue

The earlier Flag/Flagged and Star/Starred labels changed an auto-width button in a flex row, shifting the adjacent point count. The previous targeted patch already made the visible caption constant and supplied aria-pressed and aria-label for the selected state.

Source inspection of the actual runner further found:
- Touch CSS explicitly set its save-status to display:none. This hid "Saving…", "All changes saved", "Not saved", conflict/retry messaging on phones.
- The stand-alone retry and conflict controls were outside the sticky mobile footer, too easy to miss or cover with the fixed bottom navigation.
- Its 72px sticky-footer bottom offset was hard-coded even though actual mobile navigation height changes with text zoom, viewport dimensions and safe area.
- Swipe gestures on controls/maths could inadvertently navigate when horizontally panning long equations or pressing a button.
- Timer digits were tabular but lacked a minimum stable display width, and a long title needed to share limited header space.
- A flagged problem remained clickable in the sidebar even if allowBack:false subsequently locked that item.

## QN12.1 changes

1. js/pages/quiz.js: make one compact footer save-feedback region with live save status, Retry saving and Review conflicting answer controls. Keep the one-place existing saveLabel function and hide only the irrelevant retry action. Do not change server answer saving, request IDs, deadlines, navigation, flag persistence or grading.
2. assets/css/pages/quiz.css: keep save feedback **visible on touchscreens** as a full-width status row above two equal-width Previous/Next touch targets. Error/retry controls remain in the visible sticky footer. [hidden] flags are explicitly honored in CSS. Avoid horizontal overflow and preserve the existing style.
3. Measure real #mobile-nav top edge via ResizeObserver/viewport resize; set CSS --runner-mobile-nav-clearance. Prefer the measured clearance over a hard-coded 72px value. Clean up observers/listeners on route leave.
4. Keep Flag and Star captions/positions stable, with at least 44px touch targets, and make future flagged-problem list links disabled under allowBack:false. Numbered grid targets are also >=44px.
5. Give the timer a 7ch tabular-numeric minimum width, permit the header to wrap on very narrow screens, and offset question scroll positioning under the sticky site header.
6. Disable horizontal swipe navigation when starting from any button, form control, anchor, editable element, or math content. Preserve the existing blank-area gesture and keyboard shortcuts.
7. No redesign of the app shell, editing screens, historical quizzes, backend schema, or new services.

## Verification

- tests/unit/qn-fe-mobile-controls.test.mjs updated for observed mobile-nav height instead of the old fixed offset.
- tests/unit/qn12-1-mobile-runner.test.mjs adds eight static contracts for visible saving, correct hidden retry controls, sticky grid, cleanup, flag accessibility, timer dimensions, guarded swipe and touch targets.
- tests/qa/mobile-runner-browser.py runs real Chromium rendering against the **isolated Firebase Auth, Firestore, Storage QA server and synthetic student/quiz data only**, at 320, 360, 390, 430, 768, and 1024 CSS-pixel viewports. Checks Flag/Star geometry across toggle, timer width, horizontal overflow, 44px targets, mobile navigation clearance, and on 320px offline answer-save error plus retry/recovery. Captures screenshots/logs for inspection. This is NOT real Android/iOS hardware, and Chromium is NOT iOS Safari or browser text-size calibration.
- .github/workflows/quizer-verify.yml adds a separate test-only Chromium mobile QA job and also triggers on CSS/quiz.html changes. Existing two CI jobs are retained.
- Record the final **three-job** CI status and any browser errors in this checkpoint. Do not call QN12.1 verified until the browser job completes successfully.

## Remaining QN12 and QN13 audit concerns

- QN12.2: teacher editor touch sizing (some icon actions only 26px), upload/progress/resume, quiz management/catalog/account, keyboard visibility and mobile accessibility.
- Real iOS Safari and Android Chrome physical-device checks, portrait/landscape, 200% OS font setting and hybrid stylus/mouse, oversized LaTeX/image stress tests and color/contrast/VoiceOver need separate acceptance. GitHub CI Chromium emulation cannot prove these.
- QN13-A is the agreed **preintegration audit** after QN12, followed by QN11 integration, a QN12-B postintegration UI regression and QN13-B final end-to-end audit.
- Active QN8/QN10 components stay feature-disabled; Quizer Neon dev main schema remains empty. No deployments or production modifications have occurred.
