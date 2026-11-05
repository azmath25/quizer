#!/usr/bin/env python3
"""Rules preflight UI: synthetic local HTML, zero Firebase/cloud calls."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from shutil import which
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
def check(ok,what):
    if not ok: raise AssertionError(what)

server=ThreadingHTTPServer(("127.0.0.1",0),
    partial(QuietHandler,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
url=f"http://127.0.0.1:{server.server_address[1]}/tests/qa/quiz-rules-harness.html"
try:
    with sync_playwright() as p:
        chrome=next((which(name) for name in
            ("google-chrome","google-chrome-stable","chromium","chromium-browser")
            if which(name)),None)
        check(chrome,"System Chromium/Chrome unavailable")
        browser=p.chromium.launch(headless=True,executable_path=chrome,
            args=["--no-sandbox","--disable-dev-shm-usage"])
        try:
            for width,height in [(320,720),(390,844),(768,1024),(1440,900)]:
                ctx=browser.new_context(viewport={"width":width,"height":height},
                    reduced_motion="reduce",has_touch=width<=768)
                page=ctx.new_page()
                errors=[]
                page.on("pageerror",lambda ex:errors.append(str(ex)))
                calls=[]
                page.on("request",lambda req:calls.append(req.url)
                    if "/__qa/api" in req.url or
                       "cloudfunctions.net" in req.url else None)
                page.goto(url,wait_until="domcontentloaded")
                page.locator("#start").click()
                panel=page.locator(".quiz-rules")
                panel.wait_for(state="visible")
                check(page.locator("#rules-title").inner_text()=="Algebra practice",
                      "Rules title disappeared")
                check(page.locator(".quiz-overview").is_hidden(),
                      "Rules view did not replace overview")
                check(page.evaluate("window.__rulesQA.begins")==0,
                      "Opening rules used an attempt")
                check("Timer not started" in panel.inner_text(),
                      "Rules must clearly say timer not started")
                check(page.locator("#rules-prep-status").count()==1,
                      "Missing accessible preparation status")
                check(page.locator("#rules-begin").is_enabled(),
                      "Begin should not be blocked by background preparation")
                # The student can go back without losing an attempt.
                page.locator("#rules-back").click()
                check(page.locator(".quiz-overview").is_visible(),
                      "Back to overview failed")
                check(page.evaluate("window.__rulesQA.begins")==0,
                      "Back consumed an attempt")
                page.locator("#start").click()
                check(page.locator("#rules-begin").is_visible(),
                      "Rules were not re-opened")
                check(page.evaluate(
                    "() => document.documentElement.scrollWidth-window.innerWidth")<=2,
                    f"Horizontal overflow at {width}px")
                for label in ["#rules-begin","#rules-back"]:
                    size=page.locator(label).bounding_box()
                    check(size["height"]>=43,
                          f"Touch target too small at {width}px: {label}")
                if width==320:
                    page.evaluate("window.__rulesQA.fail=true")
                    page.locator("#rules-begin").click()
                    page.locator(".rules-error").wait_for()
                    check(page.locator("#rules-begin").is_enabled(),
                          "Server start refusal should permit retry")
                    check(page.evaluate("window.__rulesQA.started")==0,
                          "Failed start transitioned to questions")
                    page.evaluate("window.__rulesQA.fail=false")
                # Double-click must never consume two attempts.
                page.evaluate("""() => {
                    const button=document.querySelector('#rules-begin');
                    button.click();
                    button.click();
                }""")
                page.locator("#synthetic-runner").wait_for(timeout=15000)
                expected=2 if width==320 else 1
                check(page.evaluate("window.__rulesQA.begins")==expected,
                      "Double-click created multiple attempts")
                check(page.evaluate("window.__rulesQA.started")==1,
                      "First question did not open after successful start")
                check(not calls, f"Rules preflight called cloud API: {calls}")
                check(not errors, f"Uncaught browser errors: {errors}")
                ctx.close()
                print(f"PASS quiz rules preflight at {width}px",flush=True)
        finally: browser.close()
finally:
    server.shutdown()
    server.server_close()
