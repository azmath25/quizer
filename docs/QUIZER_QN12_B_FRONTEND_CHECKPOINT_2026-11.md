# Quizer QN12-B — postintegration frontend/mobile/a11y checkpoint

**Date:** 2026-11-04 (Asia/Baku).
**Branch:** `work/quizer-audit-optimization-2026-11` in `azmath25/quizer`.
**Starting branch SHA:** `53302ab5f7a1e992ab4ccd6cfbbb1e515a90f9ec`.
**Final tested source SHA:** `c3fbba116706a17ef5e5f5023575f3762cb7ee7b`.
**Status:** **COMPLETE FOR ISOLATED, TEST-ONLY FRONTEND AUDIT**. Stop before QN13-B, real staging or deployment.
**CI:** [all three green, run 41730776701](https://github.com/azmath25/quizer/actions/runs/41730776701).

## Audit scope and findings

The work-branch frontend was reviewed for the student quiz runner, save/retry/navigation, 500-question prefetch pressure, flag/star state stability, numbered problem grid keyboard focus, quiz draft author editor, import/preview, mobile selected-problem dock and LaTeX import. All staged backend components remain **default OFF** and the active Firebase routes still use existing legacy Firestore handlers. This is a **postintegration source/frontend regression**, not a proof of actual live Neon/Storage cutover.

### Fixed and tested

1. **Save-before-navigation correctness.** The old `syncNavigation` sent `saveAnswers` and `navigateAttempt` through `Promise.all`, allowing navigation to reach the server before the answer save. `js/services/runner-scheduling.js` exports `saveBeforeNavigate` and the runner now calls the server navigation only **after** its existing `flush()` successfully commits. Save/version conflicts block navigation. Optimistic display of an already-authorized cached question remains, but a server failure still reverts the index. Unit tests simulate a delayed save and a failed save.
2. **Bounded large-quiz prefetch.** The previous warmup dispatched **all** missing 20-item question batches concurrently (up to 25 calls for a 500-item quiz), then eagerly loaded every question image. The runner now uses `prefetchQuestionBatches` with **at most two concurrent, <=20-question RPCs** and a stop/epoch guard, prioritizing the nearest questions. Only the displayed question fetches images; errors in background warming do not block a later foreground retry. A pure 500-item test asserts 25 bounded pages, complete coverage and max inflight=2. This is request count/concurrency control, **not a measured real-cloud speedup or cost claim**.
3. **Flag/Star and accessible grid.** QN12.1 already fixed the Flag↔Flagged button-width issue by keeping the visible caption constant, using `aria-pressed` for state and a stable >=44px target. The QN12-B Chromium checks confirmed that both Flag and Star **still do not resize or shift** at every tested width and enlarged text. The numbered problem grid now has exactly one `aria-current="step"` and preserves focus after rerendering on saves, flags or navigation. Real Chromium keyboard navigation coverage was added.
4. **Native keyboard choice selection.** Global runner shortcuts previously intercepted Left/Right arrow keys on focused radio answer controls. The shortcut handler now excludes all native inputs, buttons, links, select/textarea, contenteditable elements and ARIA interactive controls. This preserves radio-group arrow navigation and prevents accidental question changes. Unit/source regression and conditional choice-focused Chromium checks were added.
5. **Teacher/import tab accessibility.** Creation-method, LaTeX import/preview and draft edit/preview tabs now use a shared `bindAccessibleTabs` helper with Arrow Left/Right/Up/Down, Home/End, roving `tabIndex`, one `aria-selected`, real `role="tab"`, `aria-controls`, and labelled `role="tabpanel"` panels. Mobile CSS/layout and original click/tap behavior are retained. Browser tests navigate these tabs using keyboard focus, not only mouse events.
6. **Existing responsive controls preserved.** The QN12.1/12.2 fixes for measured bottom navigation clearance, sticky save/retry status, touch targets, selected dock collapse, input dimensions, long title wrapping, timer geometry, browser file/import status announcements and hover-only mouse scaling remain intact.

### Changed files (QN12-B only)

- `js/services/runner-scheduling.js` (new)
- `js/components/accessibility-tabs.js` (new)
- `js/pages/quiz.js`
- `js/pages/quiz-editor.js`
- `tests/unit/qn12-b-frontend.test.mjs` (new)
- `tests/qa/mobile-runner-browser.py`
- `tests/qa/mobile-author-browser.py`

No backend source, migration, deployment configuration, Mimo or the separate AI/snipping branch was changed.

## Full final-code test evidence

**Run:** [41730776701](https://github.com/azmath25/quizer/actions/runs/41730776701), source SHA `c3fbba116706a17ef5e5f5023575f3762cb7ee7b`; **3/3 CI jobs green**:

- **348/348** Node unit tests, including **8 QN12-B scheduling/tab/keyboard tests**.
- **5/5** backend tests and passing static frontend verification.
- **88/88** Firebase demo-emulator integration tests and **1/1** transport test.
- **Student Chromium runner:** widths **320, 360, 390, 430, 768, 1024 CSS px**, plus **390 px with simulated 200% root font**. Stable Flag/Star geometry, >=44px targets, current-step marker, keyboard focus, saved/error/retry visibility, no horizontal overflow and mobile-nav clearance.
- **Author Chromium editor/import/bank:** widths **320, 390, 430, 768, 844 touch-landscape, 1024 px**, plus **390 px with simulated 200% root font**. Touch target and dock geometry, keyboard-controlled creation/preview tabs, status announcements, save controls, import field visibility, no horizontal overflow and bottom-nav clearance.
- Both browser jobs use disposable local Firebase Auth/Firestore/Storage emulators and synthetic seeded accounts/quizzes; they do **not** edit production quizzes or user records. Browser screenshots/logs are retained for seven days as GitHub Actions artifacts.

## Known release gates — QN13-B and separately approved real staging

1. The new QN11 private-bundle/Neon runtime is still **unmounted/default disabled**. These browser tests exercise the existing Firebase/Firestore behavior and shared client DTOs, not a real Neon+Firebase+GCS integrated deployment. The full end-to-end switch must be independently approved and tested against **isolated disposable Quizer** services.
2. **Manual physical-device QA** remains: iOS Safari (keyboard/safe-area/text-scale/VoiceOver), Android Chrome (TalkBack/IME), real low-memory Android phones and tablet landscape. Chromium is not proof of Safari rendering, mobile keyboard scrolling or assistive technology interoperability.
3. Real-cloud **500-question fetch, LaTeX/image import, large ZIP, student concurrency and request-billing performance** have not been measured. The 500-item test is a deterministic concurrency/budget test, not a performance benchmark.
4. No automatic axe/WCAG full-site audit, color-contrast certification, admin/teacher all-role end-to-end signoff, emergency release/rollback exercise, or production cutover was performed. QN13-B must evaluate outstanding accessibility/security/deployment risks.
5. The separately developed Ask AI / in-browser snipping branch remains isolated and unmerged; it is intentionally not a blocker for core quiz deployment unless the user explicitly makes it in-scope.

## Release decision

**GO to a separately approved QN13-B final security/release-readiness audit.**
**NO GO for production deployment** until real staging, migration/grant checks, cutover wiring, rollback, security review and physical-device checks are explicitly accepted.

**Stop here:** no merges, deployments, production migrations, real-cloud connection changes, protected-branch updates, Mimo access, or AI-branch modifications.
