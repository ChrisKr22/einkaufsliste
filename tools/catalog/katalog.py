#!/usr/bin/env python3
"""FeedYourself – Produktkatalog prüfen und als lesbare Übersicht ausgeben.

  python3 tools/catalog/katalog.py           prüft Catalog/catalog.json und schreibt Catalog/KATALOG.md
  python3 tools/catalog/katalog.py --check   nur prüfen (Rückgabewert 1 bei Fehlern)
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "Catalog" / "catalog.json"
OVERVIEW = ROOT / "Catalog" / "KATALOG.md"
IMAGES = ROOT / "Catalog" / "Images"
ID_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def norm(s):
    s = s.lower().strip()
    for a, b in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")):
        s = s.replace(a, b)
    return s


def check(catalog):
    errors, notes = [], []
    cat_ids = [c["id"] for c in catalog["categories"]]
    if len(set(cat_ids)) != len(cat_ids):
        errors.append("Kategorie-IDs sind nicht eindeutig.")
    seen_ids, seen_names = {}, {}
    for p in catalog["products"]:
        pid, name = p.get("id", ""), p.get("name", "")
        if not ID_PATTERN.match(pid):
            errors.append(f"Ungültige ID „{pid}“ ({name}): nur a–z, 0–9 und Bindestrich.")
        if pid in seen_ids:
            errors.append(f"Doppelte ID „{pid}“: {seen_ids[pid]} und {name}.")
        seen_ids[pid] = name
        if norm(name) in seen_names:
            errors.append(f"Doppelter Name „{name}“.")
        seen_names[norm(name)] = pid
        if p.get("category") not in cat_ids:
            errors.append(f"{name}: unbekannte Kategorie „{p.get('category')}“.")
        syn = [s.lower().strip() for s in p.get("synonyms", [])]
        if len(set(syn)) != len(syn):
            errors.append(f"{name}: Synonym doppelt.")
        if name.lower().strip() in syn:
            errors.append(f"{name}: Name steht auch bei den Synonymen.")

    # Hinweise: Suchwörter, die mehrere Produkte finden (meist gewollt, z. B. „Nudeln“).
    shared, spelling = defaultdict(list), {}
    for p in catalog["products"]:
        for s in p.get("synonyms", []):
            if norm(s) == norm(p["name"]):
                continue  # z. B. Äpfel/Apfel: gleiches Produkt, nur andere Schreibweise
            shared[norm(s)].append(p["name"])
            spelling.setdefault(norm(s), s)
    for key, names in sorted(shared.items()):
        term = spelling[key]
        if key in seen_names:
            notes.append(f"„{term}“ ist ein eigenes Produkt und zugleich Synonym bei: {', '.join(names)}")
        elif len(names) > 1:
            notes.append(f"„{term}“ findet {len(names)} Produkte: {', '.join(names)}")
    return errors, notes


def render(catalog, notes):
    by_cat = defaultdict(list)
    for p in catalog["products"]:
        by_cat[p["category"]].append(p)
    total = len(catalog["products"])
    syn_total = sum(len(p.get("synonyms", [])) for p in catalog["products"])
    with_img = sum(1 for p in catalog["products"] if any((IMAGES / f"{p['id']}.{e}").exists() for e in ("png", "jpg")))
    from_user = sum(1 for p in catalog["products"] if p.get("origin") == "nutzer")
    suggested = sum(1 for p in catalog["products"] if p.get("origin") == "vorschlag")

    out = [
        "# Produktkatalog – Übersicht",
        "",
        "Automatisch erzeugt aus `Catalog/catalog.json` mit `python3 tools/catalog/katalog.py`.",
        "Änderungen bitte in `catalog.json` machen (oder mir sagen), nicht hier.",
        "",
        f"**{total} Produkte · {len(catalog['categories'])} Kategorien · {syn_total} Synonyme · "
        f"{from_user} aus deiner Liste (●) · {suggested} aus Vorschlägen (◆) · {with_img} mit Foto**",
        "",
        "| # | Kategorie | Produkte | davon aus deiner Liste |",
        "|---|-----------|----------|------------------------|",
    ]
    for i, c in enumerate(catalog["categories"], 1):
        items = by_cat[c["id"]]
        mine = sum(1 for p in items if p.get("origin") == "nutzer")
        out.append(f"| {i} | [{c['name']}](#{anchor(c['name'])}) | {len(items)} | {mine} |")
    for c in catalog["categories"]:
        items = by_cat[c["id"]]
        out += ["", f"## {c['name']}", "", "| | Produkt | Synonyme (Suchwörter) | ID | Foto-Suche (optional) |",
                "|---|---------|------------------------|----|-----------------------|"]
        for p in items:
            syn = ", ".join(p.get("synonyms", [])) or "–"
            mark = {"nutzer": "●", "vorschlag": "◆"}.get(p.get("origin"), "")
            out.append(f"| {mark} | **{p['name']}** | {syn} | `{p['id']}` | {p.get('query_en', '')} |")
    if notes:
        out += ["", "## Hinweise zur Suche", "",
                "Suchwörter, die mehrere Produkte finden. Meist gewollt (wer „Nudeln“ tippt, sieht alle Sorten); "
                "bitte prüfen, ob alles passt.", ""]
        out += [f"- {n}" for n in notes]
    return "\n".join(out) + "\n"


def anchor(title):
    a = title.lower()
    a = re.sub(r"[^\w\- ]", "", a)
    return a.replace(" ", "-")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="nur prüfen, keine Übersicht schreiben")
    args = ap.parse_args()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    errors, notes = check(catalog)
    for e in errors:
        print("FEHLER:", e)
    if errors:
        sys.exit(1)
    print(f"OK: {len(catalog['products'])} Produkte in {len(catalog['categories'])} Kategorien.")
    if not args.check:
        OVERVIEW.write_text(render(catalog, notes), encoding="utf-8")
        print(f"Übersicht geschrieben: {OVERVIEW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
