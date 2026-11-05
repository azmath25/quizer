#!/usr/bin/env python3
"""Browser-only AI Studio focus QA. No Firebase/API credentials or cloud calls."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from functools import partial
from shutil import which
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]

def mock_session(page, role):
    """Mock only the Firebase session module in this isolated browser test."""
    allowed = role in ("teacher", "admin")
    teacher = "true" if allowed else "false"
    admin = "true" if role == "admin" else "false"
    source = f"""
      export async function initFirebase() {{}}
      export function watchSession(callback) {{
        queueMicrotask(() => callback({{
          status: 'ready', authResolved: true, roleResolved: true,
          accountStatus: 'active', user: {{ uid: 'synthetic-qa-user' }},
          capabilities: {{ teach: {teacher}, admin: {admin} }}
        }}));
        return () => {{}};
      }}
    """
    page.route("**/js/firebase-client.js", lambda route: route.fulfill(
        status=200, content_type="application/javascript", body=source
    ))

class QuietServer(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

def check(ok, message):
    if not ok:
        raise AssertionError(message)

server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietServer, directory=str(ROOT)))
runner = Thread(target=server.serve_forever, daemon=True)
runner.start()
url = f"http://127.0.0.1:{server.server_address[1]}/ai.html"
try:
    with sync_playwright() as playwright:
        chrome = next((which(name) for name in ("google-chrome", "chromium", "chromium-browser")
                       if which(name)), None)
        check(chrome is not None, "No system Chromium available")
        browser = playwright.chromium.launch(headless=True, executable_path=chrome)
        try:
            for width, height in ((390, 844), (1024, 768), (1440, 900)):
                context = browser.new_context(viewport={"width": width, "height": height},
                                              reduced_motion="reduce")
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                mock_session(page, "teacher")
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                page.locator("#conversation-head .chat-options").wait_for()
                theme = page.locator('.tools [data-act="theme"]')
                check("Light" in theme.get_attribute("aria-label"),
                      "AI Studio must default to light for a new local user")
                theme.click()
                check(page.evaluate("document.documentElement.dataset.theme") == "dark",
                      "AI Studio did not switch to dark")
                theme.click()
                check(page.evaluate("localStorage.getItem('mathquiz.theme.choice')") == "system",
                      "AI Studio did not synchronize System preference")
                check("System" in theme.get_attribute("aria-label"),
                      "AI Studio theme icon did not announce System")
                check(page.locator(".welcome .prompt-card:visible").count() == 2,
                      f"Starter content overcrowded at {width}px")
                check(page.locator("#app").get_attribute("class") == "app",
                      f"Inspector must start collapsed at {width}px")
                if width > 1060:
                    check(page.locator(".inspector").evaluate(
                        "(el) => getComputedStyle(el).display") == "none",
                        "Wide-screen inspector visible by default")
                page.locator(".welcome .more-prompts summary").click()
                check(page.locator(".welcome .prompt-card:visible").count() == 4,
                      "Expanded suggestions are missing")
                page.locator(".chat-options summary").click()
                check(page.locator(".chat-actions button").count() == 3,
                      "Conversation actions were removed")
                page.locator(".chat-options summary").click()
                page.locator(".tools [data-act='inspector']").click()
                check("show-inspector" in page.locator("#app").get_attribute("class") or
                      (width > 1060 and page.locator(".inspector").evaluate(
                          "(el) => getComputedStyle(el).display") != "none"),
                      "Inspector cannot be reopened")
                page.locator(".tools [data-act='inspector']").click()
                if width <= 760:
                    page.locator("[data-act='sidebar']").first.click()
                    check("show-sidebar" in page.locator("#app").get_attribute("class"),
                          "Mobile history not accessible")
                overflow = page.evaluate(
                    "() => document.documentElement.scrollWidth - window.innerWidth")
                check(overflow <= 2, f"Horizontal overflow at {width}px: {overflow}")
                check(not errors, f"Page errors at {width}px: {errors[:3]}")
                context.close()
                print(f"PASS AI Studio focus viewport={width}px")
            # Student accounts must never initialize the full AI Studio.
            student_context = browser.new_context(viewport={"width": 390, "height": 844})
            student = student_context.new_page()
            mock_session(student, "student")
            student.goto(url, wait_until="domcontentloaded", timeout=30000)
            student.locator("#ai-access-gate").wait_for(state="visible")
            check(student.locator("#app").is_hidden(), "Student gained AI Studio access")
            check("teachers and administrators" in student.locator(
                  "#ai-access-gate").inner_text().lower(),
                  "Students should see a clear access-denied explanation")
            student_context.close()
            print("PASS AI Studio student denial gate")

        finally:
            browser.close()
finally:
    server.shutdown()
    server.server_close()
