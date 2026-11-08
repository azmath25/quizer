# Release checkpoint — M1 Quizer frontend on Vercel

Date: 2026-11-08  
Target branch: `release/m1-vercel-20261108`  
Base: verified `feature/ai-studio-m1-native-layout-20261108` (28/28 tests passed by user in Google Cloud Shell).  
Current deployment status: **Not deployed through ChatGPT.** Controlled CLI path prepared.  

## Why Vercel

Quizer currently serves its public frontend at `https://azmath25.github.io/quizer/`. The repository's `.github/workflows/quizer-github-pages.yml` uses Actions for site publication. The user explicitly prohibits GitHub Actions. A Vercel **CLI-only deployment** enables a separate public static site with zero GitHub Actions and without modifying the Firebase or Mimo backend.

No claim of preserving the exact GitHub Pages URL is made. GitHub Pages stays unchanged. The Vercel URL is a **new hostname**. The local/static app uses relative page links and normal HTML files, so the full website—not just `ai.html`—is deployed as an isolated static bundle.

## Changes

- `vercel.json`: static build `npm run build`, output `dist/`, preserve `.html` URLs instead of automatic cleanUrls redirects, avoid stale AI entrypoint caching.
- `.vercelignore`: excludes backend functions, Firebase rules, private config candidates, tests, docs, CI and repo metadata from Vercel source upload. The public bundle is already limited by `scripts/build.mjs`.
- `.gitignore`: ignores `.vercel/` local project/scope link.
- `scripts/mimo/m1-release-vercel-cloudshell.sh`: complete guarded release flow; `--plan` runs all M1 tests, static asset and Firebase public client checks; `--apply` also logs into Vercel CLI, creates a **new isolated project** named `quizer-ai-studio-m1-azmath25`, links it and runs `vercel deploy --prod --yes`. Refuses wrong Git commit, dirty checkout, other repo, existing local Vercel project, already existing target Vercel project, missing assets and unsuccessful build. Verifies deployed `ai.html` and T1 assets via HTTP. No GitHub Actions, main merge, Firebase function deployment or paid Mimo run.
- No source changes to production backend, Mimo workflow, frontend services, authenticated history, Quizer importer or existing Pages branch.

## Execute in Google Cloud Shell

```bash
cd ~/quizer-queue-release
export PATH="$HOME/.local/node-v22.23.4/bin:$PATH"
git fetch origin release/m1-vercel-20261108
git switch --detach origin/release/m1-vercel-20261108
bash scripts/mimo/m1-release-vercel-cloudshell.sh --apply
```

This command may ask for one Vercel login in the browser. ChatGPT plugin account authorization and Vercel CLI authorization are separate. Never paste Vercel tokens into a chat. The CLI prints the live deployment URL. The old GitHub Pages domain and Firebase function backends are not changed. The release script refuses to overwrite an existing Vercel project by design.

## Remaining authentication and browser gate

1. Open Vercel project **Settings → Domains** and obtain the exact stable production Vercel hostname.
2. In Firebase Console, project `sat-quiz-fd317`, **Authentication → Settings → Authorized domains**, add that hostname (without `https://` or path). This allows Google Firebase web sign-in from the new origin. This step does not change the `authDomain` inside Quizer's public Firebase configuration, which stays `sat-quiz-fd317.firebaseapp.com`. Google OAuth login may fail with `auth/unauthorized-domain` until the new domain is authorized.
3. In desktop and responsive Chrome, sign in as a teacher and verify chat history, assistant send, mathematical source display, PDF job list/page details, T1 existing PNG preview/download. No paid extraction rerun.
4. Only after these succeed, consider the new Vercel origin fully functional. The deployment's static route success by itself does **not** prove authenticated AI functionality.
5. If the project already exists or a previous attempt partially created it, the script stops rather than overwriting. Reconcile/link the existing Vercel project deliberately in a new release step; do not bypass guards blindly.

## Evidence labels

- `M1_STATIC_TESTS_PASS`: offline unit/static verification (user previously produced this with 28/28 tests on the M1 source).
- `M1_VERCEL_STATIC_PREFLIGHT_PASS`: release tree verified after build.
- `M1_VERCEL_PROD_DEPLOY_PASS`: Vercel production deployment was returned successfully.
- `M1_VERCEL_PUBLIC_ASSETS_PASS`: public `ai.html` and CSS/JS assets fetched from deployment URL.
- Authenticated chat and existing T1 job retrieval need manual browser confirmation on the new hostname.

**Stop boundary:** No direct replacement of `main` or original GitHub Pages site, no creation of a GitHub Actions workflow, no backend re-deploy and no quota-spending model calls.

## Clean-worktree static verifier fix (2026-11-08)

The first user-run attempt from a fresh `git worktree` passed **28/28 tests** but stopped before Vercel at `node scripts/verify-static.mjs` with `Shared mirror missing: mimo-extraction.js`. This was not an application-code or Vercel deployment error.

Verified directly from GitHub's actual release tree:
- `shared/` contains five canonical files.
- `functions/shared/` contains four tracked mirrors with *identical blob SHAs* to the canonical files.
- `functions/shared/mimo-extraction.js` is intentionally absent from the Git tree. It is generated by the existing `scripts/sync-functions-shared.mjs` preparatory script.
- `scripts/verify-static.mjs` requires full, byte-identical backend mirrors even for frontend-only validation.

Remediation on this release branch:
- `scripts/mimo/m1-verify-cloudshell.sh` now regenerates `functions/shared/` immediately before the static mirror check.
- `.gitignore` now ignores the generated `functions/shared/` directory. This allows the missing generated file to be present during the check without leaving an untracked-file dirty checkout. Git-tracked mirror files still remain under normal git tracking.
- No backend code, live Firebase function, provider workflow, test logic or asset content was changed.

**No Vercel deployment occurred during the failing attempt**. The release must be retried from the updated branch tip. Reuse the existing clean ephemeral worktree; do not reset or clean the original Quizer checkout.
