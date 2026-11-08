# F1 — shared navigation and homepage checkpoint

Date: 2026-11-08
Branch: `feature/quizer-f1-shell-home-20261108`
Reviewed commit: `abca60eab2906e71dc65df36854dba2eb6bd1ff9`
Status: **Implementation complete; full verification pending — DO NOT MERGE OR PROMOTE**

## Implemented on branch
- A single shared role-aware shell with compact tablet destinations under **More** and mobile teacher/account actions in the bottom-navigation **More** menu.
- Homepage orders active attempts before quiz content, removes a duplicate quick-links navigation grid, and hides the empty results/marking rail.
- Original Quizer brand tokens retained. No AI/extraction backend changed as part of F1.
- Nine focused behavior tests added in `tests/unit/f1-shell-home.test.mjs` and included in `scripts/front/verify-atlas-v2.sh`.

## Independently verified repository/deployment evidence
- F1 differs from F0 planning branch by 9 commits and 6 files: `assets/css/atlas-v2.css`, `index.html`, `js/components/shell.js`, `js/pages/home.js`, the verifier script and the new test.
- Vercel preview deployment `dpl_5wdFaAyoCAB3zpx8rkL4oPkUNNGn` is READY, built from commit `abca60e`, `target=null` (preview, not production).
- Vercel build log ran `npm run build` / `node scripts/build.mjs` and produced the static `dist/` output. The log **does not show any test-suite execution**.
- Vercel used Node 26.13.0 because `package.json` declares `node >=22`; the log warns that `superstatic@10` supports only Node 20/22/24. The project's one-step verifier explicitly requires Node 22.
- Commit status shows a successful Vercel check. No GitHub Actions workflow runs were returned for this commit.

## Unverified acceptance gates (required before F1 closure)
1. Run `bash scripts/front/verify-atlas-v2.sh` on Node 22 from the branch checkout; preserve complete test/build result and address any regressions.
2. Check responsive visuals at 1440x900, 768x1024 and 390x844, both light and dark.
3. Exercise real browser interaction, keyboard focus and overflow of desktop/tablet/mobile More menus.
4. Check signed-in guest/student/teacher/admin navigation and correct resume/marking links, including error/empty/loading states.

The verifier could not be executed in the current assistant runtime: the checkout is not present and this runtime cannot resolve github.com to clone it. A public browser-based visual review was also not available. **Do not mark the nine tests as independently passing on the strength of code inspection or a Vercel build.**

## Scope and next boundary
- No changes to main, production Vercel, Firebase, Mimo, Neon, extraction or F2-F7.
- F2 can begin only at the next authorized milestone after the remaining F1 gates are satisfied.
- F4 Documents remains **folder-first**: existing library opens by default; New extraction only by explicit click; folder moves must not rerun jobs.

## Additional independent connector-side verification — 2026-11-08
- Retrieved **actual GitHub branch source** for `js/pages/home.js`, `js/components/shell.js`, F0 spec, `atlas-v2.css`, brand tokens and entry HTML.
- Executed the home rendering and shell navigation functions from that source in an isolated JavaScript runtime with mocked API and DOM, reproducing all **9 focused F1 behavior cases**; result: **9 passed / 0 failed**.
- Verified: one guest primary action, active teacher resume precedence, conditional marking panel, student results, original brand/navigation structure, F4 remains planning-only, guest routes, tablet Activity access, teacher/admin route uniqueness.
- The source execution is meaningful functional verification **but is not** a Node 22 `node --test` invocation and cannot verify CSS layout, visual appearance, real Firebase auth, or network operations.
- Actual Vercel build logs confirm `npm run build`, **not** unit tests; preview remains READY.
- A direct web preview fetch was unavailable, so browser screenshots and real interaction remain **unverified**. Do not close the milestone yet.
