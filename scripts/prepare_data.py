"""Rebuild the bundled catalogue from a checkout of the upstream companion."""
import json
import shutil
import sys
from pathlib import Path
from xml.etree import ElementTree
from PIL import Image

source = Path(sys.argv[1]) / "data"
main = Path(__file__).resolve().parents[1] / "app/src/main"
assets = main / "assets"

theme_keys = {"PanelBackgroundBrush":"panel", "CardBackgroundBrush":"paper", "TextPrimaryBrush":"ink",
    "TextSecondaryBrush":"muted", "BorderBrush":"edge", "LineBrush":"line", "AccentSolidBrush":"accent",
    "AccentBrush":"teal", "AccentTintBrush":"tint", "SectionBackgroundBrush":"section", "CardHoverBrush":"hover",
    "DangerBrush":"danger", "DangerTintBrush":"danger-tint", "SuccessTextBrush":"ok", "FinalBrush":"support",
    "OnAccentBrush":"on-accent", "TitleBackgroundBrush":"title-bg", "TitleTextBrush":"title-text",
    "TitleMutedBrush":"title-muted", "EliteBrush":"elite", "WarningTextBrush":"warn"}
themes = []
for theme_file in sorted((source.parent / "src/ASPAssistant.App/Resources/Themes").glob("*.xaml")):
    skin, mode = theme_file.stem.lower().split(".")
    values = {}
    for el in ElementTree.parse(theme_file).getroot():
        key = el.get("{http://schemas.microsoft.com/winfx/2006/xaml}Key")
        if key in theme_keys and el.get("Color"):
            color = el.get("Color").lstrip("#")
            values[theme_keys[key]] = "#" + (color[2:] + color[:2] if len(color) == 8 else color)
    selector = f'html[data-skin="{skin}"][data-dark="{int(mode == "dark")}"]'
    if skin == "closure" and mode == "light":
        selector = ":root, " + selector
    themes.append(selector + " {\n" + "\n".join(f"  --{k}: {v};" for k,v in values.items()) + "\n}")
(assets / "themes.css").write_text("/* Palettes derived from the six upstream WPF resource dictionaries; see NOTICE. */\n" + "\n".join(themes) + "\n",encoding="utf-8")

def read(name):
    return json.loads((source / (name + ".json")).read_text(encoding="utf-8-sig"))

keys = read("search_keys")["initials"]
categories = read("equipment_categories")["categories"]
profiles = {**read("operator_profiles")["operators"], **read("custom_operator_profiles")["operators"]}
operators = read("operators")["operators"] + read("custom_operators")["operators"]
equipment = read("equipment")["equipment"]
catalogue = {}
for kind, records in (("op", operators), ("eq", equipment)):
    for index, item in enumerate(records):
        name = item["name"]
        key = kind + ":" + name
        image_path = f"img/{kind}-{index}.webp"
        with Image.open(source / item["iconPath"]) as image:
            image.thumbnail((140, 140))
            image.save(assets / image_path, "WEBP", quality=86, method=6)
        tags = item.get("coreCovenants", []) + item.get("additionalCovenants", []) if kind == "op" else categories.get(name, [])
        def description(mode):
            data = item.get(mode, {})
            return data.get("effectDescription") or " ".join(t["traitDescription"] for t in data.get("traits", []))
        profile = profiles.get(name, {}) if kind == "op" else {}
        skill = profile.get("normalSkill") or {}
        catalogue[key] = dict(kind=kind, name=name, tier=item["tier"], tags=tags, image=image_path,
            initials=keys.get(name, ""), normal=description("normal"), elite=description("elite"),
            skill=skill.get("name", ""), skillText=skill.get("description", ""),
            custom=bool(item.get("isCustom")), strategy=item.get("requiredStrategyId", ""))

(assets / "catalogue.json").write_text(json.dumps(catalogue, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
with Image.open(source / "icons/aspa_logo.png") as image:
    image.thumbnail((192, 192))
    image.save(main / "res/drawable/launcher.png")
    image.thumbnail((96, 96))
    image.save(assets / "img/logo.webp", "WEBP", quality=90)

rules = assets / "rules"
rules.mkdir(exist_ok=True)
icons = {}
for index, bond in enumerate(read("covenants")["covenants"]):
    icon = source / "icons/covenants" / (bond["name"] + ".png")
    if icon.is_file():
        image_path = f"img/bond-{index}.webp"
        with Image.open(icon) as image:
            image.thumbnail((96, 96))
            image.save(assets / image_path, "WEBP", quality=92)
        icons[bond["name"]] = image_path
(rules / "covenant_icons.json").write_text(json.dumps(icons, ensure_ascii=False), encoding="utf-8")
for name in ("operators", "custom_operators", "operator_profiles", "custom_operator_profiles",
             "covenants", "covenant_effects", "equipment", "garrison_maps", "strategies",
             "bosses", "enemy_types"):
    shutil.copyfile(source / (name + ".json"), rules / (name + ".json"))
for item in read("strategies")["strategies"] + read("bosses")["bosses"]:
    icon = source / (item.get("iconPath") or "missing")
    if icon.is_file():
        with Image.open(icon) as image:
            image.thumbnail((96, 96))
            image.save(assets / "img" / (icon.stem + ".webp"), quality=80)
for image_path in (source.parent / "src/ASPAssistant.App/Resources/MapThumbs").glob("*.jpg"):
    with Image.open(image_path) as image:
        image.thumbnail((350, 200))
        image.save(assets / "img" / (image_path.stem + ".webp"), quality=82)
