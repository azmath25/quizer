# Tasks.1 — PDF job status and existing-run reconciliation

Date: 2026-11-07
PR: https://github.com/azmath25/quizer/pull/37
Branch: `fix/tasks-attention-reconcile-20261107`

## Why this milestone exists

The user's `Functions_general_quiz.pdf` batch (13 pages) has known
Mimo run IDs for pages 1–3. In Neon all three runs are **failed**;
remaining pages were not confirmed dispatched. The previous UI called
these pages "attention" and separately labeled the parent as "running".
The status was technically an attention/stop state, but misleading.

## Implemented

1. A distinct presentation for confirmed terminal **Failed**, ambiguous
   **Outcome uncertain**, and **Paused / never dispatched** pages.
   List summaries show **Needs action** rather than a misleading
   generic "attention", without rewriting any historical Firestore data.
2. Authenticated `mimoBatchReconcile` callable, owner-role scoped via
   the existing `authorizeExtractionRole` + job UID check.
   It checks up to 10 existing run IDs on attention pages using Mimo
   run GET/status and never starts new runs, uploads, retries, or changes
   spending limits.
3. If an existing run eventually completed, its original output passes
   the existing strict page validation before being recorded. If still
   running, the page reattaches to normal polling under the same run ID.
   If definitely failed, it remains blocked/failed for explicit review.
   Unknown dispatch without a run ID remains blocked; no guess/replay.
4. Browser only invokes reconciliation after the teacher clicks
   **Check existing run IDs (no new AI jobs)**. Feedback reports how many
   IDs were checked. The button is not offered for unknown requests
   with no known run ID.

## Verification scope

- Mocked worker tests cover owner isolation, a terminal failed run,
  a late completed run, known-running reattachment, and missing-run-ID
  ambiguity. They assert no additional `/runs` POST calls.
- UI contract test covers state names and the explicit reconcile action.
- Existing browser, static, backend transport and Firebase emulator CI
  remain required, not assumed.
- This is **not** a repair of the Groq vision provider error or the Mimo
  compiler. It is deliberately limited to Task statuses and safe run
  reconciliation; Solve Me and Axiom design are unchanged.

## Release boundary

No merge, Firebase deploy, Google Cloud config change, database rewrite,
historical rerun, or new paid provider call as part of this milestone.
The new callable and frontend must be released together in a controlled
Firebase + GitHub Pages rollout. Until then live UI continues to show
legacy labels. Follow up with a separate authorized release and a single
status-only live check, not a paid extraction canary.
