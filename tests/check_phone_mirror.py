"""Exercise the same frame event and shop button as the Android receiver."""
import functools
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

assets = Path(__file__).resolve().parents[1] / "app/src/main/assets"

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

with ThreadingHTTPServer(("127.0.0.1",0), functools.partial(Handler,directory=str(assets))) as server, sync_playwright() as pw:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    browser = pw.chromium.launch(executable_path=os.environ.get("CHROME_PATH"),
                                 args=[f"--explicitly-allowed-ports={server.server_port}"])
    page = browser.new_page()
    page.add_init_script("window.Tablet={phoneMirror:start=>{if(!start)PhoneMirror.event('off','已停止接收')}}")
    page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
    page.locator("nav [data-act=map]").click()
    page.locator("#phone-connect").click()
    panel = page.locator("#phone-panel")
    panel.get_by_text("接收 iPhone 投屏",exact=True).click()
    page.evaluate("PhoneMirror.event('name','Matou-Test')")
    expect(panel).to_contain_text("Matou-Test")
    frame={"round":5,"terminal":2,"money":9,"upgrade":3,"shop":["蓝毒","蓝毒","不是干员"]}
    def receive(data):
        page.evaluate("f=>PhoneMirror.event('frame',f)",data)
    receive(frame)
    assert page.evaluate("db.run.round") == 1
    receive(frame)
    assert page.evaluate("[db.run.round,db.run.terminal,db.run.money,db.run.upgrade]") == [5,2,9,3]
    shop_button=panel.get_by_role("button",name="拿了蓝毒 ＋1")
    expect(shop_button).to_have_count(1)
    assert not page.evaluate("db.run.counts['蓝毒']")
    shop_button.click()
    assert page.evaluate("db.run.counts['蓝毒']") == 1
    page.locator("nav [data-act=library]").click()
    panel.get_by_text("收起",exact=True).click()
    receive({**frame,"money":0})
    receive({**frame,"money":0})
    assert page.evaluate("db.run.money") == 0
    panel.locator("[data-m=expand]").click()
    expect(panel).to_contain_text("余额 0")
    receive({})
    expect(shop_button).to_have_count(0)
    match={"info":{"enemies":["敌方领袖","盐风主教昆图斯","特训敌人·复苏","特训敌人·隐匿","特训敌人·持续"],
                   "icons":[{"text":"炎","banned":False},{"text":"谢拉格","banned":True}],
                   "modes":["绝境模拟"]}}
    receive(match)
    assert page.evaluate("db.run.boss") != "盐风主教昆图斯"
    receive(match)
    expect(panel).to_contain_text("盐风主教昆图斯")
    assert page.evaluate("[db.run.boss,db.run.mode,db.run.enemyTypes.sort(),db.run.bannedBonds]")==[
        "盐风主教昆图斯","mode_multi_hard",["DOT","INVISIBLE","REBORN"],["谢拉格"]]
    assert page.evaluate("db.run.counts['蓝毒']") == 1
    partial={"info":{"enemies":["特训敌人·复苏"],"icons":[],"modes":[]}}
    receive(partial)
    receive(partial)
    assert page.evaluate("db.run.enemyTypes.length===3 && db.run.bannedBonds.includes('谢拉格')")
    page.evaluate("PhoneMirror.event('packet',true)")
    page.evaluate("PhoneMirror.event('reset','1')")
    expect(panel).to_contain_text("连接已中断")
    page.evaluate("PhoneMirror.event('stream','true')")
    receive(frame)
    receive(frame)
    card={**frame,"cells":{"1":[["拉普兰德"]],"2":[["烈夏"]]},"layout":"1920x1080/3","empty":[]}
    bought={**card,"cells":{"2":[["烈夏"]]},"empty":[1],"money":8}
    receive(card);receive(card)
    receive(bought)
    assert not page.evaluate("db.run.counts['拉普兰德']")
    receive(bought);receive(bought)
    assert page.evaluate("db.run.counts['拉普兰德']")==1
    receive(card);receive(card)
    refresh={**bought,"cells":{"1":[["砾"]],"2":[["烈夏"]]},"empty":[]}
    receive(refresh);receive(refresh)
    assert page.evaluate("db.run.counts['拉普兰德']")==1
    card["shop"]=["拉普兰德","烈夏"]
    receive(card);receive(card)
    panel.get_by_role("button",name="拿了拉普兰德 ＋1").click()
    receive(bought);receive(bought)
    assert page.evaluate("db.run.counts['拉普兰德']")==2
    panel.get_by_text("断开 iPhone").click()
    receive(frame)
    receive(frame)
    assert page.evaluate("db.run.money") == 8
    # Launching the overlay from a guide or a non-board map tab must still show the actual match board.
    page.set_viewport_size({"width":620,"height":367})
    page.evaluate("""()=>{db.board.tab='shop';db.board.pool=QuickRoster.owned();db.board.source='owned';move('library');
                    PhoneMirror.event('local','测试');PhoneMirror.overlayView('board');}""")
    board=page.locator(".board-shell")
    expect(board).to_be_visible()
    expect(board.locator(".tile-name").first).to_be_visible(timeout=45000)
    expect(page.locator("#phone-panel")).to_be_hidden()
    expect(page.locator("#basket")).to_be_hidden()
    assert board.evaluate("b=>b.getBoundingClientRect().bottom<=innerHeight && b.getBoundingClientRect().right<=innerWidth")
    page.locator('[data-w="map-mode-set"][data-v="2"]').click()
    expect(page.locator('[data-w="map-mode-set"][data-v="2"]')).to_have_attribute("aria-pressed","true")
    page.locator('[data-w="map-solve"]').click()
    expect(board.locator(".tile-name").first).to_be_visible(timeout=45000)
    page.evaluate("PhoneMirror.overlayView('guide')")
    assert page.evaluate("db.page==='library' && db.board.tab==='shop'")
    page.evaluate("PhoneMirror.overlayView('board');PhoneMirror.overlayView('advice')")
    expect(panel).to_be_visible()
    page.evaluate("PhoneMirror.event('off','结束')")
    assert page.evaluate("!document.body.classList.contains('overlay-board') && db.page==='library'")
    browser.close()
    server.shutdown()
print("Passed mirror connection, two-frame HUD, zero funds, confirmed purchases, folding and disconnect.")
