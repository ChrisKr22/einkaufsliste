# Fotos für den Basis-Katalog

Fotos hier ablegen. **Der Dateiname bestimmt das Produkt** – Name, ID oder ein eindeutiges Synonym aus `Catalog/catalog.json`, Groß-/Kleinschreibung und Umlaute egal:

- `Äpfel.jpg`, `aepfel.png`, `Apfel.heic` → Äpfel
- `Olivenöl.jpg`, `olivenoel.jpg` → Olivenöl
- `Möhren.png` → Karotten (Synonym)

**Quelle im Dateinamen:** Hinter das Schlagwort einen Unterstrich und den Original-Dateinamen setzen. Der Import trägt die Quelle dann selbst in `Catalog/image-credits.json` ein:

- `Äpfel_pexels-max-muster-1234567.jpg` → Äpfel, Pexels, Fotograf Max Muster, Link pexels.com/photo/1234567
- `Äpfel.jpg` (ohne Unterstrich) → gilt als eigenes Foto

Nur Bilder verwenden, die man nutzen darf – keine Screenshots von iStock, Getty, Adobe Stock o. Ä. Pexels-Fotos über „Kostenlos herunterladen“ laden, nicht als Screenshot.

Dann im Projektordner:

```bash
python3 tools/photos/photos.py import
```

```bash
python3 tools/web/build.py
```

Der Import stellt die Fotos frei, bringt sie auf 480 × 480 px und legt sie in `Catalog/Images/` (freigestellt als PNG, mit Hintergrund als JPEG). Fotos mit Szene oder Tisch im Bild besser nicht freistellen lassen: `python3 tools/photos/photos.py import --mit-hintergrund` übernimmt sie randlos. Erledigte Dateien wandern nach `Inbox/erledigt/`.

**Tipp für beste Ergebnisse:** Auf dem iPhone in der Fotos-App das Motiv lange gedrückt halten → „Teilen“ → als PNG sichern und per AirDrop hierher. Bereits freigestellte PNGs werden nur noch zugeschnitten. Sonst: vor hellem, ruhigem Hintergrund fotografieren.
