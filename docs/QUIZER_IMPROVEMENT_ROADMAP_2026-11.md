# Quizer reliability, performance, and Mimo integration roadmap

Date: 2026-11-03
Repository: azmath25/quizer
Working branch: `work/quizer-audit-optimization-2026-11`
Base: `main` (baseline observed at `e5ceb11f110ab85a04033ffe9638fd1a23d85c40`)

## Status and interpretation

This roadmap is a planning artifact only, not a claim of implementation or deployment.
It reconciles:
- `docs/COPILOT_IMPLEMENTATION_PLAN.md` (original v2 implementation design, 29 Oct)
- `quizer-backend-request-map.md` (read-only code audit, 30 Oct)
- `quizer-target-operations-map.md` (proposed request architecture, 30 Oct)
- Current `main` through 1 Nov, which already merged image-signing improvements and quiz batch prefetch in PRs #7/#8.

The repository already implements the v2 product. Do **not** restart from scratch or
treat original design/older audit recommendations as unimplemented facts.

## Non-negotiable guardrails

1. All edits, commits and docs are on the named working branch only.
2. No merges, no pull-request merges, no deployments, no changes to GitHub Pages settings,
   no Firebase production changes, database writes, migrations, rules publishing or live jobs.
3. No commits or force pushes to `main`, `main-backup`, or Mimo repositories.
4. Work one authorized milestone at a time and stop for the owner's approval after
   reporting actual files, tests and outstanding risks.
5. Preserve current security properties: canonical roles, teacher ownership,
   private quiz access, admission, immutable published revisions, key secrecy,
   server grading, deadlines, idempotence, ordered autosave, and audit trails.
6. Strict `allowBack: false` attempts must never receive future question text, images,
   answer keys or question-file links.
7. Never store tokens, signed links, credentials, student answer text, or private
   production records in telemetry, test fixtures or commits.
8. Prefer emulator/fixture/local testing; distinguish code verification from real browser
   and deployed environment checks.
9. Current UI semantics (including Nov 1 image-first rendering behavior) must be
   characterized and preserved unless the owner approves a product change.
10. Quizer must remain usable without Mimo. Mimo-produced content is always untrusted
    draft input until validation and teacher review.

## Milestones (approval-gated)

### Q0 — Baseline and gap analysis (first implementation authorization)
- Inspect working branch vs current main; review Nov 1 commits in quiz navigation
  and image paths against October request maps.
- Capture actual API sequence, roles, strict/no-backtracking behavior, and timing
  instrumentation points; identify duplicates, missing tests and regressions.
- Run available unit, backend, emulator integration, transport, static and build
  verification locally where environment permits; record all skipped suites.
- Deliver `docs/QUIZER_IMPLEMENTATION_PROGRESS.md` with reproducible findings,
  concrete Q1 file/test list and revised scope. **No application changes in Q0.**

### Q1 — Frontend and student flow baseline
- Inspect authenticated startup, page router, catalog, question navigation,
  MathJax, answer controls, image behavior and results on narrow/mobile widths.
- Add non-sensitive, opt-in local timing and request-count diagnostics where needed.
- Create regression/acceptance checks for routes and state cleanup.
- Do not change user-visible behavior except for confirmed defects.

### Q2 — Question-delivery correctness and remaining performance gaps
- Verify existing batch prefetch for `allowBack: true`; avoid per-click blocking
  question requests, unnecessary re-fetch, excessive payloads and duplicated loads.
- Maintain bounded large-quiz behavior and current rendering semantics.
- Protect `allowBack: false` server frontier; if optimization is needed,
  design/implement atomic save+advance+fetch with idempotent request IDs.
- Test refresh, multi-tab, expired attempts and permission changes.

### Q3 — Images and assets
- Verify current image signing, authorization and deduplication code.
- Remove any remaining O(total quiz size) read per individual image lookup.
- Batch requested assets, bind links to immutable generation, handle expiry and
  retries safely; honor the current image-ready UX choice until approved otherwise.
- Check CORS/URL expiry via emulator or mocks only; deployed behavior remains unverified.

### Q4 — Autosave, recovery, submit and grading
- Make answer writes ordered/versioned, recover safely after interruption,
  and guard stale acknowledgments, concurrent tabs and retries.
- Verify submitted answer snapshot, server deadlines, scoring and result release.
- Add database race/permission tests rather than relying only on UI tests.

### Q5 — Teacher/admin/report and problem-bank flows
- Audit authoring, imports, problem reuse, paginated bank browsing, publication,
  access applications, teacher reports, exports and admin activity.
- Fix high-impact correctness/performance defects in small isolated commits.
- Check teacher/student boundaries and private content visibility.

### Q6 — Mobile frontend verification and polish
- Browser-level acceptance of small screens, long mathematics, images,
  answer entry, keyboard accessibility, loading states and consistent styling.
- Verify request counts and timing against Q0 baseline without invented speedups.
- Preserve existing bright-blue design unless the owner requests redesign.

### Q7 — Mimo-to-Quizer draft import bridge
- Specify a versioned draft payload for statement/options/answer metadata,
  figures and source provenance produced by Mimo workflows.
- Build an optional Quizer-side import/preview adapter; validate input, sanitize,
  flag uncertainty and require teacher approval before any publish.
- Reconstructed TikZ figures stay separate image assets. No automated live quiz
  writes, implicit privileged account, or dependency on Mimo at quiz runtime.
- Any required Mimo-side changes receive separate authorization in its own branch.

### Q8 — Final readiness report (not deployment)
- Run appropriate available test suites and browser QA.
- Produce an evidence-backed change log, remaining blocker list, rollback notes,
  cost/latency considerations and a deployment checklist for future approval.
- Stop with unmerged working branch; do not deploy or merge.

## Milestone handoff format

For each authorized Q milestone report:
- current branch, starting and ending commits, and scope completed;
- concrete behavior changes and touched files;
- commands run and actual pass/fail/skip evidence;
- authorization/privacy/regression checks;
- limitations, risks, and main-branch divergence;
- the **next milestone is blocked pending explicit owner approval**.

## First next action

On owner's instruction: execute **Q0 only** on this branch, write the gap audit and
verification checkpoint, then stop. Do not begin Q1 or touch production.
