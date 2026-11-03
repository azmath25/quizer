#!/usr/bin/env python3
"""QN12.2: real browser geometry on synthetic Firebase-emulator author pages.

Uses installed Chromium and ONLY the existing demo-mathquiz-v2 QA server.
No cloud writes, no production identities, no website deployment.
"""
import json
import os
from pathlib import Path
import runpy
import shutil
import signal
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
OUTPUT=ROOT/"tests/qa/generated-qn12-2"
OUTPUT.mkdir(parents=True,exist_ok=True)
helpers=runpy.run_path(str(ROOT/"tests/qa/mobile-runner-browser.py"),run_name="qn12_2_qa_helpers")
BASE=helpers["BASE"]
require=helpers["require"]
rect=helpers["rect"]
api=helpers["api"]
wait_for_seed=helpers["wait_for_seed"]

VIEWPORTS=[(320,720,True),(390,844,True),
           (430,932,True),(768,1024,True),(844,390,True),
           (1024,768,False)]

def login_teacher(context):
    reply=context.request.post(BASE+"/__qa/login",data={
        "email":"teacher@example.test","password":"Testing123!"
    },timeout=25000)
    require(reply.ok,"Synthetic teacher sign-in failed: "+reply.text()[:250])

def open_page(page,route,locator):
    page.goto(BASE+"/"+route,wait_until="domcontentloaded",timeout=30000)
    page.locator(locator).first.wait_for(state="visible",timeout=55000)

def no_horizontal_overflow(page,label,width):
    layout=page.evaluate("""() => ({
      outer: document.documentElement.scrollWidth,
      inner: window.innerWidth
    })""")
    require(layout["outer"]<=layout["inner"]+2,
            f"{label} horizontal overflow at {width}px: {layout}")

def nav_clear(page,selector,width):
    if width>760:return
    dock=page.locator(selector)
    nav=page.locator("#mobile-nav")
    require(nav.is_visible(),"Mobile navigation not visible at "+str(width))
    require(rect(dock)["bottom"]<=rect(nav)["top"]+1,
            f"{selector} overlaps mobile navigation at {width}: "+
            str({"dock":rect(dock),"nav":rect(nav)}))

def tap_or_click(locator,touch):
    locator.tap(timeout=15000) if touch else locator.click(timeout=15000)

def author_check(browser,width,height,touch,quiz_id,scale=False):
    ctx=browser.new_context(viewport={"width":width,"height":height},
        device_scale_factor=2 if touch else 1,
        is_mobile=touch,has_touch=touch,reduced_motion="reduce")
    tag="large-text" if scale else "normal"
    try:
        login_teacher(ctx)
        page=ctx.new_page()
        page.route("https://fonts.googleapis.com/**",lambda r:r.abort())
        page.route("https://fonts.gstatic.com/**",lambda r:r.abort())
        page.route("**/js/components/tour.js*",lambda r:r.abort())
        errors=[]
        page.on("pageerror",lambda error:errors.append(str(error)))
        if scale:
            page.add_init_script("""document.addEventListener(
              'DOMContentLoaded', () => {
                document.documentElement.style.fontSize='200%';
              }, {once:true});""")

        # Edit an EXISTING synthetic quiz draft; do not save/publish.
        open_page(page,"upload.html?id="+quiz_id,".slot-row")
        save=page.locator("#save-state")
        require(save.get_attribute("role")=="status" and
                save.get_attribute("aria-live")=="polite",
                "Quiz draft save updates are not announced")
        slots=page.locator(".slot-row")
        require(slots.count()>0,"Seeded teacher quiz must have problems")
        row=slots.first
        all_actions=row.locator(".slot-actions button")
        require(all_actions.count()==5,"Expected five reorder/duplicate/update controls")
        for i in range(all_actions.count()):
            r=rect(all_actions.nth(i))
            require(r["width"]>=43.5 and r["height"]>=43.5,
                    f"slot action {i} too small at {width}px: {r}")
        if width<=760:
            points_field=row.locator("label.field input")
            require(rect(points_field)["height"]>=43.5 and
                    rect(points_field)["width"]>=70,
                    f"slot points crushed on phone at {width}px")
        no_horizontal_overflow(page,"quiz editor",width)
        save_buttons=page.locator(".editor-actions")
        save_buttons.scroll_into_view_if_needed()
        nav_clear(page,".editor-actions",width)
        page.screenshot(path=str(OUTPUT/f"{width}px-{tag}-editor.png"),
                        full_page=False)
        if width<=900:
            preview=page.locator('[data-editor-tab="preview"]')
            tap_or_click(preview,touch)
            require(page.locator(".editor-preview").is_visible(),
                    "Mobile editor preview tab does not open")
            no_horizontal_overflow(page,"quiz preview",width)

        # Import/preview view; no import API or storage upload.
        open_page(page,"upload.html","#import-status")
        require(page.locator("#import-status").get_attribute("role")=="status",
                "Import progress not announced")
        require(page.locator("#latex-source").is_visible(),
                "LaTeX source editor missing")
        no_horizontal_overflow(page,"import editor",width)
        page.screenshot(path=str(OUTPUT/f"{width}px-{tag}-import.png"),
                        full_page=False)

        # Existing problem bank. Selecting is IN-MEMORY ONLY.
        open_page(page,"problems.html","[data-select]")
        no_horizontal_overflow(page,"problem bank",width)
        if width<=600:
            card_buttons=page.locator(".problem-wrapper .tab-actions .action-btn")
            require(card_buttons.count()>0,"Problem card toolbar missing")
            r=rect(card_buttons.first)
            require(r["height"]>=43.5 and r["width"]>=43.5,
                    f"Bank toolbar undersized at {width}px: {r}")
        checks=page.locator("[data-select]")
        require(checks.count()>0,"Seeded teacher has no bank problems")
        target=page.locator(".problem-wrapper .prob-select").first
        require(rect(target)["width"]>=43.5 and
                rect(target)["height"]>=43.5,
                f"Problem selection hit area below 44px at {width}px")
        tap_or_click(target,touch)
        require(checks.first.is_checked(),
                f"Problem selection tap did not select item at {width}px")
        panel=page.locator("#selection-panel")
        panel.wait_for(state="visible",timeout=15000)
        toggle=page.locator("#toggle-selection")
        require(toggle.get_attribute("aria-controls")=="selection-details",
                "Selection toggle lacks accessible controlled region")
        require(rect(toggle)["height"]>=43.5 and
                rect(toggle)["width"]>=43.5,"Selection toggle too small")
        if scale:
            diagnostics=page.evaluate("""() => {
              const panel=document.querySelector('#selection-panel');
              const btn=document.querySelector('#toggle-selection');
              const r=btn.getBoundingClientRect();
              const x=r.left+r.width/2, y=r.top+r.height/2;
              const css=getComputedStyle(panel);
              const hit=document.elementFromPoint(x,y);
              return {
                parent:panel.parentElement?.tagName,
                position:css.position, zIndex:css.zIndex,
                display:css.display, panelRect:panel.getBoundingClientRect().toJSON(),
                buttonRect:r.toJSON(),
                center:{x,y}, hit:hit?.outerHTML?.slice(0,300),
                viewport:{width:innerWidth,height:innerHeight,
                  visualHeight:visualViewport?.height},
                navClearance:getComputedStyle(document.documentElement)
                  .getPropertyValue('--mobile-nav-clearance'),
                navRect:document.querySelector('#mobile-nav')?.getBoundingClientRect().toJSON(),
                visualScale:visualViewport?.scale,
                screenWidth:screen.width,clientWidth:document.documentElement.clientWidth,
                offenders:[...document.querySelectorAll('body *')]
                  .map(el=>({tag:el.tagName.toLowerCase(),name:(el.id ? '#'+el.id :
                         el.className && typeof el.className==='string' ? '.'+
                         el.className.split(' ').slice(0,2).join('.') : ''),
                    w:Math.ceil(el.getBoundingClientRect().width),
                    right:Math.ceil(el.getBoundingClientRect().right),
                    pos:getComputedStyle(el).position}))
                  .filter(v=>v.w>390 || v.right>390)
                  .sort((a,b)=>b.w-a.w).slice(0,32)
              };
            }""")
            print("QN12.2 enlarged dock hit-testing: "+json.dumps(diagnostics),flush=True)
            page.screenshot(path=str(OUTPUT/"390px-enlarged-dock-before-tap.png"),
                            full_page=False)
        if width==320:
            page.screenshot(path=str(OUTPUT/"320px-selected-collapsed.png"),
                            full_page=False)
        if width<=760:
            require(toggle.get_attribute("aria-expanded")=="false",
                    "Phone selection should start compact")
            tap_or_click(toggle,touch)
            require(toggle.get_attribute("aria-expanded")=="true",
                    "Could not expand selected problems")
        else:
            require(toggle.get_attribute("aria-expanded")=="true",
                    "Desktop selection should open expanded")
        selected=panel.locator(".sel-row")
        selected.first.wait_for(state="visible",timeout=10000)
        actions=selected.first.locator(".sel-ctl .icon-button")
        require(actions.count()==3,"Selected row should have three actions")
        for i in range(actions.count()):
            shape=rect(actions.nth(i))
            require(shape["width"]>=43.5 and shape["height"]>=43.5,
                    f"selected action {i} undersized at {width}px: {shape}")
        no_horizontal_overflow(page,"selected problem dock",width)
        panel.scroll_into_view_if_needed()
        nav_clear(page,"#selection-panel",width)
        page.screenshot(path=str(OUTPUT/f"{width}px-{tag}-bank.png"),
                        full_page=False)

        # Collapse without clearing selection, then expand again.
        tap_or_click(toggle,touch)
        require(panel.locator(".sel-row").count()==1,
                "Collapse unexpectedly removed problem selection")
        require(toggle.get_attribute("aria-expanded")=="false",
                "Collapse button did not update aria-expanded")
        tap_or_click(toggle,touch)
        require(toggle.get_attribute("aria-expanded")=="true",
                "Selection cannot be reopened")
        no_horizontal_overflow(page,"reopened selected dock",width)
        require(not errors,
                f"Unhandled author browser errors at {width}/{tag}: {errors[:3]}")
        print(f"PASS QN12.2 author viewport={width} touch={touch} scale={tag}"
              " editor controls>=44 dock>=44 save/import announced"
              " nav-clear no-overflow expand/collapse",flush=True)
    finally:
        ctx.close()

def main():
    env=dict(os.environ)
    env["PORT"]="4173"
    env["NO_PROXY"]="127.0.0.1,localhost"
    log_file=OUTPUT/"qa-server.log"
    with log_file.open("w",encoding="utf8") as output:
        server=subprocess.Popen(["node","tests/qa/server.mjs"],
            cwd=ROOT,env=env,stdout=output,stderr=subprocess.STDOUT,
            start_new_session=True)
        try:
            wait_for_seed()
            with sync_playwright() as p:
                chrome=next((path for name in
                    ("google-chrome","google-chrome-stable","chromium","chromium-browser")
                    if (path:=shutil.which(name))),None)
                require(chrome,"System Chrome/Chromium is required for browser QA")
                browser=p.chromium.launch(headless=True,
                    executable_path=chrome,
                    args=["--no-sandbox","--disable-dev-shm-usage"])
                try:
                    setup=browser.new_context()
                    try:
                        login_teacher(setup)
                        quizzes=api(setup,"listMyQuizzes",limit=20,lifecycle="active")
                        items=quizzes.get("items",[])
                        require(items,"No seeded teacher quiz drafts")
                        quiz_id=items[0].get("quizId") or items[0].get("id")
                        require(quiz_id,"Teacher quiz ID missing")
                    finally:
                        setup.close()
                    for width,height,touch in VIEWPORTS:
                        author_check(browser,width,height,touch,quiz_id)
                    author_check(browser,390,844,True,quiz_id,scale=True)
                finally:
                    browser.close()
        finally:
            if server.poll() is None:
                os.killpg(server.pid,signal.SIGTERM)
                try:server.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    os.killpg(server.pid,signal.SIGKILL)
                    server.wait(timeout=5)

if __name__=="__main__":
    main()
