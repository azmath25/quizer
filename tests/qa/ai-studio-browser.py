#!/usr/bin/env python3
"""Browser-only AI Studio focus QA. No Firebase/API credentials or cloud calls."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from functools import partial
from shutil import which
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]

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
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                page.locator("#conversation-head .chat-options").wait_for()
                # Independent preview exposes Quizer's exact site menu, without
                # loading Firebase or calling protected APIs just for nav.
                expected = [
                    ("Home", "index.html"), ("Quizzes", "quizzes.html"),
                    ("My activity", "activity.html"),
                    ("Teaching", "teaching.html"),
                    ("AI Studio", "ai.html"), ("Admin", "admin.html"),
                ]
                nav = page.locator(".studio-global-nav")
                links = nav.locator("a")
                pairs = [(link.inner_text(), link.get_attribute("href"))
                         for link in links.all()]
                check(pairs == expected,
                      f"AI Studio nav differs from Quizer at {width}px: {pairs}")
                check(nav.locator('a[aria-current="page"]').inner_text() == "AI Studio",
                      "AI Studio active navigation state missing")
                menu = page.locator("#studio-nav-dropdown")
                if width <= 1200:
                    check(menu.is_visible() and not nav.is_visible(),
                          f"Compact site navigation missing at {width}px")
                    menu.locator("summary").click()
                    menu_links = menu.locator("nav a")
                    mobile_pairs = [(link.inner_text(), link.get_attribute("href"))
                                    for link in menu_links.all()]
                    check(mobile_pairs == expected + [("Profile", "profile.html")],
                          f"Dropdown does not match Quizer links: {mobile_pairs}")
                    check(menu_links.filter(has_text="AI Studio").count() == 1,
                          "Active AI Studio link missing in compact navigation")
                    menu.locator("summary").click()
                else:
                    check(nav.is_visible() and not menu.is_visible(),
                          "Desktop navigation should show the full Quizer menu")
                    check(page.locator(".studio-profile").is_visible(),
                          "Desktop Profile link is missing")
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
        finally:
            browser.close()
finally:
    server.shutdown()
    server.server_close()
