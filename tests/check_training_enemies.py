"""Exercise selection, migration and backup restore on the run screen."""
import functools
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


assets = Path(__file__).resolve().parents[1] / "app/src/main/assets"
types = json.loads((assets / "rules/enemy_types.json").read_text(encoding="utf-8"))["types"]
with ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(assets))) as server, sync_playwright() as pw:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    browser = pw.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    page = browser.new_page()
    page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
    page.locator('[data-act="run"]').click()
    boxes = page.get_by_role("group", name="特训敌人（可多选）").get_by_role("checkbox")
    expect(boxes).to_have_count(len(types))
    expect(page.locator('input[name="training-enemy"]:checked')).to_have_count(0)
    for code, record in types.items():
        page.get_by_role("checkbox", name=record["typeName"], exact=True).check()
        detail = page.locator(f'[data-enemy-detail="{code}"]')
        for half, field in (("前半程", "firstHalfVariants"), ("后半程", "secondHalfVariants")):
            names = "、".join(e["enemyName"] for e in record[field])
            expect(detail).to_contain_text(f"{half} · {names}")
    expect(page.locator("[data-enemy-detail]")).to_have_count(len(types))
    page.get_by_role("checkbox", name="飞行", exact=True).uncheck()
    page.reload()
    expect(boxes).to_have_count(len(types))
    expect(page.locator("[data-enemy-detail]")).to_have_count(len(types) - 1)
    expect(page.locator('[data-enemy-detail="FLY"]')).to_have_count(0)
    expect(page.get_by_role("checkbox", name="元素", exact=True)).to_be_checked()

    # An existing 1.0.1 backup is restored through the same confirmation path as a current backup.
    page.locator('[data-act="prefs"]').click()
    page.locator('[data-w="backup"]').click()
    page.locator('[data-w="team-backup-export"]').click()
    current = json.loads(page.locator("#transfer").input_value())
    assert set(current["data"]["run"]["enemyTypes"]) == set(types) - {"FLY"}
    legacy = current["data"]["run"]
    del legacy["enemyTypes"]
    legacy.update(enemy="FLY", round=6)
    current["data"]["page"] = "run"
    page.locator("#transfer").evaluate("(box, value) => box.value = value", json.dumps(current))
    page.locator('[data-w="team-backup-restore"]').click()
    page.locator("#restore-confirm").click()
    expect(page.get_by_role("checkbox", name="飞行", exact=True)).to_be_checked()
    expect(page.locator("[data-enemy-detail]")).to_have_count(1)
    saved = page.evaluate("JSON.parse(localStorage.getItem('hongxue.tablet.v1')).run")
    assert saved["enemyTypes"] == ["FLY"] and "enemy" not in saved and saved["round"] == 6
    page.get_by_role("checkbox", name="致命", exact=True).check()
    page.locator('[data-w="new-run"]').click()
    page.locator('[data-w="new-run-yes"]').click()
    expect(page.locator('input[name="training-enemy"]:checked')).to_have_count(0)
    expect(page.locator("[data-enemy-detail]")).to_have_count(0)
    browser.close()
    server.shutdown()
print("Passed all nine types, individual removal, restart, backup migration and new-run reset.")
