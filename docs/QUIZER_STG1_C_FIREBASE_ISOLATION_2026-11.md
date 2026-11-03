# Quizer STG1-C — Firebase project identity and offline staging build

Date: 2026-11-04 (Asia/Baku). 
GitHub work branch: `work/quizer-audit-optimization-2026-11`.
**Status: STAGING WEB APP + CONFIG VERIFIED; AUTH, FIRESTORE, STORAGE, FUNCTIONS, BILLING, CREDENTIALS AND DEPLOYMENT NOT YET READY.**

## User-verified resource facts

| Property | Verified value |
| --- | --- |
| New Firebase / Google Cloud project | `quizer-staging-az26` |
| Google Cloud project number | `509423933910` |
| Project status | `ACTIVE` |
| Firebase label | `firebase: enabled` |
| Billing | `billingEnabled: false` |
| Registered Firebase web app | `Quizer Staging Web` |
| Staging App ID | `1:509423933910:web:bce54427cd2e87af076c77` |
| Auth domain | `quizer-staging-az26.firebaseapp.com` |
| Storage **config string, not proof of provisioned bucket** | `quizer-staging-az26.firebasestorage.app` |
| Staging Firebase app count | Exactly 1, user-confirmed |
| Existing Quizer app | `sat-quiz-fd317`, do not change |
| Existing Mimo app | `mimo-backend-513412`, do not change |

The user obtained this from `firebase apps:sdkconfig WEB ... --project quizer-staging-az26`.
Firebase public web API key belongs ONLY in public frontend configuration; it is **not** a service-account password. API restrictions, Auth, security rules and App Check still enforce security.

The Firebase CLI's unscoped `projects:list` initially failed with 403 because Cloud Shell's `GOOGLE_CLOUD_QUOTA_PROJECT` was set to Mimo, which lacked the Firebase Management API. The per-command read-only workaround **`env -u GOOGLE_CLOUD_QUOTA_PROJECT firebase ... --project quizer-staging-az26`** succeeded. Never enable Firebase APIs on Mimo to avoid this.

## Offline-only implementation on work branch

- `config/firebase.staging.js`: verified public staging SDK configuration **outside the default copy-to-dist tree**.
- `scripts/build-staging.mjs`: explicit *offline* staging build, pins staging project/App ID/auth domain/storage bucket/sender/API key and checks resulting `dist/js/firebase-config.js`. Does not connect to cloud, create services, deploy, or modify source `js/firebase-config.js`.
- `package.json`: `npm run build:staging` is the explicit staging build; original `npm run build` remains unchanged.
- `tests/unit/stg1c-staging-bundle.test.mjs`: validates exact identity, production source unchanged, and generated staging output.
- `js/firebase-config.js` still points to the current `sat-quiz-fd317` app. **Never deploy the default build to staging**, and never use the staging bundle for the existing production project.

No `.firebaserc` or default project is set by this preparation. No remote writes occurred.

## Open environment gates and safe command sequence

**Read-only next probe in Cloud Shell** (explicit staging project, no `gcloud config set project`):

```sh
gcloud firestore databases list \
  --project=quizer-staging-az26 \
  --format="table(name,locationId,type)"
```

If no database exists, plan a **new Firestore Native-mode `(default)` database** in `europe-west3` (Frankfurt); this is co-located with the dedicated Quizer Neon region. **Confirm the database location in advance because it is immutable.** Do not execute creation until command, project and billing implications have been reviewed. Firebase CLI `apps:sdkconfig` showing `storageBucket` is **not evidence that Cloud Storage exists**.

Then inspect in Firebase Console:
- Authentication > Sign-in method > Google: enable **only** for staging, select legitimate support email; review authorized domains before login tests.
- Firestore Database: provision in a verified supported region, deploy secure checked-in `firebase/firestore.rules` and indexes **only in staging** under a separately authorized rollout.
- Cloud Storage for Firebase / Functions: currently **not ready**; review Blaze billing requirement and cost alerts before provisioning.
- API key restrictions and quota: verify allowed Firebase APIs / app-specific protections; do not use public Firebase key for a separate Google Cloud or Gemini API.
- Dedicated restricted `quizer_app` SQL LOGIN and secret store: **not ready**; do not use API-created privileged Neon login roles or store secrets in a JS file.
- End-to-end runtime and stage-only URL: **not ready**; no hosted app or actual Google sign-in has been tested.

## STG1 readiness

This milestone is **configuration-prepared only**, not a pass for a complete Firebase backend or STG2 deployment.
Keep STG2 **NO GO** until Auth, Firestore rules/indexes, Storage, Functions, restricted database login, budget/IAM/secret management, and rollback controls are verified separately. No production/Mimo/AI branch changes, merges or deployments.
