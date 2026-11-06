#!/usr/bin/env python3
"""Verify native full-card link hit area on touch, real swipe, and desktop flip."""
import asyncio
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = 4191
BASE = f"http://127.0.0.1:{PORT}"
HARNESS = BASE + "/tests/qa/mobile-quiz-card-harness.html"

async def serve_ready():
    for _ in range(100):
        try:
            with urlopen(HARNESS, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            pass
        await asyncio.sleep(0.1)
    raise AssertionError("Local file server unavailable")

async def fresh(context):
    page = await context.new_page()
    await page.goto(HARNESS, wait_until="domcontentloaded")
    await page.wait_for_function("window.quizCardsReady === true")
    assert await page.locator(".quiz-card").count() == 2
    return page

async def test_touch(browser, width):
    context = await browser.new_context(
        viewport={"width":width,"height":700},is_mobile=True,
        has_touch=True,reduced_motion="no-preference")
    try:
        for target in [
            ".quiz-card:first-child .subject",
            ".quiz-card:first-child .clamp",
            ".quiz-card:first-child .card-meta",
            ".quiz-card:first-child .card-foot .text-link",
        ]:
            page = await fresh(context)
            locator=page.locator(target)
            await locator.scroll_into_view_if_needed()
            bounds=await locator.bounding_box()
            assert bounds, "Quiz-card tap target is not visible"
            # Click at a physical point, not locator.tap(), since the
            # stretched heading link deliberately overlays sibling text.
            await page.touchscreen.tap(
                bounds["x"] + bounds["width"]/2,
                bounds["y"] + bounds["height"]/2)
            await page.wait_for_url("**/quiz.html?id=quiz_one",timeout=10000)
            await page.close()
        page=await fresh(context)
        management=await page.locator(".quiz-card:nth-child(2) .subject").bounding_box()
        await page.touchscreen.tap(
            management["x"] + management["width"]/2,
            management["y"] + management["height"]/2)
        await page.wait_for_url("**/quiz-manage.html?id=quiz_manage",timeout=10000)
        await page.close()

        page=await fresh(context)
        # Confirm touch rules are active without disabling the primary CTA.
        css=await page.locator(".quiz-card:first-child h3 a").evaluate(
            """e => ({
                position: getComputedStyle(e,'::after').position,
                height: getComputedStyle(e,'::after').height,
                back: getComputedStyle(document.querySelector('.qc-back')).display
            })""")
        assert css["position"]=="absolute",css
        assert css["back"]=="none",css
        assert await page.locator(".quiz-card:first-child .card-foot a").is_visible()
        # A real touch swipe over the card must scroll rather than follow its
        # stretched native link.
        card=await page.locator(".quiz-card:first-child").bounding_box()
        x=card["x"]+card["width"]/2
        y=min(550,card["y"]+card["height"]-25)
        session=await context.new_cdp_session(page)
        await session.send("Input.dispatchTouchEvent",{
            "type":"touchStart","touchPoints":[{"x":x,"y":y}]})
        for dy in [32,64,100,144,190]:
            await session.send("Input.dispatchTouchEvent",{
                "type":"touchMove","touchPoints":[{"x":x,"y":y-dy}]})
            await asyncio.sleep(0.04)
        await session.send("Input.dispatchTouchEvent",{
            "type":"touchEnd","touchPoints":[]})
        await asyncio.sleep(0.35)
        assert page.url == HARNESS, "Touch swipe unexpectedly opened a quiz"
        assert await page.evaluate("window.scrollY") > 5, (
            "Touch swipe did not scroll the quiz list")
        await page.close()
        print(f"PASS: {width}px touch; card body, CTA and manage navigate; swipe scrolls",flush=True)
    finally:
        await context.close()

async def test_desktop(browser):
    context=await browser.new_context(
        viewport={"width":1280,"height":900},
        has_touch=False,reduced_motion="no-preference")
    try:
        page=await fresh(context)
        card=page.locator(".quiz-card:first-child")
        await card.hover()
        await asyncio.sleep(0.75)
        result=await card.locator(".qc-inner").evaluate(
            "e=>getComputedStyle(e).transform")
        assert result.startswith("matrix3d("),result
        assert not result.startswith("matrix3d(1,"),result
        print("PASS: desktop hover flip remains available",flush=True)
        await page.close()
    finally:
        await context.close()

async def main():
    chrome=next((p for name in
        ("google-chrome","google-chrome-stable","chromium","chromium-browser")
        if (p:=shutil.which(name))),None)
    assert chrome, "Chromium required"
    server=subprocess.Popen(
        [sys.executable,"-m","http.server",str(PORT),"--bind","127.0.0.1",
         "--directory",str(ROOT)],
        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        await serve_ready()
        async with async_playwright() as playwright:
            browser=await playwright.chromium.launch(
                executable_path=chrome,headless=True,
                args=["--no-sandbox","--disable-dev-shm-usage"])
            try:
                for width in [320,390,430]:
                    await test_touch(browser,width)
                await test_desktop(browser)
            finally:
                await browser.close()
    finally:
        if server.poll() is None:
            server.send_signal(signal.SIGTERM)
            try: server.wait(timeout=4)
            except subprocess.TimeoutExpired: server.kill()

if __name__ == "__main__":
    asyncio.run(main())
