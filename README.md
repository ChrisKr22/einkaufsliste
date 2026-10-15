# FeedYourself

Interaktive Einkaufsliste fürs iPhone, als **Web-App (PWA)**: läuft in Safari, wird über „Zum Home-Bildschirm“ installiert und funktioniert danach offline.
Konzept: [KONZEPT.md](KONZEPT.md) · Katalog: [Catalog/KATALOG.md](Catalog/KATALOG.md)

## Aufbau

```
web/                    die App (wird so, wie sie ist, veröffentlicht)
  index.html            Seite
  css/app.css           Farbwelt hell/dunkel aus dem Konzept
  js/app.js             Start: Speicher öffnen, Katalog übernehmen, Ansichten verbinden
  js/list-model.js      Zustand und Aktionen der Liste für Planen und Einkaufen (ohne DOM, testbar)
  js/search.js          tolerante Suche (Umlaute, Synonyme, Tippfehler)
  js/photo.js           eigene Fotos auf dem Gerät aufbereiten und freistellen
  js/data/              Repository (Liste, Produkte) und Katalog-Import
  js/storage/           IndexedDB-Speicher und Ersatzspeicher für Tests
  js/views/             Planungs- und Einkaufsansicht, Bearbeiten-Sheet, Helfer
  sw.js                 Service Worker für den Offline-Modus
  data/catalog.json     Kopie von Catalog/catalog.json (vom Build-Skript)
  images/               Katalogfotos aus Catalog/Images/ (vom Build-Skript)
  tests/                Node-Tests
Catalog/                Produktkatalog (Quelle), Übersicht, Inbox für Fotos, fertige Bilder (Images/)
tools/web/              Build-Skript, Icon-Erzeugung
tools/catalog/          Katalog prüfen und Übersicht erzeugen
tools/photos/           Foto-Werkzeug: Ordner-Import (import) und optional Pixabay/Pexels
FeedYourself.xcodeproj  zurückgestelltes SwiftUI-Projekt (braucht Xcode 16+), nur noch als Referenz
```

Ansichten sprechen nur mit dem `ListModel`, das Modell nur mit dem `ShoppingRepository`.
Der Speicher (IndexedDB) steckt ausschließlich in `js/storage/` – so lässt sich später ein Sync ergänzen.

## Arbeiten an der App

Nach jeder Änderung an `web/` oder am Katalog:

```bash
python3 tools/web/build.py
```

Das kopiert den Katalog und aktualisiert die Offline-Liste im Service Worker. Installierte Apps holen sich die neue Fassung beim nächsten Öffnen mit Internet.

Tests (Node.js 20 oder neuer):

```bash
cd web && npm test
```

Lokal im Browser ansehen (auf dem Mac):

```bash
cd web && python3 -m http.server 8000
```

Dann http://localhost:8000 öffnen. Für das iPhone braucht es HTTPS, also das Veröffentlichen (unten).

## Veröffentlichen (GitHub Pages) und aufs iPhone

Die App wird über GitHub Pages veröffentlicht. Bei jedem Hochladen auf `main` prüft und testet der Workflow `.github/workflows/pages.yml` die App und veröffentlicht den Ordner `web/`.

**Einmalig einrichten**
1. Konto auf github.com anlegen. Unter *Settings › Emails* „Keep my email addresses private“ einschalten.
2. **GitHub Desktop** installieren (desktop.github.com) und mit dem Konto anmelden.
3. In GitHub Desktop: *File › Add Local Repository* → diesen Projektordner wählen → „create a repository“ → bei *Git Ignore* und *License* jeweils **None** lassen → *Create Repository*.
4. *Publish repository* → Name `einkaufsliste` (klein geschrieben – die Adresse unterscheidet Groß/Klein) → **„Keep this code private“ ausschalten** (GitHub Pages ist im kostenlosen Konto nur für öffentliche Repositories verfügbar) → *Publish*.
5. Auf github.com im Repository: *Settings › Pages* → bei *Source* **GitHub Actions** wählen.
6. Unter *Actions* läuft „Web-App veröffentlichen“ (≈ 1 Minute). Danach ist die App erreichbar unter
   https://chriskr22.github.io/einkaufsliste/

**Schutz-Einstellungen im Repository** (einmalig, unter *Settings*)
- *General › Features*: **Issues**, Wikis, Projects und Discussions ausschalten.
- *Rules › Rulesets › New branch ruleset*: Name `main schützen`, *Active*, Ziel *Include default branch*, **Restrict deletions** und **Block force pushes** anhaken.
- *Actions › General*: bei „Fork pull request workflows from outside collaborators“ **Require approval for all external contributors** wählen.
- *Advanced Security*: **Push protection** (Schutz vor versehentlich hochgeladenen Schlüsseln) muss aktiv sein.

**Auf dem iPhone installieren**
1. Die Adresse in **Safari** öffnen.
2. Teilen-Knopf → **„Zum Home-Bildschirm“** → „Als Web-App öffnen“ eingeschaltet lassen → *Hinzufügen*.
3. Die App einmal **mit Internet** über das neue Symbol öffnen – dabei speichert sie sich für den Offline-Betrieb.
4. Ab jetzt funktioniert sie auch ohne Netz. Die Daten liegen nur auf diesem iPhone (Sicherung: Einstellungen › Sicherung).

**Aktualisieren**
Änderungen in GitHub Desktop committen und *Push origin* klicken. Die installierte App holt sich die neue Fassung beim nächsten Öffnen mit Internet und zeigt sie ab dem darauffolgenden Start.

**Gut zu wissen**
- Öffentlich sind nur der Code und der Katalog – deine Einkaufsliste nie, sie bleibt auf dem Gerät.
- Geteilte Listen (Link) funktionieren nur mit dieser Adresse. Wer sie als App auf dem Home-Bildschirm nutzt, fügt geteilte Nachrichten unter *Einstellungen › Geteilte Liste einfügen* ein.

## Fotos für den Katalog

Fotos nach `Catalog/Inbox/` legen, der Dateiname bestimmt das Produkt (z. B. `Olivenöl.jpg`). Dann:

```bash
python3 tools/photos/photos.py import
```

```bash
python3 tools/web/build.py
```

Details: [Catalog/Inbox/LIESMICH.md](Catalog/Inbox/LIESMICH.md). Eigene Fotos einzelner Produkte nimmt man direkt in der App auf (Bearbeiten-Fenster › „Foto ändern“).

## Katalog ändern

`Catalog/catalog.json` bearbeiten, `"version"` um 1 erhöhen, dann prüfen und bauen:

```bash
python3 tools/catalog/katalog.py
```

```bash
python3 tools/web/build.py
```

Beim nächsten Start ergänzt die App neue Produkte und Kategorien und aktualisiert Synonyme. Umbenennungen und die Reihenfolge, die man in der App geändert hat, bleiben erhalten.

## Rechte

© 2026 ChrisKr22. Alle Rechte vorbehalten.

Der Code ist öffentlich einsehbar, steht aber **unter keiner Open-Source-Lizenz**. Ansehen und Forken auf GitHub ist im Rahmen der GitHub-Nutzungsbedingungen möglich; Kopieren, Weiterverwenden, Verändern oder Veröffentlichen außerhalb davon ist ohne ausdrückliche Erlaubnis nicht gestattet.
