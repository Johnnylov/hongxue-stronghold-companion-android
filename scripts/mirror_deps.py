"""Versioned AirPlay JNI and Android OCR inputs used for the offline APK."""
import hashlib
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
cache = ROOT / "build" / "mirror"
base = "https://raw.githubusercontent.com/bingyunhe/hongxue-stronghold-companion/15c074d227f7ca9aecbdfdf84e4ac79a0c8f0a6a/data/model/ocr/"
inputs = {
    "jmdns.jar": ("https://repo.maven.apache.org/maven2/org/jmdns/jmdns/3.6.1/jmdns-3.6.1.jar", "56ef39a438dbd75d41bd7f0ceeb2e0b898645d0ad3953e461d221dcf69471b97"),
    "slf4j.jar": ("https://repo.maven.apache.org/maven2/org/slf4j/slf4j-api/2.0.16/slf4j-api-2.0.16.jar", "a12578dde1ba00bd9b816d388a0b879928d00bab3c83c240f7013bf4196c579a"),
    "airplay.apk": ("https://github.com/jqssun/android-airplay-server/releases/download/v0.0.36/app-release.apk", "b8c7c595ed93f91562feedce92c27800f08f9c84df424f6ac2045e82324cf2a4"),
    "ort.aar": ("https://repo.maven.apache.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/1.21.0/onnxruntime-android-1.21.0.aar", "8b675e9680b8cc02dca706a5e3b4e35cc8506de5bdf206fdae68081cbd804414"),
    "det.onnx": (base+"det.onnx", "8c3b7ee97913a7942b8565669dc9acbe8846fbbaf4b63e1d7fdb339005574a33"),
    "rec.onnx": (base+"rec.onnx", "31fb844ce3a4aaf13e4bea62ae35f43bd9a509966061980c30db9b248c542a6b"),
    "keys.txt": (base+"keys.txt", "d1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b"),
}
abis = ("arm64-v8a", "armeabi-v7a", "x86_64")

def prepare():
    cache.mkdir(parents=True, exist_ok=True)
    for name, (url, expected) in inputs.items():
        dest = cache/name
        if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == expected:
            continue
        with urlopen(url, timeout=90) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("Checksum mismatch for "+name)
        dest.write_bytes(data)
    with ZipFile(cache/"ort.aar") as aar:
        (cache/"ort.jar").write_bytes(aar.read("classes.jar"))
    return [cache/name for name in ("ort.jar","jmdns.jar","slf4j.jar")]

def package(apk):
    for model in ("det.onnx", "rec.onnx", "keys.txt"):
        apk.write(cache/model, "assets/recognition/"+model,compress_type=ZIP_DEFLATED)
    with ZipFile(cache/"airplay.apk") as air, ZipFile(cache/"ort.aar") as ort:
        for abi in abis:
            for name in ("airplay_native", "c++_shared", "crypto", "oboe"):
                path = f"lib/{abi}/lib{name}.so"
                apk.writestr(path, air.read(path),compress_type=ZIP_DEFLATED)
            for name in ("onnxruntime", "onnxruntime4j_jni"):
                filename = f"{abi}/lib{name}.so"
                apk.writestr("lib/"+filename, ort.read("jni/"+filename),compress_type=ZIP_DEFLATED)
