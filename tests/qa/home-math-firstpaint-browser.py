#!/usr/bin/env python3
"""Actual Chromium network-order regression for home MathJax and backdrop CSS.

Serves repository files locally. No Firebase login, emulator or production API
writes are required. The MathJax download is real, not a mocked request.
"""
import asyncio
import json
from pathlib import Path
import shutil
import signal
import subprocess
import sys
from urllib.request import urlopen

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = 4189
BASE = f"http://127.0.0.1:{PORT}"

async def wait_server():
    for _ in range(100):
        try:
            with urlopen(BASE + "/index.html", timeout=1) as reply:
                if reply.status == 200:
                    return
        except Exception:
            pass
        await asyncio.sleep(.1)
    raise AssertionError("Local static server failed to start")

async def check_home(browser):
    context = await browser.new_context(
        viewport={"width": 390, "height": 844},
        reduced_motion="no-preference",
    )
    page = await context.new_page()
    held_css = asyncio.Event()
    release_css = asyncio.Event()
    math_requested = asyncio.Event()
    math_urls = []

    async def delay_math_css(route):
        held_css.set()
        await release_css.wait()
        await route.continue_()

    def track(request):
        if request.url.endswith("/assets/mathjax.js"):
            math_urls.append(request.url)
            math_requested.set()

    await page.route("**/assets/css/math.css*", delay_math_css)
    await page.route("https://fonts.googleapis.com/**", lambda r: r.abort())
    await page.route("https://fonts.gstatic.com/**", lambda r: r.abort())
    page.on("request", track)
    try:
        await page.goto(BASE + "/index.html", wait_until="commit")
        await asyncio.wait_for(held_css.wait(), timeout=25)
        await page.locator("#site-header .brand").wait_for(timeout=15000)

        assert await page.locator("#math-bg").count() == 0, (
            "Decorative math was inserted before math.css loaded")
        assert not math_urls, (
            "MathJax download began while the required CSS was still pending")

        release_css.set()
        await page.locator("#math-bg span").first.wait_for(timeout=15000)
        await asyncio.wait_for(math_requested.wait(), timeout=15)
        result = await page.evaluate("""() => ({
          isStyled: getComputedStyle(document.querySelector('#math-bg')).position === 'fixed',
          count: document.querySelectorAll('#math-bg span').length,
          resources: performance.getEntriesByType('resource')
            .filter(entry => /assets\\/(?:css\\/math\\.css|css\\/polish\\.css|mathjax\\.js)/.test(entry.name))
            .map(entry => ({name: entry.name.split('/').pop(),
                             start: entry.startTime, end: entry.responseEnd}))
        })""")
        assert result["isStyled"], "Backdrop is visible but CSS is not applied"
        assert result["count"] == 14, "Decorative equations unexpectedly changed"
        css_ends = [entry["end"] for entry in result["resources"]
                    if entry["name"].startswith(("math.css", "polish.css"))]
        math_starts = [entry["start"] for entry in result["resources"]
                       if entry["name"] == "mathjax.js"]
        assert len(css_ends) == 2 and len(math_starts) == 1, result
        assert min(math_starts) >= max(css_ends), (
            "MathJax network request began before CSS finished: " + str(result))
        print("PASS: no decorative equation before math.css", flush=True)
        print("PASS: both styles downloaded before MathJax network start", flush=True)
        print(json.dumps(result, indent=2), flush=True)
    finally:
        release_css.set()
        await context.close()

async def main():
    chrome = next((path for name in
        ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")
        if (path := shutil.which(name))), None)
    assert chrome, "Chromium system binary required for browser QA"
    with subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT),
         "--bind", "127.0.0.1", "--directory", str(ROOT)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    ) as server:
        try:
            await wait_server()
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    executable_path=chrome, headless=True,
                    args=["--no-sandbox", "--disable-dev-shm-usage"])
                try:
                    await check_home(browser)
                finally:
                    await browser.close()
        finally:
            if server.poll() is None:
                server.send_signal(signal.SIGTERM)
                try: server.wait(timeout=5)
                except subprocess.TimeoutExpired: server.kill()

if __name__ == "__main__":
    asyncio.run(main())
