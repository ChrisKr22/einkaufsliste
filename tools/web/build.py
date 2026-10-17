#!/usr/bin/env python3
"""FeedYourself Web-App vorbereiten.

  python3 tools/web/build.py

1. Kopiert Catalog/catalog.json nach web/data/catalog.json.
2. Trägt alle App-Dateien in die Offline-Liste des Service Workers (web/sw.js) ein
   und setzt eine neue VERSION, sobald sich eine Datei geändert hat. So holen sich
   installierte Apps beim nächsten Öffnen mit Netz automatisch die neue Fassung.
3. Schreibt die App-Version aus VERSION in die Einstellungen (web/index.html)
   und in das Xcode-Projekt (MARKETING_VERSION).
"""

import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
SW = WEB / "sw.js"
INCLUDE = ("index.html", "manifest.webmanifest", "css", "js", "data", "icons", "images")
SKIP_SUFFIXES = {".md"}
VERSION_FILE = ROOT / "VERSION"
XCODE_PROJECT = ROOT / "FeedYourself.xcodeproj" / "project.pbxproj"


def app_files():
    files = []
    for name in INCLUDE:
        path = WEB / name
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            files += sorted(p for p in path.rglob("*") if p.is_file() and p.suffix not in SKIP_SUFFIXES and not p.name.startswith("."))
    return files


def copy_catalog_images():
    """Catalog/Images/<id>.png|jpg → web/images/ und Liste der vorhandenen Bilder für die App.

    images.json: {"ids": [...], "full": [...]} – „full“ sind Fotos mit Hintergrund (JPEG),
    die die App randlos zeigt; freigestellte Bilder sind PNG mit Transparenz.
    """
    source = ROOT / "Catalog" / "Images"
    target = WEB / "images"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir()
    known = {p["id"] for p in json.loads((ROOT / "Catalog" / "catalog.json").read_text(encoding="utf-8"))["products"]}
    ids, full = [], []
    files = sorted(f for f in source.iterdir() if f.suffix in (".png", ".jpg")) if source.exists() else []
    for f in files:
        if f.stem not in known:
            print(f"Hinweis: {f.name} gehört zu keinem Produkt im Katalog – übersprungen.")
        elif f.stem in ids:
            print(f"Hinweis: für {f.stem} gibt es PNG und JPG – nehme {f.stem}.png.")
        else:
            shutil.copyfile(f, target / f.name)
            ids.append(f.stem)
            if f.suffix == ".jpg":
                full.append(f.stem)
    for stem in set(full):
        if (source / f"{stem}.png").exists():
            full.remove(stem)
            (target / f"{stem}.jpg").unlink()
            shutil.copyfile(source / f"{stem}.png", target / f"{stem}.png")
    (WEB / "data" / "images.json").write_text(json.dumps({"ids": sorted(ids), "full": sorted(full)}) + "\n", encoding="utf-8")
    return ids


def apply_app_version():
    """VERSION (z. B. 1.2.0) → Einstellungen der Web-App und Xcode-Projekt."""
    version = VERSION_FILE.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"VERSION muss die Form 1.2.3 haben, gefunden: {version!r}")
    index = WEB / "index.html"
    html, count = re.subn(r"(<span data-app-version>)[^<]*(</span>)", rf"\g<1>{version}\g<2>", index.read_text(encoding="utf-8"))
    if count != 1:
        raise SystemExit("web/index.html: <span data-app-version> nicht (eindeutig) gefunden.")
    index.write_text(html, encoding="utf-8")
    if XCODE_PROJECT.exists():
        pbx = re.sub(r"MARKETING_VERSION = [^;]*;", f"MARKETING_VERSION = {version};", XCODE_PROJECT.read_text(encoding="utf-8"))
        XCODE_PROJECT.write_text(pbx, encoding="utf-8")
    return version


def main():
    app_version = apply_app_version()
    (WEB / "data").mkdir(exist_ok=True)
    shutil.copyfile(ROOT / "Catalog" / "catalog.json", WEB / "data" / "catalog.json")
    images = copy_catalog_images()

    files = app_files()
    digest = hashlib.sha256()
    for f in files:
        digest.update(f.relative_to(WEB).as_posix().encode())
        digest.update(f.read_bytes())
    version = digest.hexdigest()[:12]

    entries = ["'./'"] + [f"'{f.relative_to(WEB).as_posix()}'" for f in files]
    precache = "const PRECACHE = [\n" + "".join(f"  {e},\n" for e in entries) + "];"
    sw = SW.read_text(encoding="utf-8")
    sw = re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", sw, count=1)
    sw = re.sub(r"const PRECACHE = \[.*?\];", precache, sw, count=1, flags=re.S)
    SW.write_text(sw, encoding="utf-8")

    size = sum(f.stat().st_size for f in files)
    print(f"App-Version {app_version}, Build {version}: {len(files)} Dateien, {size / 1024:.0f} KB offline verfügbar, {len(images)} Produktfotos.")
    return files


def write_preview(target: Path, files):
    """Vorschau-Fassung für eine claude.ai-Vorschauseite: Seite ohne eigenes <html>/<head>-Gerüst,
    ohne Manifest und Service Worker (dort nicht möglich), übrige Dateien unverändert."""
    html = (WEB / "index.html").read_text(encoding="utf-8")
    title = re.search(r"<title>.*?</title>", html, re.S).group(0)
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    page = f'{title}\n<link rel="stylesheet" href="css/app.css">\n{body.strip()}\n'
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    (target / "index.html").write_text(page, encoding="utf-8")
    for f in files:
        rel = f.relative_to(WEB)
        if rel.as_posix() in ("index.html", "manifest.webmanifest"):
            continue
        (target / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, target / rel)
    print(f"Vorschau geschrieben: {target}")


if __name__ == "__main__":
    import sys
    built = main()
    if len(sys.argv) == 3 and sys.argv[1] == "--preview":
        write_preview(Path(sys.argv[2]).resolve(), built)
