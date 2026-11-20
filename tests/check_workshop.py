"""Verify stage editing and map recognition at tablet and narrow widths."""
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
    page = browser.new_page(viewport={"width": 1400, "height": 880})
    page.set_default_timeout(10000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(f"http://127.0.0.1:{server.server_port}/index.html")

    def action(name, value=None):
        end = f'[data-v="{value}"]' if value is not None else ""
        return page.locator(f'[data-w="{name}"]{end}')

    page.locator('[data-act="map"]').click()
    board = page.evaluate("JSON.stringify(db.board)")
    photo = page.locator(".map-photo img")
    expect(photo).to_be_visible()
    assert photo.bounding_box()["width"] >= 230
    photo.click()
    assert page.locator(".map-expanded").bounding_box()["width"] > 600
    page.locator("dialog[open]").get_by_text("看图选地图").click()
    choices = page.locator(".map-gallery button")
    expect(choices).to_have_count(10)
    page.locator(".map-gallery img").evaluate_all("(imgs)=>Promise.all(imgs.map(img=>img.decode()))")
    assert choices.evaluate_all("(els)=>els.every(e=>e.querySelector('img').complete && e.querySelector('img').naturalWidth>=300)")
    choices.filter(has_text="双仙人掌").click()
    expect(photo).to_have_attribute("alt", "沙漠（双仙人掌）全图")
    board = page.evaluate("JSON.stringify(db.board)")
    page.locator('[data-act="planner"]').click()
    action("plan-tab","workshop").click()
    library=page.locator(".ws-library")
    assert action("workshop-add","op:砾").count()==0
    action("workshop-tier","1").click()
    assert library.locator(".ws-library-grid button").count()>2
    action("workshop-add","op:深靛").click()
    expect(page.locator(".ws-inspector")).to_contain_text("深靛")
    action("workshop-card-copy","0").click()
    assert page.locator(".ws-piece").count()==2
    expect(action("reference","伊比利亚")).to_contain_text("1 / 3")
    action("workshop-add","op:深靛").click()
    expect(page.locator(".ws-piece")).to_have_count(1)
    expect(page.locator(".ws-piece")).to_contain_text("精锐")
    action("workshop-card-elite","0").click()
    expect(page.locator(".ws-piece")).to_contain_text("普通")
    action("workshop-card-elite","0").click()
    action("workshop-card-copy","0").click()
    action("workshop-card-remove","1").click()
    expect(page.locator(".ws-piece")).to_have_count(1)
    action("workshop-gear").click()
    action("workshop-add","eq:维式重锤").click()
    expect(page.locator(".ws-piece")).to_contain_text("维式重锤")
    action("workshop-card-field","0").click()
    assert action("reference","伊比利亚").count()==0
    action("workshop-card-field","0").click()
    action("workshop-kind","op").click()
    action("workshop-tier","0").click()
    for name in ["蓝毒","瑰盐"]:
        action("workshop-add","op:"+name).click()
    expect(action("reference","伊比利亚")).to_contain_text("已激活")
    action("workshop-position").click()
    expect(page.locator(".board .occupied")).to_have_count(3,timeout=45000)
    expect(action("map-owned")).to_have_count(0)
    page.locator(".map-photo").click()
    expect(page.locator(".map-expanded")).to_be_visible()
    page.locator("dialog[open] .icon-close").click()
    action("map-workshop-back").click()
    assert page.evaluate("JSON.stringify(db.board)")==board
    page.locator("#ws-stage").click()
    page.locator('#ws-stage-options [value="1"]').click()
    expect(page.locator(".ws-piece")).to_have_count(0)
    page.locator("#ws-stage").click()
    page.locator('#ws-stage-options [value="0"]').click()
    expect(page.locator(".ws-piece")).to_have_count(3)
    library.locator('[data-w="ban-bonds"]').click()
    page.locator('dialog[open] input[value="伊比利亚"]').check()
    action("ban-bonds-save").click()
    expect(action("workshop-add","op:深靛")).to_have_count(0)
    expect(page.locator(".ws-piece").first).to_contain_text("本局禁用")
    page.reload()
    expect(page.locator(".ws-piece")).to_have_count(3)
    for width in [1400,820,412]:
        page.set_viewport_size({"width":width,"height":840})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
    page.set_viewport_size({"width":1400,"height":880})
    page.locator('[data-act="teams"]').click()
    page.locator('#desk [data-act="open-team"]').first.click()
    stage=page.locator("#detail-stage")
    stage.click()
    options=page.locator('#detail-stage-options [role="option"]')
    assert options.all_text_contents()==["前期 · 第 1–5 回合","中期 · 第 6–10 回合","后期成型 · 第 11–15 回合"]
    options.nth(1).click()
    basket=page.locator("#basketStage")
    expect(basket).to_have_text("中期 · 第 6–10 回合")
    for width in [1400,854,412]:
        page.set_viewport_size({"width":width,"height":840})
        basket.click()
        choices=page.locator("#basketStage-options")
        expect(choices.get_by_role("option",selected=True)).to_have_text("中期 · 第 6–10 回合")
        anchor,menu=basket.bounding_box(),choices.bounding_box()
        assert abs(menu["x"]-anchor["x"]) < 2 and abs(menu["width"]-anchor["width"]) < 2
        assert 0 <= menu["y"]-anchor["y"]-anchor["height"] <= 6
        assert page.evaluate("handleBack()") and page.evaluate("db.page==='teams'")
        expect(choices).to_be_hidden()
    basket.focus()
    page.keyboard.press("ArrowDown")
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    expect(stage).to_have_text("后期成型 · 第 11–15 回合")
    page.reload()
    expect(stage).to_have_text("后期成型 · 第 11–15 回合")
    page.set_viewport_size({"width":1400,"height":880})
    page.locator('[data-act="map"]').click()
    page.locator('[data-w="map-pool"]').first.click()
    card=page.locator('.quick-card[data-unit="角峰"]')
    card.locator("[data-quick-toggle]").click()
    card.get_by_role("button",name="增加一份 角峰").click()
    expect(card.locator("small")).to_have_text("2 普通 · 0 精锐")
    card.get_by_role("button",name="增加一份 角峰").click()
    expect(card.locator("small")).to_have_text("0 普通 · 1 精锐")
    page.locator("[data-quick-save]").click()
    expect(page.locator(".tile.occupied")).to_have_count(1,timeout=45000)
    page.evaluate("()=>{window.nSolves=0;const engine=Workbench.engine;Workbench.engine=(a,...v)=>{if(a==='placement')nSolves++;return engine(a,...v);};}")
    action("map-card-copy","角峰").click()
    expect(action("map-card-field","角峰#2")).to_have_attribute("aria-pressed","false")
    action("map-card-field","角峰#2").click()
    expect(page.locator(".tile.occupied")).to_have_count(2)
    action("map-card-elite","角峰#2").click()
    assert page.evaluate("db.run.elite['角峰']")==2
    action("map-card-remove","角峰").click()
    expect(page.locator(".tile.occupied")).to_have_count(1)
    assert page.evaluate("db.run.elite['角峰']===1 && db.run.counts['角峰']===1")
    action("map-card-field","角峰").click()
    expect(page.locator(".tile.occupied")).to_have_count(0)
    action("map-card-field","角峰").click()
    expect(page.locator(".tile.occupied")).to_have_count(1)
    assert page.evaluate("nSolves")==0
    assert not errors, errors
    browser.close()
    server.shutdown()
print("Passed map preview, full-image gallery, isolated stage boards, equipment, promotion, bench, shared bans and responsive layout.")
