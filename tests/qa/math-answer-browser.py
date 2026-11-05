#!/usr/bin/env python3
"""Real Chromium smoke checks for the new offline math answer editor.

Uses only a local synthetic HTML document and no Firebase/API credentials.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from functools import partial
from shutil import which
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
HTML = b"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/pages/quiz.css"></head><body>
<main style="width:min(700px,100%);margin:20px auto">
<div class="answer-area"><label class="field"><span>Your answer</span>
<input id="answer-text" maxlength="500" autocomplete="off"></label></div></main>
</body></html>"""

class LocalOnly(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

    def do_GET(self):
        if self.path == "/__qa/math-answer":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(HTML)))
            self.end_headers()
            self.wfile.write(HTML)
        else:
            super().do_GET()

def require(ok, message):
    if not ok:
        raise AssertionError(message)

server = ThreadingHTTPServer(("127.0.0.1", 0), partial(LocalOnly, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/__qa/math-answer"
try:
    with sync_playwright() as playwright:
        chrome = next((which(x) for x in ("google-chrome", "chromium", "chromium-browser")
                       if which(x)), None)
        require(chrome is not None, "System Chromium is unavailable")
        browser = playwright.chromium.launch(headless=True, executable_path=chrome)
        try:
            for width, height in ((320, 720), (390, 844), (768, 1024), (1440, 900)):
                context = browser.new_context(viewport={"width": width, "height": height})
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(url, wait_until="domcontentloaded")
                page.evaluate("""async () => {
                    window.inputChanges = 0;
                    const input = document.getElementById('answer-text');
                    input.addEventListener('input', () => window.inputChanges++);
                    const module = await import('/js/components/math-answer-editor.js');
                    module.mountMathAnswerEditor(input, {attemptId:'synthetic', itemId:'math1'});
                }""")
                input_field = page.locator("#answer-text")
                label = page.locator("label.field")
                require(label.get_attribute("for") == "answer-text",
                        "Math toolbar disconnected the input's accessible label")
                page.get_by_role("button", name="Insert √").click()
                require(input_field.input_value() == r"\sqrt{}",
                        "Radical key inserted the wrong mathematical expression")
                require(page.evaluate("document.querySelector('#answer-text').selectionStart") == 6,
                        "Math template cursor not moved inside the radical")
                page.keyboard.type("5")
                require(input_field.input_value() == r"\sqrt{5}",
                        "Hand-entered radical did not produce an editable value")
                require(page.evaluate("window.inputChanges") >= 2,
                        "Math keyboard failed to trigger quiz autosave events")
                input_field.fill("")
                page.get_by_role("button", name="Insert a/b").click()
                require(input_field.input_value() == r"\frac{}{}",
                        "Fraction template insertion failed")
                page.get_by_role("button", name="Handwrite / draw").click()
                canvas = page.locator(".math-ink-area canvas")
                canvas.wait_for(state="visible")
                box = canvas.bounding_box()
                require(box is not None and box["width"] > 0, "Canvas not visible")
                page.mouse.move(box["x"] + 12, box["y"] + 12)
                page.mouse.down()
                page.mouse.move(box["x"] + 45, box["y"] + 35)
                page.mouse.up()
                strokes = page.evaluate("""() => JSON.parse(sessionStorage.getItem(
                    'mathquiz.ink.synthetic.math1') || '[]')""")
                require(len(strokes) > 0 and len(strokes[-1]) >= 1,
                        "Handwriting stroke not saved")
                require(input_field.input_value() == r"\frac{}{}",
                        "Drawing must not silently replace the graded answer")
                overflow = page.evaluate(
                    "document.documentElement.scrollWidth - innerWidth")
                require(overflow <= 2, f"Math keyboard overflows at {width}px: {overflow}")
                require(not errors, f"Page errors at {width}px: {errors[:3]}")
                context.close()
                print(f"PASS math input and handwriting viewport={width}px")
        finally:
            browser.close()
finally:
    server.shutdown()
    server.server_close()
