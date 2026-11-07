#!/usr/bin/env python3
"""One-off, guarded cleanup of six verified older Quizer PDF batch jobs.

Reads Firestore using the Cloud Shell gcloud identity, not a teacher account.
- --plan: read-only; prints only IDs/states, no document contents
- --apply: archives all selected job/page documents locally BEFORE deletion
           and deletes with Firestore updateTime preconditions
- preserves the new job da93223c3f and all unrelated jobs
- makes NO Mimo/provider calls and does not restart/retry failed pages

Run from an authenticated Google Cloud Shell with sat-quiz-fd317 selected.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

PROJECT = "sat-quiz-fd317"
ROOT = f"projects/{PROJECT}/databases/(default)/documents"
API = f"https://firestore.googleapis.com/v1/{ROOT}"
RUN_QUERY = API + ":runQuery"
PRESERVE_PREFIX = "da93223c3f"
# Exact first six 'attention' job prefixes from the November 7 Firestore audit.
PURGE_PREFIXES = frozenset({
    "680ba8688c", "9a918178ce", "a6e2a1b3a5",
    "aaa8f8477f", "bd0353b72d", "c8ba07466a",
})
SAFE_PAGE_STATES = {"attention", "queued", "completed"}
BACKUP_ROOT = Path.home() / "quizer-firestore-cleanup-backups"


def fail(message):
    raise RuntimeError("STOP: " + message)


def gcloud(*args):
    result = subprocess.run(["gcloud", *args], text=True, capture_output=True,
                            timeout=30, check=False)
    if result.returncode:
        fail("gcloud command failed; check login/project and IAM permissions")
    return result.stdout.strip()


def api_request(method, url, token, payload=None, missing_ok=False):
    raw = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url, data=raw, method=method,
        headers={"Authorization": "Bearer " + token, "Accept": "application/json",
                 **({"Content-Type": "application/json"} if raw is not None else {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            body = response.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        if missing_ok and exc.code == 404:
            return None
        # Do not print potentially sensitive Google error response bodies.
        fail(f"Firestore {method} returned HTTP {exc.code}; nothing will be retried")


def query_docs(token, *, field, operator, value, limit=500):
    q = {"structuredQuery": {
        "from": [{"collectionId": "mimoBatchJobs"}],
        "where": {"fieldFilter": {
            "field": {"fieldPath": field},
            "op": operator,
            "value": {"stringValue": value},
        }},
        "limit": limit,
    }}
    answer = api_request("POST", RUN_QUERY, token, q)
    if not isinstance(answer, list):
        fail("Firestore query response was not a list")
    result = [r["document"] for r in answer if "document" in r]
    if len(result) >= limit:
        fail("Too many matched jobs; would not have audited the entire result")
    return result


def value(doc, field):
    return doc.get("fields", {}).get(field, {}).get("stringValue", "")


def job_id(doc):
    name = doc.get("name", "")
    if not name.startswith(ROOT + "/mimoBatchJobs/"):
        fail("Unexpected Firestore document path")
    suffix = name.removeprefix(ROOT + "/mimoBatchJobs/")
    if "/" in suffix or len(suffix) != 64 or any(c not in "0123456789abcdef" for c in suffix):
        fail("Invalid document ID")
    return suffix


def page_refs(doc):
    pages = doc.get("fields", {}).get("pages", {}).get("arrayValue", {}).get("values", [])
    if not isinstance(pages, list) or len(pages) > 100:
        fail("Invalid page list")
    result = []
    numbers = set()
    for item in pages:
        p = item.get("mapValue", {}).get("fields", {})
        state = p.get("state", {}).get("stringValue", "")
        try:
            number = int(p.get("number", {}).get("integerValue", ""))
        except (TypeError, ValueError):
            fail("Invalid page number")
        if state not in SAFE_PAGE_STATES or number not in range(1, 101) or number in numbers:
            fail("Old job has an in-flight, unexpected or duplicate page; refuse to delete")
        numbers.add(number)
        page_key = hashlib.sha256(f"{job_id(doc)}:{number}".encode("utf-8")).hexdigest()
        result.append((number, state, ROOT + "/mimoBatchPages/" + page_key))
    return result


def get_doc(token, name, missing_ok=False):
    if not name.startswith(ROOT + "/"):
        fail("Unsafe Firestore document path")
    return api_request(
        "GET", "https://firestore.googleapis.com/v1/" + name,
        token, missing_ok=missing_ok,
    )


def delete_doc(token, doc):
    name = doc["name"]
    if not name.startswith(ROOT + "/mimoBatchJobs/") and not name.startswith(ROOT + "/mimoBatchPages/"):
        fail("Refusing to delete unexpected collection")
    update_time = doc.get("updateTime")
    if not update_time:
        fail("Missing Firestore updateTime precondition")
    params = urllib.parse.urlencode({"currentDocument.updateTime": update_time})
    api_request("DELETE", "https://firestore.googleapis.com/v1/" + name + "?" + params, token)


def snapshot(archive):
    BACKUP_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(BACKUP_ROOT, 0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    outfile = BACKUP_ROOT / f"six-old-attention-jobs-{stamp}.json"
    flags = os.O_CREAT | os.O_WRONLY | os.O_EXCL
    fd = os.open(str(outfile), flags, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(archive, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    return outfile


def main():
    args = argparse.ArgumentParser(description=__doc__)
    modes = args.add_mutually_exclusive_group(required=True)
    modes.add_argument("--plan", action="store_true")
    modes.add_argument("--apply", action="store_true")
    mode = args.parse_args()
    if gcloud("config", "get-value", "project") != PROJECT:
        fail("Select Google Cloud project sat-quiz-fd317")

    token = gcloud("auth", "print-access-token")
    attention = query_docs(token, field="state", operator="EQUAL", value="attention")
    selected = [doc for doc in attention if job_id(doc)[:10] in PURGE_PREFIXES]
    if len(selected) != len(PURGE_PREFIXES) or {job_id(d)[:10] for d in selected} != PURGE_PREFIXES:
        fail("Exact six historical attention jobs not found; no deletion performed")

    # Require the current job to exist before any changes, but inspect it
    # only AFTER cleanup, per the requested sequence.
    current_candidates = query_docs(
        token, field="createdAt", operator="GREATER_THAN_OR_EQUAL",
        value="2026-11-07T18:48:40", limit=500,
    )
    current_matches = [d for d in current_candidates
                       if job_id(d).startswith(PRESERVE_PREFIX)]
    if len(current_matches) != 1:
        fail("Current job cannot be uniquely located; no deletion performed")
    current_name = current_matches[0]["name"]
    newest_created = value(current_matches[0], "createdAt")

    children = []
    for doc in selected:
        if value(doc, "state") != "attention" or not value(doc, "createdAt") < newest_created:
            fail("A job changed state or is not older than the current test")
        pages = page_refs(doc)
        print("OLD", job_id(doc)[:10], "state=attention",
              "pages=", [s for _, s, _ in pages])
        for _, _, ref in pages:
            child = get_doc(token, ref, missing_ok=True)
            if child:
                # Ensure no unrelated child can be deleted by a hash collision.
                if value(child, "jobId") != job_id(doc):
                    fail("Page record does not belong to its parent")
                children.append(child)

    print("PLAN: remove", len(selected), "old attention job records and",
          len(children), "associated page records; preserve current", PRESERVE_PREFIX)
    if mode.plan:
        print("NO WRITES. Use --apply to archive, then conditionally delete these exact records.")
        return

    # Recheck all parent documents immediately before archive / deletion.
    refreshed = [get_doc(token, d["name"]) for d in selected]
    for old, doc in zip(selected, refreshed):
        if old.get("updateTime") != doc.get("updateTime") or value(doc, "state") != "attention":
            fail("A parent job changed during preflight; no deletion performed")
    archive = {"project": PROJECT, "snapshot_time": datetime.now(timezone.utc).isoformat(),
               "reason": "old attention jobs occupying all six sweep slots",
               "jobs": refreshed, "pages": children}
    path = snapshot(archive)
    print("BACKUP_SAVED:", str(path), "(private mode 0600)")
    print("BACKUP_FIRST: deleting only the six audited historical jobs.")
    # Once the parent is deleted, scheduler will not select it. Remove child
    # records only after all parents are deleted. Keep local archive for repair.
    for doc in refreshed:
        delete_doc(token, doc)
        print("DELETED_OLD_JOB", job_id(doc)[:10])
    for child in children:
        delete_doc(token, child)
    print("DELETED_OLD_PAGE_RECORDS", len(children))

    current = get_doc(token, current_name)
    statuses = [
        p.get("mapValue", {}).get("fields", {}).get("state", {}).get("stringValue", "?")
        for p in current.get("fields", {}).get("pages", {}).get("arrayValue", {}).get("values", [])
    ]
    print("CURRENT_JOB", job_id(current)[:10],
          "state=", value(current, "state"), "pages=", statuses)
    print("CLEANUP_PASS. Keep archive until job processing is independently verified.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, urllib.error.URLError, subprocess.TimeoutExpired) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
