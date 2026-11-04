#!/usr/bin/env python3
"""STG2.2: READ-ONLY one-command Cloud Shell inventory of *staging only*.
Never enables APIs, deploys Functions, creates secrets, reads secret versions,
changes IAM/billing/quotas, or prints credentials / identity emails.
No external Python dependencies.
"""
import json
import os
import shutil
import subprocess
import sys

PROJECT = "quizer-staging-az26"
PROJECT_NUMBER = "509423933910"
ACCOUNT = "quizer-stg-runtime@" + PROJECT + ".iam.gserviceaccount.com"
SECRET = "quizer-staging-neon-url"
REGION = "europe-west1"

COMMANDS = {
    "project": ("projects", "describe", PROJECT),
    "billing": ("billing", "projects", "describe", PROJECT),
    "service_accounts": ("iam", "service-accounts", "list", "--project=" + PROJECT),
    "functions": ("functions", "list", "--project=" + PROJECT),
    "secrets": ("secrets", "list", "--project=" + PROJECT),
    "firestore": ("firestore", "databases", "list", "--project=" + PROJECT),
    "run_services": ("run", "services", "list", "--project=" + PROJECT, "--region=" + REGION),
    "project_iam": ("projects", "get-iam-policy", PROJECT),
}
# Managed service accounts and service identity information must not be
# emitted in full. Only an exact, expected staging identity is labeled.
def check(command):
    env = dict(os.environ)
    # Do not use the prior Mimo Cloud Shell quota-project setting.
    env.pop("GOOGLE_CLOUD_QUOTA_PROJECT", None)
    env["CLOUDSDK_CORE_DISABLE_PROMPTS"] = "1"
    argv = ["gcloud", "--quiet", *command, "--format=json"]
    try:
        cp = subprocess.run(argv, capture_output=True, text=True,
                            timeout=30, env=env, check=False)
        if cp.returncode != 0:
            return None, "UNVERIFIED_OR_PERMISSION_DENIED"
        return json.loads(cp.stdout or "null"), None
    except (subprocess.TimeoutExpired, ValueError, OSError):
        return None, "UNVERIFIED_OR_PERMISSION_DENIED"

def classification(member):
    if member in ("allUsers", "allAuthenticatedUsers"):
        return "PUBLIC"
    return member.split(":", 1)[0] if ":" in member else "OTHER"

def aggregate_bindings(bindings):
    result = []
    for binding in bindings or []:
        members = binding.get("members") or []
        classes = {}
        for member in members:
            kind = classification(member)
            classes[kind] = classes.get(kind, 0) + 1
        result.append({"role": binding.get("role", ""),
                       "principalClasses": classes,
                       "public": bool(classes.get("PUBLIC", 0))})
    return result

def main():
    if not shutil.which("gcloud"):
        print(json.dumps({"status": "BLOCKED", "reason": "GCLOUD_NOT_INSTALLED"}))
        return 2
    results, failures = {}, []
    for name, args in COMMANDS.items():
        val, err = check(args)
        results[name] = val
        if err:
            failures.append(name + "_UNVERIFIED")
    project = results["project"] or {}
    identity_ok = (
        project.get("projectId") == PROJECT
        and str(project.get("projectNumber")) == PROJECT_NUMBER
        and project.get("lifecycleState") == "ACTIVE")
    if not identity_ok:
        failures.append("PROJECT_IDENTITY_UNVERIFIED")
    billing = results["billing"] or {}
    billing_enabled = billing.get("billingEnabled")
    if billing_enabled is not False:
        failures.append("BILLING_DISABLED_NOT_VERIFIED")
    accounts = results["service_accounts"]
    accounts = accounts if isinstance(accounts, list) else []
    custom_account_exists = any(a.get("email") == ACCOUNT and
                                a.get("disabled") is not True for a in accounts)
    if not custom_account_exists:
        failures.append("DEDICATED_RUNTIME_SERVICE_ACCOUNT_NOT_VERIFIED")
    functions = results["functions"]
    functions = functions if isinstance(functions, list) else []
    # No deployment is assumed safe merely because the SA exists.
    known_functions = [{"name": (f.get("name") or "").split("/")[-1],
                        "environment": f.get("environment", "UNKNOWN"),
                        "dedicatedSAConfigured":
                            f.get("serviceConfig", {}).get("serviceAccountEmail") == ACCOUNT}
                       for f in functions]
    if not known_functions:
        failures.append("NO_STAGING_FUNCTIONS_DEPLOYED")
    elif any(not item["dedicatedSAConfigured"] for item in known_functions):
        failures.append("FUNCTIONS_WITHOUT_VERIFIED_DEDICATED_SA")
    secrets = results["secrets"]
    secrets = secrets if isinstance(secrets, list) else []
    secret_exists = any((s.get("name") or "").split("/")[-1] == SECRET
                        for s in secrets)
    if not secret_exists:
        failures.append("STAGING_SECRET_NOT_VERIFIED")
    firestore = results["firestore"]
    firestore = firestore if isinstance(firestore, list) else []
    db = next((x for x in firestore
               if (x.get("name") or "").endswith("/databases/(default)")), None)
    if not db or db.get("locationId") != "europe-west3":
        failures.append("FIRESTORE_STAGE_REGION_UNVERIFIED")
    resources = results["run_services"]
    resources = resources if isinstance(resources, list) else []
    iam = results["project_iam"] or {}
    bindings = aggregate_bindings(iam.get("bindings"))
    if any(x["public"] for x in bindings):
        failures.append("PUBLIC_PROJECT_IAM_BINDING_REVIEW")
    # Even an apparently clean project-policy inventory cannot establish
    # effective inherited permissions, service-level IAM or a budget alert.
    failures.extend(["BUDGET_ALERTS_NOT_CHECKED",
                     "EFFECTIVE_IAM_NOT_ATTESTED",
                     "SECRET_LEVEL_IAM_NOT_ATTESTED",
                     "SQL_RUNTIME_LOGIN_NOT_ATTESTED",
                     "LIVE_APP_AUTH_NOT_TESTED"])
    report = {
        "project": PROJECT,
        "identityVerified": identity_ok,
        "billingEnabled": billing_enabled,
        "dedicatedRuntimeAccountPresent": custom_account_exists,
        "secretMetadataPresent": secret_exists,
        "stagingFunctions": known_functions,
        "runServiceCount": len(resources),
        "firestoreRegion": db.get("locationId") if db else None,
        "projectIAMSummary": bindings,
        "blockers": sorted(set(failures)),
        "authorizesDeployment": False,
        "authorizesBillingChange": False,
        "authorizesSecretsAccess": False,
        "authorizesProductionChange": False,
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    return 2  # Always fail closed until an independently reviewed gate.

if __name__ == "__main__":
    sys.exit(main())
