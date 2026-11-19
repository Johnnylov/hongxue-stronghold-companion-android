"""Check recommendations through the same checklist, owned-pool and map controls as the APK."""
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
    page = browser.new_page(viewport={"width": 1400, "height": 876})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
    panel = page.locator("#basket")
    rec = panel.locator('[data-tab="recommend"]').first
    rec.click()
    expect(panel).to_contain_text("还没有可用的持有干员")
    panel.locator('[data-w="owned"]').click()
    for name in ["深靛", "瑰盐"]:
        page.locator(f'#quick-grid [data-unit="{name}"] [data-quick-focus]').click()
    page.locator('[data-quick-save]').click()
    first = panel.locator(".run-guide").first
    expect(first).to_contain_text("伊比利亚 · 聚合起步")
    expect(first).to_contain_text("已有 2/3")
    expect(first).to_contain_text("蓝毒")
    first.get_by_text("跟踪到购买清单").click()
    expect(panel.locator("input[data-buy]:checked")).to_have_count(2)
    panel.get_by_label("蓝毒 已购买").check()
    expect(panel.locator(".run-preview")).to_contain_text("3/3")
    rec.click()
    expect(first).to_contain_text("干员已齐")
    first.get_by_text("跟踪到购买清单").click()
    assert page.evaluate("db.teams.length") == 1
    rec.click()

    page.evaluate("""() => {
        db.imports.unshift({id:'double', title:'双深靛', stages:[
            {label:'过渡',start:1,end:4,entries:[{key:'op:海沫'}]},
            {label:'成型',start:5,end:16,isFinal:true,entries:[
                {key:'op:深靛',elite:true},{key:'op:深靛',elite:true},{key:'eq:聚合急救箱'}]}]});
        db.run.counts={'深靛':1}; db.run.elite={}; db.run.round=6; render();
    }""")
    duplicate = panel.locator(".run-guide").filter(has_text="双深靛")
    expect(duplicate).to_contain_text("已有 1/2")
    expect(duplicate).to_contain_text("深靛 ×2")
    duplicate.get_by_text("跟踪到购买清单").click()
    assert page.evaluate("active().stage") == 1
    expect(panel.locator("input[data-buy]:checked")).to_have_count(1)
    rec.click()
    page.evaluate("db.run.bannedBonds=['伊比利亚']; render()")
    expect(panel).to_contain_text("还没有可用的持有干员")

    page.evaluate("db.run.bannedBonds=[]; db.run.counts={'极光':1}; render()")
    computed = panel.locator("[data-run-target] .run-guide")
    expect(computed).to_contain_text("持有池自动规划", timeout=60000)
    expect(computed).to_contain_text("极光")
    computed.get_by_text("跟踪到购买清单").click()
    expect(panel.get_by_label("极光 已购买")).to_be_checked()
    page.reload()
    expect(panel.get_by_label("极光 已购买")).to_be_checked()

    pool = ["砾", "初雪", "伊桑", "华法琳", "灵知", "耶拉", "角峰", "锏", "深靛"]
    page.evaluate("names => {db.run.counts=Object.fromEntries(names.map(n=>[n,1])); persist()}", pool)
    page.locator('[data-act="map"]').click()
    page.locator('[data-w="map-tab"][data-v="recommend"]').click()
    members = page.locator("#desk .run-members > span")
    expect(members).to_have_count(8, timeout=60000)
    assert set(members.all_text_contents()) <= set(pool)
    page.locator('[data-w="map-tab"][data-v="board"]').click()
    page.locator('[data-w="map-owned"]').click()
    page.locator(".tile[data-piece]").first.wait_for()
    page.locator('[data-w="map-cancel"]').wait_for(state="hidden")
    page.evaluate("""() => {
        const run=Workbench.engine; window.placements=0;
        Workbench.engine=(action,...a)=>{if(action==='placement') placements++;return run(action,...a)};
    }""")
    original = page.evaluate("JSON.stringify(db.board.layouts[db.board.map].placed)")
    tiles = page.locator(".tile[data-piece]")
    keys = tiles.evaluate_all("(ts)=>ts.map(t=>t.dataset.piece)")
    assert tiles.locator(".tile-name").all_text_contents() == keys
    selected = keys[0]
    tiles.first.click()
    page.locator('[data-map-number="normal"][data-number="2"]').click()
    page.locator('[data-map-number="buy"]').click()
    page.locator('[data-map-number="normal"][data-number="1"]').click()
    assert page.evaluate("n=>[db.run.counts[n],db.run.elite[n]]", selected) == [2,1]
    assert page.evaluate("JSON.stringify(db.board.layouts[db.board.map].placed)") == original
    tiles.nth(1).click()
    expect(page.locator(".selected-piece > strong")).to_contain_text(keys[1])
    assert page.evaluate("placements") == 0
    page.locator('[data-w="map-finish-edit"]').click()
    page.locator('[data-w="map-cancel"]').wait_for(state="hidden")
    assert page.evaluate("placements") == 1

    # Both membership and copy counts can be changed before the same commit.
    page.locator('.roster-bar [data-w="map-pool"]').click()
    page.locator('#quick-grid [data-unit="极光"] [data-quick-focus]').click()
    page.locator('[data-quick-number="normal"][data-number="2"]').click()
    page.locator('[data-quick-number="buy"]').click()
    page.locator('#quick-grid [data-unit="砾"] [data-quick-toggle]').click()
    assert page.evaluate("placements") == 1
    page.locator("[data-quick-save]").click()
    page.locator('[data-w="map-cancel"]').wait_for(state="hidden")
    assert page.evaluate("[db.run.counts['极光'],db.run.elite['极光'],db.run.counts['砾']||0,placements]") == [1,1,0,2]
    before_trial = page.evaluate("JSON.stringify(db.run)")
    page.locator('[data-w="map-team"]').click()
    page.locator('[data-w="map-cancel"]').wait_for(state="hidden")
    page.locator(".tile[data-piece]").first.click()
    page.locator('[data-map-number="normal"][data-number="2"]').click()
    assert page.evaluate("db.board.source") == "trial"
    assert page.evaluate("JSON.stringify(db.run)") == before_trial
    page.locator('[data-w="map-owned"]').click()
    page.locator('[data-w="map-cancel"]').wait_for(state="hidden")
    assert page.evaluate("db.board.pool.find(o=>o.name==='极光').elite") == 1
    panel.locator('[data-tab="recommend"]').first.click()
    panel.locator(".run-guide").first.get_by_text("跟踪到购买清单").click()
    expect(page.locator("#desk .board")).to_be_visible()
    assert page.evaluate("[db.page, db.prefs.basketTab]") == ["map", "shop"]
    assert page.title() == "马头·卫戍手册"
    assert not errors, errors
    browser.close()
    server.shutdown()
print("Passed checklist recommendations, original planner, 8-of-9 selection, on-board names and edits, single batch solve and isolated guide trials.")
