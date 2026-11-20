"""Exercise personalized recommendations, tracking, income and multiplayer bans in the WebView frontend."""
import functools
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        try:
            super().do_GET()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

assets=Path(__file__).resolve().parents[1]/"app/src/main/assets"
with ThreadingHTTPServer(("127.0.0.1",0),functools.partial(Handler,directory=str(assets))) as server, sync_playwright() as pw:
    threading.Thread(target=server.serve_forever,daemon=True).start()
    browser=pw.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    page=browser.new_page(viewport={"width":1400,"height":880})
    errors=[]
    page.on("pageerror", lambda error:errors.append(str(error)))
    page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
    page.locator('[data-act="planner"]').click()
    page.evaluate("""() => {
      Object.assign(db.run,{counts:{'深靛':1,'蓝毒':1,'瑰盐':1},elite:{'蓝毒':1},terminal:3,round:6,money:8,upgrade:4});
      db.planning.locked=['砾'];
      const engine=Workbench.engine;window.requests=[];window.nativeAdvice={};
      Workbench.engine=async(a,q,...rest)=>{ if(a==='auto')requests.push(q);
        const result=await engine(a,q,...rest);
        if(a==='autoRoute')window.nativeAdvice[q.terminal]=result.advice;
        if(a==='advice')window.nativeAdvice[q.terminal]=result;
        return result;};
    }""")
    page.locator('[data-w="plan-tab"][data-v="auto"]').click()
    panel=page.locator(".match-choice")
    expect(panel).to_contain_text("本局首选 · 伊比利亚",timeout=60000)
    expect(panel).to_contain_text("蓝毒（精锐）")
    assert page.evaluate("requests[0].locked.length===0 && requests[0].preferred['蓝毒']>requests[0].preferred['深靛']")
    # Open the automatically ranked route without explicitly selecting a style.
    def verify_original(level):
        card=page.locator(f'#plan-output > .level-advice[data-advice-level="{level}"]')
        expect(card).to_be_visible(timeout=60000)
        expected=page.evaluate("(n)=>window.nativeAdvice[n].flatMap(s=>s.levels).find(l=>l.terminalLevel===n)",level)
        assert card.locator("h4").inner_text()==expected["title"]
        assert card.locator(".advice-purchases").inner_text()==expected["purchaseText"]
        expect(card).to_contain_text(expected["upgradeText"])
        expect(card).to_contain_text(expected["economyText"])
        for pick in expected["reserve"]:
            expect(card.locator(".advice-reserve")).to_contain_text(pick["name"])
        return expected
    verify_original(3)
    page.evaluate("db.run.terminal=4;render()")
    at_four=verify_original(4)
    expect(page.locator('#route-result [data-advice-level="5"]')).to_have_count(1)
    assert at_four["purchaseText"] and at_four["upgradeText"]
    page.evaluate("db.run.terminal=3;render()")
    verify_original(3)
    mode_buttons=page.get_by_role("group",name="多人难度").get_by_role("button")
    assert mode_buttons.count()==4
    assert page.evaluate("Workbench.isBanned('砾')") is True
    mode_buttons.get_by_text("险境模拟").click()
    expect(panel).to_contain_text("伊比利亚",timeout=60000)
    assert page.evaluate("Workbench.isBanned('砾')") is False
    page.locator('[data-w="plan-run-settings"]').click()
    def set_money(n):
        page.get_by_role("group",name="本局资金").get_by_role("button",name=str(n),exact=True).click()
    set_money(0)
    expect(panel).to_contain_text("本轮先调站位")
    calls=page.evaluate("requests.length")
    set_money(10)
    expect(panel).to_contain_text("当前余额 10",timeout=10000)
    assert page.evaluate("requests.length")==calls
    def receipt(code,n=None):
        page.locator('#desk [data-w="income-open"]').click()
        page.locator(f'[data-w="income-pick"][data-v="{code}"]').click()
        if n is not None: page.locator(f'[data-w="income-amount"][data-v="{code}/{n}"]').click()
    receipt("0/elite")
    assert page.evaluate("db.run.money")==12
    receipt("1/normal")
    receipt("2/elite")
    receipt("3/normal", 3)
    assert page.evaluate("[db.run.money,ItemIncome.total(db.run)]")==[15,5]
    set_money(7)
    page.locator('#desk [data-w="income-open"]').click()
    page.locator('[data-w="income-undo"]').first.click()
    assert page.evaluate("db.run.money")==7
    page.evaluate("db.run.round++;Economy.changed(db.run,'round');persist();render()")
    expect(panel).to_contain_text("开局未消费 15",timeout=15000)
    assert page.evaluate("ItemIncome.total(db.run)")==5
    page.reload()
    expect(panel).to_contain_text("开局未消费 15",timeout=60000)
    page.evaluate("db.run.round++;Economy.changed(db.run,'round');persist();render()")
    assert page.evaluate("ItemIncome.total(db.run)")==1
    expect(panel).to_contain_text("伊比利亚")
    first=page.locator(".planrow").first
    first.locator('[data-w="plan-route"]').first.click()
    page.locator('[data-w="plan-save"]').click(timeout=60000)
    original=page.evaluate("active().id")
    assert page.evaluate("db.teams.length")==1
    expect(page.locator("#basket .buytitle")).to_have_text("伊比利亚 · 先小后大")
    assert page.locator("#basket .run-preview").filter(has_text="伊比利亚 · 先小后大").count()==0
    page.evaluate("active().title='我的伊比利亚';active().owned.push(JSON.stringify(['eq:保留勾选',1]));persist()")
    page.locator('[data-act="planner"]').click()
    page.locator('.planrow').first.locator('[data-w="plan-route"]').first.click()
    page.locator('[data-w="plan-save"]').click(timeout=60000)
    assert page.evaluate("[db.teams.length,active().id,active().title,active().owned.includes(JSON.stringify(['eq:保留勾选',1]))]")==[1,original,"我的伊比利亚",True]
    page.evaluate("""() => {delete db.round15Migrated;db.run.round=16;db.run.levelSince=16;
       active().stages[0].end=16;persist();}""")
    page.reload()
    page.locator("#desk h2").first.wait_for()
    assert page.evaluate("[db.run.round,db.run.levelSince,active().stages[0].end,active().id]")==[15,15,15,original]
    assert not errors, errors
    browser.close()
    server.shutdown()
print("Passed live multiplayer ranking, budget, static bans, immediate and deferred item income, idempotent tracking and round-15 migration.")
