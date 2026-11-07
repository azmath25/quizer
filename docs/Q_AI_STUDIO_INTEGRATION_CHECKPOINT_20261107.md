# AI Studio / Quizer–Mimo implementation checkpoint — 2026-11-07

> This is a checkpoint, **not proof of deployment or workflow correctness**. Code and current CI/test evidence are authoritative. Do not merge this draft or remove `documents.html` until release gates pass.

## Delivered separately to main

- Quizer PR #27: MathJax source-LaTeX preserving page snips. GitHub Pages deployed.
- Quizer PR #28: copyable messages, uncompiled LaTeX fallback and empty-on-send composers. CI passed; GitHub Pages deployed.
- Mimo PR #32: bounded deterministic `text_join`, `json_merge`, `json_validate` utilities. Merged after CI; **Cloud Run has not been redeployed**, so production workflow tools may not include them.

## AI Studio draft implementation — Quizer PR #26

1. `ai.html` replaces the prototype with real authenticated teacher chat and a Background Jobs tab. Existing Create Quiz and Problem Bank paths link into the appropriate job target.
2. Shared `mimoAiHub` Firebase callable uses Neon owner-scoped threads/messages and sends a compact conversation synopsis plus the last few turns instead of the whole transcript. The scheduled summarizer is fenced, uses at most $0.003 per confirmed request, and never automatically repeats uncertain model work. Original messages remain queryable.
3. Photo upload creates a private Quizer image asset and a separately billed, owner-gated vision-extraction job. The attached photo reference and resulting conversation are saved. Text chat is **not** itself a native multimodal model; arbitrary returned images are **not** available.
4. Whole-document jobs accept a single PDF/image and select pages 1–100, with an independently reserved $0.03–$0.50 per-page hard Mimo run cap and a teacher-selectable document reservation cap up to $50. Atomic Firestore transaction claims permit at most three active pages, multiple admissions per scheduled tick, and no hidden reruns after uncertain dispatch. Outstanding runs are still polled when the document budget becomes exhausted.
5. The job API persists owner-authorized sanitized stage labels and per-page checkpoints: reading, extraction, verification, TikZ writing, PNG compilation, and preparing review. No fake ETA/progress percentages; timeline data must not leak prompts, credentials, or source content.
6. Completed pages require source SHA verification, complete teacher decisions, canonical Quizer problem validation, LaTeX parser round trip and owned ready image-asset bindings. Revisions use optimistic version checks. The existing import APIs create private quiz drafts or problem-bank entries only after approval; no automatic publish.
7. Prior single-page extraction remains functional until the new UI has been verified; do not delete its `documents.html` page beforehand.

## Storage / migration checkpoint

- Live Neon branch `sat-quiz-live-2026-11` was updated **additively** with compact chat-memory columns and image-asset/job references on 2026-11-07. Checked with `information_schema`. No existing chat, quiz, or job records were dropped.
- PDF batch job metadata and review records currently live in owner-scoped Firestore; this is durable but not the proposed future Neon-native job ledger. Long-term job audit/report migrations are separate.
- Original uploaded files and generated images stay in Quizer private asset storage or Mimo artifact storage, not the Neon message bodies.

## Release blockers and scope not yet completed

- **Real provider run**: Verify whole PDF with multiple pages and a figure, provider run-budget admission, output JSON quality, TikZ artifact fetch, final Quizer preview, and safe private import under an authenticated teacher. CI's Mimo mocks alone cannot prove this.
- **Per-figure TikZ at scale**: Existing pinned Mimo workflow exposes a conditional *page* PNG. There is not yet one independent compile/retry checkpoint for each of 20 figures on one or many pages. A failed diagram must not rerun the whole source extraction; figure-specific workflow design and real tests are outstanding.
- **Vision output**: Photos can be uploaded and their verified extracted mathematics discussed, but arbitrary model-produced image replies and raw-image native model chat require additional Mimo workflow support.
- **Browser continuity**: New server-backed chats from `ai.html` and popups are shared. Old pre-release local-only chats may not exist on Neon and cannot automatically be recovered from other devices.
- **Notification / ETA**: In-app job state/history works in draft; measured ETA and push notifications are not released.
- **Deployment**: Firebase/Cloud Scheduler requires authenticated Google Cloud access. Release script `scripts/deploy-ai-studio-functions.sh --deploy` checks project, secrets and tests, then targets only AI-related Firebase functions. Do not use until the current PR is green and the live source/permission contract is verified.
- `documents.html` deletion remains **deferred intentionally** until the new release is live and an actual teacher can extract, review and import from `ai.html`.

## QA evidence to collect before full release

- Full Github CI green on current PR #26 head (backend/unit/static/build and Firebase emulator/transport).
- Live teacher can open an old saved thread started in popup from `ai.html?thread=...`, continue it, refresh, and see summary-backed context.
- Real PDF page extraction completes within selected capped budget; 3-page + 20-figure simulations distinguish per-page and per-figure limitations.
- Forced unknown/timeout does **not** reissue paid run; background job remains visible after reload; exhausted budget does not start new calls.
- Rejecting/approving questions persists across reloads and remains owner-gated. Forged assets, duplicate imports, incorrect answers, malicious LaTeX and hidden grading data are blocked.
- Only after passing release checks: deploy Firebase functions, then merge and publish UI, then retire `documents.html`.
