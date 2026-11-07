#!/usr/bin/env python3
"""Authenticated-looking browser smoke using local callable mocks, no cloud traffic.

Checks original AI Studio visual structure and the production Firebase/Mimo wiring.
The test cannot prove real deployment or live service authorization.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from functools import partial
from shutil import which
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]

class QuietServer(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

def check(condition, message):
    if not condition:
        raise AssertionError(message)

def mock_session(page, role):
    js = r"""
      const session = {
        status: "ready", authResolved: true, roleResolved: true,
        accountStatus: "active", epoch: 7,
        user: {uid:"qa-original-studio",email:"qa@example.test",emailVerified:true},
        profile: {displayName:"QA Teacher",preferences:{theme:"light"}},
        capabilities: {teach:__TEACH__,admin:__ADMIN__}
      };
      const threadId="00000000-0000-4000-a000-000000000001";
      let threadMessages=[
        {id:"m1",role:"user",content:"Solve 2x=4.",createdAt:"2026-11-07T12:00:00Z"},
        {id:"m2",role:"assistant",content:"The answer is \\(x=2\\).",createdAt:"2026-11-07T12:01:00Z"}
      ];
      let threads=[{id:threadId,title:"Saved mathematics",createdAt:"2026-11-07T12:00:00Z",updatedAt:"2026-11-07T12:01:00Z"}];
      export async function initFirebase(){return session;}
      export function getSession(){return session;}
      export function watchSession(callback){queueMicrotask(()=>callback(session));return ()=>{};}
      export function errorMessage(error){return String(error);}
      export async function getFirebaseServices(){
        return {functions:{},functionsSDK:{httpsCallable(_f,name){
          return async (payload={})=>{
            if(name==="mimoAiHub"){
              if(payload.action==="chat.list")return {data:{threads}};
              if(payload.action==="chat.get")return {data:{messages:threadMessages,hasMore:false}};
              if(payload.action==="chat.send"){
                const id=payload.threadId||threadId;
                threadMessages=[...threadMessages,
                  {id:"m"+(threadMessages.length+1),role:"user",content:payload.message},
                  {id:"m"+(threadMessages.length+2),role:"assistant",content:"Here is the solution: \\(x=2\\)."}];
                threads=[{id,title:"Saved mathematics",createdAt:"2026-11-07T12:00:00Z",updatedAt:"2026-11-07T12:05:00Z"}];
                return {data:{reply:"Here is the solution: \\(x=2\\).",threadId:id,saved:true,runId:"qa-run"}};
              }
            }
            if(name==="mimoExtractList"||name==="mimoBatchList")
              return {data:{jobs:[]}};
            return {data:{}};
          };
        }}};
      }
    """
    js=js.replace("__TEACH__", "true" if role=="teacher" else "false")
    js=js.replace("__ADMIN__", "true" if role=="admin" else "false")
    page.route("**/js/firebase-client.js",lambda route: route.fulfill(
        status=200,content_type="application/javascript",body=js))

server = ThreadingHTTPServer(("127.0.0.1",0),partial(QuietServer,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
url=f"http://127.0.0.1:{server.server_address[1]}/ai.html"
try:
  with sync_playwright() as playwright:
    chrome=next((which(name) for name in ("google-chrome","chromium","chromium-browser") if which(name)),None)
    check(chrome is not None,"No local Chromium executable")
    browser=playwright.chromium.launch(headless=True,executable_path=chrome)
    try:
      for role,width,height in [("teacher",390,844),("teacher",1024,768),("teacher",1440,900),("admin",1440,900)]:
        context=browser.new_context(viewport={"width":width,"height":height},reduced_motion="reduce")
        page=context.new_page()
        errors=[]
        page.on("pageerror",lambda error: errors.append(str(error)))
        mock_session(page,role)
        page.goto(url,wait_until="domcontentloaded",timeout=30000)
        try:
          page.locator("#conversation-head .current-title h1").wait_for(timeout=12000)
        except Exception as exc:
          gate=page.locator("#ai-access-gate").inner_text()
          raise AssertionError(f"Studio not initialized as {role}: gate={gate}, errors={errors[:4]}") from exc
        check(page.locator("#app").is_visible(),f"{role}: original Studio hidden")
        check(page.locator(".studio-heading strong").inner_text()=="AI Studio","Original studio heading missing")
        check(page.locator(".topbar .tools .icon-btn").count()==3,"Original toolbar icons missing")
        check(page.locator(".shell .sidebar").count()==1,"Original conversation sidebar missing")
        check(page.locator(".shell .stage").count()==1,"Original animated stage missing")
        check(page.locator(".shell .inspector").count()==1,"Original job inspector missing")
        check(page.locator(".welcome .prompt-card:visible").count()==2,"Original welcome should show two suggestions")
        page.locator(".welcome .more-prompts summary").click()
        check(page.locator(".welcome .prompt-card:visible").count()==4,"Expanded suggestions missing")
        check(page.locator("#ai-threads .history-row").count()==1,"Saved Neon chat missing from mock list")
        check(page.locator("#theme-trigger").count()==1,"Quizer shared theme control missing")
        check(page.locator("#desktop-nav a[href='ai.html'][aria-current='page']").count()==1,
              "AI Studio header navigation not active")
        check(page.locator("#app").get_attribute("class")=="app","Inspector/sidebar should start closed")
        if width>1060:
          check(page.locator(".inspector").evaluate("(e)=>getComputedStyle(e).display")=="none",
                "Inspector not collapsed on desktop")
        page.locator(".tools [data-act='inspector']").click()
        if width>1060:
          check(page.locator(".inspector").evaluate("(e)=>getComputedStyle(e).display")!="none",
                "Inspector did not reopen")
        else:
          check("show-inspector" in page.locator("#app").get_attribute("class"),"Mobile inspector did not open")
        page.locator(".tools [data-act='inspector']").click()
        if width<=760:
          page.locator("[data-act='sidebar']").first.click()
        page.locator("#ai-new-chat").click()
        check(page.locator("#type-dialog").evaluate("(e)=>e.open"),"Original type chooser missing")
        page.locator("#type-dialog .type-card").filter(has_text="Problem solver").click()
        check("Problem solver" in page.locator("#compose-mode").inner_text(),
              "Problem solver mode not selected")
        page.locator("#ai-prompt").fill("Solve 2x=4")
        page.locator("#ai-send").click()
        page.locator(".message.assistant .msg-body").filter(has_text="Here is the solution").wait_for(timeout=12000)
        check(page.locator(".message.user").count()==1,"User message not displayed")
        copy=page.locator(".message.assistant .ai-copy-msg").last
        check(copy.locator("svg").count()==1 and copy.inner_text().strip()=="",
              "Copy button should be icon-only")
        if width<=760:
          page.locator("[data-act='sidebar']").first.click()
        page.locator("#ai-tab-jobs").click()
        check(page.locator("#ai-job-form").is_visible(),"Production PDF job form missing")
        check(page.locator("#ai-job-budget").count()==1,"Budget control missing")
        if width<=760:
          page.locator("[data-act='sidebar']").first.click()
        page.locator("#ai-tab-chat").click()
        check(page.locator("#ai-chat-panel").is_visible(),"Cannot return to assistant")
        if width<=760:
          page.locator("[data-act='sidebar']").first.click()
          check("show-sidebar" in page.locator("#app").get_attribute("class"),
                "Original mobile history drawer cannot open")
        overflow=page.evaluate("document.documentElement.scrollWidth-window.innerWidth")
        check(overflow<=2,f"Horizontal overflow at {width}px: {overflow}")
        check(not errors,f"Page errors at {width}px: {errors[:5]}")
        context.close()
        print(f"PASS restored AI Studio role={role} width={width}px")
      student_context=browser.new_context(viewport={"width":390,"height":844})
      student=student_context.new_page()
      mock_session(student,"student")
      student.goto(url,wait_until="domcontentloaded",timeout=30000)
      student.locator("#ai-access-gate").wait_for(state="visible",timeout=12000)
      check(student.locator("#app").is_hidden(),"Student gained AI Studio access")
      check("teacher or administrator" in student.locator("#ai-access-gate").inner_text().lower(),
            "Student denial message missing")
      student_context.close()
      print("PASS restored AI Studio student denial")
    finally:
      browser.close()
finally:
  server.shutdown()
  server.server_close()
