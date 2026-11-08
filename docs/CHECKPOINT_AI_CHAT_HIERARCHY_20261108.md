# AI Studio chat hierarchy + pending indicator checkpoint

Date: 2026-11-08  
Branch: `feature/ai-chat-hierarchy-20261108`  
Based on: `feature/frontend-structure-only-20261108`  
Deployment: **Vercel preview only**. The existing production deployment and protected GitHub `main` are unchanged.

## User-visible changes

- Removed the duplicate Recent chats heading, expanded New conversation label, large "Start with a question" hero, sample prompts and "More ideas". Initial chat is deliberately quiet, with the single composer as the primary action.
- Removed redundant composer eyebrow, Commands shortcut inside the composer and shortcut hint strip. Kept Photo, MathJax-aware Snip, text input, Enter/Shift+Enter and Send behavior.
- Sidebar date labels display only valid compact dates; invalid and missing timestamps are omitted instead of showing "Time unavailable". Epoch seconds, milliseconds, ISO dates and legacy Firestore-style seconds are handled.
- Pin controls are hidden except when the row is hovered, keyboard-focused or pinned. On devices without hover they remain discoverable.
- Added an accessible, temporary animated three-dot assistant "Generating reply…" row to the chat message area, immediately after optimistic user submission. It disappears on success/error, is scoped to the chat view where the request began, and never becomes part of saved messages or API requests.
- The animation is CSS-only, uses Quizer's original brand tokens, and respects `prefers-reduced-motion: reduce`. No fabricated progress percentages, estimated times, or provider-native streaming claims.
- No source changes to Firebase callable code, Neon, Mimo backend, quiz data, app permissions, provider pricing, photo extraction or TikZ viewer.

## Verification

- Confirmed new HTML, JS and CSS return HTTP 200 from a Vercel READY preview.
- Ran an in-memory source-test evaluation of `tests/unit/ai-chat-hierarchy.test.mjs`: 4/4 passed (including reply lifecycle, animation CSS, composer structure, actual date function behavior).
- Ran the existing `ai-studio-m1-native` and `ai-studio-focus` source-test evaluations: 11/11 passed after replacing stale UI-layout assertions.
- `scripts/front/verify-atlas-v2.sh` now includes the chat hierarchy tests in the Node 22 verification suite, but a **complete Node or authenticated browser run has not been performed in this ChatGPT session**. Source assertions and HTTP responses do not prove browser interactions.
- Preview branch: `https://github.com/azmath25/quizer/tree/feature/ai-chat-hierarchy-20261108`.
- Preview URL (code before this docs commit): `https://quizer-ai-studio-m1-azmath25-ijh9omc2k-azmath25s-projects.vercel.app/ai.html`.

## Browser QA before any production promotion

1. Teacher account sends a simple message: draft clears immediately, optimistic user message and three dots appear, only one request is sent, correct reply replaces dots.
2. Failure path: dots disappear, safe error appears, original draft restores without automatic retry or a duplicate paid provider call.
3. Start a new thread/open old thread while one request is pending: no spinner from the original thread leaks into the newly opened conversation.
4. Verify focus-visible, pin-button keyboard behavior, mobile composer safe-area and reduced-motion settings.
5. Confirm historical chat, PDF jobs, stored messages, T1 image download and surrounding Quizer navigation remain functional.

Production remains on `release/m1-vercel-20261108`. No release or promotion authorized in this milestone.
