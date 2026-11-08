# M0 — Quizer-native AI Studio: source-of-truth baseline audit

**Date:** 2026-11-08  
**Status:** M0 read-only source audit; no frontend redesign, backend changes, provider calls, production deployment, data migration, protected-branch merge or GitHub Actions.  
**Source branch:** `feature/ai-studio-m0-baseline-20261108` created from `release/t1-png-recovery-safe-20261108`, the recovery-preserving T1 release branch.  
**Next implementation boundary:** M1 only. Preserve the working code, then redesign its presentation.

## 1. Findings, with evidence

### 1.1 The preferred earlier design exists, but is **not** a functional backend alternative

Preserved design reference:
- `backup/main-before-document-image-ui-20261106:ai.html`, Git blob `631eafb37e8427a92e984c4e8ec2cfd9daf03acd`.
- `backup/pre-main-consolidation-20261106:ai.html` has the **same blob**. Do not treat these as two independent functional alternatives.
- It is a large, inline HTML/CSS/JavaScript preview (~73.9 k characters); does **not** have `js/pages/ai-studio.js` on those backup branches.
- It explicitly labels itself “Preview · no live AI”; `seed()` inserts sample conversations/jobs; `startJob()` inserts a local fake job; the inspector says “Simulated jobs · No server requests.”
- Its UI is still a meaningful **design reference**, particularly the conversation-first top bar, conversation/search/pinned sidebar, central thread and composer, job inspector, modal dialogs, responsive layout and visible jobs progress.
- It calls `mountShell` for the site's shared header, but cannot be restored wholesale without replacing the real AI Studio application with simulated behavior.

### 1.2 Newer AI Studio has actual functionality

Current recovery-preserving T1 source is on `release/t1-png-recovery-safe-20261108`, carried unchanged into this M0 branch. Main work surfaces:
- `ai.html` (HTML UI), `assets/css/ai-studio-production.css`, `assets/css/ai-studio-axiom-p1.css`, `js/pages/ai-studio.js` (live controller).
- `js/components/shell.js` mounts Quizer's **real Math Quiz brand/logo, main navigation, account/theme controls** into `#site-header`. In addition the AI Studio HTML contains a second `axiom-brand` reading “Quizer AI / MATHEMATICS STUDIO” in a custom sidebar. This duplicated branding/navigation and its inconsistent layout should be repaired in M1, not by deleting the shared shell.
- The current AI Studio has real chat history, thread search, pinned threads, message pagination, a Markdown/MathJax renderer, text/photo inputs, snipping, server-backed job list, per-page extraction, budget controls, page progress and PDF source preview.
- `js/pages/ai-studio.js` calls `mountShell({showAssistant:false,showBackdrop:false})` and the teacher-only Firebase services. Backend and auth integration must survive visual restructuring.

### 1.3 Durable chat and privacy

- `js/services/mimo-chat.js`: `sendTeacherChatMessage` uses the authenticated Firebase callable with request IDs and session-epoch checks. `teacherChatHistory('chat.list'|'chat.get')` reads saved threads.
- `functions/src/mimo/ai-hub.js` exposes owner-scoped, verified teacher/admin chat history and existing direct-send compatibility. Chat history is available server-side through the AI memory store. M1 may change its visual arrangement but **must not reset chat IDs, silently clear stored messages, break popup/AI Studio shared history, expose secrets, or change the callable protocol**.
- `js/components/ai-chat-markdown.js` renders untrusted model output as DOM text and safely typesets TeX. It provides **original LaTeX source** when MathJax errors; this is a required compatibility guard for malformed math.
- `js/pages/ai-studio.js` clears the submitted composer draft immediately, handles busy state and errors; preserve this behavior when reworking the composer.

### 1.4 PDF jobs and T1 TikZ are working paths, not disposable prototypes

- `js/services/mimo-extraction.js` invokes owner-scoped Firebase functions; the Mimo API project key stays server-side.
- `functions/src/mimo/batch.js` stores a durable, owner-scoped `mimoBatchJobs` document and per-page `mimoBatchPages` checkpoint records, with cost limits and background progress.
- The base includes the **recent successfully deployed PDF completion-recovery logic**, `functions/src/mimo/completed-page.js`, handling fallback to validated first-pass extraction and protecting teacher review from stale polls. This code must **not** be regressed by using a branch based directly on old `main`.
- `js/components/mimo-png-viewer.js`, `js/pages/ai-studio.js`, the Firebase `mimoBatchImage` callable and `createExtractionTransport().png()` form the T1 path: owner-checked job/page → existing run ID → Mimo image artifact GET → PNG MIME/magic validation → browser blob preview/download and checksum metadata.
- Confirmed existing image: Mimo run `7e8f42c3-514c-407c-b93a-4f85fe54bd71`; page 2; PNG 13,527 bytes, 160 DPI, SHA-256 `47c01a3158bdf1a84bb8b687f2cb8046bc9651f781193d6c060c2e346f5901f4`.
- User confirmed seeing the image in Chrome in the Quizer session via the **temporary signed-in browser smoke test**, not through the permanently published T1 frontend. T1 retrieval has browser evidence; **the new permanent PNG UI remains unpublished**.
- Compiled PNG is **not yet automatically attached** to the corresponding Quizer question; that is T2, after M2/M3.

### 1.5 Browser snipping and document source previews

- `js/components/page-snip.js` has `formatSnipMath`, `assembleSnipFragments`, `snipPageContent`, uses document order and attempts to recover original MathJax LaTeX rather than copying glyphs. Preserve this and its existing tests. It is not a guarantee of perfect math extraction from every page or image.
- `js/components/ai-source-preview.js` previews the selected local source. Preserve file selection, page context and re-attachment paths.
- The student/user shared floating assistant in `js/components/assistant.js` also uses the snip utilities; M1 must avoid breaking it.

### 1.6 Canonical Quizer LaTeX import path — target for M2/M4, not a new editor

- `upload.html` and `js/pages/quiz-editor.js` already implement teacher import, parsing, preview and draft editing.
- `js/pages/guide.js`, `shared/latex-parser.js` and `examples/algebra.tex` describe the required syntax: `\\quiztitle{}`, `\\begin{problem}`, `\\begin{choices}`, `\\choice`, `\\correctchoice`, `\\answer{}`, `\\accepted{}`, `\\begin{solution}`, etc.
- `js/pages/quiz-editor.js` already **consumes** `sessionStorage['mathquiz.aiImport']`, putting `{source,title}` into the existing editor and running its preview. GitHub code search finds **only the consumer**, not an active producer. M4 needs a producer/handoff, not a parallel AI importer.
- The older `js/services/ai-reviewed-import.js` and `shared/mimo-extraction.js` support a **separate per-question approval/JSON figure-binding workflow**. This is the user-rejected architecture; preserve functionality through the interim period, then retire it in M4 after the standard import handoff works. No approval requirements should be added to the new product.
- Existing Mimo `mimo.extracted_page.v1` outputs are not already complete canonical Quizer LaTeX, nor do they guarantee solved/verified answer keys. M2 must handle this explicitly instead of mislabeling the current extract output as importer-ready.
- `documents.html` redirects to `ai.html?mode=job`; do not create a competing documents application.

## 2. Non-negotiable behavior preservation for M1

| Capability | Current source | Required M1 result |
| --- | --- | --- |
| Site identity, nav, theme, account | `js/components/shell.js`, `ai.html` | One consistent Quizer shell, no second competing logo |
| Real teacher authentication | `js/firebase-client.js`, `js/services/mimo-chat.js` | Server-authorized, owner-scoped; no direct browser Mimo key |
| Chat/send/retry/draft state | `js/pages/ai-studio.js`, `js/services/mimo-chat.js` | Preserve sender, distinct error handling, cleared send draft |
| Saved/pinned chats, old messages | `js/pages/ai-studio.js`, `functions/src/mimo/ai-hub.js` | Same thread IDs, messages, pagination and search |
| Markdown and invalid TeX source fallback | `js/components/ai-chat-markdown.js` | Safe rendering, raw TeX visible on errors |
| Snip, photo and math context | `js/components/page-snip.js`, `js/components/ai-source-preview.js` | Preserve behavior and privacy protections |
| PDF job creation, page progress, budgets | `js/services/mimo-extraction.js`, `functions/src/mimo/batch.js` | Same jobs and run IDs, no repeat uploads |
| PDF checkpoint recovery | `functions/src/mimo/completed-page.js` | Preserve live deployed recovery logic |
| TikZ PNG preview/download | `js/components/mimo-png-viewer.js`, `functions/src/mimo/batch.js` | Keep permanent T1 viewer in the rebuilt interface |
| Normal Quizer import | `upload.html`, `js/pages/quiz-editor.js` | Do not replace, rebuild or fork importer in M1 |

## 3. Implementation risks / unresolved facts

1. **Frontend is not deployed via T1:** The updated HTML and viewer currently exist on GitHub; the live browser T1 test was a temporary console-based UI. M1 should not assume production already serves its new controls.
2. **GitHub Pages publishing:** Existing site publishing uses GitHub Pages Actions. User prohibits GitHub Actions and merge to `main` without explicit approval. M1 should be built/tested on a feature branch, not silently deploy by switching publishing methods.
3. **Visual preferences:** Source audit proves what the old prototype implemented in DOM/CSS; it does **not** establish the user's exact desired pixel styling or a full visual QA result. Preserve historical style assets as design references rather than assuming the prototype's decorative elements are mandatory.
4. **User requirement for one PDF job:** Existing Firestore batch jobs support durable pages, but the internal AI revision/candidate history contract is not implemented in the requested final form (M3/M5). Do not conflate Mimo run UUID, Quizer document job ID, revision ID and quiz draft ID.
5. **Separate per-question approvals:** Current AI Studio still asks for approvals and JSON image bindings; these are transitional code paths and will be replaced by the normal Quizer importer later (M4). Do not compound them in M1.
6. **Figure matching and geometric correctness:** Retrieval success does not validate reconstruction accuracy or automatic figure placement.
7. **Baseline tests:** No browser/mobile capture has been executed as part of this M0 source audit. Run targeted tests for M1 after implementation, checking both shared shell and the preserved workflows.

## 4. Exact M1 implementation scope and acceptance gates

M1 is a **frontend integration and design** milestone, not a new backend, PDF workflow, approval model or import system. Plan modifications to `ai.html`, `assets/css/ai-studio-*.css` (minimal and reversible) and the presentation/event-binding portions of `js/pages/ai-studio.js`. Reuse `js/components/shell.js` without inventing a second navigation implementation. Preserve backend and service modules unless fixing a demonstrable UI integration bug requires a tightly scoped change.

M1 must visibly deliver:
1. Quizer-native shared header/logo, nav, theme and account behavior on desktop/mobile without duplicate branding or a hidden/overlaid global navigation.
2. The preferred compact conversation-first visual hierarchy: discoverable threads/search/pinning, readable message canvas, reliable composer and unobtrusive jobs/workbench panel. Use the old `ai.html` as visual reference only.
3. Jobs and stages remain accessible **inside `ai.html`**, including historical jobs, the T1 compiled PNG viewer, source preview and page details. No separate `documents.html` app.
4. Chat history, send, session guard, copy/TeX fallback, snipping, drafts and error states remain functional. AI entries from question/quiz contexts remain compatible.
5. No new calls on ordinary page open besides existing intended requests; no new Mimo provider runs during design QA.
6. Tests and screenshots at desktop and narrow-mobile widths, plus Node tests for chat, view, snip, PDF and static imports, followed by an explicit M1 checkpoint.

**M1 stop boundary:** No M2 output-schema change, no M3 revision history, no T2 figure attachments, no M4 canonical import hookup, no GitHub Actions and no production deployment.
