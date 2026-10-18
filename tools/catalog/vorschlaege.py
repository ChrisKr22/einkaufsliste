#!/usr/bin/env python3
"""FeedYourself – Katalog-Vorschläge aus der App prüfen und übernehmen.

Nutzer schicken über Einstellungen › „Für den Katalog vorschlagen“ eine Nachricht mit einem
Code (FY-KATALOG:…). Die Nachricht als Textdatei in Catalog/Vorschlaege/ ablegen
oder direkt aus der Zwischenablage lesen lassen.

  python3 tools/catalog/vorschlaege.py                      alle Vorschläge in Catalog/Vorschlaege/ anzeigen
  pbpaste | python3 tools/catalog/vorschlaege.py -          Vorschlag aus der Zwischenablage anzeigen
  python3 tools/catalog/vorschlaege.py --uebernehmen 1,3    Nummern 1 und 3 in den Katalog übernehmen
  python3 tools/catalog/vorschlaege.py --alle               alle neuen übernehmen

Freigabe aus der App (Pflegemodus › „Vorschläge prüfen“ › „Freigabe teilen“, Code FY-FREIGABE:…):

  pbpaste | python3 tools/catalog/vorschlaege.py --freigabe -   aufgenommene in den Katalog, abgelehnte nach Catalog/abgelehnt.json

Übernommene Produkte bekommen origin „vorschlag“; danach wie gewohnt build.py ausführen.
Dateien, deren Vorschläge alle im Katalog sind, wandern nach Catalog/Vorschlaege/erledigt/.
"""

import argparse
import base64
import json
import re
import shutil
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import katalog  # noqa: E402  (prüfen und Übersicht schreiben)

ROOT = katalog.ROOT
INBOX = ROOT / "Catalog" / "Vorschlaege"
DONE = INBOX / "erledigt"
MARKER = re.compile(r"FY-KATALOG:([zj][A-Za-z0-9_-]+)")
RELEASE_MARKER = re.compile(r"FY-FREIGABE:([zj][A-Za-z0-9_-]+)")
REJECTED = ROOT / "Catalog" / "abgelehnt.json"
MAX_RELEASE_ITEMS = 200
MAX_UNPACKED = 1_000_000   # Bytes – ein präparierter Code soll nicht den Speicher füllen
UNITS = {"stk", "pck", "g", "kg", "ml", "l"}
FALLBACK = "sonst"


def rel(path):
    try:
        return path.relative_to(ROOT)
    except ValueError:
        return path


def unpack(code):
    """Gegenstück zu packJson in der App: z… = deflate-raw + Base64url, j… = nur Base64url."""
    raw = base64.urlsafe_b64decode(code[1:] + "=" * (-len(code[1:]) % 4))
    if code[0] == "z":
        inflater = zlib.decompressobj(-15)
        data = inflater.decompress(raw, MAX_UNPACKED)
        if inflater.unconsumed_tail:
            raise ValueError("zu groß")
    else:
        data = raw
    payload = json.loads(data.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("unbekanntes Format")
    return payload


def decode(code):
    payload = unpack(code)
    if payload.get("v") != 1 or not isinstance(payload.get("p"), list):
        raise ValueError("unbekanntes Format")
    return payload["p"]


def read_sources(use_stdin):
    """[(Quelle, Datei oder None, [Vorschläge])]"""
    sources = []
    texts = [("Zwischenablage", None, sys.stdin.read())] if use_stdin else [
        (f.name, f, f.read_text(encoding="utf-8", errors="replace"))
        for f in sorted(INBOX.glob("*")) if f.is_file() and f.suffix.lower() in (".txt", ".md", "")]
    for label, path, text in texts:
        rows = []
        for code in MARKER.findall(text):
            try:
                rows += decode(code)
            except (ValueError, zlib.error, json.JSONDecodeError) as error:
                print(f"Hinweis: {label} enthält einen beschädigten Code ({error}) – übersprungen.")
        if rows:
            sources.append((label, path, rows))
        elif path is not None or use_stdin:
            print(f"Hinweis: In {label} steht kein Katalog-Vorschlag (FY-KATALOG:…).")
    return sources


def printable(text):
    """Steuerzeichen (z. B. ANSI-Farbcodes) aus fremden Nachrichten entfernen – sie könnten die Anzeige im Terminal verfälschen."""
    return "".join(ch for ch in str(text) if ch.isprintable())


def slug(name, taken):
    s = katalog.norm(name)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "produkt"
    candidate, n = s, 2
    while candidate in taken:
        candidate, n = f"{s}-{n}", n + 1
    return candidate


def insert_product(catalog, product):
    """Hinter das letzte Produkt derselben Kategorie, sonst ans Ende – catalog.json bleibt nach Kategorien gegliedert."""
    products = catalog["products"]
    last = max((n for n, p in enumerate(products) if p.get("category") == product["category"]), default=len(products) - 1)
    products.insert(last + 1, product)


def collect(sources, catalog):
    """Fasst gleiche Vorschläge zusammen und vergleicht mit dem Katalog."""
    known = {}
    for p in catalog["products"]:
        known[katalog.norm(p["name"])] = p["name"]
        for s in p.get("synonyms", []):
            known.setdefault(katalog.norm(s), p["name"])
    categories = {c["id"]: c["name"] for c in catalog["categories"]}
    merged = {}
    for label, _, rows in sources:
        for row in rows:
            name = printable(row.get("n", "")).strip()[:80]
            if not name:
                continue
            item = merged.setdefault(katalog.norm(name), {
                "name": name, "category": row.get("k"), "category_name": printable(row.get("kn") or "") or None,
                "unit": row.get("u") if row.get("u") in UNITS else None,
                "synonyms": [printable(s)[:80] for s in row.get("y", []) if isinstance(s, str)][:10],
                "count": 0, "from": set(),
            })
            item["count"] += int(row.get("c") or 0)
            item["from"].add(label)
    rejected = {katalog.norm(r.get("name", "")) for r in load_rejected() if isinstance(r, dict)}
    items = []
    for key, item in merged.items():
        item["in_catalog"] = known.get(key)
        item["rejected_before"] = key in rejected
        if item["category"] not in categories:
            item["category_note"] = f"„{item['category_name'] or printable(item['category'] or '') or '?'}“ gibt es im Katalog nicht → Sonstiges"
            item["category"] = FALLBACK
        item["category_label"] = categories.get(item["category"], item["category"])
        items.append(item)
    items.sort(key=lambda i: (i["in_catalog"] is not None, katalog.norm(i["name"])))
    return items


def show(items):
    if not items:
        print(f"Keine Vorschläge. Nachrichten als .txt nach {rel(INBOX)}/ legen oder mit „pbpaste | … -“ einlesen.")
        return
    for n, i in enumerate(items, 1):
        if i["in_catalog"]:
            print(f"     {i['name']:28} schon im Katalog (als {i['in_catalog']})")
            continue
        extra = [i["category_label"]]
        if i["unit"]:
            extra.append(f"Einheit {i['unit']}")
        if i["synonyms"]:
            extra.append("Synonyme: " + ", ".join(i["synonyms"]))
        if i["count"]:
            extra.append(f"{i['count']}× gekauft")
        print(f"{n:3}. {i['name']:28} {' · '.join(extra)}   [{', '.join(sorted(i['from']))}]")
        if i.get("category_note"):
            print(f"     ↳ Kategorie {i['category_note']}")
        if i.get("rejected_before"):
            print(f"     ↳ früher abgelehnt (siehe {rel(REJECTED)})")


def adopt(items, numbers, catalog):
    taken = {p["id"] for p in catalog["products"]}
    added = []
    for n in numbers:
        if not 1 <= n <= len(items):
            sys.exit(f"Nummer {n} gibt es nicht.")
        i = items[n - 1]
        if i["in_catalog"]:
            print(f"Übersprungen: {i['name']} ist schon im Katalog.")
            continue
        product = {"id": slug(i["name"], taken), "name": i["name"], "category": i["category"],
                   "synonyms": [s for s in i["synonyms"] if katalog.norm(s) != katalog.norm(i["name"])]}
        if i["unit"] and i["unit"] != "stk":
            product["unit"] = i["unit"]
        product["origin"] = "vorschlag"
        taken.add(product["id"])
        insert_product(catalog, product)
        i["in_catalog"] = i["name"]
        added.append(product)
    if not added:
        return []
    errors, notes = katalog.check(catalog)
    if errors:
        for e in errors:
            print("FEHLER:", e)
        sys.exit("Nichts übernommen – bitte die Fehler oben prüfen.")
    catalog["version"] = int(catalog.get("version", 0)) + 1
    katalog.CATALOG.write_text(katalog.dump(catalog), encoding="utf-8")
    katalog.OVERVIEW.write_text(katalog.render(catalog, notes), encoding="utf-8")
    return added


def tidy(sources, catalog):
    """Dateien, deren Vorschläge jetzt alle im Katalog stehen, nach erledigt/ verschieben."""
    known = {katalog.norm(p["name"]) for p in catalog["products"]}
    known |= {katalog.norm(s) for p in catalog["products"] for s in p.get("synonyms", [])}
    for label, path, rows in sources:
        if path and all(katalog.norm(str(r.get("n", ""))) in known for r in rows):
            DONE.mkdir(parents=True, exist_ok=True)
            shutil.move(str(path), DONE / path.name)
            print(f"Erledigt: {label} → {rel(DONE)}/")


def load_rejected():
    try:
        data = json.loads(REJECTED.read_text(encoding="utf-8"))
        return data.get("abgelehnt", []) if isinstance(data, dict) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def read_release(text):
    """Freigabe-Codes aus einem Text → (aufgenommen, abgelehnt). Wirft ValueError bei kaputtem oder fremdem Code."""
    codes = RELEASE_MARKER.findall(text)
    if not codes:
        raise ValueError("Keine Freigabe gefunden (FY-FREIGABE:…).")
    accepted, rejected = [], []
    for code in codes:
        try:
            payload = unpack(code)
        except (zlib.error, json.JSONDecodeError, UnicodeDecodeError, ValueError) as error:
            raise ValueError(f"Freigabe beschädigt ({error}).")
        if payload.get("v") != 1 or not isinstance(payload.get("a"), list) or not isinstance(payload.get("r"), list):
            raise ValueError("Unbekanntes Freigabe-Format.")
        accepted += payload["a"]
        rejected += payload["r"]
    if len(accepted) + len(rejected) > MAX_RELEASE_ITEMS:
        raise ValueError(f"Mehr als {MAX_RELEASE_ITEMS} Einträge – das kommt nicht aus der App.")
    return accepted, rejected


def apply_release(accepted, rejected, catalog, rejected_list, today):
    """Aufgenommene in den Katalog (Kopie), abgelehnte in die Abgelehnt-Liste. → (katalog, liste, aufgenommen, übersprungen)"""
    catalog = json.loads(json.dumps(catalog))
    rejected_list = [dict(r) for r in rejected_list]
    categories = {c["id"] for c in catalog["categories"]}
    known = {}
    for p in catalog["products"]:
        known[katalog.norm(p["name"])] = p["name"]
        for s in p.get("synonyms", []):
            known.setdefault(katalog.norm(s), p["name"])
    taken = {p["id"] for p in catalog["products"]}
    added, skipped = [], []
    for row in accepted:
        if not isinstance(row, dict):
            continue
        name = printable(row.get("n", "")).strip()[:80]
        if not name:
            continue
        if katalog.norm(name) in known:
            skipped.append(f"{name}: schon im Katalog (als {known[katalog.norm(name)]})")
            continue
        category = row.get("k") if row.get("k") in categories else FALLBACK
        if category != row.get("k"):
            skipped.append(f"{name}: Kategorie „{printable(row.get('k') or '?')}“ unbekannt → Sonstiges")
        synonyms = []
        for s in row.get("y", []) if isinstance(row.get("y"), list) else []:
            s = printable(s).strip()[:80] if isinstance(s, str) else ""
            if s and katalog.norm(s) != katalog.norm(name) and katalog.norm(s) not in {katalog.norm(x) for x in synonyms}:
                synonyms.append(s)
        product = {"id": slug(name, taken), "name": name, "category": category, "synonyms": synonyms[:10]}
        if row.get("u") in UNITS and row.get("u") != "stk":
            product["unit"] = row["u"]
        product["origin"] = "vorschlag"
        taken.add(product["id"])
        known[katalog.norm(name)] = name
        insert_product(catalog, product)
        added.append(product)
    seen = {katalog.norm(r.get("name", "")) for r in rejected_list}
    for name in rejected:
        name = printable(name).strip()[:80] if isinstance(name, str) else ""
        if name and katalog.norm(name) not in seen:
            rejected_list.append({"name": name, "datum": today})
            seen.add(katalog.norm(name))
    if added:
        catalog["version"] = int(catalog.get("version", 0)) + 1
    return catalog, rejected_list, added, skipped


def cmd_release(text):
    from datetime import date
    try:
        accepted, rejected = read_release(text)
    except ValueError as error:
        sys.exit(str(error))
    catalog = json.loads(katalog.CATALOG.read_text(encoding="utf-8"))
    before = load_rejected()
    catalog, rejected_list, added, skipped = apply_release(accepted, rejected, catalog, before, date.today().isoformat())
    if added:
        errors, notes = katalog.check(catalog)
        if errors:
            for e in errors:
                print("FEHLER:", e)
            sys.exit("Nichts übernommen – bitte die Fehler oben prüfen.")
        katalog.CATALOG.write_text(katalog.dump(catalog), encoding="utf-8")
        katalog.OVERVIEW.write_text(katalog.render(catalog, notes), encoding="utf-8")
    if len(rejected_list) != len(before):
        REJECTED.write_text(json.dumps({"hinweis": "Abgelehnte Katalog-Vorschläge (nur für vorschlaege.py, wird nicht ausgeliefert).",
                                        "abgelehnt": rejected_list}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for p in added:
        print(f"Aufgenommen: {p['name']} ({p['category']}) als „{p['id']}“")
    for name in rejected:
        print(f"Abgelehnt:   {printable(name)}")
    for note in skipped:
        print(f"Hinweis:     {note}")
    if added:
        print(f"\nKatalog-Version {catalog['version']}. Weiter mit:  python3 tools/web/build.py   – dann committen und pushen.")
    elif rejected:
        print(f"\nNur Ablehnungen – in {rel(REJECTED)} vermerkt. Committen nicht vergessen.")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("quelle", nargs="?", help="„-“ liest einen Vorschlag von der Standardeingabe (z. B. pbpaste)")
    ap.add_argument("--uebernehmen", metavar="NR", help="Nummern aus der Liste, z. B. 1,3,4")
    ap.add_argument("--alle", action="store_true", help="alle neuen Vorschläge übernehmen")
    ap.add_argument("--freigabe", action="store_true", help="Freigabe aus der App übernehmen (mit „-“ von der Standardeingabe)")
    args = ap.parse_args()

    if args.freigabe:
        cmd_release(sys.stdin.read() if args.quelle == "-" else
                    (Path(args.quelle).read_text(encoding="utf-8") if args.quelle else sys.exit("Freigabe mit „-“ (Standardeingabe) oder einer Datei angeben.")))
        return

    INBOX.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(katalog.CATALOG.read_text(encoding="utf-8"))
    sources = read_sources(args.quelle == "-")
    items = collect(sources, catalog)

    if args.uebernehmen or args.alle:
        numbers = ([n for n, i in enumerate(items, 1) if not i["in_catalog"]] if args.alle
                   else [int(x) for x in re.split(r"[,\s]+", args.uebernehmen.strip()) if x])
        added = adopt(items, numbers, catalog)
        for p in added:
            print(f"Übernommen: {p['name']} ({p['category']}) als „{p['id']}“")
        if added:
            print(f"\nKatalog-Version {catalog['version']}. Weiter mit:  python3 tools/web/build.py")
        tidy(sources, catalog)
        return
    show(items)
    if any(not i["in_catalog"] for i in items):
        print("\nÜbernehmen mit:  python3 tools/catalog/vorschlaege.py --uebernehmen 1,2   (oder --alle)")


if __name__ == "__main__":
    main()
