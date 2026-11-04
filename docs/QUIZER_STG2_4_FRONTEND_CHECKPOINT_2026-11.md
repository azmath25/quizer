# Quizer STG2.4 — offline staging frontend build and mobile regression

Date: 2026-11-04 (Asia/Baku)
Branch: `work/quizer-audit-optimization-2026-11`
Status: **offline build verification implemented; no hosting deployment**.

## Work completed

- Reused the existing `npm run build:staging` to construct a **separate public Firebase staging client bundle** without changing `js/firebase-config.js` for production.
- Added `scripts/staging/stg2-frontend-audit.mjs` to inspect the entire generated `dist/` frontend, rather than trusting only one Firebase config file. It requires the exact Quizer staging project and app ID, scans static HTML/JS/CSS/JSON/SVG/text for references to the existing production Quizer project or Mimo, refuses server credentials and checks that the student quiz's Flag button still has its constant visible caption, `aria-pressed` behavior and stable minimum width.
- Integrated this audit into the existing offline staging-build unit test so the build and scan run sequentially in the same test, avoiding concurrent deletion of the shared `dist/` directory.
- Added synthetic negative unit tests for wrong Firebase/Mimo IDs, missing page files, leaked private key marker, flag-size/caption regression and wrong app ID.
- Existing QN12 mobile Chromium QA still tests 320/390/430/768/1024 CSS pixels, enlarged text, timer, sticky navigation, flag/star geometry, student controls and responsive author/editor views.

## Scope and limitations

This is a static bundle/test-environment checkpoint, not a hosted release. The new hybrid backend remains unmounted. The staging Firebase project currently has deny-all Firestore client rules; the stage backend/secret/SQL login/Storage setup is not ready. The audit result **always reports `readyToDeploy:false`**, `cloudBackendVerified:false`, `physicalDeviceVerified:false`; it never calls Firebase or Neon.

No GitHub protected branch edits, production Quizer data changes, Mimo resources, AI/snipping branch edits, merges or deployments were performed. Historical user records are not required for synthetic staging frontend testing. Do not interpret this as authorization to delete existing production records.

## Next milestone

STG2.5 may independently exercise synthetic teacher/student workflows and failure cases through the staging integration/emulators. A real deployed end-to-end test is still blocked by STG2.2/2.3 infrastructure.
