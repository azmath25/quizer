# Quizer frontend design system — F0 structure and interaction contract

Status: **planning specification only — no frontend or backend behavior changed**  
Date: 2026-11-08  
Planning branch: `plan/quizer-design-system-f0-20261108`  
Based on: `feature/ai-chat-hierarchy-20261108`  
Production: remains on `release/m1-vercel-20261108`; do not change production settings or `main` in F0.

## 0. Core product decision

Quizer is a mathematics teaching and quiz application, **not an AI chat product with quizzes bolted on**. The design must prioritize real user tasks, not gradients, color changes, redundant navigation, oversized welcome headings, decorative statistics, duplicated job inspectors, or persistent controls that rarely need attention.

Use Quizer's **existing** brand tokens: `assets/css/tokens.css` (original `--brand: #0281af`, original Inter system), including user-selected light/dark/system appearance. **No unsolicited palette, font, logo, or brand redesign.** The screenshots in the conversation document failed hierarchy and duplicated surfaces; they are not approval of the current layout.

### Non-negotiable UX rules

1. One global Quizer navigation system, controlled by `js/components/shell.js`; no second set of global links inside the page.
2. One primary action per view; secondary actions grouped logically. No duplicate controls such as two New Chat buttons, two Documents headings, multiple redundant search commands or a second homepage navigation grid.
3. Information order: **current work → next action → related content → details/advanced controls**.
4. Sidebars have a job: recent chats **in Chat only**; saved document jobs **only when requested** or when viewing a job. Never show both automatically.
5. All actions must have immediate UI feedback, safe errors, keyboard focus, loading/empty states, and predictable mobile behavior.
6. Prevent duplicate paid requests; do not claim streaming, percentage, ETA or completion unless real backend data proves it.
7. On failure, preserve typed text, original mathematical source, uploaded-source context and the current workflow position.
8. Editing, approval and publishing belong to the **existing Quizer editor**, not a new AI Studio review application.

## 1. Shared visual system

### Existing tokens to retain

- Brand, text, surface, status, border, shadows and all dark theme overrides remain sourced from `assets/css/tokens.css`.
- Retain Quizer's existing font stack. No external font dependency or second theme engine.
- Apply shared spacing scale (`4,8,12,16,24,32` CSS px), consistent surfaces, and responsive grid patterns **without changing brand identity**.
- Layout constraints: reading width ~760–860px for long mathematical messages; dense work tables may use up to ~1280px; interactive fields have descriptive labels and minimum 44px touch areas where practical.
- At phone widths, the shared bottom navigation replaces the desktop menu; it must not overlap the chat composer, timer, source preview or dialog.
- Keep existing MathJax and raw LaTeX fallback for malformed expressions. No additional syntax parser during visual redesign.
- Visible focus and contrast must be checked in both themes; honor `prefers-reduced-motion` in animations and state transitions.

### Component ownership

| Component | Owned by | Use and duplication rule |
|---|---|---|
| Global header, account, theme, primary navigation | `js/components/shell.js` | Mounted once on each page; AI Studio reuses it |
| Page header | Shared UI helpers | Exactly one meaningful page title; avoid banners and repeated breadcrumbs |
| Primary and secondary buttons, controls, panels, notices | Shared `js/components/ui.js` plus consolidated CSS | Standard states, error text and keyboard behavior |
| Data load/error/empty state | Each page controller using shared patterns | Loading must not block unrelated layout; show retry for failed data |
| Conversation list and composer | AI Studio Chat view | Only one New Chat and one active composer |
| Job list, progress, figures | AI Studio Documents view | A persistent parent job; no mandatory third column |
| Quizer question/quiz review | Existing quiz importer/editor | AI Studio cannot define a second final approval mechanism |

## 2. Navigation / screen hierarchy

**Global shell** (desktop header, mobile bottom bar): Home, Quizzes, My Activity, Teaching/Problem Bank (teacher), AI Studio (teacher/admin), Profile, Admin (authorized). The exact visible subset is capability-controlled, not cosmetic. Global nav is not repeated in home content. Shared Quizer session and theme apply to all routes.

### Homepage

Order: short contextual title → *Continue* active attempt (if present) or Create Quiz (teacher) / Browse Quizzes (guest) → two or three relevant quiz cards → items requiring attention → recent activity. No navigation shortcut grid, decorative metric row or repeated brand hero. Role-specific modules should disappear when empty; don't show placeholder statistics for their own sake. Continue remains the most prominent task when applicable.

### AI Studio → Chat

```
[Shared Quizer header + user account]
[Chat] [Documents]                                 [Preferences]
[Recent chats]    [Optional conversation title / actions]
[New chat]        [Conversation messages and picture attachments]
[Search]          [Animated pending reply only while waiting]
[Threads]         [One compact textarea + image + math snip + send]
```

- Only Chat has the conversation sidebar; mobile exposes it as a drawer.
- One New Chat, readable titles, compact valid dates, pinned chats on demand; no repeated list of navigation tabs.
- Mathematical text is safe-rendered with copy and raw-source fallback. Keep Enter to send, Shift+Enter newline, draft cleared immediately, failure restores input; prevent duplicate submission.
- Animated three-dot **Generating reply…** row is a pending-state indication, not fabricated reasoning or token streaming.
- **Picture chat:** attach a PNG/JPEG to the current thread, display the image in the message and saved history, ask or follow up naturally using that thread's prior context. It must send as a multimodal chat attachment through the authorized server path. It must **not silently submit a document extraction job** or redirect to Documents. The browser must not see provider credentials. Network/API support for multimodal chat is an explicit implementation gap to address with a **small authorized server contract**, not a CSS-only claim.
- Math-aware screenshot/snipping remains a compose action, not an automatic send. Copy, accessibility, safe LaTeX fallback and privacy remain mandatory.

### AI Studio → Documents

```
[Shared Quizer header]
[Chat] [Documents]                                 [Preferences]
[Documents library]                                [+ New extraction]
[Folders / saved documents / search and sort]
[Open document → its persistent job, pages, figures and result]
[Click New extraction → source upload + options → Start]
[When complete: OPEN IN QUIZER EDITOR]
```

- **Default Documents screen is the document library, not an extraction form.** It lists saved documents in user-managed folders (initially **All documents** and **Unfiled**), with search, filter, status and newest-first ordering. Opening a document shows its durable job, pages, figures and result. The existing source upload/extraction form stays **closed and unmounted until the user clicks + New extraction**, then opens in a separate focused route/view. Do not automatically open a new extraction on arrival, after finishing a job, or when returning to Documents.
- **Folder model:** folder ID, owning teacher, name, optional parent folder and ordering metadata; a document references a folder ID without changing its source job ID. Moving/renaming a folder does not rerun Mimo. No fabricated folders, folder counts or client-only persistence presented as durable: implement with server-enforced ownership and Neon records in the later F4 milestone after the storage contract is verified. Provide Unfiled for existing jobs and safe migration/compatibility.
- User explicitly chooses a destination (private quiz / Problem Bank), source and limits only inside the New extraction view. Returning to the library or a saved job never automatically triggers submission.
- File range, page budget, total cap, retry controls and low-level model logs are inside Advanced or the relevant job detail. Summary of limits still visible before costly submission.
- Exactly **one durable parent job** per uploaded document. Child page tasks and per-figure tasks belong to that job; do not create unrelated jobs for every page/retry.
- Processing happens in the background. Show real statuses: queued, running, awaiting attention, completed, failed, outcome unknown. Job survives tab closing and can be resumed.
- Target: up to 100 pages with initially 3 active page tasks, subject to **backend capacity and cost-admission verification**; this is not a claim that the current deployed backend honors all target limits.
- Preserve surrounding page words when reconstructing drawings. Figures have identifiers, TikZ source/compiled PNG, associated question, and targeted figure retry; display completed PNG as a first-class asset.
- Page/item diagnostics can be inspected and corrected, but **do not require per-question teacher approval to proceed**.
- Use targeted retry from the failed checkpoint; don't repay for already verified extraction or regenerate the entire document for one bad diagram.
- A document can offer intermediate source/text/figure previews; these are progress diagnostics, not another question editor.

### Documents output → existing Quizer editor (combined requirements 5 + 7)

```
One document job
   ↓ extraction / question order / optional answer key / figures / verification
One canonical Quizer-compatible LaTeX source + bounded asset manifest
   ↓ 'Open in Quizer editor'
Existing Quizer importer: parse → preview → correct → save private draft → publish
```

**The editor owns final review and approval.** AI Studio only creates the prepared artifact, warns of uncertainty, and offers targeted AI revision if explicitly requested. There is no separate approve-every-question screen, no mandatory JSON figure-binding form, and no second final question editor.

Required handoff contract (proposed; must be reconciled with existing importer **before implementation**):
- `sourceJobId`, output revision and content fingerprint for idempotency.
- `title`, `target` and the complete ordered Quizer-compatible LaTeX source (questions/options/answer keys where verified).
- Figure manifest: stable figure ID, associated question number, filename and an accessible private image asset; all referenced image filenames must resolve when the existing parser runs. Warn if an image is missing rather than silently dropping it.
- Explicit uncertainty markers/warnings, not invented answers.
- Revision lineage and retry provenance accessible from Documents, not inserted as an intrusive approval stage.
- Existing editor can accept `sessionStorage['mathquiz.aiImport']` with `{source,title}`, but **that alone does not carry picture bytes**. We must define the private asset handoff or existing editor upload/import path for figures and test it end to end.
- Current `js/services/ai-reviewed-import.js` creates a private import job via `createImportJob`; this is **not yet** the agreed editor-first handoff. The implementation must avoid double-importing or bypassing current teacher permissions and save validation.
- Private Draft comes before publishing. Approval is the editor's save/publish workflow, not an additional AI Studio gate.

### Other Quizer pages

- Quiz taking: problem first, visible desktop timer and answer choices, mobile controls that don't obstruct text; no per-question network fetch if a safe batch already exists, subject to measured backend behavior.
- Teacher Problem Bank: selection editor and preview in available upper-right desktop space; manageable one-column question cards; search/filter actions are secondary, not a parallel navigation.
- Quiz Editor: existing math parser, preview, import/recovery and save logic remain the source of truth.
- Results and Activity: outcome and next action first; explanations, exports and detailed logs subordinate.
- Admin: on-demand fetch after opening a specific panel; don't load every administrative dataset on every page entry.

## 3. One Firebase login, not a second AI authentication experience

Quizer already has `initFirebase()`, `getSession()` and `watchSession()` in `js/firebase-client.js`. AI Studio must listen to **that same shared authentication state**, with a single login route for unauthenticated users. No independent sign-in popup, duplicate role lookup just to paint the AI Studio layout, or second app authentication provider.

This does **not** mean removing security checks: sensitive Firebase callables must independently verify identity, account status and teacher/admin role. Show a loading state only while the shared Firebase session is resolving, then render the workspace. Avoid redundant round trips and repeated prompts.

## 4. State design rules

Each major task uses a consistent state table:

| State | Visible content | Safe user action |
|---|---|---|
| Empty | One short explanation or nothing; one main action | Start chat, choose quiz, upload file |
| Loading | Inline skeleton / subdued progress, never an invented percentage | Usually none; preserve other UI |
| Active | Existing content plus current step | Continue work |
| Success | Next action prominently (e.g. Open in Quizer editor) | Review, edit, publish normally |
| Failed | Human-readable reason; retain input and completed artifacts | Retry only safe/failed checkpoint |
| Outcome unknown | Explain uncertain execution/charge | Reconcile existing run ID first; no automatic repost |
| Restricted | Quizer shared sign-in/role message | Existing login; never new AI login |

Important: don't render 'Time unavailable' on every history row or re-show a splash screen after every message.

## 5. Responsive page templates

Desktop (1280px+): one global header; chat list ~230–250px when Chat; central content; optional inspector *only while explicitly open*. Documents uses full content width by default.

Tablet (761–1279px): same content order, collapse nonessential rails into drawers; maintain the Quizer desktop/tablet global shell behavior.

Phone (<=760px): shared mobile nav, compact Chat/Documents switch, one column, recent chats and jobs as drawers. Composer and quiz timer must be visible above bottom nav/safe area. Buttons >=44px targets where feasible. No simultaneous left/right drawers.

Screen acceptance captures: 1440×900 desktop, 768×1024 tablet, 390×844 phone; test both light/dark, keyboard, and reduced motion.

## 6. Execution milestones — only one approved slice at a time

**F0 — This document:** freeze IA/component ownership and acceptance gates. No code changes, no production.

**F1 — Shared shell + home structure:** remove any remaining duplicate navigation and cleanup CSS cascade; retain original colors; test Home/Teacher/Student mobile and desktop. No AI backend.

**F2 — Shared session and AI Chat layout:** remove redundant access screen/auth fetch, preserve callable enforcement, finish compact chat UI and pending animation. No image backend yet.

**F3 — Picture Chat (distinct from Documents):** verify supported server-side multimodal call contract; implement private image upload/reference/history/reply path, preserving same thread. Targeted tests ensure it does **not** trigger extraction.

**F4 — Documents UI + folder library:** default view is **saved documents organized into folders**, not upload. On explicit **New extraction**, show the upload/options form. Open existing jobs in-place with diagnostic page/figure viewer and safe retry. Design/verify Neon owner-scoped folders and folder assignment before enabling persistence, preserving existing unfiled Mimo jobs and never rewriting provider job IDs. If the backend lacks an essential state/contract, document that dependency before making a separately scoped backend change.

**F5 — Quizer editor handoff:** complete ordered LaTeX + figure assets → existing importer and editor. Make editor the **sole final review/approval** point; tests for missing images, ordering, idempotency and private draft. Do not migrate quiz core to Neon.

**F6 — Other Quizer routes:** quiz-taking, problem bank, teacher, results, profile/admin hierarchy; measure actual call counts and latency before optimizing the data layer.

**F7 — QA and release:** run Node 22 focused tests/static build and browser QA with signed-in teacher/student on desktop/mobile, visual screenshot comparisons, accessibility and end-to-end document + figure import. Deploy preview branch with Vercel Git integration; promote production only after explicitly approved.

Every milestone: `specific files → targeted tests → full relevant static/CI verification → checkpoint → stop`. No GitHub Actions usage, no protected `main` modifications, no unapproved production, no paid Mimo calls for UI smoke.

## 7. Acceptance criteria: definition of 'good frontend'

- One global nav; zero duplicated home nav grids, duplicated title bars or permanently visible unused inspectors.
- User can reach chat, new chat, pictures, the document **folder library**, previous jobs and editor import with one clear route; current mode always obvious.
- **Documents opens in the library, never the upload form.** Only the explicit New extraction action opens the extraction workflow. Organizing a saved document into a folder never starts AI work.
- UI hierarchy remains readable without changing colors.
- Existing teacher/student login works on every page without a separate AI sign-in.
- Chat image **does not** create a document extraction job.
- PDF extraction results open directly in Quizer's existing editor with working image assets, answer keys when verified, and no approve-every-question gate.
- A failed TikZ figure can be retried alone without rerunning the document.
- No new calls/slowdowns introduced by navigation or decoration.
- Signed-in, no-auth, permission-denied, error, pending and mobile tests all pass before production.
- Screenshots at acceptance sizes are manually reviewed; source regex tests alone **cannot establish layout quality**.

## 8. Verified repository facts vs target behavior

Repository files examined (not inferred from README/comments):
- `js/components/shell.js`: shared global navigation, `watchSession`, role-filtered AI/Teaching links.
- `js/firebase-client.js`: shared browser-local Firebase authentication and session listeners.
- `js/pages/ai-studio.js`: live chat, image attachments currently routed to `submitMimoExtraction(...target:"chat")`, document batch, review and import controls.
- `js/services/mimo-chat.js`: chat callable already accepts `imageJobId` and `imageAssetId` fields, but the current UI's picture path still creates extraction first; native picture chat is not proven.
- `js/services/mimo-extraction.js`: existing batch calls and page/job read/reconcile.
- `js/pages/quiz-editor.js`: existing importer consumes `sessionStorage['mathquiz.aiImport']` with `source,title`; parser warns about missing image assets.
- `js/services/ai-reviewed-import.js`: currently creates a private `createImportJob` with its own recovery; must be reconciled with editor-first handoff.
- `assets/css/tokens.css`: original brand and font retained.

**F0 stopping point:** approve the structural contract in this document, then implement **F1 only**. No UI code was authored as part of this planning milestone.
