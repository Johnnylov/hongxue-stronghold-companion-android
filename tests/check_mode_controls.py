"""Touch the deployed mode controls through the map UI, including an empty local match."""
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


assets = Path(__file__).resolve().parents[1] / "app/src/main/assets"
with ThreadingHTTPServer(("127.0.0.1",0),functools.partial(Handler,directory=str(assets))) as server, sync_playwright() as pw:
    threading.Thread(target=server.serve_forever,daemon=True).start()
    browser=pw.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    page=browser.new_page(viewport={"width":1280,"height":800},has_touch=True)
    page.set_default_timeout(10000)
    errors=[]
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
    page.locator('[data-act="map"]').tap()
    solve=page.locator('[data-w="map-solve"]')
    status=page.locator("#map-mode-status")
    def mode(n):
        return page.locator(f'[data-w="map-mode-set"][data-v="{n}"]')
    def settled(n,count):
        expect(mode(n)).to_have_attribute("aria-pressed","true")
        expect(status).to_contain_text(["战斗","平衡","叠层"][n]+"推荐已完成",timeout=45000)
        expect(page.locator(".tile.occupied")).to_have_count(count)
        assert page.evaluate("JSON.parse(db.board.layouts[db.board.map].recommended.key)[2].mode")==n

    mode(2).tap()
    expect(status).to_contain_text("叠层模式")
    solve.tap()
    expect(page.locator(".quick-editor")).to_be_visible()
    page.locator('.quick-card[data-unit="深靛"] [data-quick-toggle]').tap()
    page.locator('[data-quick-save]').tap()
    settled(2,1)
    # A zero-ownership player can use the tracked stage directly and retain their real inventory.
    page.evaluate("""()=>{db.run.counts={};db.run.elite={};db.board.pool=[];db.board.layouts={};db.board.mode=1;
       db.board.map="desert_crates";incorporate(GuideModel.offline.find(t=>t.id==="ib"),0,[],"map");}""")
    expect(solve).to_have_text("用当前清单阵容试摆")
    solve.tap()
    settled(1,3)
    assert page.evaluate("db.board.source==='trial' && !Object.keys(db.run.counts).length")
    mode(0).tap()
    settled(0,3)
    expect(status).to_contain_text("人选、位置和朝向与上次摆位相同")
    mode(2).tap()
    settled(2,3)
    page.reload()
    expect(mode(2)).to_have_attribute("aria-pressed","true")
    # A pending selection persisted before Android stopped the process must be solved on reopen.
    page.evaluate("db.board.mode=1;db.board.layouts[db.board.map].pendingMode=1;persist()")
    page.reload()
    settled(1,3)
    # The same controls must yield a genuine change for a more varied formation.
    page.evaluate("""()=>{db.run.mode="mode_multi_abyss";db.board.map="desert_cactus";
      db.board.pool=["砾","初雪","伊桑","华法琳","灵知","耶拉","角峰","锏"].map(name=>({name,count:1,elite:0}));
      db.board.layouts={};Maps.render()}""")
    mode(0).tap()
    settled(0,8)
    first=page.locator(".tile.occupied").evaluate_all("(els)=>els.map(el=>[el.dataset.v,el.dataset.piece,el.querySelector('b').textContent])")
    mode(2).tap()
    settled(2,8)
    second=page.locator(".tile.occupied").evaluate_all("(els)=>els.map(el=>[el.dataset.v,el.dataset.piece,el.querySelector('b').textContent])")
    assert first!=second
    # A failing worker exposes retry on the board itself.
    page.evaluate("""()=>{const orig=Workbench.engine;Workbench.engine=(a,...args)=>{
      if(a==='placement'){Workbench.engine=orig; return Promise.reject(Error('测试重试'));}
      return orig(a,...args);};}""")
    mode(1).tap()
    expect(status).to_contain_text("测试重试")
    solve.tap()
    settled(1,8)
    # The visible route itself can be tried even when the game roster is empty.
    trial=page.locator('[data-w="map-trial-stage"]')
    names=trial.evaluate("e=>JSON.parse(e.dataset.v)")
    trial.tap()
    expect(status).to_contain_text("平衡推荐已完成",timeout=45000)
    assert page.evaluate("db.board.pool.map(p=>p.name)")==names
    assert page.evaluate("Object.keys(db.run.counts).length")==0
    assert not errors,errors
    browser.close()
    server.shutdown()
print("Passed empty-board selection, all three modes, same and different layouts, trial isolation, interrupted switches and retry.")
