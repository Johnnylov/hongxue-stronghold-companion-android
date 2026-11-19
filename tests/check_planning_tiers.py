"""Verify recruit levels in target candidates, auto candidates and expanded stages."""
import functools
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


assets = Path(__file__).resolve().parents[1] / "app/src/main/assets"
with ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(assets))) as server, sync_playwright() as pw:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    browser = pw.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
    page.locator('[data-act="planner"]').click()
    page.evaluate("""() => {
        db.run.terminal=3;
        const custom=Workbench.data.custom_operators.operators[0].name;
        db.prefs.custom=[custom];
        db.planning.goals={'莱塔尼亚':1};
        const operators=['深靛','折光','黑键',custom].map(name=>({name}));
        const final={operators,people:8,transforms:0,goals:[{name:'莱塔尼亚',level:1}],hasPith:true,strategy:1};
        const auto={final,mainCovenant:'莱塔尼亚',recommendedStyle:0};
        const stage={definition:{name:'开局',terminalLevel:3},isFinal:false,summary:{warnings:[]},
          covenants:[],operators:operators.map(o=>({...o,viaTriple:o.name==='黑键',role:1}))};
        const route={stages:[stage]};
        const raw=Workbench.engine;
        Workbench.engine=async (action,...args) => {
          if (action==='auto') return {candidates:[auto]};
          if (action==='target') return {plans:[final]};
          if (action==='route') return route;
          if (action==='autoRoute') return {route,mainCovenant:'莱塔尼亚',advice:[]};
          return raw(action,...args);
        };
        Planning.render();
    }""")
    for mode in ["target", "auto"]:
        page.locator(f'[data-w="plan-tab"][data-v="{mode}"]').click()
        page.locator('[data-w="plan-solve"]').click()
        card = page.locator(".planrow > .plan-members")

        def check_member(container, name, label, status):
            b = container.locator(f'[data-key="op:{name}"]')
            expect(b.locator(".recruit-level")).to_have_text(label)
            expect(b).to_contain_text(status)

        check_member(card, "深靛", "1 本起", "本级可刷")
        check_member(card, "黑键", "4 本起", "本级未开放")
        check_member(card, "盟约·辅助干员", "优等生赠送", "第 1 回合获得")
        check_member(card, "“暴躁铁皮”", "暴躁铁皮赠送", "第 1 回合获得")
        page.locator('[data-w="plan-route"]').first.click()
        stage = page.locator("#route-result details").first
        stage.locator("summary").click()
        expect(stage.locator("summary")).to_contain_text("3 本")
        check_member(stage, "黑键", "4 本起", "3 本三连获取")
        stage.locator('[data-key="op:折光"]').click()
        expect(page.locator("#dialog")).to_contain_text("折光")
        page.locator("#dialog .icon-close").click()

    flags = page.evaluate("""() => {
        const n=db.prefs.custom[0];
        const custom=[4,5,6].map(t=>Planning.recruitment(n,t).canRoll);
        db.prefs.custom=[];
        const disabled=Planning.recruitment(n,6).canRoll;
        return {custom, disabled, unknown:Planning.recruitment('未知名字',2).canRoll,
          regular:Workbench.data.operators.operators.filter(o=>!o.requiredStrategyId).every(o=>
            [1,2,3,4,5,6].every(t=>Planning.recruitment(o.name,t).canRoll===(o.tier<=t)))};
    }""")
    assert flags == {"custom": [False, None, True], "disabled": False, "unknown": None, "regular": True}, flags
    browser.close()
    server.shutdown()
print("Passed target/auto cards, expanded routes, triple rewards, strategy grants, all ordinary tiers and both custom slots.")
