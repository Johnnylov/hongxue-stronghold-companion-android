"""Check promotion migration, inline match settings and bans through the map page."""
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
    page.locator('[data-act="map"]').click()
    page.evaluate("""() => {
        delete db.promotionRulesMigrated;
        db.page = 'run';
        db.run.money = 9999; db.run.mode = 'mode_single_funny';
        db.run.counts = {'蓝毒':9,'星极':2};
        db.run.elite = {};
        const b = db.board;
        delete b.source;
        b.tab = 'owned';
        b.pool = Object.entries(db.run.counts).map(([name,count]) => ({name,count,elite:0}));
        b.layouts[b.map] = {placed:{'蓝毒':{cell:{col:3,row:1},facing:0},'蓝毒#9':{cell:{col:4,row:1},facing:1}},
            pins:['蓝毒','蓝毒#9'], checks:[], active:[], total:null};
        persist();
    }""")
    page.reload()
    panel = page.locator("#map-run-panel")
    expect(panel).to_be_visible()
    balance = panel.locator("#run-money")
    assert balance.locator("option").evaluate_all("(els)=>els.map(e=>e.value)") == [""]+[str(i) for i in range(21)]
    expect(balance).to_have_value("20")
    assert page.evaluate("JSON.parse(localStorage.getItem('hongxue.tablet.v1')).run.money") == 20
    assert page.evaluate("Array.from({length:9},(_,i)=>Economy.funding('mode_single_funny',i+1,Workbench.data.economy).amount)") == [6,7,8,9,10,11,11,11,11]
    assert page.evaluate("Array.from({length:14},(_,i)=>Economy.funding('mode_single_1',i+1,Workbench.data.economy).amount)") == [4,5,6,7,8,9,10,11,11,11,11,11,11,11]
    assert page.evaluate("Economy.funding('mode_multi_abyss',12,Workbench.data.economy).amount") == 12
    assert page.evaluate("Economy.funding('mode_single_20',15,Workbench.data.economy).amount") == 11
    assert page.evaluate("Economy.funding('mode_single_20',16,Workbench.data.economy)") is None
    panel.locator(".round-funding summary").click()
    expect(panel.locator(".round-funding div > span")).to_have_count(9)
    balance.select_option("6")
    assert page.evaluate("db.run.money") == 6
    expect(page.locator(".board")).to_be_visible()
    assert page.evaluate("[db.page, db.board.source, db.run.counts, db.run.elite]") == [
        "map", "owned", {"蓝毒": 3, "星极": 1}, {"蓝毒": 3, "星极": 1}]
    assert page.evaluate("db.board.layouts[db.board.map].pins") == ["蓝毒"]
    page.locator('.tile[data-piece="蓝毒"]').click()
    expect(page.locator('[data-map-number="normal"]')).to_have_count(3)
    page.locator('.deploy-roster [data-piece="星极"]').click()
    page.locator('.roster-bar [data-w="map-pool"]').click()
    page.locator('[data-unit="星极"] [data-quick-focus]').click()
    expect(page.locator('[data-quick-number="normal"]')).to_have_count(2)
    page.locator('[data-quick-number="normal"][data-number="1"]').click()
    page.locator('[data-quick-number="buy"]').click()
    expect(page.locator('[data-unit="星极"] small')).to_have_text("0 普通 · 2 精锐")
    page.locator('#dialog [data-act="cancel"]').click()
    assert page.evaluate("db.run.elite['星极']") == 1

    def number(field, value):
        panel.locator(f"#run-{field}").select_option(str(value))

    number("round", 14)
    number("terminal", 3)
    panel.locator("#run-boss").select_option(index=1)
    panel.locator('[name="training-enemy"]').nth(0).check()
    panel.locator('[name="training-enemy"]').nth(1).check()
    page.locator('.map-run-bar [data-w="map-next-round"]').click()
    assert page.evaluate("[db.run.round,db.run.terminal,!!db.run.boss,db.run.enemyTypes.length]") == [15, 3, True, 2]
    expect(page.locator('[data-w="map-next-round"]')).to_have_count(0)
    balance.select_option("0")
    expect(balance).to_have_value("0")
    balance.select_option("")
    assert page.evaluate("db.run.money") is None
    balance.select_option("5")
    panel.get_by_text("按游戏画面修正价格").click()
    number("upgrade", 4)
    assert page.evaluate("[db.run.money,db.run.upgrade]") == [5,4]

    def add_ban(name):
        panel.locator('[data-w="ban-bonds"]').click()
        page.locator("#dialog").get_by_role("checkbox", name=name, exact=True).check()
        page.locator('[data-w="ban-bonds-save"]').click()

    add_ban("聚合")
    assert page.evaluate("['瑰盐','华法琳'].map(Workbench.isBanned)") == [False, False]
    placed = page.evaluate("""async () => {
        const pool=['瑰盐','华法琳','褐果'].map(name=>({name, copy:0, isElite:false}));
        const plan=await Workbench.engine('placement',{map:db.board.map,pool,bannedBonds:db.run.bannedBonds});
        return plan.placed.map(p=>p.key);
    }""")
    assert set(placed) == {"华法琳", "瑰盐"}, placed
    add_ban("灵巧")
    add_ban("莱塔尼亚")
    assert page.evaluate("['华法琳','薇薇安娜'].map(Workbench.isBanned)") == [True, False]
    page.reload()
    expect(panel).to_be_visible()
    expect(panel.locator('[name="training-enemy"]:checked')).to_have_count(2)
    expect(page.locator(".board")).to_be_visible()
    assert page.evaluate("[db.run.round,db.run.money,db.run.upgrade,db.run.elite['蓝毒']]") == [15,5,4,3]
    browser.close()
    server.shutdown()
print("Passed inline match settings, legacy holdings, ordinary promotion, Astesia, bans, solver filtering and restart.")
