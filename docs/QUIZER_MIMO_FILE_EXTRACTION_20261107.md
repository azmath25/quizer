# Quizer Mimo file extraction checkpoint — 2026-11-07

## Scope

Feature branch adds a teacher-only PDF/image extraction bridge from documents.html to published Mimo workflow c_mw5e6wmr_wma1bg, pinned at version 1. Existing project chat_test already has permission; no new API key is needed.

## Data path

1. Teacher explicitly selects PDF, PNG or JPEG (<=8 MiB) and consents in Document Desk.
2. Authenticated Firebase callable accepts bounded base64 bytes, checks verified email and live Firestore teacher/admin role, MIME magic and filename.
3. Server reserves an idempotent Firestore job and enforces 2 requests/minute and 20/UTC day atomically.
4. Using the existing secret QUIZER_MIMO_PROJECT_KEY, server uploads the file to Mimo integration artifacts. PDFs are ingested for true page counts, then run in single-page vision mode; images use Mimo image artifact input.
5. Published workflow version 1 runs in background with $0.03 hard per-run provider cost cap. Same job ID cannot automatically produce another paid run.
6. Owner-scoped status fetch validates extracted_page_json against the existing Quizer extraction contract, with trusted source metadata.
7. Teacher may edit, approve or reject every question, inspect/download the optional TikZ PNG, save image privately, and export reviewed LaTeX to import with Quizer Create quiz. No automatic bank/public quiz writes.

## Deployment and checks

GitHub Pages deployment does NOT deploy Firebase callables. Before activating this feature, run backend/static/unit/transport CI, review, then deploy only the three new Firebase functions to sat-quiz-fd317 (europe-west1), with existing Firebase secret available. Test real image, PDF and figure pages after deployment with a small provider budget. No production deployment is performed by this feature branch.

## Limits / risks

One PDF page per run; the Mimo workflow output must have schema mimo.extracted_page.v1. Review changes are local until export, not a durable Neon review UI. A composite TikZ PNG must be explicitly assigned to the correct problem. Mimo artifact quota is shared by the project; stored uploads count until retained/deleted. Unknown network outcomes are never retried automatically. More work is required for full-document batching and one-click authorized problem-bank imports.
