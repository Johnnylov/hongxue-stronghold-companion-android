"""Publish the upstream C# planners for the tablet's local WebAssembly worker."""
import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
args = argparse.ArgumentParser()
args.add_argument("--dotnet", default=os.environ.get("DOTNET_EXE", "dotnet"))
options = args.parse_args()
output = root / "build/managed"
subprocess.run([options.dotnet, "publish", str(root / "engine/TabletEngine.csproj"), "-c", "Release",
                "-o", str(output), "-p:RestoreSources=https://api.nuget.org/v3/index.json"], check=True)
source = output / "wwwroot/_framework"
dest = root / "app/src/main/assets/runtime"
if dest.exists():
    shutil.rmtree(dest)
dest.mkdir(parents=True)
manifest = json.loads((source / "blazor.boot.json").read_text(encoding="utf-8-sig"))
files = ["blazor.boot.json", "dotnet.js"]
for group in ("assembly", "wasmNative", "jsModuleNative", "jsModuleRuntime", "icu"):
    files.extend(manifest["resources"].get(group, {}).keys())
for name in files:
    shutil.copyfile(source / name, dest / name)
