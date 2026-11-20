"""Change rounds through all three match controls and verify the displayed advice, including out-of-order responses."""
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
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


assets=Path(__file__).resolve().parents[1]/"app/src/main/assets"
with ThreadingHTTPServer(("127.0.0.1",0),functools.partial(Handler,directory=str(assets))) as server, sync_playwright() as pw:
    threading.Thread(target=server.serve_forever,daemon=True).start()
    browser=pw.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None,
                               args=[f"--explicitly-allowed-ports={server.server_port}"])
    page=browser.new_page(viewport={"width":1400,"height":875},has_touch=True)
    errors=[]
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
    page.locator('nav [data-act="map"]').tap()
    page.evaluate("""()=>{incorporate(GuideModel.offline.find(g=>g.id==='ib'),0,[],"map");}""")
    panel=page.locator("#next-step-panel")
    top=page.locator(".map-run-bar")
    advance=panel.get_by_role("button",name="下一回合",exact=True)
    selector=page.locator("#run-round")
    budget=panel.locator(".round-budget")
    def check_round(n):
        expect(panel.locator("summary").first).to_contain_text(f"第 {n} / 15 回合")
        expect(top).to_contain_text(f"第 {n} 回合")
        expect(selector).to_have_value(str(n))
        expect(panel.locator(".round-action")).to_have_attribute("data-action-round",str(n),timeout=60000)

    top.get_by_role("button",name="对局设置",exact=False).tap()
    check_round(1)
    expect(budget).to_contain_text("还差 1")
    advance.tap()
    check_round(2)
    expect(panel.locator(".round-action")).to_contain_text("可升至 2 本")
    expect(budget).to_contain_text("升后余 1")
    assert page.evaluate("db.run.terminal===1 && db.run.money===null")
    selector.select_option("1")
    page.locator("#run-terminal").select_option("2")
    selector.select_option("5")
    check_round(5)
    expect(budget).to_contain_text("开局未消费估算 8 · 升 3 本需 4 · 升后余 4")
    expect(panel.locator(".round-guide")).to_contain_text("前期")
    top.get_by_role("button",name="下一回合").tap()
    check_round(6)
    expect(budget).to_contain_text("开局未消费估算 9 · 升 3 本需 3 · 升后余 6")
    expect(panel.locator(".round-guide")).to_contain_text("中期")
    assert page.evaluate("db.run.money===null && active().stage===0")
    page.locator("#run-money").select_option("0")
    expect(budget).to_contain_text("实际余额 0")
    expect(panel.locator(".round-action")).to_contain_text("先调站位")
    page.locator("#map-run-panel [data-w=income-open]").tap()
    page.locator('[data-w="income-pick"][data-v="2/normal"]').tap()
    advance.tap()
    check_round(7)
    expect(budget).to_contain_text("开局未消费估算 12（基础 10，道具 +2）")
    page.reload()
    check_round(7)
    expect(budget).to_contain_text("道具 +2")
    # Hold a real old engine result while changing the selector again.
    page.evaluate("""()=>{const engine=Workbench.engine;Workbench.engine=async(a,q,...rest)=>{
      const value=await engine(a,q,...rest);
      if((a==="advice" || a==="autoRoute") && q.round===8) {
        await new Promise(resolve=>{
          window.releaseOld=resolve;
          document.body.dataset.oldResponse="pending";
        });
        document.body.dataset.oldResponse="delivered";
      }
      return value;
    };}""")
    advance.tap()
    expect(page.locator("body")).to_have_attribute("data-old-response","pending",timeout=60000)
    selector.select_option("14")
    check_round(14)
    page.evaluate("window.releaseOld()")
    expect(page.locator("body")).to_have_attribute("data-old-response","delivered")
    check_round(14)
    expect(budget).not_to_contain_text("道具")
    before=page.evaluate("({counts:db.run.counts,board:db.board})")
    advance.tap()
    check_round(15)
    expect(advance).to_have_count(0)
    expect(top.get_by_role("button",name="下一回合")).to_have_count(0)
    expect(panel.locator(".route-stage-head")).to_contain_text("成型目标")
    expect(panel.locator(".level-advice")).to_contain_text("Boss 前核对")
    assert before==page.evaluate("({counts:db.run.counts,board:db.board})")
    # The selected round is editable even after the final turn; automatic stages obey the preference.
    page.evaluate("db.prefs.autoStage=true;persist()")
    selector.select_option("6")
    check_round(6)
    assert page.evaluate("active().stage===1")
    assert not errors,errors
    browser.close()
    server.shutdown()
print("Passed round synchronization, turn budgets, actual zero, deferred income, manual and automatic stages, old-result rejection and round 15.")
