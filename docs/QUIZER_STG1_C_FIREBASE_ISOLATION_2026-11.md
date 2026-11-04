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

## Verified CI checkpoint

**PASS:** [GitHub Actions run 41742378046](https://github.com/azmath25/quizer/actions/runs/41742378046) on exact staging source commit `215273a2ad51f82dec3078041378d77426997640` — all 3/3 jobs successful. Includes **367/367 unit tests**, **5/5 backend tests**, Firebase emulator integration/transport, and Chromium mobile runner / author checks. Offline staging-build identity test passed and original production source remained unchanged.

These were local/CI tests against emulator and repo files, **not live Firebase, Storage, Firestore, Google Auth or deployment verification**. Further external STG1 gates remain pending.


## Cloud Firestore creation checkpoint (user-verified 2026-11-04)

The user executed the following with **explicit** `--project=quizer-staging-az26`:

1. `gcloud firestore databases list` prompted to enable `firestore.googleapis.com` in the new staging project; the enable operation succeeded.
2. Repeated listing returned no databases.
3. `gcloud firestore databases create --database="(default)" --location=europe-west3 --edition=standard --type=firestore-native --project=quizer-staging-az26` completed successfully.
4. `gcloud firestore databases describe --project=quizer-staging-az26 --database="(default)"` confirmed `FIRESTORE_NATIVE`, region `europe-west3`, correct resource name.

Creation response additionally reports `databaseEdition: STANDARD`, `freeTier: true`, `deleteProtectionState: DELETE_PROTECTION_DISABLED`, `pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_DISABLED`. These are recorded as development-only properties, not as a secure production configuration.

**Result: STG1-C Firestore database provisioned, but Security Rules are NOT yet verified/deployed.** Next: publish explicit staging-only deny-by-default bootstrap rules, verify release, then configure Firebase Google sign-in through staging Authentication Console. Database creation does not imply any application deployment. Do not grant broad test-mode access.

## Firestore deny-all bootstrap rules deployed — verified from Cloud Shell output

User executed on the **new** `quizer-staging-az26` project:

```sh
mkdir -p ~/quizer-stg1c-rules
# Local firebase.json declares only firestore.rules
# Local firestore.rules allows read, write: if false on all documents
(cd ~/quizer-stg1c-rules &&
 env -u GOOGLE_CLOUD_QUOTA_PROJECT firebase deploy \
 --only firestore:rules --project quizer-staging-az26 --non-interactive)
```

Cloud Shell reported `firestore.rules compiled successfully`, `released rules firestore.rules to cloud.firestore`, and `Deploy complete!`.

**Checkpoint: PASS for deployment of deny-all client SDK rules**. This blocks client Firestore reads and writes, including signed-in clients; server Admin SDK/IAM calls bypass rules. This is intentionally a temporary locked state, **not Quizer's final role-aware `firebase/firestore.rules`**, which will need a separate tested staging-only release before runtime testing. This procedure did not deploy a frontend, Function, storage rule, indexes or auth provider and did not mutate Mimo or production.

**Next gate:** configure Google as a sign-in method **only** in Firebase Console for `quizer-staging-az26`; verify project ID, project support email and authorized domains, save, then independently check. Do not enable Email/Password or anonymous providers unless separately required. No real sign-in verification can pass before runtime endpoints and suitable stage-only authorization are ready.

## Google Authentication (user-confirmed; independent API check pending)

On 2026-11-04 the user reported completing the Firebase Console step to enable Google sign-in in `quizer-staging-az26`.

**Status:** reported enabled, not independently API-verified yet. No Auth user/session/redirect-domain test has been performed. Do **not** state full STG1-C success until stage-only provider status and authorized domains are inspected. Project Mimo stays unmodified. The next safe validation is the read-only Identity Toolkit API `projects.defaultSupportedIdpConfigs.get`, printing **only** the `enabled` and `name` fields (never OAuth `clientSecret`).

## Independent Google Auth provider verification — PASS

The user ran a read-only Identity Toolkit Admin v2 `GET` with the explicit header `X-Goog-User-Project: quizer-staging-az26` and a response field mask `fields=name,enabled`. Cloud Shell output:

```text
Provider: projects/509423933910/defaultSupportedIdpConfigs/google.com
Google sign-in enabled: True
```

This independently verifies Google as an **enabled provider** for the new Firebase staging project (`509423933910`). The earlier HTTP 403 without the explicit quota-project header was resolved. No OAuth client secrets were printed and neither Mimo nor production was changed.

**Authentication provider gate: PASS.** Authorized redirect domains and actual user login are still **UNVERIFIED**. Firestore remains intentionally deny-all. Next step: inspect only `authorizedDomains` via `GET https://identitytoolkit.googleapis.com/admin/v2/projects/quizer-staging-az26/config?fields=authorizedDomains` with the same explicit quota-project header. This command must not expose any client or provider secret. No user signup, rules relaxation, staging deployment or credential changes are yet authorized.

## Firebase Authentication authorized domains verified — PASS

The user queried the Identity Toolkit Admin v2 `projects.config.get` endpoint for `quizer-staging-az26` with an explicit `X-Goog-User-Project: quizer-staging-az26` quota-project header and the restricted `fields=authorizedDomains` field mask. It returned only:

- `localhost` — local development (review whether it is needed for release)
- `quizer-staging-az26.firebaseapp.com` — staging authentication domain
- `quizer-staging-az26.web.app` — staging hosting domain

**Result:** Authorized domains were independently verified as staging-only with no Mimo or existing Quizer production domains. No domains were added/removed; no sign-in was attempted. This is a configuration PASS, not evidence of an end-to-end login PASS.

**Remaining STG1-D gates:** billing remains previously reported disabled; inspect current status, service IAM and provider controls before any billable setup. Firestore deny-all bootstrap rule is still in force. No app/Functions/Storage deployment and no Neon runtime credential is provisioned.

## STG1-D preliminary billing and IAM role inventory (user-verified)

After an initial Cloud Shell gcloud session transiently had no active account, the user reran both **read-only** commands with restored authentication, explicitly targeting `quizer-staging-az26`:

- `gcloud billing projects describe quizer-staging-az26 --format="yaml(billingEnabled)"` -> **`billingEnabled: false`**.
- `gcloud projects get-iam-policy quizer-staging-az26 --format="table(bindings.role)"` returned these role bindings:
  `roles/firebase.managementServiceAgent`,
  `roles/firebase.sdkAdminServiceAgent`,
  `roles/firebaseauth.admin`,
  `roles/firebaserules.system`,
  `roles/firestore.serviceAgent`,
  `roles/iam.serviceAccountTokenCreator`,
  `roles/owner`.

**Billing project-level linkage: PASS (disabled).** This is not a spending-alert check or proof that future Blaze activation is safe. **IAM: PARTIAL/NEEDS REVIEW** because role names without members do not show public grants or which principal has `roles/owner` or `roles/iam.serviceAccountTokenCreator`. The next check must show per-role member counts, public-principal flags, and principal type breakdown only, without exposing account emails. Avoid changes to Mimo, current production, IAM and billing.

## STG1-D project-level IAM member-class audit — PASS (2026-11-04)

The user ran a read-only, explicitly scoped `gcloud projects get-iam-policy quizer-staging-az26 --format=json` and a Python summarizer which displayed per-binding member type/count, anonymous grants and conditions without user/service-account addresses.

| Role | Members | Class | Public? | Condition? |
| --- | ---: | --- | --- | --- |
| `roles/firebase.managementServiceAgent` | 1 | serviceAccount | false | false |
| `roles/firebase.sdkAdminServiceAgent` | 1 | serviceAccount | false | false |
| `roles/firebaseauth.admin` | 1 | serviceAccount | false | false |
| `roles/firebaserules.system` | 1 | serviceAccount | false | false |
| `roles/firestore.serviceAgent` | 1 | serviceAccount | false | false |
| `roles/iam.serviceAccountTokenCreator` | 1 | serviceAccount | false | false |
| `roles/owner` | 1 | user | false | false |

**Verified:** no project-wide `allUsers` or `allAuthenticatedUsers` binding, only one human owner, and service-only Firebase-related grants. The presence of an impersonation privilege needs exact service-identity/role-reason verification before runtime access is considered hardened. This does not inspect IAM of individual resources, inherited organization/folder permissions, or whether the underlying service identities have been modified. No IAM changes were made.

**Remaining:** budget alerts before any billing activation, disabled-billing constraints on Functions/Storage, dedicated Neon `quizer_app` SQL LOGIN with secure secrets, version-ledger persistence and runner, final staging-only deploy/recovery plan, real auth and end-to-end tests. STG2 is still NO GO.
