# Fotos für den Basis-Katalog

Werkzeug, um lizenzfreie Produktfotos für FeedYourself zu finden, auszuwählen und einheitlich aufzubereiten.
Läuft nur auf dem Mac während der Entwicklung, die App selbst bleibt offline.

```
Catalog/catalog.json ──fetch──▶ Suchergebnisse (Cache) ──review──▶ deine Auswahl
                                                                     │
Catalog/Images/<id>.png ◀──process── work/selected/<id>.jpg ◀──download─┘
Catalog/image-credits.json
```

## Einmalig einrichten

1. **API-Schlüssel holen** (kostenlos):
   - Pixabay: Konto anlegen, dann unter https://pixabay.com/api/docs/ den Schlüssel kopieren.
   - Pexels (optional): https://www.pexels.com/api/ → „Your API Key“.
2. **Schlüssel im macOS-Schlüsselbund speichern** (empfohlen):
   ```bash
   security add-generic-password -a "$USER" -s feedyourself-pixabay -w
   ```
   Das Terminal fragt nach dem Passwort: Schlüssel einfügen (die Eingabe bleibt unsichtbar), Enter, zur Bestätigung noch einmal.
   Für Pexels genauso mit `-s feedyourself-pexels`. Prüfen, ob es geklappt hat (zeigt den Schlüssel an):
   ```bash
   security find-generic-password -s feedyourself-pixabay -w
   ```
   Schlüssel austauschen: denselben `add`-Befehl mit `-U` am Anfang der Optionen; löschen: `security delete-generic-password -s feedyourself-pixabay`.

   **Alternative:** Vorlage kopieren und den Schlüssel als Klartext eintragen. `api-keys.env` steht in `.gitignore` und landet nicht im Repository.
   ```bash
   cp tools/photos/api-keys.env.example tools/photos/api-keys.env
   ```
   Reihenfolge, falls mehrere vorhanden: Umgebungsvariable → Schlüsselbund → `api-keys.env`.
3. Voraussetzungen: Python 3 (vorhanden) und Xcode oder die Command Line Tools (für `swiftc`).

## Ablauf

Alle Befehle im Projektordner ausführen.

**1. Suchergebnisse abrufen**: eine Suche pro Produkt, 6 Kandidaten, 24 h im Cache.
```bash
python3 tools/photos/photos.py fetch
```
Optionen: `--source pixabay pexels` (beide Quellen), `--only aepfel tomaten` (nur bestimmte Produkte), `--per-product 8`, `--refresh`.
An den Suchbegriff wird automatisch „isolated“ angehängt (Fotos auf weißem Grund); bei zu wenigen Treffern wird ohne gesucht.

**2. Auswählen**: öffnet eine Seite im Browser, die Auswahl wird automatisch gespeichert.
```bash
python3 tools/photos/photos.py review
```
Pro Produkt ein Foto anklicken. Passt keins: „Keins passt“ wählen und einen anderen englischen Suchbegriff eintragen. Danach `fetch` erneut ausführen; nur geänderte Produkte werden neu gesucht. Beenden mit `Ctrl+C`.

Gut geeignet sind Fotos mit einem einzelnen Produkt auf **hellem, ruhigem Hintergrund**, ohne Markenlogo und ohne Text.

**3. Ausgewählte Fotos laden**: nur die ausgewählten, in voller Größe.
```bash
python3 tools/photos/photos.py download
```

**4. Aufbereiten**: freistellen, 600×600 px, transparentes PNG.
```bash
python3 tools/photos/photos.py process
```
Ergebnis: `Catalog/Images/<produkt-id>.png` und `Catalog/image-credits.json` (Quelle, Fotograf:in, Lizenz).

**Zwischendurch:** `python3 tools/photos/photos.py status` zeigt den Stand je Produkt.

## Freistellen: wie es funktioniert

`cutout.swift` versucht nacheinander:

| Verfahren | Wann | Ergebnis |
|-----------|------|----------|
| Apple Vision (`VNGenerateForegroundInstanceMaskRequest`) | nur auf **Apple-Silicon-Macs** (M1 und neuer) | erkennt das Motiv auf jedem Hintergrund |
| Heller Hintergrund vom Rand her entfernen | auf jedem Mac, wenn der Bildrand überwiegend hell und einfarbig ist | gut bei „isolated“-Fotos auf Weiß |
| Quadratisch zuschneiden | wenn beides nicht klappt | kein transparenter Hintergrund; `process` listet diese Produkte auf, dann besser ein anderes Foto wählen |

Auf einem Intel-Mac gibt es nur Verfahren 2 und 3. Deshalb lohnt es sich dort besonders, Fotos mit weißem Hintergrund auszuwählen.

## Regeln der Bildquellen (Stand Oktober 2026)

- **Pixabay** ([API-Doku](https://pixabay.com/api/docs/)): Ergebnisse 24 h cachen, kein dauerhaftes Hotlinking (Bilder selbst speichern ist erwünscht), max. 100 Anfragen/Minute. **Automatisierte Massenabfragen und systematische Massen-Downloads sind verboten.** Deshalb arbeitet das Werkzeug so:
  - eine Suche pro Produkt, gedrosselt auf 1 Anfrage pro Sekunde,
  - Vorschaubilder werden nur zur Auswahl angezeigt, nicht heruntergeladen,
  - heruntergeladen wird nur das eine ausgewählte Foto,
  - mehr als 150 Produkte auf einmal nur mit `--yes`. Für den vollen Katalog lieber in Etappen (`--only`) arbeiten.
  - Bei Anzeige der Ergebnisse ist die Quelle zu nennen; das macht die Auswahlseite.
- **Pexels** ([API-Doku](https://www.pexels.com/api/documentation/)): 200 Anfragen/Stunde (das Werkzeug wartet 18,5 s zwischen Anfragen), sichtbarer Link zu Pexels und Nennung der Fotograf:innen erwünscht. → In der App kommt eine Seite „Bildnachweise“ in die Einstellungen, gespeist aus `image-credits.json`.
- **Unsplash** wird bewusst nicht per API genutzt: deren Richtlinien verlangen, Bilder von Unsplash-Servern zu laden statt sie mitzuliefern.

## Dateien

| Pfad | Inhalt |
|------|--------|
| `Catalog/catalog.json` | Produkte mit ID, Name, Kategorie, Synonymen, englischem Suchbegriff |
| `tools/photos/photos.py` | Hauptskript (nur Python-Standardbibliothek) |
| `tools/photos/cutout.swift` | Freistellen und Zuschneiden (wird beim ersten `process` kompiliert) |
| `tools/photos/api-keys.env` | deine API-Schlüssel (nicht im Repository) |
| `tools/photos/work/` | Cache, Auswahl, Downloads, kompiliertes Werkzeug (nicht im Repository) |
| `Catalog/Images/` | fertige Produktbilder für die App |
| `Catalog/image-credits.json` | Bildnachweise |
