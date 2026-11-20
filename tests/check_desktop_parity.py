"""Compare the solver inside a built APK against a Windows v1.9.4 reference."""
import functools
import json
import os
import sys
import tempfile
import threading
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
apk = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "build/Matou-Tablet-v1.0.8.apk"
cases = json.loads((root / "tests/DesktopParity/reference.json").read_text(encoding="utf-8"))
class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        try:
            super().do_GET()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            # Cancelling a worker aborts its in-flight local asset requests.
            pass
class Server(ThreadingHTTPServer):
    request_queue_size = 128
with tempfile.TemporaryDirectory() as tmp:
    dest = Path(tmp)
    with zipfile.ZipFile(apk) as package:
        for name in package.namelist():
            if name.startswith("assets/") and not name.endswith("/"):
                file = dest / name
                if not file.resolve().is_relative_to(dest):
                    raise ValueError(name)
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(package.read(name))
    with Server(("127.0.0.1",0), functools.partial(Handler, directory=str(dest / "assets"))) as server, sync_playwright() as pw:
        threading.Thread(target=server.serve_forever,daemon=True).start()
        browser = pw.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
        page = browser.new_page()
        page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
        page.locator("#desk h1").wait_for()
        for case in cases:
            request = {"map": case["mapId"], "pool": [{"name": n, "copy":0,"isElite":False} for n in case["names"]], "people":8, "mode":1}
            for attempt in range(5):
                result = page.evaluate("(q)=>Workbench.engine('placement',q)", request)
                assert result["total"] == case["total"]
                assert [c["text"] for c in result["checks"]] == case["checks"]
                assert [{k:p[k] for k in ("key","cell","facing")} for p in result["placed"]] == case["layout"]
            print(case["mapId"], "matched all 5 runs", case["total"], flush=True)
        for case in json.loads((root / "tests/DesktopParity/boards.json").read_text(encoding="utf-8")):
            result = page.evaluate("(r) => Workbench.engine('placement', r)", case["req"])
            for ref, actual in (("layout", "placed"), ("bench", "bench"), ("checks", "checks"),
                                ("combat", "combat"), ("stacking", "stacking"), ("total", "total")):
                assert case[ref] == result[actual], (case["req"]["map"], ref)
        print("All ten boards matched the desktop DLL, including notes, pins, copies and elite effects.", flush=True)
        case = cases[0]
        page.evaluate("""c => {
            db.run.mode='mode_multi_abyss'; move('map');
            Object.assign(db.board, {source:"trial", map:c.mapId, pool:c.names.map(name => ({name, count:1, elite:0})), layouts:{}});
            Maps.render();
        }""", case)
        page.locator('[data-w="map-solve"]').click()
        page.locator('[data-w="map-cancel"]').wait_for(state="hidden")
        assert page.evaluate("Boolean(db.board.layouts[db.board.map]?.recommended?.key)")
        page.reload()
        page.locator('[data-w="map-solve"]').wait_for()
        page.evaluate("""() => {
            const raw = Workbench.engine;
            window.searchCount = 0;
            Workbench.engine = (a,...rest) => { if (a === 'placement') searchCount++; return raw(a,...rest); };
        }""")
        page.locator('[data-w="map-solve"]').click()
        assert page.evaluate("searchCount") == 0
        assert page.evaluate("db.board.layouts[db.board.map].total") == case["total"]
        # Two rapid switches must drop the obsolete search. Toggling route visibility must keep the latest one.
        page.evaluate("""() => {
            document.querySelector('[data-w="map-mode-set"][data-v="0"]').click();
            document.querySelector('[data-w="map-mode-set"][data-v="2"]').click();
            document.getElementById('map-routes').click();
        }""")
        page.locator('[data-w="map-cancel"]').wait_for(state="hidden")
        assert page.evaluate("JSON.parse(db.board.layouts[db.board.map].recommended.key)[2].mode") == 2
        assert page.evaluate("searchCount") == 2
        print("Persistent reuse and rapid mode switches passed.", flush=True)
        browser.close()
        server.shutdown()
