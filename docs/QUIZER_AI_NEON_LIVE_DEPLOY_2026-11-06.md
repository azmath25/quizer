# Neon live AI schema deployment checkpoint — 2026-11-06

## Deployment status: SUCCESS (Neon database only)

- Neon project: quizer-dev, `soft-grass-35754518`
- Target branch: `sat-quiz-live-2026-11`, `br-lucky-lake-b9pocorx`
- Database and DB role: `quizer`, `quizer_owner`
- Source migration: `db/migrations/20261106_ai_memory_documents.sql` from feature branch `feature/quizer-ai-neon-memory-docs-20261106`, source Git blob `e5c991462ccb3e55a100c073116b1b61f8da4087`
- Execution: **one atomic transaction** consisting of 9 additive CREATE SCHEMA / CREATE TABLE / CREATE INDEX statements.
- No existing table mutation, DROP, DELETE, UPDATE, TRUNCATE, migration rollback, secret access, Firebase deployment, Mimo model call, branch merge or GitHub Pages deployment.

## Preflight

- Target database `quizer` existed with role `quizer_owner`.
- Existing quiz schema `quizer`: **7 tables**.
- Existing AI schema `quizer_ai`: **0 tables**.
- The schema had already passed development-branch rehearsal on `quizer-ai-memory-docs-dev-20261106`.

## Post-deployment verification

**AI tables (4):**
- `quizer_ai.threads` — 5 columns.
- `quizer_ai.messages` — 8 columns.
- `quizer_ai.documents` — 9 columns.
- `quizer_ai.document_pages` — 9 columns.

**AI indexes (4):**
- `threads_owner_recent`
- `messages_thread_created`
- `documents_owner_recent`
- `document_pages_owner`

Foreign keys, primary keys, unique keys, and bounded-content CHECK constraints appeared in the PostgreSQL catalog, including composite `(id, owner_uid)` references for user-owned messages and document pages.

**Data check:** all four new AI tables contain **0 rows**; no synthetic user records were written to the live branch. All **7 existing** quiz schema tables remained present.

## Release boundary

The live **Neon schema** is ready, but this does **not** mean history or document features are available in the website yet. Their backend implementation remains in draft PR #20, and the existing deployed `mimoTeacherChat` callable does not yet accept the new `action` fields.

A separate Firebase v2 callable deployment and end-to-end authenticated teacher verification are needed. Verify that the server-only Firebase secret `QUIZER_NEON_DATABASE_URL` points to the intended `quizer` database on `sat-quiz-live-2026-11` before enabling the updated callable. Do not expose a database URI, provider key or user chat data in the browser.

References: https://github.com/azmath25/quizer/pull/20 and https://github.com/azmath25/quizer/blob/feature/quizer-ai-neon-memory-docs-20261106/db/migrations/20261106_ai_memory_documents.sql
