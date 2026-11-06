#!/usr/bin/env python3
"""Synthetic mobile/desktop quiz-card interaction regression in Chromium."""
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
UI=(ROOT/"js/components/ui.js").read_text(encoding="utf8")
CSS=(ROOT/"assets/css/components.css").read_text(encoding="utf8")+"\n"+(ROOT/"assets/css/math.css").read_text(encoding="utf8")
START=UI.index("export function quizCard(")
END=UI.index("\nexport function pagination(",START)
FUNCTION=UI[START:END].replace("export function quizCard","function quizCard")
STUBS=r"""
const e = v => String(v ?? "").replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const badge = value => "<span class='badge'>"+e(value)+"</span>";
const icon = () => "<span aria-hidden='true'>◆</span>";
const duration = n => n ? n+" min" : "Untimed";
const points = n => String(n ?? 0);
"""

def build_page(page):
    page.set_content(
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<style>:root{--surface:#fff;--text:#123;--border:#dde3e8;--radius:12px;--shadow:0 2px 8px #ccc;'
        '--tone:#267a9a;--on-brand:#fff;--primary:#2680a0;--glass:#ffffff30;--radius-sm:6px}'
        'body{margin:0;font:16px system-ui;background:#f6f8fa;}#cards{padding:40px 18px;display:grid;gap:24px;max-width:420px;}'
        '.quiz-card{min-height:240px;display:flex}.qc-inner{min-height:240px;min-width:0}'
        '.qc-front{min-width:0}.card-foot{margin-top:auto;padding-top:12px}'
        '.card-top,.card-meta{display:flex;gap:10px}.card-meta{padding:8px 0}'
        'h3{margin:9px 0}p{margin:8px 0}</style>'
        '<style>'+CSS+'</style>'
        '<div id="cards"></div><div style="height:1800px"></div>'
    )
    page.add_script_tag(content=STUBS+"\n"+FUNCTION)
    page.evaluate("""() => {
      document.querySelector("#cards").innerHTML =
        quizCard({quizId:"student",title:"Algebra",subject:"Mathematics",description:"An equation to solve",questionCount:5})+
        quizCard({quizId:"teacher",title:"Teacher draft",subject:"Geometry",description:"Draft problem",questionCount:3},{management:true});
      window.lastNavigation=null;
      document.addEventListener("click",ev=>{
        const a=ev.target.closest("a[href]");
        if(a){window.lastNavigation=a.getAttribute("href");ev.preventDefault();}
      },true);
    }""")

def check(condition,message):
    if not condition: raise AssertionError(message)

def tap_background(page,index):
    box=page.locator(".qc-front").nth(index).bounding_box()
    check(box and box["width"]>120 and box["height"]>120,"Front card too small")
    x=box["x"]+box["width"]-24
    y=box["y"]+min(90,box["height"]/2)
    check(page.evaluate("({x,y})=>document.elementFromPoint(x,y)?.classList.contains('qc-tap-target')",{"x":x,"y":y}),
          "Native touch overlay not on top of the card")
    page.touchscreen.tap(x,y)

def mobile(browser):
    ctx=browser.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True)
    try:
        page=ctx.new_page()
        build_page(page)
        check(page.locator(".qc-tap-target").first.is_visible(),"Mobile overlay should be visible")
        check(page.locator(".card-foot .text-link").first.is_visible(),"View Quiz must remain visible")
        tap_background(page,0)
        check(page.evaluate("window.lastNavigation")=="quiz.html?id=student","Student card tap failed")
        page.locator(".card-foot .text-link").first.tap()
        check(page.evaluate("window.lastNavigation")=="quiz.html?id=student","Footer link failed")
        tap_background(page,1)
        check(page.evaluate("window.lastNavigation")=="quiz-manage.html?id=teacher","Teacher card tap failed")
        page.evaluate("window.lastNavigation=null; window.scrollTo(0,0)")
        box=page.locator(".qc-front").first.bounding_box()
        x=box["x"]+box["width"]/2
        y=box["y"]+box["height"]/2
        dev=ctx.new_cdp_session(page)
        dev.send("Input.dispatchTouchEvent",{"type":"touchStart","touchPoints":[{"x":x,"y":y,"id":1}]})
        for n in range(1,6):
            dev.send("Input.dispatchTouchEvent",{"type":"touchMove","touchPoints":[{"x":x,"y":y-n*24,"id":1}]})
        dev.send("Input.dispatchTouchEvent",{"type":"touchEnd","touchPoints":[]})
        page.wait_for_timeout(150)
        check(page.evaluate("window.lastNavigation") is None,"Swipe accidentally opened the quiz")
        print("PASS mobile card tap, View Quiz, teacher Manage and swipe cancellation",flush=True)
    finally:
        ctx.close()

def desktop(browser):
    ctx=browser.new_context(viewport={"width":1280,"height":900},is_mobile=False,has_touch=False)
    try:
        page=ctx.new_page()
        build_page(page)
        check(not page.locator(".qc-tap-target").first.is_visible(),"Desktop overlay must be hidden")
        page.locator(".quiz-card").first.hover()
        page.wait_for_timeout(700)
        transform=page.locator(".qc-inner").first.evaluate("(el)=>getComputedStyle(el).transform")
        check(transform!="none","Desktop hover flip did not activate")
        print("PASS desktop hover flip without mobile overlay",flush=True)
    finally:
        ctx.close()

def main():
    with sync_playwright() as playwright:
        chrome=next((p for name in ("google-chrome","chromium","chromium-browser")
                     if (p:=shutil.which(name))),None)
        check(chrome is not None,"System Chrome/Chromium is required")
        browser=playwright.chromium.launch(executable_path=chrome,headless=True,
            args=["--no-sandbox","--disable-dev-shm-usage"])
        try:
            mobile(browser)
            desktop(browser)
        finally:
            browser.close()

if __name__=="__main__":
    main()
