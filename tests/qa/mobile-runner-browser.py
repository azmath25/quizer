#!/usr/bin/env python3
"""QN12.1 real Chromium responsive regression against ONLY demo Firebase emulators.

No production data, no deployment. Uses the existing QA server and synthetic
seed. Fails closed if its emulator guard is missing. Chromium is not iOS Safari.
"""
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import time
import uuid
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "tests/qa/generated-qn12-1"
OUTPUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:4173"
WIDTHS = [(320, 720, True), (360, 780, True), (390, 844, True),
          (430, 932, True), (768, 1024, True), (1024, 768, False)]

def require(condition, message):
    if not condition:
        raise AssertionError(message)

def rect(locator):
    return locator.evaluate("""el => {
      const r = el.getBoundingClientRect();
      return {x:r.x, y:r.y, width:r.width, height:r.height,
              top:r.top, right:r.right, bottom:r.bottom};
    }""")

def same_geometry(before, after, name, width):
    for key in ("x", "y", "width", "height"):
        require(abs(before[key] - after[key]) <= 1.0,
                f"{name} {key} shifted at {width}px: {before[key]} to {after[key]}")

def api(context, action, **data):
    r = context.request.post(BASE + "/__qa/api", data={
        "apiVersion": 2, "action": action,
        "requestId": str(uuid.uuid4()), **data,
    }, timeout=25000)
    require(r.ok, f"QA emulator {action} failed: {r.status} {r.text()[:500]}")
    body = r.json()
    require(isinstance(body, dict) and "data" in body,
            f"{action} returned unexpected payload")
    return body["data"]

def wait_for_seed():
    start = time.monotonic()
    last = None
    while time.monotonic() - start < 200:
        try:
            with urlopen(BASE + "/__qa/status", timeout=3) as res:
                last = json.load(res)
                if last.get("error"):
                    raise AssertionError("QA fixture setup: " + last["error"])
                if last.get("ready"):
                    return
        except AssertionError:
            raise
        except Exception:
            pass
        time.sleep(1)
    raise AssertionError("Emulator QA server did not become ready: " +
                         str(last)[-1800:])

def login(context):
    r = context.request.post(BASE + "/__qa/login", data={
        "email": "student@example.test", "password": "Testing123!",
    }, timeout=25000)
    require(r.ok, "Synthetic student login failed: " + r.text()[:500])

def viewport_check(browser, width, height, touch, attempt_id):
    ctx = browser.new_context(viewport={"width": width, "height": height},
                              device_scale_factor=2 if touch else 1,
                              is_mobile=touch, has_touch=touch,
                              reduced_motion="reduce")
    try:
        login(ctx)
        page = ctx.new_page()
        page.route("https://fonts.googleapis.com/**", lambda route: route.abort())
        page.route("https://fonts.gstatic.com/**", lambda route: route.abort())
        page.route("**/js/components/tour.js*", lambda route: route.abort())
        errors = []
        page.on("pageerror", lambda ex: errors.append(str(ex)))
        page.goto(BASE + "/quiz.html?attempt=" + attempt_id,
                  wait_until="domcontentloaded", timeout=30000)
        page.locator("#flag").wait_for(state="visible", timeout=55000)
        flag = page.locator("#flag")
        star = page.locator("#star")
        timer = page.locator("#timer")
        status = page.locator("#save-status")
        require(status.is_visible(),
                f"mobile saving/status indicator is invisible at {width}px")
        require(flag.bounding_box()["height"] >= 43.5 and
                star.bounding_box()["height"] >= 43.5,
                f"flag/star touch target below 44px at {width}px")
        for name, loc in [("flag", flag), ("star", star)]:
            loc.scroll_into_view_if_needed()
            original = rect(loc)
            state = loc.get_attribute("aria-pressed")
            loc.click(timeout=12000)
            page.wait_for_function(
                """args => document.querySelector(args.sel)
                       ?.getAttribute('aria-pressed') !== args.prior""",
                arg={"sel": "#" + name, "prior": state}, timeout=15000)
            after = rect(loc)
            same_geometry(original, after, name, width)
        old = rect(timer)
        page.wait_for_timeout(1200)
        new = rect(timer)
        require(abs(old["width"]-new["width"]) < 1,
                f"timer width changed at {width}px")
        too_wide = page.evaluate("""() => ({
          doc:document.documentElement.scrollWidth,
          win:window.innerWidth
        })""")
        require(too_wide["doc"] <= too_wide["win"] + 2,
                f"horizontal overflow at {width}px: {too_wide}")
        grid = page.locator("#question-grid button").first
        require(grid.count() and rect(grid)["height"] >= 43.5,
                f"numbered problem button smaller than 44px at {width}px")
        footer = page.locator(".runner-footer")
        footer.scroll_into_view_if_needed()
        if width <= 760:
            nav = page.locator("#mobile-nav")
            require(nav.is_visible(), "mobile navigation not visible")
            require(rect(footer)["bottom"] <= rect(nav)["top"] + 1,
                    f"quiz actions overlap mobile navigation at {width}px: " +
                    str({"footer":rect(footer),"nav":rect(nav)}))
        if width == 320:
            # Intentionally force an answer-save network failure; error and
            # retry must remain visible above navigation. No real data.
            def offline_save(route):
                body = route.request.post_data_json or {}
                if body.get("action") == "saveAnswers":
                    route.abort("failed")
                else:
                    route.continue_()
            page.route("**/__qa/api", offline_save)
            radios = page.locator('input[name="answer"]')
            if radios.count():
                choice = radios.first
                if choice.is_checked() and radios.count()>1:
                    choice = radios.nth(1)
                choice.check(timeout=10000)
            else:
                page.locator("#answer-text").fill("12345", timeout=10000)
            page.wait_for_function(
                """() => document.querySelector('#save-status')
                     ?.textContent.includes('Not saved.')""", timeout=20000)
            require(page.locator("#retry-save").is_visible(),
                    "Retry saving disappeared on mobile")
            require(page.locator("#save-status").is_visible(),
                    "Failed-saving warning hidden on mobile")
            page.screenshot(path=str(OUTPUT / "320px-save-error.png"),
                            full_page=False)
            page.unroute("**/__qa/api", offline_save)
            page.locator("#retry-save").click(timeout=15000)
            page.wait_for_function(
                """() => document.querySelector('#save-status')
                     ?.textContent.includes('All changes saved')""",
                timeout=20000)
        page.screenshot(path=str(OUTPUT / f"{width}px-runner.png"),
                        full_page=False)
        require(not errors, f"browser uncaught errors at {width}px: {errors[:4]}")
        print(f"PASS responsive runner width={width} touch={touch} " +
              f"flag/star=stable timer=stable save=visible grid>=44 " +
              f"no-overflow=true nav-clear=true", flush=True)
    finally:
        ctx.close()

def main():
    env = dict(os.environ)
    env["PORT"] = "4173"
    env["NO_PROXY"] = "127.0.0.1,localhost"
    log_path = OUTPUT / "qa-server.log"
    with log_path.open("w", encoding="utf-8") as log:
        server = subprocess.Popen(["node", "tests/qa/server.mjs"], cwd=ROOT,
                                  env=env, stdout=log, stderr=subprocess.STDOUT,
                                  start_new_session=True)
        try:
            wait_for_seed()
            with sync_playwright() as p:
                # The GitHub Ubuntu 26.04 runner ships system Chrome/Chromium.
                # Playwright 1.58 cannot download its own Chromium on 26.04.
                installed_browser = next((path for name in
                    ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")
                    if (path := shutil.which(name))), None)
                require(installed_browser,
                        "No system Chrome/Chromium found on the QA runner")
                browser = p.chromium.launch(headless=True,
                                            executable_path=installed_browser,
                                            args=["--no-sandbox",
                                                  "--disable-dev-shm-usage"])
                try:
                    setup = browser.new_context()
                    try:
                        login(setup)
                        quizzes = api(setup, "listPublicQuizzes", limit=20)
                        items = quizzes.get("items", [])
                        candidates = [q for q in items
                                      if q.get("accessMode", "open") == "open"]
                        require(candidates, "No synthetic public/open quiz available")
                        attempt_id = None
                        for candidate in candidates:
                            qid = candidate.get("quizId") or candidate.get("id")
                            if not qid:
                                continue
                            try:
                                started = api(setup, "startAttempt", quizId=qid)
                                attempt_id = started["attemptId"]
                                break
                            except AssertionError:
                                continue
                        require(attempt_id, "Could not start a synthetic quiz attempt")
                    finally:
                        setup.close()
                    for width, height, touch in WIDTHS:
                        viewport_check(browser, width, height, touch, attempt_id)
                finally:
                    browser.close()
        finally:
            # Ensure QA Firebase emulator processes cannot outlive this job.
            if server.poll() is None:
                os.killpg(server.pid, signal.SIGTERM)
                try:
                    server.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    os.killpg(server.pid, signal.SIGKILL)
                    server.wait(timeout=5)

if __name__ == "__main__":
    main()
