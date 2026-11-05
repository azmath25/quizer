#!/usr/bin/env python3
"""In-tab snip QA: NO OS snipping tool, screen-share API, Firebase, or AI provider."""
from pathlib import Path
import json
import os
import shutil
import signal
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
PORT=4187
URL=f"http://127.0.0.1:{PORT}/tests/qa/ai-snip-fixture.html"
OUT=ROOT/"tests/qa/generated-ai-snip"
OUT.mkdir(parents=True,exist_ok=True)

def check(ok,message):
    if not ok:raise AssertionError(message)

def verify(browser,width,height,touch):
    ctx=browser.new_context(
        viewport={"width":width,"height":height},
        device_scale_factor=2 if touch else 1,
        is_mobile=touch,has_touch=touch,
        reduced_motion="reduce")
    try:
        page=ctx.new_page()
        errors=[]
        page.on("pageerror",lambda error:errors.append(str(error)))
        page.goto(URL,wait_until="domcontentloaded")
        page.locator("#snip-start").click()
        page.locator(".snip-page-layer").wait_for(state="visible")
        problem=page.locator("#problem").bounding_box()
        check(problem and problem["width"]>=100,"Synthetic problem not visible")
        x=problem["x"]+10
        y=problem["y"]+10
        page.mouse.move(x,y)
        page.mouse.down()
        page.mouse.move(problem["x"]+problem["width"]-10,
                        problem["y"]+problem["height"]-10,steps=10)
        page.screenshot(path=str(OUT/f"{width}px-snipping-overlay.png"))
        page.mouse.up()
        page.wait_for_function("window.lastClip !== undefined")
        data=page.evaluate("window.lastClip")
        check(isinstance(data,str) and "Solve 2x + 1 = 5" in data,
              f"Visible math not captured at {width}: {str(data)[:150]}")
        check("Triangle ABC" in data,
              f"Visible figure description not captured at {width}")
        check("PRIVATE_ANSWER_KEY_DO_NOT_CAPTURE" not in data,
              "Hidden answer key appeared in the snip")
        check("Unrelated distant text" not in data,
              "Out-of-rectangle content appeared in the snip")
        check(not errors,f"Uncaught in-page snipping error: {errors[:3]}")
        page.locator("#snip-start").click()
        page.keyboard.press("Escape")
        page.wait_for_function("window.lastClip !== undefined")
        check(page.evaluate("window.lastClip") is None,
              "Escape did not cancel in-page selection")
        check(page.locator(".snip-page-layer").count()==0,
              "Overlay not cleaned up after cancel")
        print(f"PASS in-browser zero-permission snip width={width} touch={touch}"
              " math + figure context captured, hidden data omitted, Esc canceled",
              flush=True)
    finally:ctx.close()

def main():
    with (OUT/"static-server.log").open("w",encoding="utf8") as log:
        server=subprocess.Popen(["python","-m","http.server",str(PORT),
                                 "--bind","127.0.0.1"],
                                cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,
                                start_new_session=True)
        try:
            for _ in range(60):
                try:
                    with urlopen(URL,timeout=1) as response:
                        if response.status==200:break
                except Exception:time.sleep(.25)
            else:raise AssertionError("Static test server did not start")
            with sync_playwright() as p:
                chrome=next((v for name in
                    ("google-chrome","google-chrome-stable","chromium","chromium-browser")
                    if (v:=shutil.which(name))),None)
                check(chrome is not None,
                      "System Chromium required for browser snip regression")
                browser=p.chromium.launch(
                    executable_path=chrome,headless=True,
                    args=["--no-sandbox","--disable-dev-shm-usage"])
                try:
                    verify(browser,390,844,True)
                    verify(browser,1024,768,False)
                finally:browser.close()
        finally:
            if server.poll() is None:
                os.killpg(server.pid,signal.SIGTERM)
                try:server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(server.pid,signal.SIGKILL)
                    server.wait()

if __name__=="__main__":
    main()
