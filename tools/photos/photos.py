#!/usr/bin/env python3
"""FeedYourself – Fotos für den Basis-Katalog abrufen, auswählen und aufbereiten.

Ablauf (Details in README.md):
  1. fetch     Pro Produkt eine Suche bei Pixabay und/oder Pexels, Treffer werden 24 h gecacht.
  2. review    Lokale Auswahlseite im Browser; pro Produkt ein Foto anklicken.
  3. download  Nur die ausgewählten Fotos in voller Größe herunterladen.
  4. process   Freistellen (Apple Vision), auf 600×600 bringen, nach Catalog/Images/ schreiben,
               Bildnachweise nach Catalog/image-credits.json.
  status       Zeigt, wie weit jedes Produkt ist.

Nur Python-Standardbibliothek, keine Installation nötig.
"""

import argparse
import datetime
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CATALOG = ROOT / "Catalog" / "catalog.json"
IMAGES_OUT = ROOT / "Catalog" / "Images"
CREDITS = ROOT / "Catalog" / "image-credits.json"
WORK = HERE / "work"
CACHE = WORK / "cache"
SELECTION = WORK / "selection.json"
SELECTED_DIR = WORK / "selected"
MANIFEST = SELECTED_DIR / "manifest.json"
KEYS_FILE = HERE / "api-keys.env"
CUTOUT = HERE / "cutout.swift"
INBOX = ROOT / "Catalog" / "Inbox"
INBOX_DONE = INBOX / "erledigt"
IMPORT_STAGE = WORK / "import"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".heic", ".webp"}
FREIGESTELLT = ("alpha", "cutout", "whitebg")

CACHE_TTL = 24 * 3600  # Pixabay verlangt 24 h Caching; Vorschau-URLs laufen danach ab.
USER_AGENT = "FeedYourself-PhotoTool/1.0 (lokales Entwicklerwerkzeug)"


# ---------------------------------------------------------------- Hilfsfunktionen

def load_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def save_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


KEYCHAIN_SERVICES = {"PIXABAY_API_KEY": "feedyourself-pixabay", "PEXELS_API_KEY": "feedyourself-pexels"}


def keychain_lookup(service):
    """Schlüssel aus dem macOS-Schlüsselbund lesen (oder None)."""
    try:
        proc = subprocess.run(["security", "find-generic-password", "-s", service, "-w"],
                              capture_output=True, text=True)
    except FileNotFoundError:
        return None
    value = proc.stdout.strip()
    return value if proc.returncode == 0 and value else None


def load_keys():
    """API-Schlüssel, Vorrang in dieser Reihenfolge: Umgebungsvariable, macOS-Schlüsselbund,
    tools/photos/api-keys.env."""
    keys = {}
    if KEYS_FILE.exists():
        for line in KEYS_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                v = v.strip().strip('"').strip("'")
                if v:
                    keys[k.strip()] = v
    for k, service in KEYCHAIN_SERVICES.items():
        value = keychain_lookup(service)
        if value:
            keys[k] = value
    for k in KEYCHAIN_SERVICES:
        if os.environ.get(k):
            keys[k] = os.environ[k]
    return keys


def load_catalog():
    cat = load_json(CATALOG, None)
    if not cat:
        sys.exit(f"Katalog nicht gefunden: {CATALOG}")
    return cat


def now():
    return time.time()


def iso(ts):
    return datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


def http_json(url, headers=None, retries=3):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8")), resp.headers
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries:
                wait = int(e.headers.get("Retry-After") or e.headers.get("X-RateLimit-Reset") or 60)
                print(f"    Limit erreicht, warte {wait} s …")
                time.sleep(wait + 1)
                continue
            body = e.read().decode("utf-8", "replace")[:200]
            raise RuntimeError(f"HTTP {e.code}: {body}") from None


def http_download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return len(data)


# ---------------------------------------------------------------- Bildquellen

class Source:
    name = ""
    interval = 1.0  # Mindestabstand zwischen Anfragen in Sekunden

    def __init__(self, key):
        self.key = key
        self._last = 0.0

    def throttle(self):
        wait = self.interval - (now() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = now()


class Pixabay(Source):
    """https://pixabay.com/api/docs/ – max. 100 Anfragen/Minute, 24 h Cache,
    kein dauerhaftes Hotlinking, Massen-Downloads verboten."""
    name = "pixabay"
    interval = 1.0

    def _get(self, **params):
        self.throttle()
        q = urllib.parse.urlencode({"key": self.key, **params})
        data, _ = http_json("https://pixabay.com/api/?" + q)
        return data.get("hits", [])

    def search(self, query, n):
        hits = self._get(q=query[:100], image_type="photo", per_page=max(3, min(n, 200)),
                         safesearch="true", lang="en")
        return [self.normalize(h) for h in hits[:n]]

    def by_id(self, photo_id):
        hits = self._get(id=photo_id)
        return self.normalize(hits[0]) if hits else None

    @staticmethod
    def normalize(h):
        return {
            "source": "pixabay",
            "id": str(h["id"]),
            "page": h.get("pageURL"),
            "preview": h.get("webformatURL"),
            "full": h.get("largeImageURL"),
            "author": h.get("user"),
            "author_url": f"https://pixabay.com/users/{h.get('user')}-{h.get('user_id')}/",
            "alt": h.get("tags", ""),
            "width": h.get("imageWidth"),
            "height": h.get("imageHeight"),
            "license": "Pixabay Content License",
            "license_url": "https://pixabay.com/service/license-summary/",
        }


class Pexels(Source):
    """https://www.pexels.com/api/documentation/ – 200 Anfragen/Stunde,
    Link zu Pexels und Nennung der Fotograf:innen erwünscht."""
    name = "pexels"
    interval = 18.5  # 200/Stunde

    def _get(self, path, **params):
        self.throttle()
        url = "https://api.pexels.com/v1/" + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data, _ = http_json(url, headers={"Authorization": self.key})
        return data

    def search(self, query, n):
        data = self._get("search", query=query, per_page=max(1, min(n, 80)), locale="en-US")
        return [self.normalize(p) for p in data.get("photos", [])[:n]]

    def by_id(self, photo_id):
        return self.normalize(self._get(f"photos/{photo_id}"))

    @staticmethod
    def normalize(p):
        src = p.get("src", {})
        return {
            "source": "pexels",
            "id": str(p["id"]),
            "page": p.get("url"),
            "preview": src.get("medium") or src.get("small"),
            "full": src.get("large2x") or src.get("large") or src.get("original"),
            "author": p.get("photographer"),
            "author_url": p.get("photographer_url"),
            "alt": p.get("alt", ""),
            "width": p.get("width"),
            "height": p.get("height"),
            "license": "Pexels License",
            "license_url": "https://www.pexels.com/license/",
        }


SOURCES = {"pixabay": (Pixabay, "PIXABAY_API_KEY"), "pexels": (Pexels, "PEXELS_API_KEY")}


def make_sources(names, keys, required=True):
    out = []
    for n in names:
        cls, env = SOURCES[n]
        if not keys.get(env):
            if required:
                sys.exit(f"Kein API-Schlüssel für {n}. Im Schlüsselbund speichern mit:\n"
                         f"  security add-generic-password -a \"$USER\" -s {KEYCHAIN_SERVICES[env]} -w\n"
                         f"(oder {env} in tools/photos/api-keys.env eintragen, siehe README.md)")
            continue
        out.append(cls(keys[env]))
    return out


def cache_path(source, product_id):
    return CACHE / source / f"{product_id}.json"


def cached(source, product_id):
    return load_json(cache_path(source, product_id), None)


def is_fresh(entry):
    return bool(entry) and now() - entry.get("fetched_at", 0) < CACHE_TTL


# ---------------------------------------------------------------- fetch

def cmd_fetch(args):
    catalog = load_catalog()
    keys = load_keys()
    sources = make_sources(args.source, keys)
    selection = load_json(SELECTION, {})
    products = [p for p in catalog["products"] if not args.only or p["id"] in args.only]
    if len(products) > 150 and not args.yes:
        sys.exit(f"{len(products)} Produkte auf einmal: Pixabay untersagt automatisierte Massenabfragen. "
                 "Bitte in Etappen mit --only arbeiten oder bewusst mit --yes bestätigen.")

    for src in sources:
        print(f"\n== {src.name}: {len(products)} Produkte ==")
        for i, p in enumerate(products, 1):
            override = (selection.get(p["id"]) or {}).get("query")
            base = override or p["query_en"]
            entry = cached(src.name, p["id"])
            if is_fresh(entry) and entry.get("base_query") == base and not args.refresh:
                print(f"[{i}/{len(products)}] {p['name']}: aus Cache ({len(entry['results'])} Treffer)")
                continue
            query = base if args.no_isolated else f"{base} isolated"
            try:
                results = src.search(query, args.per_product)
                if len(results) < 3 and not args.no_isolated:
                    query = base
                    results = src.search(query, args.per_product)
            except RuntimeError as e:
                print(f"[{i}/{len(products)}] {p['name']}: Fehler – {e}")
                continue
            save_json(cache_path(src.name, p["id"]), {
                "fetched_at": now(), "base_query": base, "query": query, "results": results,
            })
            print(f"[{i}/{len(products)}] {p['name']}: {len(results)} Treffer für „{query}“")
    print("\nWeiter mit:  python3 tools/photos/photos.py review")


# ---------------------------------------------------------------- review

def review_data(catalog):
    cats = {c["id"]: c["name"] for c in catalog["categories"]}
    selection = load_json(SELECTION, {})
    items, stale = [], 0
    for p in catalog["products"]:
        cands = []
        for name in SOURCES:
            entry = cached(name, p["id"])
            if not entry:
                continue
            if not is_fresh(entry):
                stale += 1
            cands += entry["results"]
        items.append({
            "id": p["id"], "name": p["name"], "category": cats.get(p["category"], p["category"]),
            "query": (selection.get(p["id"]) or {}).get("query") or p["query_en"],
            "candidates": [{k: c[k] for k in ("source", "id", "preview", "page", "author", "alt")} for c in cands],
        })
    return items, selection, stale


def review_html(items, selection, stale):
    data = json.dumps({"items": items, "selection": selection}, ensure_ascii=False).replace("</", "<\\/")
    warn = (f'<p class="warn">{stale} Suchergebnisse sind älter als 24 Stunden – Vorschaubilder können fehlen. '
            'Abhilfe: <code>photos.py fetch --refresh</code></p>') if stale else ""
    return REVIEW_TEMPLATE.replace("{{WARN}}", warn).replace("{{DATA}}", data)


def cmd_review(args):
    catalog = load_catalog()
    items, selection, stale = review_data(catalog)
    if not any(i["candidates"] for i in items):
        sys.exit("Noch keine Suchergebnisse. Zuerst:  python3 tools/photos/photos.py fetch")

    if args.html_only:
        out = WORK / "review.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(review_html(items, selection, stale), encoding="utf-8")
        print(f"Auswahlseite geschrieben: {out}\n(Ohne Server wird die Auswahl nicht gespeichert – nur zur Ansicht.)")
        return

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype):
            raw = body.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                it, sel, st = review_data(catalog)
                self._send(200, review_html(it, sel, st), "text/html; charset=utf-8")
            else:
                self._send(404, "nicht gefunden", "text/plain; charset=utf-8")

        def do_POST(self):
            if self.path != "/save":
                return self._send(404, "nicht gefunden", "text/plain; charset=utf-8")
            length = int(self.headers.get("Content-Length") or 0)
            try:
                sel = json.loads(self.rfile.read(length).decode("utf-8"))
                assert isinstance(sel, dict)
            except Exception:
                return self._send(400, "ungültig", "text/plain; charset=utf-8")
            save_json(SELECTION, sel)
            self._send(200, '{"ok":true}', "application/json")

    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Auswahlseite läuft: {url}\nAuswahl wird automatisch gespeichert in {SELECTION}\nBeenden mit Ctrl+C.")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nWeiter mit:  python3 tools/photos/photos.py download")


# ---------------------------------------------------------------- download

def find_candidate(choice):
    source, photo_id = choice.split(":", 1)
    for path in (CACHE / source).glob("*.json"):
        entry = load_json(path, {})
        for r in entry.get("results", []):
            if r["id"] == photo_id:
                return r, entry
    return None, None


def cmd_download(args):
    catalog = load_catalog()
    keys = load_keys()
    selection = load_json(SELECTION, {})
    manifest = load_json(MANIFEST, {})
    sources = {s.name: s for s in make_sources(list(SOURCES), keys, required=False)}
    names = {p["id"]: p["name"] for p in catalog["products"]}
    todo = [(pid, s["choice"]) for pid, s in selection.items() if s.get("choice") and pid in names]
    if not todo:
        sys.exit("Noch nichts ausgewählt. Zuerst:  python3 tools/photos/photos.py review")

    for i, (pid, choice) in enumerate(todo, 1):
        dest = SELECTED_DIR / f"{pid}.jpg"
        if dest.exists() and manifest.get(pid, {}).get("choice") == choice and not args.force:
            print(f"[{i}/{len(todo)}] {names[pid]}: schon vorhanden")
            continue
        cand, entry = find_candidate(choice)
        source = choice.split(":", 1)[0]
        if not cand or not is_fresh(entry):
            # Pixabay-URLs laufen nach 24 h ab → frisch per ID abfragen.
            if source not in sources:
                print(f"[{i}/{len(todo)}] {names[pid]}: übersprungen – kein API-Schlüssel für {source}")
                continue
            cand = sources[source].by_id(choice.split(":", 1)[1])
        if not cand or not cand.get("full"):
            print(f"[{i}/{len(todo)}] {names[pid]}: Foto nicht mehr verfügbar – bitte neu auswählen")
            continue
        try:
            size = http_download(cand["full"], dest)
        except Exception as e:
            print(f"[{i}/{len(todo)}] {names[pid]}: Download fehlgeschlagen – {e}")
            continue
        manifest[pid] = {"choice": choice, "downloaded_at": now(), **{k: cand.get(k) for k in (
            "source", "id", "page", "author", "author_url", "license", "license_url")}}
        save_json(MANIFEST, manifest)
        print(f"[{i}/{len(todo)}] {names[pid]}: {size // 1024} KB")
        time.sleep(0.5)
    print("\nWeiter mit:  python3 tools/photos/photos.py process")


# ---------------------------------------------------------------- process

def build_cutout():
    """cutout.swift einmal kompilieren (neu, wenn die Quelle geändert wurde)."""
    bin_dir = WORK / "bin"
    binary = bin_dir / "cutout"
    if binary.exists() and binary.stat().st_mtime >= CUTOUT.stat().st_mtime:
        return binary
    bin_dir.mkdir(parents=True, exist_ok=True)
    print("Kompiliere cutout.swift (einmalig) …")
    cmd = ["swiftc", "-O", "-module-cache-path", str(bin_dir / "module-cache"), str(CUTOUT), "-o", str(binary)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        sys.exit("„swiftc“ nicht gefunden – bitte Xcode bzw. die Command Line Tools installieren (xcode-select --install).")
    if proc.returncode != 0 or not binary.exists():
        sys.exit("Kompilieren fehlgeschlagen:\n" + proc.stderr)
    return binary


def cmd_process(args):
    catalog = load_catalog()
    manifest = load_json(MANIFEST, {})
    if not manifest:
        sys.exit("Noch keine Fotos heruntergeladen. Zuerst:  python3 tools/photos/photos.py download")
    binary = build_cutout()
    cmd = [str(binary), str(SELECTED_DIR), str(IMAGES_OUT), "--size", str(args.size), "--margin", str(args.margin)]
    print("Freistellen …")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit("Freistellen fehlgeschlagen:\n" + proc.stderr)

    modes = {}
    for line in proc.stdout.splitlines():
        try:
            r = json.loads(line)
            modes[Path(r["file"]).stem] = r["mode"]
        except (ValueError, KeyError):
            pass

    names = {p["id"]: p["name"] for p in catalog["products"]}
    credits = {c["product_id"]: c for c in load_json(CREDITS, {"images": []}).get("images", [])}
    for pid, m in manifest.items():
        if modes.get(pid) in (None, "error"):
            continue
        credits[pid] = {
            "product_id": pid, "name": names.get(pid, pid), "file": f"Images/{pid}.png",
            "source": m["source"], "photo_id": m["id"], "page": m["page"],
            "author": m["author"], "author_url": m["author_url"],
            "license": m["license"], "license_url": m["license_url"],
            "cutout": modes[pid] in FREIGESTELLT,
        }
    save_json(CREDITS, {"generated_at": iso(now()),
                        "images": sorted(credits.values(), key=lambda c: c["product_id"])})

    cut = [p for p, mo in modes.items() if mo in FREIGESTELLT]
    fb = [p for p, mo in modes.items() if mo == "fallback"]
    err = [p for p, mo in modes.items() if mo == "error"]
    print(f"{len(cut)} freigestellt, {len(fb)} nur zugeschnitten → {IMAGES_OUT}")
    if fb:
        print("Nicht freigestellt (Hintergrund nicht hell genug bzw. Motiv nicht erkannt – ggf. anderes Foto wählen): "
              + ", ".join(names.get(p, p) for p in fb))
    if err:
        print("Fehler beim Lesen: " + ", ".join(names.get(p, p) for p in err))
    print(f"Bildnachweise: {CREDITS}")


# ---------------------------------------------------------------- import (eigene Fotos)

def split_inbox_name(stem):
    """„Äpfel_pexels-max-muster-1234567“ → („Äpfel“, Quellenangabe). Ohne „_“: eigenes Foto.

    Alles vor dem ersten Unterstrich bestimmt das Produkt, der Rest ist die Quelle.
    Pexels-Dateinamen (pexels-<fotograf>-<nummer>) werden in Fotograf und Link zerlegt.
    """
    product, sep, rest = stem.partition("_")
    if not sep or not rest.strip():
        return stem, {"source": "eigenes Foto", "license": "eigenes Foto"}
    # pexels-<fotograf>[-<nutzer-nr>]-<foto-nr>; „pexels“ darf fehlen, wenn der Rest mit „-“ beginnt.
    m = re.fullmatch(r"(?:pexels-|-)(?:(.+?)-)?(\d+)", rest.strip(), flags=re.IGNORECASE)
    if m:
        slug, number = m.group(1), m.group(2)
        slug = re.sub(r"-\d+$", "", slug) if slug else slug
        author = " ".join(w.capitalize() for w in slug.split("-")) if slug and slug.lower() != "photo" else None
        return product, {"source": "Pexels", "author": author, "page": f"https://www.pexels.com/photo/{number}/",
                         "license": "Pexels License", "license_url": "https://www.pexels.com/license/"}
    if rest.strip().lower() == "pexels":
        return product, {"source": "Pexels", "license": "Pexels License", "license_url": "https://www.pexels.com/license/"}
    return product, {"source": rest.strip(), "license": "unbekannt – bitte prüfen"}


def fold_name(text):
    """Für den Vergleich von Dateinamen: klein, Umlaute vereinfacht, nur Buchstaben und Ziffern."""
    import unicodedata
    text = text.lower().replace("ß", "ss")
    text = "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")
    return "".join(c for c in text if c.isalnum())


def name_variants(text):
    expanded = text.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    return {fold_name(text), fold_name(expanded)}


def build_name_index(catalog):
    """Dateiname → Produkt-ID. Name und ID gehen vor Synonymen; mehrdeutige Synonyme werden nicht benutzt."""
    primary, synonyms = {}, {}
    for p in catalog["products"]:
        for key in name_variants(p["name"]) | name_variants(p["id"]):
            primary[key] = p["id"]
        for syn in p.get("synonyms", []):
            for key in name_variants(syn):
                synonyms.setdefault(key, set()).add(p["id"])
    index = {k: next(iter(ids)) for k, ids in synonyms.items() if len(ids) == 1}
    ambiguous = {k: sorted(ids) for k, ids in synonyms.items() if len(ids) > 1 and k not in primary}
    index.update(primary)
    return index, ambiguous


def cmd_import(args):
    catalog = load_catalog()
    names = {p["id"]: p["name"] for p in catalog["products"]}
    INBOX.mkdir(parents=True, exist_ok=True)
    files = sorted(f for f in INBOX.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_SUFFIXES)
    if not files:
        sys.exit(f"Keine Fotos in {INBOX.relative_to(ROOT)}/ – Dateien dort ablegen, Dateiname = Produkt (z. B. „Olivenöl.jpg“).")

    index, ambiguous = build_name_index(catalog)
    matched, unmatched, unclear = {}, [], []
    for f in files:
        key = fold_name(split_inbox_name(f.stem)[0])
        if key in index:
            pid = index[key]
            if pid in matched:
                print(f"Hinweis: {f.name} und {matched[pid].name} gehören beide zu {names[pid]} – nehme {f.name}.")
            matched[pid] = f
        elif key in ambiguous:
            unclear.append((f, ambiguous[key]))
        else:
            unmatched.append(f)

    if IMPORT_STAGE.exists():
        shutil.rmtree(IMPORT_STAGE)
    IMPORT_STAGE.mkdir(parents=True)
    for pid, f in matched.items():
        shutil.copyfile(f, IMPORT_STAGE / f"{pid}{f.suffix.lower()}")

    modes = {}
    if matched:
        binary = build_cutout()
        extra = ["--keep-background"] if args.mit_hintergrund else []
        proc = subprocess.run([str(binary), str(IMPORT_STAGE), str(IMAGES_OUT), "--size", str(args.size), "--margin", str(args.margin), *extra],
                              capture_output=True, text=True)
        if proc.returncode != 0:
            sys.exit("Freistellen fehlgeschlagen:\n" + proc.stderr)
        for line in proc.stdout.splitlines():
            try:
                r = json.loads(line)
                modes[Path(r["file"]).stem] = r["mode"]
            except (ValueError, KeyError):
                pass

    credits = {c["product_id"]: c for c in load_json(CREDITS, {"images": []}).get("images", [])}
    done = []
    for pid, f in matched.items():
        mode = modes.get(pid, "error")
        if mode == "error":
            print(f"Fehler: {f.name} konnte nicht gelesen werden.")
            continue
        origin = {k: v for k, v in split_inbox_name(f.stem)[1].items() if v}
        ext = "jpg" if mode == "fallback" else "png"
        credits[pid] = {"product_id": pid, "name": names[pid], "file": f"Images/{pid}.{ext}", **origin,
                        "original_file": f.name, "cutout": mode in FREIGESTELLT}
        done.append((pid, f, mode))
        if not args.keep:
            INBOX_DONE.mkdir(exist_ok=True)
            shutil.move(str(f), INBOX_DONE / f.name)
    if done:
        save_json(CREDITS, {"generated_at": iso(now()), "images": sorted(credits.values(), key=lambda c: c["product_id"])})

    label = {"alpha": "schon freigestellt", "cutout": "freigestellt", "whitebg": "freigestellt (heller Hintergrund)", "fallback": "nur zugeschnitten"}
    print(f"\n{len(done)} Foto(s) übernommen → {IMAGES_OUT.relative_to(ROOT)}/")
    for pid, f, mode in done:
        c = credits[pid]
        source = c["source"] + (f" · {c['author']}" if c.get("author") else "")
        print(f"  {f.name:40} → {names[pid]:18} {label.get(mode, mode):26} {source}")
    if unclear:
        print("\nNicht eindeutig (bitte genauer benennen):")
        for f, ids in unclear:
            print(f"  {f.name}: passt zu " + ", ".join(names[i] for i in ids))
    if unmatched:
        print("\nKein passendes Produkt (Tippfehler? Sonst Produkt in catalog.json ergänzen):")
        for f in unmatched:
            print(f"  {f.name}")
    if not args.mit_hintergrund and any(m == "fallback" for _, _, m in done):
        print("\nTipp: „nur zugeschnitten“ heißt, der Hintergrund blieb stehen. Auf dem iPhone in Fotos das Motiv lange drücken → „Teilen“ → als PNG sichern, dann erneut importieren.")
    if done:
        print("\nWeiter mit:  python3 tools/web/build.py   (bringt die Fotos in die App)")


# ---------------------------------------------------------------- status

def cmd_status(args):
    catalog = load_catalog()
    selection = load_json(SELECTION, {})
    manifest = load_json(MANIFEST, {})
    rows = []
    for p in catalog["products"]:
        found = sum(len((cached(n, p["id"]) or {}).get("results", [])) for n in SOURCES)
        sel = selection.get(p["id"]) or {}
        state = ("fertig" if any((IMAGES_OUT / f"{p['id']}.{e}").exists() for e in ("png", "jpg")) and p["id"] in manifest
                 else "geladen" if p["id"] in manifest
                 else "ausgewählt" if sel.get("choice")
                 else "keins passt" if sel.get("none")
                 else f"{found} Kandidaten" if found else "offen")
        rows.append((p["name"], state))
    w = max(len(n) for n, _ in rows)
    for n, s in rows:
        print(f"  {n.ljust(w)}  {s}")
    done = sum(1 for _, s in rows if s == "fertig")
    print(f"\n{done} von {len(rows)} Produkten haben ein fertiges Foto.")


# ---------------------------------------------------------------- Auswahlseite

REVIEW_TEMPLATE = r"""<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FeedYourself – Fotoauswahl</title>
<style>
  :root { --bg:#F4F5F4; --surface:#FFFFFF; --surface2:#E2E4E2; --border:#DADDDA; --text:#1A1F1B; --text2:#5E665F; --accent:#2A7F3F; --accentInk:#237035; --accentSoft:#E2F0E3; --later:#3F5F8A; }
  @media (prefers-color-scheme: dark) { :root { --bg:#151213; --surface:#211C1D; --surface2:#2C2628; --border:#3A3234; --text:#ECECEA; --text2:#A9A9A5; --accent:#F5C400; --accentInk:#F5C400; --accentSoft:#3A3110; --later:#9BB8E6; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
  header { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; }
  h1 { margin: 0; font-size: 20px; } h1 span { color: var(--accentInk); }
  .progress { color: var(--text2); font-variant-numeric: tabular-nums; }
  .saved { color: var(--accentInk); font-size: 13px; min-width: 90px; }
  label.filter { display: flex; gap: 6px; align-items: center; color: var(--text2); cursor: pointer; }
  .credit-note { margin-left: auto; color: var(--text2); font-size: 13px; }
  .credit-note a, .meta a { color: var(--text2); }
  main { padding: 8px 24px 64px; max-width: 1400px; margin: 0 auto; }
  .warn { background: var(--accentSoft); padding: 10px 14px; border-radius: 10px; }
  section { margin-top: 22px; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; }
  section.done { opacity: 0.75; }
  .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin-bottom: 12px; }
  .head h2 { margin: 0; font-size: 18px; }
  .head .cat { color: var(--text2); font-size: 13px; }
  .head .state { margin-left: auto; font-size: 13px; font-weight: 600; color: var(--text2); }
  .head .state.ok { color: var(--accentInk); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
  .cand { position: relative; display: block; border-radius: 12px; overflow: hidden; border: 3px solid transparent; background: var(--surface2); cursor: pointer; }
  .cand input { position: absolute; opacity: 0; pointer-events: none; }
  .cand img { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; }
  .cand:has(input:checked) { border-color: var(--accent); }
  .cand:has(input:focus-visible) { outline: 2px solid var(--text); outline-offset: 2px; }
  .cand .tick { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; border-radius: 14px; background: var(--accent); color: var(--bg); display: none; align-items: center; justify-content: center; font-weight: 800; }
  .cand:has(input:checked) .tick { display: flex; }
  .meta { padding: 6px 8px 8px; font-size: 12px; color: var(--text2); background: var(--surface); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .none { display: flex; align-items: center; justify-content: center; text-align: center; padding: 12px; color: var(--text2); border: 2px dashed var(--border); border-radius: 12px; cursor: pointer; min-height: 120px; }
  .none:has(input:checked) { border-color: var(--later); color: var(--later); font-weight: 600; }
  .none input { position: absolute; opacity: 0; }
  .requery { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; font-size: 13px; color: var(--text2); }
  .requery input { flex: 1 1 220px; height: 34px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font: inherit; }
  .empty { color: var(--text2); }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>Feed<span>Yourself</span> · Fotoauswahl</h1>
  <span class="progress" id="progress"></span>
  <span class="saved" id="saved" role="status"></span>
  <label class="filter"><input type="checkbox" id="onlyOpen"> nur offene zeigen</label>
  <span class="credit-note">Fotos von <a href="https://pixabay.com/" target="_blank" rel="noopener">Pixabay</a> und <a href="https://www.pexels.com/" target="_blank" rel="noopener">Pexels</a></span>
</header>
<main>
{{WARN}}
<p class="empty">Pro Produkt ein Foto anklicken. Gut geeignet: ein einzelnes Produkt, ruhiger oder heller Hintergrund, keine Markenlogos, kein Text. Passt nichts, „Keins passt“ wählen und unten einen anderen englischen Suchbegriff eintragen – dann <code>photos.py fetch</code> erneut ausführen.</p>
<div id="list"></div>
</main>
<script>
const DATA = {{DATA}};
const sel = DATA.selection || {};
const list = document.getElementById('list');
const savedEl = document.getElementById('saved');
const progressEl = document.getElementById('progress');
const onlyOpen = document.getElementById('onlyOpen');
let saveTimer = null;

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function save() {
  clearTimeout(saveTimer);
  savedEl.textContent = 'speichert …';
  saveTimer = setTimeout(async () => {
    try {
      const r = await fetch('/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sel) });
      savedEl.textContent = r.ok ? 'gespeichert' : 'Fehler beim Speichern';
    } catch (e) { savedEl.textContent = 'Server nicht erreichbar'; }
  }, 250);
}

function progress() {
  const n = DATA.items.length;
  const done = DATA.items.filter(it => sel[it.id] && (sel[it.id].choice || sel[it.id].none)).length;
  progressEl.textContent = done + ' / ' + n + ' entschieden';
}

function render() {
  list.innerHTML = DATA.items.map(it => {
    const s = sel[it.id] || {};
    const decided = !!(s.choice || s.none);
    const state = s.choice ? '✓ ausgewählt' : s.none ? 'keins passt' : 'offen';
    const cands = it.candidates.map(c => {
      const val = c.source + ':' + c.id;
      return `<label class="cand" title="${esc(c.alt)}">
        <input type="radio" name="p-${esc(it.id)}" value="${esc(val)}" ${s.choice === val ? 'checked' : ''}>
        <img src="${esc(c.preview)}" alt="${esc(it.name)}: ${esc(c.alt)}" loading="lazy" referrerpolicy="no-referrer">
        <span class="tick" aria-hidden="true">✓</span>
        <span class="meta">${esc(c.author)} · <a href="${esc(c.page)}" target="_blank" rel="noopener">${c.source === 'pexels' ? 'Pexels' : 'Pixabay'}</a></span>
      </label>`;
    }).join('');
    return `<section data-id="${esc(it.id)}" class="${decided ? 'done' : ''}" ${onlyOpen.checked && decided ? 'hidden' : ''}>
      <div class="head"><h2>${esc(it.name)}</h2><span class="cat">${esc(it.category)} · Suche: „${esc(it.query)}“</span>
        <span class="state ${s.choice ? 'ok' : ''}">${state}</span></div>
      <div class="grid">${cands || '<span class="empty">Keine Treffer – anderen Suchbegriff eintragen.</span>'}
        <label class="none"><input type="radio" name="p-${esc(it.id)}" value="" ${s.none ? 'checked' : ''}>Keins passt</label>
      </div>
      <div class="requery"><label for="q-${esc(it.id)}">Anderer Suchbegriff (englisch):</label>
        <input id="q-${esc(it.id)}" data-q="${esc(it.id)}" value="${esc(s.query || '')}" placeholder="${esc(it.query)}"></div>
    </section>`;
  }).join('');
  progress();
}

list.addEventListener('change', e => {
  const t = e.target;
  if (t.type === 'radio') {
    const id = t.name.slice(2);
    const s = sel[id] = sel[id] || {};
    if (t.value) { s.choice = t.value; delete s.none; } else { s.none = true; delete s.choice; }
    save(); render();
  }
});
list.addEventListener('input', e => {
  const id = e.target.dataset.q;
  if (!id) return;
  const s = sel[id] = sel[id] || {};
  const v = e.target.value.trim();
  if (v) s.query = v; else delete s.query;
  save();
});
onlyOpen.addEventListener('change', render);
render();
</script>
</body>
</html>
"""


# ---------------------------------------------------------------- CLI

def main():
    ap = argparse.ArgumentParser(description="Fotos für den FeedYourself-Katalog abrufen, auswählen und aufbereiten.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fetch", help="Suchergebnisse pro Produkt abrufen (gecacht)")
    f.add_argument("--source", nargs="+", choices=list(SOURCES), default=["pixabay"], help="Bildquelle(n), Standard: pixabay")
    f.add_argument("--per-product", type=int, default=6, help="Kandidaten pro Produkt und Quelle (Standard 6)")
    f.add_argument("--only", nargs="+", metavar="ID", help="nur diese Produkt-IDs")
    f.add_argument("--refresh", action="store_true", help="Cache ignorieren und neu abfragen")
    f.add_argument("--no-isolated", action="store_true", help="„isolated“ nicht an den Suchbegriff hängen")
    f.add_argument("--yes", action="store_true", help="mehr als 150 Produkte auf einmal bestätigen")
    f.set_defaults(func=cmd_fetch)

    r = sub.add_parser("review", help="Auswahlseite im Browser öffnen")
    r.add_argument("--port", type=int, default=8765)
    r.add_argument("--no-browser", action="store_true", help="Browser nicht automatisch öffnen")
    r.add_argument("--html-only", action="store_true", help="nur work/review.html schreiben, kein Server")
    r.set_defaults(func=cmd_review)

    d = sub.add_parser("download", help="ausgewählte Fotos in voller Größe laden")
    d.add_argument("--force", action="store_true", help="auch schon geladene neu laden")
    d.set_defaults(func=cmd_download)

    p = sub.add_parser("process", help="freistellen, 600×600, nach Catalog/Images/")
    p.add_argument("--size", type=int, default=600)
    p.add_argument("--margin", type=float, default=0.08, help="Rand um das Motiv (Anteil, Standard 0.08)")
    p.set_defaults(func=cmd_process)

    i = sub.add_parser("import", help="eigene Fotos aus Catalog/Inbox/ übernehmen (Dateiname = Produkt)")
    i.add_argument("--size", type=int, default=480, help="Kantenlänge in Pixeln (Standard 480)")
    i.add_argument("--margin", type=float, default=0.06)
    i.add_argument("--keep", action="store_true", help="Dateien nach dem Import in der Inbox lassen")
    i.add_argument("--mit-hintergrund", action="store_true", help="nicht freistellen – Fotos randlos mit Hintergrund übernehmen")
    i.set_defaults(func=cmd_import)

    s = sub.add_parser("status", help="Stand pro Produkt anzeigen")
    s.set_defaults(func=cmd_status)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
