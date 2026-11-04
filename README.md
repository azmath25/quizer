# Math Quiz · version 2

A mobile-first math quiz website with a bright blue interface, Firebase accounts, a reusable problem bank, and teacher-managed quizzes. The frontend is plain HTML, CSS and JavaScript. GitHub Pages hosts the public frontend through the dedicated **Publish Quizer to GitHub Pages** workflow on the Quizer work branch. Firebase runs authentication, protected data, file uploads, grading and background jobs. There is no PHP.

## Start here

1. Follow [FIREBASE-SETUP.md](FIREBASE-SETUP.md) once to configure and deploy your Firebase backend.
2. Put the extracted project contents in your GitHub repository. `index.html` belongs at the repository root.
3. In GitHub **Settings → Pages**, set Source to **GitHub Actions**. The workflow `.github/workflows/quizer-github-pages.yml` builds and publishes only `dist/` from `work/quizer-audit-optimization-2026-11`. Do not enable Firebase Hosting for this deployment.
4. Sign in, bootstrap the first administrator, then manage teacher roles from **Admin**.

**Upgrading an existing Firebase installation?** Read [docs/MIGRATION.md](docs/MIGRATION.md) before replacing its rules. Version 1 data and rules are not interchangeable with version 2.

The public Firebase web configuration in `js/firebase-config.js` targets `sat-quiz-fd317`. It contains public Firebase SDK identifiers, not private credentials. This repository does not contain a Neon password, private signing key or service-account key. The new Neon-backed PROD1 backend remains unmounted until a separately approved real-cloud release.

## Prod 1 release status (November 2026)

The **existing Firebase-backed app** is the active API contract. Separate Quizer Neon schema and SQL role exist, and the work branch contains default-disabled modules for a reusable Neon problem bank, diff-only saves, private published bundles and cross-store recovery. They are **not wired into the deployed Firebase Functions**. A successful GitHub Pages run publishes only static files; it cannot activate Neon or update Cloud Functions. Real Firebase+Neon+Storage end-to-end testing, secret binding, history preservation and deployment authorization are still required. See [Prod 1 release gate](docs/QUIZER_PROD1_RELEASE_GATE_2026-11-04.md).

## What is included

- **Home:** your recent results, active attempt, quiz shortcuts and updates.
- **Quizzes:** public catalog, approved quizzes and clear access status.
- **Quiz runner:** multiple choice, short answers and written responses; MathJax; separate images; flags; answer autosave; server deadlines; resume and conflict handling.
- **Results:** correct, incorrect, skipped, partial, pending, points and percentage. Written work is teacher-marked. Score and solution release are independent.
- **Teaching:** your quizzes, access requests, results, manual marking and exports.
- **Quiz management:** edit drafts, publish immutable versions, public/private visibility, open/approval admission, application links, attempt allowances, time windows, Trash/restore, duplication and history.
- **Problem bank:** independent versioned problems, private/shared teacher visibility, attributed forks, preview, search and selection into new or existing quizzes.
- **Import:** LaTeX, legacy quiz JSON or a version 2 backup ZIP; validate and preview before importing. Images upload separately to Cloud Storage and JSON stores asset references.
- **Profile:** direct account access, verification, appearance, text size and sign-out.
- **Admin:** roles, disabled accounts, teacher/student activity, content, jobs and user history. The last active administrator cannot be removed.
- **LaTeX guide:** available to teachers and administrators.

All live quizzes and results come from Firebase. The app does not fall back to browser-only quizzes or a GitHub JSON catalog. An explicit migration option can import old quizzes found in the current browser. Old local copies are retained.

## Put the whole folder on GitHub

Use **GitHub Desktop**: **File → Add local repository** (or create a repository in this folder), commit the complete project, and **Publish repository**. You can also use Git:

```sh
git init
git add .
git commit -m "Math Quiz version 2"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

No file-by-file upload is needed. `.gitignore` excludes installed packages, local runtime files and credentials. Preserve `.nojekyll`. The public frontend is built by `.github/workflows/quizer-github-pages.yml`; unit/emulator/mobile CI runs in `.github/workflows/quizer-verify.yml`. The frontend workflow does not deploy Firebase Hosting, Cloud Functions, Neon, or Mimo.

## Local development

Use **Node.js 22** and **Java 21+** for Firebase emulators.

```sh
npm ci
npm --prefix functions ci
npm run emulators
```

In a second terminal, provide the emulator environment and create isolated test fixtures:

```sh
GCLOUD_PROJECT=demo-mathquiz-v2 \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
npm run seed
```

Set `appConfig.emulators.enabled` to `true` in `js/app-config.js`, then run `npm start` and open `http://localhost:4173`. Seeded accounts are `teacher@example.test`, `other-teacher@example.test`, `student@example.test`, and `admin@example.test`, with password `Testing123!`. They exist only in the demo emulator project. Disable emulators again before committing a production configuration.

Do not open HTML files with `file://`; ES modules require an HTTP server. The browser Firebase SDK loads from Google's CDN; MathJax and ZIP processing are bundled locally.

## Verification

```sh
npm test
npm run test:backend
npm run test:integration
npm run test:transport
npm run verify:static
npm run build
```

`test:integration` starts Auth, Firestore and Storage emulators and checks permissions, assets, immutable publication, admissions, attempts, grading, reports, concurrency and migration. `test:transport` checks real Auth tokens through the exported callable HTTP wrapper using the client SDK. `npm run build` creates the frontend-only `dist/` directory uploaded by the dedicated GitHub Pages workflow.

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for performed checks and remaining production checks. The original detailed plan is retained in [docs/COPILOT_IMPLEMENTATION_PLAN.md](docs/COPILOT_IMPLEMENTATION_PLAN.md).

## Project structure

| Location | Purpose |
| --- | --- |
| Root `.html` pages | Separate Home, catalog, profile, teaching, editing, runner, results, admin and guide routes |
| `assets/css/tokens.css` | Colors, spacing, radii, typography and theme tokens |
| `assets/css/base.css`, `layout.css`, `components.css` | Shared styling |
| `assets/css/pages/` | Page-specific CSS |
| `js/pages/` | Page controllers |
| `js/components/` | Reusable forms, rendering, dialogs, reports and navigation |
| `js/services/` | Backend API, assets, backup import and temporary answer recovery |
| `shared/` | Canonical validation, LaTeX parser and grading logic |
| `functions/src/` | Authoritative Firebase API, authorization, grading and job workers |
| `functions/shared/` | Deployable mirror; regenerated by `npm run prepare:backend` |
| `firebase/` | Firestore rules, indexes, Storage rules and CORS example |
| `scripts/` | Build, first-admin bootstrap, migration and emulator seed |
| `tests/` | Unit, backend integration, rules, transport, migration and browser QA tooling |

Edit CSS tokens for global design changes; use page styles for local changes. There is no single giant stylesheet. Appearance is an account preference, not a separate Firebase connection screen.

## Data model and limits

Quiz metadata and drafts are separate from immutable published snapshots. Attempts pin the published revision and server-controlled settings. Answer keys never travel to active student attempts. Independent problem revisions let teachers reuse and revise content without changing an ongoing test or old result. Images and source files are separate immutable Storage objects with protected references and short-lived authorized URLs.

Default limits: 500 problems per quiz; 4 MiB per image; 16 megapixels; 20 MiB source/backup input; 1 GiB teacher storage allowance; bounded API pages and edits. Automatic short-answer grading supports accepted text/numeric expressions and numerical tolerance, **not unrestricted symbolic algebra equivalence**. Use teacher marking for proofs and long reasoning.

The teacher-facing AI chat currently contains a demo interface (`AI_CONNECTED=false`); real PDF AI extraction, Ask AI and browser snipping remain separate PROD2 scope. Do not label demo output as live AI processing.
