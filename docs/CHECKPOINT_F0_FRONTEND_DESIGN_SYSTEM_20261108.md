# F0 checkpoint — Quizer frontend design system

Date: 2026-11-08  
Branch: `plan/quizer-design-system-f0-20261108`  
Base: `feature/ai-chat-hierarchy-20261108`

## Result

Source-informed frontend architecture and design contract committed in:
- [QUIZER_FRONTEND_DESIGN_SYSTEM_F0_20261108.md](QUIZER_FRONTEND_DESIGN_SYSTEM_F0_20261108.md)

Decisions frozen for the implementation sequence:
1. Original Quizer colors, type and account/session; no visual rebranding.
2. One global navigation, one primary action and no duplicated site links.
3. Picture Chat stays in the conversation and does **not** create a document extraction job.
4. Documents is a separate background one-parent-job workflow.
5. Final PDF review, figure placement, question correction and quiz approval use **existing Quizer importer/editor only**, not a second approval UI.
6. Neon/Mimo/Firebase responsibilities and user data retained; no unapproved migration.
7. Small slice-by-slice implementation, previews/tests/visual acceptance before any production promotion.

## Relevant code verified

- Shared session `js/firebase-client.js`, shared navbar `js/components/shell.js`.
- Current image send invokes extraction from `js/pages/ai-studio.js`; an actual non-extraction multimodal chat path needs a scoped server contract.
- Existing importer `js/pages/quiz-editor.js` consumes `mathquiz.aiImport` with `{source,title}`. It does not alone transfer figure bytes.
- Existing `js/services/ai-reviewed-import.js` calls `createImportJob`. This is a different import path and must be reconciled with the editor-first target.
- Backend role authorization must remain even when removing redundant UI-level auth prompts.

## Evidence

F0 is a planning-only milestone and does not require a build or browser deployment. The GitHub branch diff should show only this planning document and checkpoint. No protected branch, backend, production Vercel config, Firebase project or Mimo workflow changed.

## Next authorized boundary

Implement **F1 shared shell + homepage structure only**, run focused and relevant full static checks, compare 1440px desktop and 390px mobile screenshots, produce an F1 checkpoint, and stop before F2–F7. Work from the planning branch on a dedicated feature branch. Do not alter colors, AI backend, job orchestration or protected branches.
