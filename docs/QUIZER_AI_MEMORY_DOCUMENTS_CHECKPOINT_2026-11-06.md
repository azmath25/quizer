# Quizer AI memory and documents checkpoint — 2026-11-06

## Boundaries

Implementation branch: feature/quizer-ai-neon-memory-docs-20261106, based on feature/quizer-mimo-teacher-chat-ui-20261106.
Draft review: https://github.com/azmath25/quizer/pull/20

The existing Firebase v2 callable **mimoTeacherChat** remains the sole API for chat, history, documents and math-assistant modes. Existing Quizer Firebase Auth and verified Firestore teacher/admin roles are mandatory. No second Mimo bridge, direct browser access to Mimo/Neon, secrets in public JS, autonomous retries, or new provider selection.

**No Firebase deployment, production Neon migration, Mimo backend change or merge happened.**

## Files and features

- db/migrations/20261106_ai_memory_documents.sql: namespaced quizer_ai schema (threads, messages, documents, document_pages) with tenant foreign keys, indices and content bounds.
- functions/src/mimo/memory-store.js: server-side pooled PostgreSQL, owner-filtered reads, 50-message bound, atomic saved user/assistant turns, document text/page records and transaction rollback.
- functions/src/mimo/ai-hub.js: actions chat.send, chat.list, chat.get, document.create_text, document.list, document.get. Existing no-action chat requests stay backward compatible. One Mimo execution per send with existing four/minute, 25/UTC-day and USD 0.05 hard run cap. When a paid answer completes but Neon save fails, return the answer with a MEMORY_UNAVAILABLE warning; do not retry.
- functions/src/index.js: code-only routing through the same Firebase callable with the server-only project key and existing QUIZER_NEON_DATABASE_URL secret reference.
- js/services/mimo-chat.js: same Firebase client for all actions and identity checks.
- js/components/ask-ai-popup.js and js/components/ai-chat-library.js: saved chat retrieval, selected document context, pasted notes, math modes Explain / Hints / Check / Simplify / LaTeX.
- assets/css/ask-ai-popup.css: accessible scoped modal library styles.
- Added/extended focused frontend and backend tests and feature-branch-only non-deploying CI.

Text documents (up to 20,000 characters) work in the **development contract only**; PDF/image binary uploads, OCR, TikZ compilation, realtime streaming and automated quiz publication are NOT implemented or enabled. The document-page schema leaves a path for later extraction and human review.

## Neon development rehearsal

Quizer development project soft-grass-35754518, disposable branch quizer-ai-memory-docs-dev-20261106 (br-holy-bonus-b96gz792), parent main. Production-like branch sat-quiz-live-2026-11 and its tables were untouched. The schema was created on the disposable branch and all four tables were verified.

Synthetic SQL fixture verified two stored chat messages, one text-document page and a cross-owner filtered read returning zero. No real teacher or student data was written.

## CI verification

GitHub Actions run 42189955063 passed both jobs on commit adc1c9215be841012514d87af656991d11eaffca:
- Frontend/unit 640 passed, 0 failed.
- Backend/unit 37 passed, 0 failed.
- Firebase emulator integration/rules 97 passed, 0 failed.
- Transport 1 passed, 0 failed.
- 16-route static verification and production build passed.

This is unit/emulator and isolated SQL validation, NOT a new billable live Firebase-to-Neon-to-Mimo test.

## Release gate and further work

The new AI library frontend cannot be deployed safely against the currently deployed strict old callable: it will reject new action fields. Before any release, approve a production database migration, confirm that the existing Neon Firebase secret points to the intended database, deploy only the approved mimoTeacherChat callable to sat-quiz-fd317/europe-west1, and perform teacher/student/mobile/security acceptance checks.

Further independent slices: teacher-owned Firebase Storage PDF/image intake and checksum, asynchronous extraction with page text and surrounding figure captions, uncertain-span human review, restricted TikZ reconstruction worker, recoverable checkpoints, and retention/export/delete controls. Keep provider/API selection server-side and cost-limited.

**Checkpoint STOP: implemented and verified in an isolated branch; no merge or production deployment.**
