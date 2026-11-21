"""Build and sign the tablet APK with JDK 17+ and Android SDK Build Tools 35."""
import argparse
import os
import shutil
import subprocess
import sys
import zipfile
import mirror_deps
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--sdk", default=os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT"))
parser.add_argument("--tools", type=Path)
parser.add_argument("--platform", type=Path, help="Path to platform android.jar")
parser.add_argument("--keystore", required=True, type=Path)
parser.add_argument("--alias", default="hongxue")
args = parser.parse_args()
sdk = Path(args.sdk or ".")
tools = args.tools or sdk / "build-tools/35.0.0"
android = (args.platform or sdk / "platforms/android-35/android.jar").resolve()
suffix = ".exe" if os.name == "nt" else ""
java_home = os.environ.get("JAVA_HOME")
def jdk(name):
    return Path(java_home) / "bin" / (name + suffix) if java_home else name
def run(*command):
    subprocess.run([str(x) for x in command], check=True)

out = root / "build"
main = root / "app/src/main"
subprocess.run([sys.executable, str(root / "scripts/prepare_engine.py")], check=True)
out.mkdir(exist_ok=True)
classes = out / "classes"
if classes.exists():
    shutil.rmtree(classes)
classes.mkdir()
mirror_jars = mirror_deps.prepare()
run(tools / ("aapt2" + suffix), "compile", "--dir", main / "res", "-o", out / "compiled.zip")
run(tools / ("aapt2" + suffix), "link", "-o", out / "base.apk", "-I", android,
    "--manifest", main / "AndroidManifest.xml", "-A", main / "assets", out / "compiled.zip")
bootpath = os.pathsep.join(map(str, (android, tools / "core-lambda-stubs.jar")))
run(jdk("javac"), "-encoding", "UTF-8", "-source", "8", "-target", "8", "-bootclasspath", bootpath,
    "-classpath", os.pathsep.join(map(str,mirror_jars)), "-d", classes, *main.glob("java/**/*.java"))
run(jdk("jar"), "cf", out / "classes.jar", "-C", classes, ".")
run(jdk("java"), "-cp", tools / "lib/d8.jar", "com.android.tools.r8.D8",
    "--release", "--min-api", "26", "--lib", android, "--output", out, out / "classes.jar", *mirror_jars)
with zipfile.ZipFile(out / "base.apk") as base, zipfile.ZipFile(out / "unsigned.apk", "w") as apk:
    for entry in base.infolist():
        apk.writestr(entry.filename, base.read(entry), compress_type=entry.compress_type)
    apk.write(out / "classes.dex", "classes.dex", compress_type=zipfile.ZIP_DEFLATED)
    mirror_deps.package(apk)
run(tools / ("zipalign" + suffix), "-f", "4", out / "unsigned.apk", out / "aligned.apk")
apk = out / "Matou-Tablet-v1.2.2.apk"
signer = [jdk("java"), "-jar", tools / "lib/apksigner.jar"]
run(*signer, "sign", "--ks", args.keystore, "--ks-key-alias", args.alias,
    "--ks-pass", "env:HX_STORE_PASS", "--key-pass", "env:HX_STORE_PASS",
    "--out", apk, out / "aligned.apk")
run(*signer, "verify", "--verbose", apk)
print(apk)
