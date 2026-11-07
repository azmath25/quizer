# P1 checkpoint — Axiom-style one-page AI Studio

Date: 2026-11-07
Branch: `feature/p1-axiom-one-page-20261107`
PR: https://github.com/azmath25/quizer/pull/36

## Scope delivered in source

The visual architecture is based on the **layout and navigation** of
`azmath25/axiom` (not Axiom's color palette), and it uses Quizer's
existing design tokens, authentication and live Firebase/Mimo services.

1. **One-page workspace** in `ai.html`: compact persistent navigation
   and chat history; centered reading-width conversation and composer;
   optional right-hand job workbench on wide screens; off-canvas
   navigation/workbench on mobile. No new AI route is required.
2. **Real command palette** with Ctrl/⌘ K and slash-at-empty-draft.
   Commands navigate to live assistant, document extraction, owned jobs,
   teacher review, source snip, preferences, and local TXT/TeX import.
   There are no fake model requests or simulated artifacts.
3. **Private Document Lab** in the same page: an owner-authorized PDF
   or PNG/JPEG batch starts only after explicit consent. Local PDF
   preview and local image figure cropping occur without network
   requests. A crop is uploaded instead of its original only when
   the teacher consciously starts a job. Changing source/crop resets
   consent. TXT/TeX source can be imported into the unsent chat draft.
4. **Budget clarity**: Standard per-page cap defaults to $0.30
   (instead of the historical $0.15), with explicit $0.15 and $0.50
   choices. The document hard cap remains configurable; the UI warns
   when selected pages exceed what the hard cap can reserve. These are
   maximum reservations, not provider price guarantees.
5. **Existing server-backed features retained**: authenticated Firebase
   -> Mimo chat; Neon owned conversation history; PDF batch list/status,
   reviewVersion conflict protection and teacher-approved import;
   local source checksum verification; owner-scoped diagram PNG
   retrieval and private asset upload; LaTeX raw-source fallback and
   icon-only message copy.
6. **Entry points consolidated**: teacher shortcuts on Home,
   Teaching and Profile, plus the site navigation, route to
   `ai.html` or `ai.html?mode=job`.
   The old `documents.html` interface has been replaced with a
   small compatibility redirect to `ai.html?mode=job` for bookmarked
   URLs. The original page source remains recoverable in Git history.

## Tests

- Existing Quizer unit, Firebase emulator/integration, static,
  transport and build checks run from GitHub Actions.
- A browser smoke runs with authenticated-looking mocked callables
  at 390px, 1024px and 1440px for teacher/admin and a student UI.
  It checks Axiom shell, mobile drawers, workbench, command palette,
  real chat submit/copy icon, document navigation, budget warning,
  local PDF preview and TXT/TeX import without sending.
- A batch regression uses mocked Mimo PDF ingest, runs and compiler
  artifacts to check successful page validation, authenticated TikZ
  PNG access, and no repeat paid calls for completed checkpoints.

These mocks prove code paths and front-end behavior, **not** that the
production Groq provider or private compiler is currently functioning.

## Release prerequisites — not completed by this branch

- P0 Mimo PR #33 (safe provider error diagnostics) and Quizer PR #34
  (owner-safe PDF failure reasons) remain separate from P1; integrate
  in a reviewed order and resolve any shared-file conflicts.
- Production `mimo-worker` / Firebase function deployments were not
  performed. A real vision PDF and a real PDF with a TikZ figure need
  **separate, explicitly authorized bounded canary runs** after P0
  error diagnostics are deployed. Existing failures reported
  `MIMO_RUN_FAILED` with a generic internal backend error; this PR
  does not claim that error is fixed by changing UI or budgets.
- No protected main merge and no GitHub Pages/Cloud deploy were
  performed; the live site will keep its previous layout until a
  reviewed release.
- The previous standalone Document Desk interface has been retired.
  The old URL remains only as a 0-second compatibility redirect; no
  duplicate AI/extraction runtime loads at that URL. Do not remove
  the redirect until incoming bookmarks are no longer needed.
