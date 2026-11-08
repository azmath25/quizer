#!/usr/bin/env python3
"""Guarded Quizer PDF queue release through Google Cloud, without GitHub Actions.

--plan: read-only checks. --apply: offline tests, two additive Firestore
composite indexes, then only the five existing Mimo batch Cloud Functions.
Does not delete historical jobs, replay provider requests, modify Neon,
publish GitHub Pages, or deploy unrelated Firebase Functions.
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PROJECT = "sat-quiz-fd317"
MIMO_PROJECT = "mimo-backend-513412"
REGION = "europe-west1"
BRANCH = "fix/pdf-queue-fairness-20261108"
TARGETS = ",".join(
    "functions:mathquiz:" + name for name in
    ("mimoBatchStart", "mimoBatchList", "mimoBatchStatus",
     "mimoBatchReconcile", "mimoBatchSweep")
)
WANTED = [
    ("state", "updatedAt"),
    ("needsAttentionPolling", "updatedAt"),
]


class Stop(Exception):
    pass


def run(*argv: str, timeout: int = 90, output: bool = True) -> str:
    try:
        proc = subprocess.run(argv, cwd=ROOT, text=True,
                              capture_output=output, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Stop("command unavailable/timed out: " + argv[0]) from None
    if proc.returncode:
        if not output:
            raise Stop("local verification failed: " + argv[0])
        raise Stop("command failed (no secret output shown): " + argv[0])
    return proc.stdout.strip() if output else ""


def require(ok: bool, message: str):
    if not ok:
        raise Stop(message)


def preflight():
    require(run("gcloud", "config", "get-value", "project") == PROJECT,
            "select Google Cloud project sat-quiz-fd317")
    require("azmath25/quizer" in run("git", "remote", "get-url", "origin"),
            "unexpected Quizer repository remote")
    sha = run("git", "rev-parse", "HEAD")
    expected = run("git", "rev-parse", "refs/remotes/origin/" + BRANCH)
    require(sha == expected,
            "checkout the exact freshly fetched Quizer fix branch (detached HEAD is fine)")
    require(not run("git", "status", "--porcelain", "--untracked-files=no"),
            "tracked source files modified: use a clean checkout")
    require(run("node", "--version").startswith("v22."),
            "Node 22 required")
    run("firebase", "--version")
    require((ROOT / "firebase/firestore.indexes.json").is_file(),
            "Firestore index manifest not found")
    require((ROOT / "functions/src/mimo/batch.js").is_file(),
            "batch source not found")
    return sha


def mimo_ready():
    svc = json.loads(run(
        "gcloud", "run", "services", "describe", "mimo-backend-git",
        "--project", MIMO_PROJECT, "--region", REGION, "--format=json"
    ))
    traffic = [x for x in svc.get("status", {}).get("traffic", [])
               if int(x.get("percent", 0)) > 0]
    require(len(traffic) == 1 and int(traffic[0]["percent"]) == 100,
            "Mimo Studio has ambiguous live traffic; stop")
    image = svc["spec"]["template"]["spec"]["containers"][0]["image"]
    require("mimo-openrouter-quota" in image,
            "Mimo quota-fix image not serving yet; deploy and verify Mimo first")
    print("Mimo quota-fix Studio image present:", image.rsplit("/", 1)[-1],
          flush=True)


def firestore_index_create(signature):
    """Add exactly one collection-scoped composite index via supported gcloud CLI."""
    args = [
        "gcloud", "firestore", "indexes", "composite", "create",
        "--project", PROJECT,
        "--database=(default)",
        "--collection-group=mimoBatchJobs",
        "--query-scope=collection",
        "--async",
    ] + [
        "--field-config=field-path=" + field + ",order=ascending"
        for field in signature
    ]
    run(*args, timeout=100)
    print("Additive index requested:", "+".join(signature), flush=True)


def inspect_indexes():
    """Use the official Cloud SDK instead of hand-built Firestore REST URLs."""
    raw = run(
        "gcloud", "firestore", "indexes", "composite", "list",
        "--project", PROJECT, "--database=(default)", "--format=json",
        timeout=120,
    )
    indexes = json.loads(raw)
    require(isinstance(indexes, list), "Firestore CLI index list is not an array")
    return [
        index for index in indexes
        if "/collectionGroups/mimoBatchJobs/" in index.get("name", "")
    ]


def index_signature(record):
    fields = record.get("fields", [])
    return tuple(f.get("fieldPath") for f in fields[:2])



def index_status(indexes, signature):
    matches = [
        idx for idx in indexes
        if idx.get("queryScope") == "COLLECTION"
        and index_signature(idx) == signature
        and all(f.get("order") == "ASCENDING" for f in idx["fields"][:2])
    ]
    require(len(matches) <= 1,
            "unexpected duplicate composite index for " + str(signature))
    return matches[0].get("state", "UNKNOWN") if matches else None


def ensure_indexes(apply: bool):
    indexes = inspect_indexes()
    for signature in WANTED:
        state = index_status(indexes, signature)
        print("Firestore index", "+".join(signature), state or "MISSING", flush=True)
        if state is None and apply:
            firestore_index_create(signature)
    if not apply:
        return
    for attempt in range(40):
        indexes = inspect_indexes()
        states = [index_status(indexes, s) for s in WANTED]
        require(all(s is not None for s in states),
                "an index did not appear after request; stop")
        if all(s == "READY" for s in states):
            print("Both indexes READY.", flush=True)
            return
        require(all(s in ("READY", "CREATING") for s in states),
                "index build did not succeed: " + str(states))
        print("Waiting for Firestore indexes:", states, flush=True)
        if attempt != 39:
            time.sleep(15)
    raise Stop("index builds not READY; rerun after they become READY")


def main():
    require(sys.argv[1:] in (["--plan"], ["--apply"]),
            "Usage: python3 scripts/mimo/release-queue-hardfix-cloudshell.py --plan|--apply")
    sha = preflight()
    print("QUIZER_RELEASE_PREFLIGHT_PASS commit:", sha, flush=True)
    mimo_ready()
    apply = sys.argv[1] == "--apply"
    if not apply:
        ensure_indexes(False)
        print("NO WRITES. Apply performs offline tests, additive indexes, then five Functions.")
        return
    print("Running local mock-transport checks; no paid provider requests.", flush=True)
    run("bash", "scripts/mimo/verify-hardfix-cloudshell.sh",
        timeout=900, output=False)
    # Only Firebase Functions need production npm dependencies locally.
    # The root project's 680+ browser/test packages are NOT required for
    # either this release or its focused mock-transport tests.
    print("Installing Functions-only dependencies; no root npm ci.", flush=True)
    run("npm", "ci", "--prefix", "functions", "--omit=dev",
        "--no-audit", "--no-fund", "--prefer-offline",
        timeout=900, output=False)
    ensure_indexes(True)
    print("Deploying ONLY Mimo batch Firebase Functions.", flush=True)
    run("firebase", "deploy", "--only", TARGETS,
        "--project", PROJECT, "--non-interactive", timeout=1400, output=False)
    print("QUIZER_FUNCTION_RELEASE_PASS", flush=True)
    print("Frontend ai-studio.js remains UNPUBLISHED (GitHub Pages needs a separate release path).")


if __name__ == "__main__":
    try:
        main()
    except Stop as exc:
        print("STOP:", exc, file=sys.stderr)
        sys.exit(1)
