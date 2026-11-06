#!/usr/bin/env python3
"""Synthetic browser layout QA for bank selection and teacher PDF placeholders.
No authentication, Firebase, screenshot permission or backend calls needed.
"""
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CSS = "\n".join((ROOT / path).read_text(encoding="utf-8") for path in [
    "assets/css/layout.css", "assets/css/components.css",
    "assets/css/math.css", "assets/css/pages/editor.css",
    "assets/css/problem-card.css",
])
UI = (ROOT / "js/components/ui.js").read_text(encoding="utf-8")
START = UI.index("export function quizCard(")
END = UI.index("\nexport function pagination(", START)
QUIZ = UI[START:END].replace("export function quizCard", "function quizCard")
HELPERS = """
const e = v => String(v ?? "").replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;");
const badge = v => "<span class='badge'>"+e(v)+"</span>";
const icon = () => "<svg class='icon' viewBox='0 0 10 10'></svg>";
const duration = seconds => seconds ? seconds+" min" : "Untimed";
const points = n => String(n ?? 0);
"""

def check(yes, message):
    if not yes:
        raise AssertionError(message)

def seed(page):
    page.set_content(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<style>:root{--surface:#fff;--surface-alt:#f5f7fa;--text:#223;--muted:#64748b;'
        '--border:#e2e8f0;--brand:#1584b2;--on-brand:#fff;--radius:12px;--radius-sm:7px;'
        '--shadow:0 2px 5px #0002;--shadow-lift:0 3px 10px #0002;--tone:#1584b2}'
        'body{margin:0;font:16px system-ui;background:#f8fafc;}main{max-width:none;padding:24px;}'
        '</style><style>'+CSS+'</style></head><body data-page="problems">'
        '<main><div class="bank-layout"><div class="bank-main"><div class="grid" id="bank-list">'
        '<div class="problem-wrapper"><div class="prob-tabs"><div class="tab-meta">'
        '<span class="meta-tag">Algebra</span></div><div class="tab-actions">'
        '<button type="button" class="action-btn">Copy</button></div></div>'
        '<article class="prob-card-box"><div class="flip-container"><div class="flip-card">'
        '<div class="flip-face flip-face--front"><div class="prob-card__body"><h3>Question 1</h3>'
        '<div class="prob-card__text">If x + 2 = 5, find x.</div></div></div>'
        '<div class="flip-face flip-face--back"><div class="meta-back">Metadata and actions</div></div>'
        '</div></div></article></div></div></div>'
        '<aside class="selection-panel" id="selection-panel" hidden>One problem selected</aside>'
        '</div><div id="teacher-cards"></div></main></body></html>'
    )
    page.add_script_tag(content=HELPERS+"\n"+QUIZ)
    page.evaluate("""() => {
      document.querySelector("#teacher-cards").innerHTML =
       quizCard({quizId:"teacher",title:"Teacher quiz",questionCount:2},{management:true});
    }""")

def geometry(page, selected, width):
    page.locator("#selection-panel").evaluate("(el, selected) => el.hidden = !selected", selected)
    data = page.evaluate("""() => {
        const read = s => document.querySelector(s).getBoundingClientRect();
        const card = read(".problem-wrapper"), wrap = read(".flip-container"),
          front = read(".flip-face--front"), back = read(".flip-face--back"),
          core = read(".flip-card"), list = read("#bank-list");
        return {
            card:card.width, wrap:wrap.width, front:front.width,
            back:back.width, core:core.width, list:list.width,
            window:window.innerWidth, overflow:document.documentElement.scrollWidth,
            wrapDisplay:getComputedStyle(document.querySelector(".flip-container")).display
        };
    }""")
    assert_width=lambda a,b: abs(data[a]-data[b])<=3
    check(data["wrapDisplay"]=="block",f"bank flip remains shrink-to-fit: {width}")
    check(assert_width("wrap","core") and assert_width("wrap","front") and assert_width("wrap","back"),
          f"back and front must have same width at {width} selection={selected}: {data}")
    check(abs(data["card"]-data["wrap"])<=3,
          f"bank card only partly flips at {width} selection={selected}: {data}")
    check(data["overflow"] <= data["window"] + 3,
          f"horizontal overflow at {width} selection={selected}: {data}")
    if not selected and width>=900:
        check(data["list"] <= 823,
              f"no-selection cards should not expand across full desktop: {data}")
    page.locator(".flip-card").evaluate("(el)=>el.classList.add('is-flipped')")
    page.wait_for_timeout(650)
    flipped = page.locator(".flip-card").evaluate("(el)=>getComputedStyle(el).transform")
    check(flipped!="none",f"flip transform lost at {width}")
    page.locator(".flip-card").evaluate("(el)=>el.classList.remove('is-flipped')")
    print(f"PASS bank {width}px selected={selected} card={data['card']:.1f}px face={data['front']:.1f}px",flush=True)

def teacher_buttons(page, touch):
    back=page.locator("#teacher-cards .qc-back .qc-pdf-soon")
    front=page.locator("#teacher-cards .qc-front .qc-pdf-front")
    check(back.count()==1 and back.is_disabled(),"back needs disabled PDF placeholder")
    check(front.count()==1 and front.is_disabled(),"touch front needs disabled PDF placeholder")
    check(front.is_visible()==touch, "touch-only PDF placeholder visibility incorrect")
    check(page.locator("#teacher-cards .card-foot .text-link").inner_text().strip().startswith("Manage"),
          "Teacher Manage must remain visible")
    print("PASS PDF placeholders "+("touch" if touch else "desktop"),flush=True)

def main():
    with sync_playwright() as pw:
        chrome=next((val for name in ("google-chrome","chromium","chromium-browser")
                     if (val:=shutil.which(name))),None)
        check(chrome is not None,"System Chromium required")
        browser=pw.chromium.launch(executable_path=chrome,headless=True,
            args=["--no-sandbox","--disable-dev-shm-usage"])
        try:
            for width,height,touch in [(1440,900,False),(1024,768,False),(390,844,True)]:
                ctx=browser.new_context(viewport={"width":width,"height":height},
                    has_touch=touch,is_mobile=touch,reduced_motion="no-preference")
                try:
                    page=ctx.new_page()
                    seed(page)
                    geometry(page,False,width)
                    geometry(page,True,width)
                    teacher_buttons(page,touch)
                finally:ctx.close()
        finally:browser.close()

if __name__=="__main__":
    main()
