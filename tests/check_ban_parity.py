"""Compare the tablet with the shipped Windows v1.9.4 ban rules and covenant list.

Regenerate the fixture from the original binary with --record-desktop PATH_TO_APP.
The normal test runs against local assets, or against a signed APK passed via --apk.
"""
import argparse
import functools
import hashlib
import itertools
import json
import os
import subprocess
import tempfile
import threading
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


tests = Path(__file__).resolve().parent
fixture = tests / "DesktopParity" / "bans.json"


def selections(core, additional):
    names = [*core, *additional]
    # The two photographed runs in the desktop BanCovenantReaderTests.
    sample1 = ["炎", "萨尔贡", "阿戈尔", "叙拉古", "乌萨斯", "精准", "灵巧", "坚守", "奇迹", "奥术"]
    sample2 = ["维多利亚", "阿戈尔", "叙拉古", "乌萨斯", "莱塔尼亚", "精准", "助力", "不屈", "聚合", "奥术"]
    return [[], *[[name] for name in names], *map(list, itertools.combinations(names, 2)),
            core, additional, names, ["莱塔尼亚", "卡西米尔", "聚合"], sample1, sample2]


def record(app):
    """Ask the original DLL which operators each selection excludes, without using the port."""
    def data(filename):
        return json.loads((app / "data" / (filename + ".json")).read_text("utf-8-sig"))

    covenants = data("covenants")["covenants"]
    core = [c["name"] for c in covenants if c["bondType"] == "SEASON"]
    additional = [c["name"] for c in covenants if c["bondType"] == "REGULAR"]
    operators = data("operators")["operators"] + data("custom_operators")["operators"]
    operators.sort(key=lambda op: op["name"])
    cases = selections(core, additional)
    dll = app / "HongxueCompanion.Core.dll"
    query = """
$ErrorActionPreference = 'Stop'
if ([Diagnostics.FileVersionInfo]::GetVersionInfo($env:DESKTOP_RULES).FileVersion -ne '1.9.4.0') {
    throw 'This fixture requires the Windows v1.9.4 desktop DLL.'
}
$null = [Reflection.Assembly]::LoadFrom($env:DESKTOP_RULES)
$inputData = [IO.File]::ReadAllText($env:DESKTOP_QUERIES) | ConvertFrom-Json
foreach ($names in $inputData.cases) {
    $bans = [Collections.Generic.HashSet[string]]::new([string[]]$names)
    -join $(foreach ($op in $inputData.operators) {
        [int][ASPAssistant.Core.Services.CovenantBanRules]::IsExcluded(
            [string[]]$op.coreCovenants, [string[]]$op.additionalCovenants, $bans)
    })
}
"""
    with tempfile.TemporaryDirectory() as tmp:
        queries = Path(tmp) / "queries.json"
        queries.write_text(json.dumps({"cases": cases, "operators": operators}), "utf8")
        env = {**os.environ, "DESKTOP_QUERIES": str(queries), "DESKTOP_RULES": str(dll)}
        output = subprocess.check_output(["pwsh", "-NoProfile", "-NonInteractive", "-Command", query], text=True, env=env)
    flags = output.splitlines()
    assert len(flags) == len(cases) and all(len(row) == len(operators) and set(row) <= {"0", "1"} for row in flags)
    oracle = {"version": "1.9.4", "desktopDllSha256": hashlib.sha256(dll.read_bytes()).hexdigest(),
              "core": core, "additional": additional, "names": [o["name"] for o in operators],
              "masks": {"+".join(case): hex(int(bits, 2))[2:] for case, bits in zip(cases, flags, strict=True)}}
    fixture.write_text(json.dumps(oracle, ensure_ascii=False, indent=2) + "\n", "utf8")


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        try:
            super().do_GET()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass


def run(assets):
    oracle = json.loads(fixture.read_text("utf8"))
    names = oracle["names"]
    cases = selections(oracle["core"], oracle["additional"])
    with ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(assets))) as server, sync_playwright() as pw:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        browser = pw.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
        page = browser.new_page()
        page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
        expect(page.locator("#desk h1")).to_have_text("攻略库")
        page.locator('[data-act="map"]').click()
        page.locator('[data-w="map-run-toggle"]').click()
        open_bans = page.locator('[data-w="ban-bonds"]')
        open_bans.click()
        dialog = page.locator("#dialog")
        for legend, key in [("核心盟约", "core"), ("附加盟约", "additional")]:
            boxes = dialog.get_by_role("group", name=legend, exact=True).get_by_role("checkbox")
            actual = boxes.evaluate_all("(els) => els.map(e=>e.value)")
            assert sorted(actual) == sorted(oracle[key]), (legend, actual, oracle[key])
        for name in ["莱塔尼亚", "聚合", "精准"]:
            dialog.get_by_role("checkbox", name=name, exact=True).check()
        dialog.locator('[data-w="ban-bonds-save"]').click()
        page.reload()
        open_bans.click()
        assert set(dialog.locator('input[name="ban-covenant"]:checked').evaluate_all("(els)=>els.map(e=>e.value)")) == {"莱塔尼亚", "聚合", "精准"}
        dialog.locator('[data-w="ban-bonds-save"]').click()
        assert set(names) == set(page.evaluate("Object.keys(Workbench.rawOps)"))
        rows = page.evaluate("""({names,cases}) => {
            const original = db.run.bannedBonds;
            const values = cases.map(bans => {
                db.run.bannedBonds=bans;
                return names.map(n=>Number(Workbench.isBanned(n))).join("");
            });
            db.run.bannedBonds = original;
            return values;
        }""", {"names": names, "cases": cases})
        for case, bits in zip(cases, rows, strict=True):
            expected = format(int(oracle["masks"]["+".join(case)], 16), f"0{len(names)}b")
            mismatches = [n for n, actual, original in zip(names, bits, expected, strict=True) if actual != original]
            assert not mismatches, (case, mismatches)
        result = page.evaluate("""async () => {
            const names = ['薇薇安娜','瑰盐','华法琳','灰喉'];
            const pool = names.map(name => ({name,copy:0,isElite:false}));
            const engine = await Workbench.engine('placement',{map:db.board.map,pool,bannedBonds:db.run.bannedBonds});
            return [names.filter(n => !Workbench.isBanned(n)), engine.placed.map(p=>p.key)];
        }""")
        assert set(result[0]) == set(result[1]) == {"薇薇安娜", "华法琳", "瑰盐"}, result
        browser.close()
        server.shutdown()
    print(f"Matched desktop v{oracle['version']} for {len(names)} operators across {len(cases)} ban selections, both UI groups, persisted selection, and map placement.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--record-desktop", type=Path)
    group.add_argument("--apk", type=Path)
    args = parser.parse_args()
    if args.record_desktop:
        record(args.record_desktop.resolve())
    elif args.apk:
        with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(args.apk) as apk:
            for entry in apk.namelist():
                if entry.startswith("assets/") and not entry.endswith("/"):
                    apk.extract(entry, tmp)
            run(Path(tmp) / "assets")
    else:
        run(tests.parent / "app" / "src" / "main" / "assets")
