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
    panel.get_by_text("开始接收",exact=True).click()
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
    panel.get_by_text("断开 iPhone").click()
    receive(frame)
    receive(frame)
    assert page.evaluate("db.run.money") == 0
    browser.close()
    server.shutdown()
print("Passed mirror connection, two-frame HUD, zero funds, confirmed purchases, folding and disconnect.")
