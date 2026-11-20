"""Exercise manual and desktop-route guidance on the match map."""
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


assets = Path(__file__).resolve().parents[1] / "app/src/main/assets"
with ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(assets))) as server, sync_playwright() as pw:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    browser = pw.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    page = browser.new_page()
    page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
    page.locator('[data-act="planner"]').click()
    guide = page.locator(".plan-progression")
    guide.locator("summary").click()
    expect(guide.locator("li")).to_have_count(6)
    expect(guide.locator("small")).to_have_count(0)
    # Compare the visible card against the actual C# route, including all per-operator marks.
    page.evaluate("""()=>{const engine=Workbench.engine;Workbench.engine=async(a,...args)=>{
      const result=await engine(a,...args); if(a==='autoRoute') window.testRoute=result; return result;};}""")
    page.locator('[data-act="map"]').click()
    panel = page.locator("#map-next-step")
    expect(panel).to_contain_text("当前 1 本",timeout=60000)
    expect(panel.locator(".route-stage-card")).to_contain_text("开局")
    expect(panel).to_contain_text("升至 2 本后")
    expect(panel.locator(".advice-purchases")).to_contain_text("未记录获取")
    expect(panel.locator(".route-stage-card .route-op")).to_have_count(6)
    assert page.evaluate("""()=>{
      const data=window.testRoute, stage=data.route.stages[0], level=data.advice[0].levels[0], panel=document.querySelector("#map-next-step");
      const ops=[...panel.querySelectorAll(".route-op")], purchases=panel.querySelector(".advice-purchases");
      return ops.length===stage.operators.length && ops.every((el,i)=>{
        const o=stage.operators[i];
        return el.dataset.key==="op:"+o.name && !!el.querySelector(".new")===o.isNew && !!el.querySelector(".triple")===o.viaTriple;
      }) && purchases.innerText===level.purchaseText && panel.innerText.includes(level.upgradeText)
        && [...panel.querySelectorAll(".advice-reserve button")].map(el=>el.dataset.key).join()===level.reserve.map(p=>"op:"+p.name).join();
    }""")
    panel.locator('[data-w="owned"]').click()
    page.locator('[data-unit="深靛"] [data-quick-focus]').click()
    page.locator("[data-quick-save]").click()
    expect(panel).to_contain_text("伊比利亚")
    panel.locator('[data-act="follow-run-lineup"]').click()
    assert page.evaluate('db.page === "map" && !!active()')
    page.evaluate("""() => {
        const team=active(); team.stages=[{label:'开局',entries:[{key:'op:深靛',elite:true},{key:'op:蓝毒'}]}];
        team.stage=0; Object.assign(db.run,{mode:"mode_multi_abyss",terminal:2,round:3,upgrade:5,money:1,counts:{'深靛':2},elite:{}});
        render();
    }""")
    expect(panel).to_contain_text("深靛 ×1")
    expect(panel).to_contain_text("再取 1 名可合成")
    expect(panel).to_contain_text("还差 4 资金")
    page.evaluate("db.run.banned=['深靛']; db.run.counts['砾']=1; render()")
    expect(panel.locator(".next-shopping")).to_contain_text("蓝毒")
    page.evaluate("db.run.banned=[]; db.run.terminal=1; db.run.money=0; db.run.counts={'深靛':1,'砾':1}; db.run.elite={'深靛':1}; render()")
    expect(panel).to_contain_text("当前终端刷不到")
    page.evaluate("db.run.money=7; db.run.upgrade=4; render()")
    expect(panel).to_contain_text("如果当前站位能守，可先升至 2 本，支付 4 后本轮余 3")
    page.evaluate("db.run.money=null; render()")
    expect(panel).to_contain_text("先点选当前余额")
    page.evaluate("db.run.upgrade=0; render()")
    expect(panel).to_contain_text("当前升级免费，可先把终端升至 2 本")
    page.evaluate("""() => {
        db.run.terminal=2; db.run.money=5; db.run.counts={'深靛':1,'蓝毒':1};db.run.elite={'深靛':1};render();
    }""")
    expect(panel.locator(".next-shopping")).to_contain_text("本阶段干员已齐")
    expect(panel.locator("[data-next-route]")).to_contain_text("优先购买",timeout=60000)
    expect(panel.locator("[data-next-route]")).to_contain_text("升本条件")

    # Generate and save a real desktop route. Advice must only re-evaluate this route, without new searches.
    page.evaluate("""async () => {
        const req={...Workbench.request(),people:8,transforms:0};
        const result=await Workbench.engine('auto',req), candidate=result.candidates[0];
        const response=await Workbench.engine('autoRoute',{...req,index:0,style:0});
        const archive={candidate,style:0,savedRoute:response.route};
        const stages=response.route.stages.map(s=>({label:s.definition.name,isFinal:s.isFinal,
            entries:s.operators.map(o=>({key:'op:'+o.name}))}));
        const t=active(); Object.assign(t,{autoPlan:archive,stages,stage:0});
        Object.assign(db.run,{terminal:4,round:8,upgrade:8,money:2});
        const original=Workbench.engine; window.nextActions=[];
        Workbench.engine=(action,...args)=>{nextActions.push(action);return original(action,...args)};
        render();
    }""")
    expect(panel).to_contain_text("资金 2，升级费 8，还差 6", timeout=30000)
    assert page.evaluate("nextActions.filter(a=>['auto','autoRoute','target','route'].includes(a))") == []
    page.evaluate("active().stages[0].entries.reverse();active().stages[0].entries[0].elite=true;db.run.money=10; db.run.terminal=5; render()")
    expect(panel).to_contain_text("升级后剩 2")
    expect(panel).to_contain_text("五本")
    page.evaluate("db.run.terminal=6; db.run.upgrade=null; render()")
    expect(panel).to_contain_text("终端已满级")
    page.evaluate("active().stage=Teams.finalIndex(active()); render()")
    expect(panel).to_contain_text("打 Boss 前核对")
    page.evaluate("""() => {
        const t=active(); db.run.banned=[t.autoPlan.savedRoute.stages[0].operators[0].name]; render();
    }""")
    expect(panel).to_contain_text("先修补这套自动路线")
    expect(panel.locator('[data-w="team-review"]')).to_have_count(1)
    page.evaluate("""() => {
        db.run.banned=[]; const t=active(); t.stage=0;
        t.stages[0].entries=[{key:'op:星极',elite:true}];
        Object.assign(db.run,{counts:{'星极':1},elite:{}});render();
    }""")
    expect(panel.locator(".route-source")).to_contain_text("本局推荐",timeout=60000)
    expect(panel).to_contain_text("优先购买")
    page.evaluate("""() => {
        const grant=Object.values(Workbench.rawOps).find(op=>op.requiredStrategyId).name;
        const custom=Object.values(Workbench.rawOps).find(op=>op.isCustom).name;
        const names=['折光','蓝毒','泡泡','莎草','雪猎','砾','泡泡',grant,custom];
        active().stages=[{label:'试验',entries:names.map(n=>({key:'op:'+n}))}];
        active().stage=0; db.prefs.custom=[custom]; db.run.counts={'折光':1}; db.run.elite={}; db.run.banned=['蓝毒'];
        move('planner');
    }""")
    guide.locator("summary").click()
    expect(guide.locator('[data-progression-level="2"] small')).to_have_text("本级起可找 · 泡泡、莎草、雪猎")
    expect(guide.locator("small")).to_have_count(1)
    browser.close()
    server.shutdown()
print("Passed no-pool, shopping, promotion, terminal/round, budget, bans and live Windows-route advice.")
