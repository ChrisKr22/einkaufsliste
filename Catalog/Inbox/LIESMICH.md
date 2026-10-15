# Fotos für den Basis-Katalog

Fotos hier ablegen. **Der Dateiname bestimmt das Produkt** – Name, ID oder ein eindeutiges Synonym aus `Catalog/catalog.json`, Groß-/Kleinschreibung und Umlaute egal:

- `Äpfel.jpg`, `aepfel.png`, `Apfel.heic` → Äpfel
- `Olivenöl.jpg`, `olivenoel.jpg` → Olivenöl
- `Möhren.png` → Karotten (Synonym)

Dann im Projektordner:

```bash
python3 tools/photos/photos.py import
```

```bash
python3 tools/web/build.py
```

Der Import stellt die Fotos frei, bringt sie auf 480 × 480 px und legt sie in `Catalog/Images/`. Erledigte Dateien wandern nach `Inbox/erledigt/`.

**Tipp für beste Ergebnisse:** Auf dem iPhone in der Fotos-App das Motiv lange gedrückt halten → „Teilen“ → als PNG sichern und per AirDrop hierher. Bereits freigestellte PNGs werden nur noch zugeschnitten. Sonst: vor hellem, ruhigem Hintergrund fotografieren.
