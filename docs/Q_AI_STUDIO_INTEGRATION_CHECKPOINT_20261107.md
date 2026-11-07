# Q-AI Studio integration checkpoint — 2026-11-07

## Approved product direction

AI Studio (`ai.html`) is the single teacher-facing place for quick chat and background extraction. Create Quiz and Problem Bank link to the correct AI Studio job target; reviewed, structurally validated Quizer records import only after explicit approval.

## Implemented in **draft feature branch only**

- Replaced the simulated `ai.html` with authenticated chat and jobs UI.
- Reused the original Quizer `validateProblem`, extraction-review schema, LaTeX round-trip, and existing import receipt APIs for direct private draft/bank creation.
- Introduced a server-only `mimoAiHub` callable to share Neon chat threads across AI Studio, Ask AI popup, and floating assistant. Pagination permits older messages to be loaded.
- Reused existing Neon history implementation from earlier branch without merging unrelated changes.
- Added a bounded incremental conversation summary: full messages remain in Neon, only <=1600 characters of memory plus a few latest turns feed the cheap text workflow; each summary call has a $0.003 hard cap, a durable fenced claim, and no silent retries on unknown outcomes.
- Introduced an owner-scoped `mimoExtractList` callable for persisted Firestore extraction jobs. The server now exposes sanitized Mimo timeline node statuses; no checkpoint payload is returned.
- Raised per-page Quizer extraction default from $0.03 to $0.15 with explicit $0.15/$0.30/$0.50 selection and validation (server never accepts >$0.50 per run). The previous deployed functions still use $0.03.
- Added direct approved Quizer import adapter; existing Quizer API validates owned assets and import records before saving.
- Added image selection from chat; an explicit vision extraction job processes the photo, and the extracted mathematical content can then be used as contextual text in a chat response. General generated images remain unsupported.
- Reconstructed TikZ PNG, where available, is privately saved and must be manually associated with the correct reviewed question.

## Q-AI.SNIP — math-aware snipping (added to plan and implemented in branch)

- Rebuild browser-page text snips **in DOM order**: the old code scanned text and appended all MathJax formulas at the end, scrambling mixed text/formulas.
- Obtain original MathJax TeX at the typeset root, not unreadable rendered SVG glyphs or duplicate accessibility MathML; preserve inline versus display math delimiters.
- Preserve separate paragraphs and repeated choice texts, enforce input limits, and keep math delimiters intact rather than clipping partial formulas.
- Keep browser-tab pixel snip as a separate explicit-permission path for figures or formulas whose original LaTeX is unavailable; never pretend OCR or external-screen extraction has occurred.
- Both the floating teacher assistant and `ai.html` consume the same DOM snip module. The user reviews the selected text in the composer before sending; no automatic model call or hidden answer-key extraction.
- Tests: equation ordering, duplicate answer choices, display delimiters, bounded output, synthetic MathJax DOM integration, existing browser capture/privacy tests.

## Safety / outstanding release blockers

1. **Not yet a full-document background scheduler**: existing Quizer extraction supports one PDF page per run, 2 requests/minute and 20 requests/day. A 100-question / 20-figure parent job with durable per-page/per-figure checkpoints, total job budget, resumability and worker-side scheduling is still required.
2. Review decisions live in the current browser; persist source-verified approvals and figure association before production release. Existing job metadata persists in Firestore but is not yet a unified Neon job ledger.
3. No direct general-purpose vision chat workflow or arbitrary model-generated image output yet. Image conversation currently uses a bounded vision-extraction bridge.
4. Old previously ephemeral popup conversations cannot be retroactively recovered unless data survives in that browser; new conversations use shared server-side history.
5. Quizer live Neon requires **additive** `20261107_ai_compact_memory.sql` migration after production risk review. Applied/tested only on isolated Neon AI dev branch.
6. Firebase deployment requires the authenticated `sat-quiz-fd317` project, secrets `QUIZER_NEON_DATABASE_URL` and `QUIZER_MIMO_PROJECT_KEY`, and owner-visible tests.
7. Do not remove `documents.html`, merge, or release until the replacement is feature-complete, full test matrix is green and real provider workflows have been verified.

Mimo deterministic `text_join`, `json_merge` and `json_validate` live on a separate **draft** feature branch; their unit/cloud-readiness CI passed. Neither repo is merged or deployed from this work.
