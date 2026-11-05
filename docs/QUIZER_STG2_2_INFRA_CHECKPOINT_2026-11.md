# Quizer STG2.2 — staging infrastructure readiness, no provisioning

Date: 2026-11-04 (Asia/Baku)
Branch: work/quizer-audit-optimization-2026-11
Status: **READ-ONLY PREPARATION COMPLETE; LIVE INFRASTRUCTURE BLOCKED**.

This milestone is strictly limited to the isolated Quizer staging project `quizer-staging-az26` (number `509423933910`) and existing Quizer Neon disposable child `br-sweet-rice-b9ehdv9i` in project `soft-grass-35754518`. Never use the default Neon branch, Mimo, `sat-quiz-fd317`, GitHub main/main-backup, or any existing production resources.

## Live observations

A read-only Neon role inventory reconfirmed that `quizer_owner` has password login while `quizer_app_limited` and `quizer_reader_limited` are NOLOGIN. The required least-privilege runtime LOGIN `quizer_app` is **absent**. The Neon child remains non-default with the expected parent. No SQL was executed.

No authenticated Google Cloud service or billing connector is installed in this conversation. A Firebase connector exists in the Plugin Directory but is not connected, and has been suggested recently. We cannot inspect or modify live Google Cloud/Firebase IAM, Functions, Secret Manager or budget resources here. **No provisioning claim is made.** Billing was last user-verified disabled; $1/month remains a soft spending target rather than an enforceable project-wide hard cap.

## One-file read-only infrastructure audit

`scripts/staging/stg2-infra-readonly-audit.py` can be run by an authorized operator **in a connected Cloud Shell** with Python 3 and gcloud. It makes one scoped read-only inventory of project identity, billing state, service accounts, deployed Functions and Run services, secret names (NOT values), Firestore region and summarized project IAM principal classes. It disallows interactive API enables, unsets the prior Google quota-project override, never changes gcloud's active project, and never accesses secret versions. Unexpected permissions/API errors remain **UNVERIFIED** rather than being treated as absence of resources.

Example one command, if the script is present in the checked-out work branch:

```sh
python3 scripts/staging/stg2-infra-readonly-audit.py
```

The script always exits with code 2 and `authorizesDeployment:false` by design. It produces a sanitized JSON report and does NOT create/enable IAM roles, service identities, secrets, Functions, Cloud Storage, budgets, billing or deployed routes. Do not treat its output as self-attesting proof of effective/inherited IAM or stage budget; those require independent live review.

## Blockers and next stage

- Dedicated Quizer staging Functions v2 service account is not verified or bound to an actual staging runtime.
- A stage-only Secret Manager resource and secret-scoped accessor are unverified.
- `quizer_app` restricted SQL LOGIN/password has not been created, delivered or independently attested. Never use `quizer_owner` as runtime.
- Storage and Functions require separately approved billable setup; stage billing, budget alerts and quotas are unverified. Do not enable Blaze or link a billing account without explicit cost authorization.
- Firestore's stage client rules remain deny-all; no stage-only role-aware runtime test has passed.
- No deployed source, Hosting or full Firebase–Neon–Storage cross-store test has occurred.

**STG2.2 provisioning is BLOCKED. STG2.3 live backend deployment must not start** without these prerequisites. Only downstream offline preparation and emulator tests may continue, with separate CI checkpoints. No changes were made to cloud projects, branch roles/schema, production data, protected branches or AI features.
