"""Check all 20 enemy paths, their direction and overlays through the normal map UI."""
import functools
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

assets = Path(__file__).resolve().parents[1] / "app/src/main/assets"
maps = json.loads((assets / "rules/garrison_maps.json").read_text(encoding="utf-8"))

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

with ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(assets))) as server:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
        page = browser.new_page(viewport={"width": 1400, "height": 876})
        page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
        expect(page.locator("#desk h1")).to_have_text("攻略库")
        page.locator('[data-act="map"]').click()
        for board in maps["maps"]:
            page.locator('[data-w="map-gallery"]').first.click()
            page.locator('dialog[open] [data-w="map-select"]').filter(has_text=board["name"]).get_by_text(board["name"], exact=True).click()
            for i, route in enumerate(board["routes"]):
                group = page.locator(f'[data-route-index="{i}"]')
                expect(group.locator(".way-arrow")).to_have_count(len(route["cells"]) - 1)
                points = group.locator(".way-line").get_attribute("points").split()
                offset = -0.15 if i == 0 else 0.16
                for point, (col, row) in zip(points, route["cells"], strict=True):
                    x, y = map(float, point.split(","))
                    assert abs(x / 100 - (col - maps["columns"][0] + .5 + offset)) < 0.001
                    assert abs(y / 100 - (row + .5 + offset)) < 0.001
                assert route["cells"][0] == route["spawn"]
                x, y = route["cells"][-1]
                assert board["cells"][y][x - maps["columns"][0]] == "D"
            for index in (0, 1):
                page.locator(f'[data-w="map-route-filter"][data-v="{index}"]').click()
                expect(page.locator(".enemy-path")).to_have_count(1)
                expect(page.locator(f'[data-route-index="{index}"]')).to_have_count(1)
            page.locator('[data-w="map-route-filter"][data-v="both"]').click()
        page.locator("#map-routes").uncheck()
        expect(page.locator(".enemy-routes")).to_have_count(0)
        page.locator("#map-routes").check()
        expect(page.locator(".enemy-path")).to_have_count(2)
        page.reload()
        expect(page.locator(".enemy-path")).to_have_count(2)
        browser.close()
    server.shutdown()
print("Passed all 10 maps and 20 directed enemy paths.")
