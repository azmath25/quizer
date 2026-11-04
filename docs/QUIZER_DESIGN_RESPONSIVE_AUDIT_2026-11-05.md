# Quizer page-positioning and device-orientation audit — 2026-11-05

**Branch:** `design/ai-studio-single-page-2026-11-04` (isolated design work; based on `work/quizer-audit-optimization-2026-11`)  
**Boundary:** UI and one read-only UI test only. No merge, deployment, GitHub Pages changes, Firebase/Neon/Mimo writes, authorization changes or data migrations.  
**Status:** source audit and layout corrections; browser/device visual acceptance remains outstanding.

## Product rule

- **Students (phone-first):** prioritize the current quiz/action, stable answer controls and save feedback; one-column navigation and readable results. Avoid adding extra overlays over the runner's fixed exam controls.
- **Teachers (desktop-first):** make writing, previewing, selecting and publishing feel like a workspace; use horizontal space without forcing desktop selection actions into a bottom tray.
- **Administrators (desktop-first):** show filters and record actions alongside the relevant row and preserve useful full-width listings. Mobile is supported but not the primary configuration.
- **All roles:** respect Quizer's existing theme, keyboard focus order, 44px touch targets, large text and measured mobile-navigation clearance.

## Route-by-route audit

| Route | Intended user/device | Finding or decision | Implemented on this branch |
| --- | --- | --- | --- |
| `index.html` | Student phone; mixed-role home | Tablet dashboard could squeeze two major columns; phone heading consumed extra space | Tablet dashboard stacks at <=1000px; phone heading/CTA spacing tightened |
| `quizzes.html` | Student phone | Search/filter toolbar could wrap unpredictably and waste horizontal room | Title search gets full width; subject and Search align on one phone row |
| `quiz.html` | Student phone | Protect timer, Flag/Star geometry and save-before-navigation; don't rearrange sensitive exam state | Phone question navigation auto-fits real 44px targets; overview CTA becomes full-width; narrow viewport padding refined |
| `results.html` | Student phone | 168px score indicator beside text can feel cramped on narrow screens | Score/description stack in centered order; grading/score semantics unchanged |
| `activity.html` | Student phone | Status, score and action could separate awkwardly on wrap | Mobile record details precede a consistent full-width actions row |
| `profile.html` | Student + staff | Sign out was a distant sidebar card and looked unrelated to identity | Moved Sign out beside account identity (single bound action); desktop identity grid and mobile stack; workspace links remain in sidebar |
| `login.html` | Student phone | Already constrained to centered 450px auth form | No new change needed |
| `access.html` | Student phone | Already uses `.narrow` and a single request form | No new change needed |
| `problems.html` | Teacher computer | Selection editor became a fixed bottom dock at <=1100px, including laptops; no-selection bank wasted wide space | >=1101px dedicated right inspector; 900–1100px compact right inspector; 761–899px initially collapsed top inspector with DOM/focus order updated; <=760px proven phone dock preserved; two card columns at >=1280px when not selecting |
| `problem-edit.html` | Teacher computer | Equal editor/preview widths can waste preview space | Source/editor gets more width than sticky preview at >=1101px |
| `upload.html` | Teacher computer | TeX editor and problem preview benefit from asymmetric workspace | Wider editable source and narrower sticky preview at >=1101px; prior mobile tabs/save layout untouched |
| `teaching.html` | Teacher computer | List tabs disappear after scrolling; controls spread across large viewport | Larger desktop canvas, sticky desktop tabs, compact filter field widths |
| `quiz-manage.html` | Teacher computer | Management actions and sidebar could end far away from content | Larger desktop canvas, sticky management tabs and right rail; existing access/grade contracts untouched |
| `admin.html` | Admin computer | User record actions can float at far right or wrap poorly; admin tabs scroll away | Wide desktop canvas, aligned account actions/filters, sticky tabs; tablet/phone actions wrap under record |
| `guide.html` | Teacher reference | No severe positioning regression identified from static layout; uses existing content width | No changes |
| `ai.html` | Future mixed-role | Isolated experimental studio; current router does not register it | Existing self-contained AI Studio remains in place; no integration or release |

## Modified UI files

- `js/pages/profile.js`: move existing `#logout` action into the identity summary; callback remains unchanged.
- `js/pages/problems.js`: reorder selected-problem panel DOM on tablets, adapt initial collapse on window size changes, preserve body portal/cleanup on phones; existing selected problems, revisions and actions remain untouched.
- `assets/css/layout.css`: role- and route-scoped desktop canvas/tabs and student mobile dashboard/activity layout.
- `assets/css/pages/account.css`: desktop identity/action alignment and phone wrap.
- `assets/css/pages/editor.css`: adaptive selected-problem inspector and authoring columns.
- `assets/css/pages/home.css`, `catalog.css`, `quiz.css`: targeted mobile priorities.
- `assets/css/pages/admin.css`, `reports.css`: desktop admin/teacher information layout.
- `tests/unit/design-responsive-positioning.test.mjs`: source regressions for layout boundaries.

No schema, backend worker, Firebase configuration, database, permission, grading, attempt, model-inference or release-setting file is changed. `ai.html` remains a standalone local preview.

## Verified source invariants

- QN12.2 mobile selection still uses a `<=760px` body-level dock, 44px controls, `z-index:70`, `#selection-details[hidden]` and measured `--mobile-nav-clearance`.
- Desktop/tablet bank inspector is no longer forced to `position:fixed;bottom:16px` at 900–1100px.
- Existing runner save feedback, navigation grid, `aria-current` and timer geometry are not edited.
- Existing profile `#logout` appears once and retains `action(root, "#logout", logout)`.
- Existing author import, draft save and publish code paths are not modified.
- CSS braces are balanced and the changed page-controller JavaScript passed syntax-only verification.

## Acceptance still needed before release

1. **Real Chromium geometry:** 320/360/390/430/600/760/761/768/844/899/900/1024/1100/1280/1440px; 200% text zoom; inspect bank selection expanded/collapsed, resize across boundaries, profile summary, admin records, desktop editor/preview, student results and exam footer. Confirm zero horizontal overflow, hidden buttons and focus order mismatch.
2. **Real hardware:** iOS Safari and Android Chrome with keyboard, safe-area insets, phone portrait, tablet landscape and coarse/fine pointer modes. Confirm action rows remain visible when the virtual keyboard appears.
3. **Behavior:** test student in-progress quiz, empty quizzes, failed save/conflict, no-back mode; staff empty and 100/500-problem bank selections; admin hundreds of user/job records. Check that new style rules never change read/write counts or call sensitive backend APIs.
4. **A11y:** keyboard focus order after tablet panel DOM moves, VoiceOver/TalkBack and high contrast/dark appearance; ensure no layout shift of Flag/Star on actual devices.
5. **CI:** test-only `quizer-verify.yml` must be explicitly run on this isolated branch before integration; its branch push trigger currently only covers the main Quizer work branch. Never manually dispatch the **GitHub Pages deployment workflow** for this design work.

**Release decision:** DESIGN ONLY / NO DEPLOY. No claim of physical-device or browser QA completion. No merge or copy into active Quizer pages until the owner approves and tests the isolated branch.
