# FeedYourself – App-Konzept (Entwurf v0.7)

Web-App (PWA) fürs iPhone, nach der Installation vollständig offline. (Ursprünglich als native iOS-App geplant, siehe Kapitel 7.) Eine grafische, interaktive Einkaufsliste mit zwei Modi: **Planung** und **Einkauf**.

Mockup (klickbar): https://claude.ai/artifact/TakTedz3vtBNwH9KyWkPJH

---

## 1. Ziele & Grundsätze

- **Schnell erfassen:** Ein Produkt soll in < 3 Sekunden auf der Liste sein (tippen → Vorschlag → bestätigen).
- **Grafisch statt Text:** Jedes Produkt hat ein Foto. Im Einkaufsmodus erkennt man Produkte auf einen Blick.
- **Laden-Logik:** Kategorien folgen dem Laufweg im Laden (frei sortierbar).
- **Lernend:** Gekaufte Produkte werden gemerkt und lassen sich mit einem Tipp wieder hinzufügen.
- **Offline first:** Keine Netzwerkverbindung, kein Konto. Datenmodell aber so gebaut, dass später Teilen via iCloud möglich ist.

---

## 2. Die zwei Modi

Umschalten über einen großen Segment-Schalter oben oder eine Tab-Leiste: **Planen | Einkaufen**.

### 2.1 Planungsmodus

```
┌─────────────────────────────────┐
│  🔍 Was brauchst du?            │  ← Suchfeld, immer oben, Tastatur sofort aktiv
├─────────────────────────────────┤
│  Vorschläge beim Tippen "oli":  │
│  [📷 Olivenöl]  [📷 Oliven]     │  ← Treffer aus Katalog + Verlauf
│  + „oli" als neues Produkt      │
├─────────────────────────────────┤
│  OBST & GEMÜSE                  │
│  📷 Äpfel        2x   „Elstar"  │
│  📷 Tomaten      1x             │
│  BACKWAREN                      │
│  📷 Brot         1x   „Dinkel"  │
│  ÖLE & GEWÜRZE                  │
│  📷 Olivenöl     2x   „Bertolli"│
├─────────────────────────────────┤
│  ⟲ Zuletzt gekauft  (12)        │  ← aufklappbar, 1 Tipp = wieder hinzufügen
└─────────────────────────────────┘
```

**Suche & Hinzufügen**
- Suche im Produktkatalog (vorinstalliert, ca. 250–400 gängige Lebensmittel) und in eigenen Produkten.
- Tolerant: Groß-/Kleinschreibung, Umlaute („Ol" findet „Öl"), Teilwörter („nudel" → „Spaghetti", „Penne" über Synonyme), einfache Tippfehler.
- Sortierung der Treffer: zuletzt/häufig gekauft zuerst, dann alphabetisch.
- **Enter / Tipp auf Treffer** → Produkt landet in seiner Kategorie auf der Liste (Menge 1).
- Erneutes Hinzufügen eines bereits gelisteten Produkts → Menge +1 statt Duplikat.
- Kein Treffer → „‚Kokosmilch' als neues Produkt anlegen": Kategorie wählen, optional Foto mit Kamera aufnehmen oder aus Fotos wählen.

**Listeneintrag bearbeiten** (Tipp auf Eintrag öffnet ein kleines Sheet)
- **Menge:** Stepper (− 2x +). Optional später: Einheit (500 g, 1 l).
- **Anmerkung:** Freitext, z. B. Sorte, Marke („Elstar", „Barilla Nr. 5").
- Kategorie ändern, Eintrag löschen (auch per Wischen nach links).

**Zuletzt gekauft / Häufig gekauft**
- Bereich unter der Liste (oder eigener Reiter) mit allen früher gekauften Produkten als Foto-Kacheln.
- 1 Tipp = auf die Liste, mit **zuletzt verwendeter Menge und Anmerkung** vorausgefüllt.
- Sortierbar nach „zuletzt" oder „am häufigsten".

### 2.2 Einkaufsmodus

```
┌─────────────────────────────────┐
│  Einkauf  ▓▓▓▓▓▓░░░░  6 / 10    │  ← Fortschritt
├─────────────────────────────────┤
│  OBST & GEMÜSE                  │
│  ┌──────────┐ ┌──────────┐      │
│  │  [FOTO]  │ │  [FOTO]  │      │  ← große Foto-Kacheln
│  │  Äpfel   │ │ Tomaten  │      │
│  │ 2x Elstar│ │    1x    │      │
│  └──────────┘ └──────────┘      │
│  BACKWAREN                      │
│  ┌──────────┐                   │
│  │  [FOTO]  │                   │
│  │   Brot   │                   │
│  └──────────┘                   │
├─────────────────────────────────┤
│  🛒 Im Wagen (4)  ˅             │  ← eingeklappt, zum Rückgängig-Machen
│        [ Einkauf abschließen ]  │
└─────────────────────────────────┘
```

- Zeigt **nur offene (fehlende) Produkte**, gruppiert nach Kategorie in **Laden-Reihenfolge**.
- **Drei Ansichten, umschaltbar** (Schalter oben rechts, Auswahl wird gemerkt):
  - **Kacheln** (Standard): 2 große Foto-Kacheln pro Zeile.
  - **Liste**: Foto links, mehr Produkte gleichzeitig sichtbar.
  - **Fokus**: immer nur **ein** Produkt als große Karte, in Laden-Reihenfolge, wie ein Kartenstapel. Ideal mit einer Hand oder wenn man nicht auf die Liste schauen will. Darunter steht „Noch 6 offen · danach: Tomaten".
  - Aufwand gering: Alle Ansichten nutzen dieselben Daten und dieselbe Gesten-Logik, nur die Anordnung (`LazyVGrid`, `List`, Kartenstapel) unterscheidet sich.
- Name, Menge und Anmerkung sind gut lesbar, auch mit einer Hand im Laden.
- **Gesten:**

  | Geste | Kacheln & Liste | Fokus |
  |-------|-----------------|-------|
  | Tippen | in den Wagen | **überspringen** – Produkt ans Ende der Reihe, beliebig oft (nur für diesen Einkauf) |
  | → nach rechts wischen | in den Wagen | in den Wagen |
  | ← nach links wischen | zurückstellen / nicht vorhanden | zurückstellen / nicht vorhanden |

  - Nur waagerechte Gesten – senkrecht wird überall gescrollt, auch in der Fokus-Ansicht. (Hochwischen gab es anfangs in der Fokus-Ansicht; entfernt, weil es beim Scrollen störte.)
  - Beim Ziehen färbt sich die Karte (grün bzw. gelb = Wagen, blau = zurückstellen), ab ~80 pt Weg wird ausgelöst, dazu kommt haptisches Feedback.
  - Zusätzlich gibt es auf jeder Karte einen kleinen ←-Knopf und in der Fokus-Ansicht zwei große Knöpfe (für VoiceOver und Bedienung ohne Wischen).
  - In SwiftUI: `DragGesture` mit Richtungsprüfung (waagerecht nur, wenn |dx| > |dy|), in der Liste alternativ die nativen `swipeActions`.
- **Rückgängig:** Toast „Äpfel im Wagen · Rückgängig" für einige Sekunden; außerdem einklappbare Bereiche „Zurückgestellt" und „Im Wagen", in denen sich jedes Produkt zurückholen lässt.
- Leere Kategorien werden ausgeblendet.
- Das Display bleibt während des Einkaufs an (optional, Einstellung).
- **Einkauf abschließen** nur **per Knopf** (immer sichtbar unten):
  - Produkte im Wagen kommen in „Zuletzt gekauft" (Verlauf).
  - Zurückgestellte und noch offene Produkte bleiben für den nächsten Einkauf auf der Liste.
  - Danach eine Zusammenfassung: „7 Produkte gekauft · 1 bleibt auf der Liste".

### 2.3 Lebenszyklus eines Eintrags

```
 Katalog/Verlauf ──hinzufügen──▶ OFFEN ──tippen / → wischen──▶ IM WAGEN ──abschließen──▶ GEKAUFT (Verlauf)
                                 │  ▲                            │                            │
                    ← wischen    │  └──────── rückgängig ────────┘                            │
                                 ▼                                                            │
                          ZURÜCKGESTELLT ──abschließen──▶ bleibt OFFEN für nächsten Einkauf   │
                                                                                              │
                                 ▲─────────────────── 1 Tipp „wieder hinzufügen" ─────────────┘
```

---

## 3. Kategorien

Standard-Kategorien (umbenennbar, erweiterbar, per Drag & Drop in Laden-Reihenfolge sortierbar):

| # | Kategorie | Beispiele |
|---|-----------|-----------|
| 1 | Obst | Äpfel, Bananen, Zitronen |
| 2 | Gemüse | Tomaten, Paprika, Zwiebeln |
| 3 | Backwaren | Brot, Brötchen, Toast |
| 4 | Fleisch & Wurst | Hähnchen, Hack, Salami |
| 5 | Fisch | Lachs, Thunfisch |
| 6 | Milchprodukte & Eier | Milch, Joghurt, Eier, Butter |
| 7 | Käse | Gouda, Mozzarella, Parmesan |
| 8 | Tiefkühl | Pizza, Erbsen, Eis |
| 9 | Nudeln, Reis & Getreide | Spaghetti, Reis, Haferflocken |
| 10 | Konserven & Fertiges | Tomaten passiert, Bohnen |
| 11 | Öle, Essig & Gewürze | Olivenöl, Salz, Pfeffer |
| 12 | Backen & Süßes | Mehl, Zucker, Schokolade |
| 13 | Snacks | Chips, Nüsse |
| 14 | Getränke | Wasser, Saft, Kaffee, Tee |
| 15 | Drogerie & Haushalt | Spülmittel, Toilettenpapier |
| 16 | Sonstiges | Fallback für alles andere |

### 3.1 Produktkatalog & Suchbegriffe

**Stand heute** (`Catalog/catalog.json`, Entwurf zur Durchsicht): **194 Produkte in 16 Kategorien mit 324 Synonymen**, davon 87 aus deiner eigenen Einkaufsliste (in der Übersicht mit ● markiert, im JSON als `"origin": "nutzer"`). Lesbare Übersicht: [Catalog/KATALOG.md](Catalog/KATALOG.md), erzeugt und geprüft mit `python3 tools/catalog/katalog.py`. Jedes Produkt hat:

| Feld | Zweck | Beispiel |
|------|-------|----------|
| `name` | Anzeige und Suche in der App | Karotten |
| `synonyms` | weitere Suchwörter in der App | Möhren, Möhre |
| `query_en` | englischer Suchbegriff, nur für das optionale Foto-Werkzeug | carrots |

**Herkunft:** Die Liste habe ich von Hand zusammengestellt, aus gängigen Produkten eines deutschen Supermarkts. Sie stammt aus keiner Datenbank, deshalb gibt es keine Lizenzfragen.

**Ziel für v1.0:** ca. **150 Produkte in allen 16 Kategorien**, mit 2–4 Synonymen pro Produkt (regionale Begriffe wie Semmel/Brötchen, Oberbegriffe wie Nudeln → Spaghetti/Penne, Singular/Plural). Das ergibt rund 400–500 Suchwörter.

**Wie wir dorthin kommen:**
1. Ich erstelle einen Entwurf (Produkte, Kategorie, Synonyme), du streichst und ergänzt nach deinen Einkaufsgewohnheiten.
2. Optional zum Abgleich: **Wikidata** (Lizenz CC0, frei nutzbar) hat zu vielen Lebensmitteln deutsche Bezeichnungen und Alternativnamen. Open Food Facts eignet sich weniger: Es enthält vor allem Markenprodukte, und seine Datenbanklizenz (ODbL) verlangt Namensnennung und Weitergabe unter gleichen Bedingungen.

**In der App** kommen außerdem automatisch dazu:
- eigene Produkte, die man über die Suche anlegt,
- Begriffe, die man häufig eintippt: Die Suche lernt, was man nach Eingabe von „nud“ auswählt, und zeigt es künftig zuerst.

Die Suche bleibt tolerant (Umlaute, Teilwörter, kleine Tippfehler), damit auch Wörter gefunden werden, die nicht im Katalog stehen.

### 3.2 Einstellungen

Erreichbar über das Regler-Symbol oben rechts (in beiden Modi), öffnet sich als eigener Bildschirm.

**Kategorien festlegen**
- Liste aller Kategorien in Laden-Reihenfolge, mit Nummer, Symbol und Anzahl der Produkte.
- **Umbenennen:** direkt auf den Namen tippen und tippen. Wird das Feld leer gelassen, heißt sie „Neue Kategorie".
- **Reihenfolge ändern:** per Drag & Drop am Griff; mit Tastatur/Screenreader über die Pfeiltasten auf dem Griff.
- **Hinzufügen:** „+ Kategorie hinzufügen" legt eine neue Kategorie vor „Sonstiges" an.
- **Löschen:** Die Produkte der Kategorie wandern nach „Sonstiges", mit Rückgängig. „Sonstiges" selbst lässt sich nicht löschen (Auffangkategorie). Gelöschte Katalog-Kategorien legt ein späteres Katalog-Update nicht wieder an.
- Später möglich: Symbol und Farbfläche einer Kategorie wählen, Kategorie eines Produkts im Bearbeiten-Sheet ändern.

**Einkauf**
- Display beim Einkaufen anlassen (Ein/Aus).

Weitere Punkte kommen dazu, sobald sie festgelegt sind (z. B. Standardansicht im Einkauf, Bildnachweise).


### 3.3 Maßeinheiten ✅

| Einheit | Anzeige | Schritt (Plus/Minus) | Startwert |
|---|---|---|---|
| Stück | 4× | 1 | 1 |
| Packung | 2 Pck. | 1 | 1 |
| Gramm | 500 g | 100 | 500 |
| Kilogramm | 1,5 kg | 0,5 | 1 |
| Milliliter | 500 ml | 100 | 500 |
| Liter | 1,5 l | 0,5 | 1 |

- **Je Produkt** eine Standard-Einheit (Einstellungen › „Einheiten je Produkt“, mit Suche), z. B. Äpfel in Kilogramm. Gilt ab dem nächsten Hinzufügen; ohne Festlegung: Stück.
- **Je Eintrag** änderbar im Bearbeiten-Fenster (Auswahl „Einheit“); die Menge springt dann auf den Startwert der neuen Einheit.
- Minus an der kleinsten Menge entfernt den Eintrag (in der Liste, mit Rückgängig); im Bearbeiten-Fenster bleibt er stehen.
- „Zuletzt gekauft“, geteilte Listen und die Sicherung behalten Menge **und** Einheit. Wurde die Standard-Einheit seit dem letzten Kauf geändert, startet das Produkt mit dem Startwert der neuen Einheit (nicht „6 kg“ statt „6 Stück“).
- Geteilte Liste mit anderer Einheit als die eigene: die eigene Menge bleibt.
- Optional kann `catalog.json` je Produkt eine Einheit vorgeben (`"unit": "kg"`).

---

## 4. Bilder (Fotos)

Entscheidung: **realistische Fotos**, offline in der App mitgeliefert.

### 4.1 Lizenzfreie Fotos für den Basis-Katalog

| Quelle | Lizenz | Hinweis |
|--------|--------|---------|
| **Pexels** | Pexels-Lizenz: kostenlos, auch kommerziell, ohne Namensnennung | Große Auswahl an Lebensmittelfotos, empfohlen |
| **Unsplash** | Unsplash-Lizenz: kostenlos, auch kommerziell | Verboten ist nur, eine konkurrierende Bilddatenbank aufzubauen; Fotos in einer App mitzuliefern ist erlaubt |
| **Pixabay** | Pixabay-Lizenz: ähnlich wie Pexels | Teilweise schon freigestellte Bilder |
| Wikimedia Commons | gemischt (CC0, CC-BY, CC-BY-SA) | Nur CC0 ohne Aufwand; bei CC-BY Namensnennung in der App nötig |
| ~~Open Food Facts~~ | CC-BY-SA | Enthält Markenverpackungen, eher ungeeignet |

- **Einheitlicher Look:** Produkte werden freigestellt (Hintergrund entfernt) und auf einer **zarten Kategorie-Farbfläche** gezeigt (siehe Mockup). So passen Fotos aus verschiedenen Quellen zusammen und funktionieren auch im Dark Mode. Freistellen geht z. B. mit der macOS-Vorschau oder Fotos-App („Motiv kopieren“) oder per Stapelverarbeitung mit Apples Vision-Framework.
- **Format:** Quadratisch, 600×600 px (@3x für die Kacheln), PNG mit Transparenz und beim Build als HEIC komprimiert, ca. 30–50 KB pro Bild → bei 300 Produkten ca. 12 MB.
- **Nachweis:** Eine Datei `image-credits.json` (Produkt → Quelle, URL, Lizenz) wird mitgepflegt. Sie wird nicht zwingend angezeigt, sichert aber die Herkunft ab.
- **Fallback:** Ohne Foto erscheint die Kategorie-Farbfläche mit einem Kategorie-Symbol.

### 4.2 Optional: Fotos automatisch im Stapel abrufen (Pixabay/Pexels)

> **Optional, vorerst zurückgestellt.** Das Werkzeug ist fertig, wird aber erst einmal nicht genutzt. Vorrang hat der Import eigener Bilder aus einem Projektordner (4.4). Das Werkzeug kann später zum Füllen von Lücken dienen.

Umgesetzt in `tools/photos/` (Anleitung: [tools/photos/README.md](tools/photos/README.md)). Das Skript läuft auf dem Mac, die App bleibt offline.

1. **Eingabe:** `Catalog/catalog.json` mit ID, Name, Kategorie, Synonymen und englischem Suchbegriff (Start: 38 Produkte aus dem Mockup).
2. **`fetch`:** eine Suche pro Produkt bei **Pixabay** (Standard) und/oder **Pexels**, 6 Kandidaten, 24 h Cache. „isolated“ wird angehängt, damit Fotos auf weißem Grund kommen. Es gibt nur Metadaten und Vorschau-Links, noch keine Downloads.
3. **`review`:** lokale Auswahlseite im Browser. Pro Produkt ein Foto anklicken oder „Keins passt“ wählen und einen neuen Suchbegriff eintragen. Die Auswahl wird automatisch gespeichert.
4. **`download`:** lädt nur die ausgewählten Fotos in voller Größe.
5. **`process`:** freistellen, mittig auf 600×600 setzen, transparentes PNG nach `Catalog/Images/`, Bildnachweise nach `Catalog/image-credits.json`.

**API-Bedingungen (geprüft am 14.10.2026):**
- **Pixabay:** Bilder selbst speichern ist erwünscht, dauerhaftes Hotlinking nicht. 24 h Caching ist Pflicht, max. 100 Anfragen pro Minute, die Quelle ist bei Anzeige der Ergebnisse zu nennen. **Automatisierte Massenabfragen und systematische Massen-Downloads sind verboten.** Das Werkzeug ist deshalb zurückhaltend gebaut: eine Suche pro Produkt, gedrosselt, Vorschauen werden nur angezeigt, geladen wird nur das ausgewählte Foto, und mehr als 150 Produkte auf einmal gehen nur mit ausdrücklicher Bestätigung. Für den vollen Katalog in Etappen arbeiten oder vorher bei Pixabay nachfragen.
- **Pexels:** 200 Anfragen pro Stunde. Ein sichtbarer Link zu Pexels und die Nennung der Fotograf:innen sind erwünscht → die App bekommt eine Seite „Bildnachweise“ in den Einstellungen. Das Speichern regelt die API-Doku nicht ausdrücklich.
- **Unsplash-API:** ungeeignet, weil Bilder von Unsplash-Servern geladen werden müssen.

**Freistellen auf Intel-Macs:** Apples Motiverkennung (`VNGenerateForegroundInstanceMaskRequest`) läuft nur auf Apple-Silicon-Macs. Auf Intel entfernt das Werkzeug stattdessen hellen, einfarbigen Hintergrund vom Bildrand her. Das klappt gut bei Fotos auf Weiß; bei anderen Fotos wird nur quadratisch zugeschnitten, und `process` listet diese Produkte auf.

### 4.3 Eigenes Foto pro Produkt (in der App) ✅

- Im Bearbeiten-Fenster eines Eintrags: **„Foto ändern“**. Das iPhone bietet dann **Foto aufnehmen**, **Fotomediathek** oder **Dateien** an.
- Die App bereitet das Foto **auf dem Gerät** auf, nichts wird hochgeladen:
  - auf 480 × 480 px bringen,
  - einen **hellen, einfarbigen Hintergrund entfernen** und das Motiv mittig mit Rand setzen,
  - klappt das nicht (dunkler oder unruhiger Hintergrund), wird das Foto quadratisch zugeschnitten, mit dem Hinweis, vor hellem Hintergrund zu fotografieren,
  - speichern als WebP; wo der Browser das nicht kann, als PNG (mit Transparenz) bzw. JPEG.
- Das eigene Foto hat **Vorrang vor dem Katalogfoto** und erscheint überall: Liste, Kacheln, Fokus-Ansicht, „Zuletzt gekauft“, Vorschläge.
- **„Standardbild“** entfernt das eigene Foto wieder; beides lässt sich rückgängig machen.
- Eigene Fotos sind Teil der **Sicherung**, aber nicht der geteilten Liste (der Link soll kurz bleiben).
- Speicherort: IndexedDB, eigener Speicher `photos` (Produkt-ID → Bild).

### 4.4 Ordner-Import für den Basis-Katalog ✅

**Ablauf** (Anleitung auch in `Catalog/Inbox/LIESMICH.md`):
1. Fotos in `Catalog/Inbox/` legen. **Der Dateiname bestimmt das Produkt**: Name, ID oder ein eindeutiges Synonym, Groß-/Kleinschreibung und Umlaute egal (`Äpfel.png`, `olivenoel.jpg`, `Möhren.png` → Karotten).
2. `python3 tools/photos/photos.py import`
   - ordnet zu und meldet, was **nicht eindeutig** ist (z. B. `Nudeln.png` passt zu vier Produkten) oder **zu keinem Produkt** passt,
   - stellt frei, in dieser Reihenfolge: schon freigestelltes PNG nur zuschneiden → Apple Vision (nur Apple-Silicon-Macs) → hellen Hintergrund entfernen → sonst quadratisch zuschneiden,
   - schreibt `Catalog/Images/<id>.png` (480 × 480) und trägt „eigenes Foto“ in `Catalog/image-credits.json` ein,
   - verschiebt erledigte Dateien nach `Catalog/Inbox/erledigt/`.
3. `python3 tools/web/build.py` kopiert die Bilder nach `web/images/`, schreibt die Liste `web/data/images.json` und nimmt alles in den Offline-Speicher auf.

Originalfotos in der Inbox werden nicht ins Repository übernommen, die fertigen Bilder in `Catalog/Images/` schon.

**Freistellen ohne Apple-Silicon-Mac (Tipp):** Auf dem **iPhone** in der Fotos-App das Motiv lange gedrückt halten → „Kopieren“ bzw. „Teilen“ → als PNG sichern und per AirDrop in `Catalog/Inbox/` legen. Das iPhone stellt hervorragend frei, das Werkzeug übernimmt die Transparenz dann direkt. Alternativ die Produkte auf weißem Papier fotografieren; das klappt mit dem Hintergrund-Verfahren auch auf dem Intel-Mac.

**Aufwand:** ca. 150 Fotos für den Start. Für einen einheitlichen Look: Tageslicht, von schräg oben, Produkt füllt das Bild, ruhiger heller Untergrund.

---

## 5. Gestaltung & Farbwelt

**Designrichtung A „Galerie“ (entschieden am 15.10.2026): ruhig, hochwertig, clean. Ein grüner Akzent in beiden Modi – Tannengrün im Hellen, Salbeigrün im Dunkeln. Kein Gelb mehr.**

- **Neutraler Grund, Karten ohne Rahmen:** Weiße Karten mit weichem Schatten auf leicht grauem Weiß; im Dunkeln fast schwarzer Grund mit dunkelgrauen Karten. Kopf und Abschlussleiste sind Milchglas.
- **Eine ruhige Bildfläche für alle Produkte** (`Fläche Bild`). Die **Kategoriefarbe** erscheint nur noch als feiner Rahmen um Produktbild bzw. Symbol – dezent, aber beim Einkaufen zur Orientierung lesbar.
- **Fotos:** Freigestellte Bilder (PNG) stehen mit Rand auf der Bildfläche; Fotos mit Hintergrund (JPEG) füllen die Fläche randlos. Damit sie zur App passen, werden sie leicht entsättigt (Sättigung 88 %, Kontrast 94 %, im Dunkeln etwas abgedunkelt) und bekommen oben links einen feinen Glanz. In Kacheln und Fokus läuft das Foto unten weich in die Karte aus; Name und Menge stehen auf diesem Übergang.
- **Akzent sparsam:** Hauptknopf, Fortschritt, Mengen, „In den Wagen“. Struktur und Steuerelemente bleiben grau.
- **Typografie:** SF Pro für alles; große Überschrift „Einkaufsliste“ in SF Pro Display (32 pt, fett), Abschnittstitel in normaler Schreibweise statt Großbuchstaben. Wortmarke „Feed“ in Textfarbe, „Yourself“ in Sekundärgrau.
- **„Zurückstellen“** ist ein gedämpftes Schieferblau, **„Entfernen“** neutral grau mit Rückgängig.
- **Dichte:** großzügig wie im Mockup (Zeilen 64 pt, Kacheln zweispaltig).

| Rolle | Hell | Dunkel |
|-------|------|--------|
| Akzent / Knopf | `#1F5C3A` (Tannengrün) | `#A7C2A0` (Salbeigrün) |
| Schrift auf Knopf | `#FFFFFF` | `#161714` |
| Akzent als Text | `#1F5C3A` | `#B9D1B2` |
| Akzent-Fläche (zart) | `#E5EEE8` | `#2A3328` |
| Hintergrund | `#F7F7F5` | `#0E0F0E` |
| Fläche (Karten) | `#FFFFFF` | `#1A1B1A` |
| Fläche 2 (Steuerelemente) | `#ECECE9` | `#252725` |
| Fläche Bild | `#F1F0ED` | `#222422` |
| Linien | 8 % Schwarz | 7 % Weiß |
| Text | `#141614` | `#F2F2EF` |
| Text sekundär | `#6B706C` | `#9A9E9A` |
| Zurückgestellt | `#56677D` | `#A9B8CC` |
| Kategorie-Rahmen | Kategoriefarbe 38 % | Kategoriefarbe 55 % |

Alle Textfarben erreichen mindestens 4,5:1 Kontrast (WCAG AA). Mockups der drei geprüften Richtungen: Design-Fläche „FeedYourself Designrichtungen“.

---

## 6. Datenmodell

SwiftData, so gestaltet, dass späterer Sync ohne Migration möglich ist:
alle Felder optional oder mit Standardwert, keine `@Attribute(.unique)`, Beziehungen optional, jede Entität mit eigener `id: UUID`.
Wichtig für das Teilen (siehe Kapitel 8): SwiftData kann per CloudKit nur **eigene Geräte** synchronisieren, aber **nicht mit anderen Personen teilen**.

```
Category
  id: UUID
  name: String
  sortOrder: Int            // Laden-Reihenfolge
  placeholderImage: String?
  products: [Product]

Product                      // Katalog (vorinstalliert + eigene)
  id: UUID
  name: String
  synonyms: [String]         // "Nudeln" → Spaghetti, Penne …
  category: Category?
  bundledImageName: String?  // Foto aus der App
  customImage: Data?         // eigenes Foto (.externalStorage)
  isCustom: Bool
  purchaseCount: Int         // für "häufig gekauft"
  lastPurchasedAt: Date?
  lastQuantity: Int          // Vorbelegung beim Wieder-Hinzufügen
  lastNote: String?

ListEntry                    // Eintrag auf der aktiven Liste
  id: UUID
  product: Product?
  quantity: Int              // "2x"
  note: String?              // "Elstar", "Barilla"
  status: open | inCart | later   // later = zurückgestellt
  addedAt: Date
  checkedAt: Date?

ShoppingTrip                 // optional: Historie abgeschlossener Einkäufe
  id: UUID
  finishedAt: Date
  items: [TripItem]          // Name, Menge, Notiz (Kopie)
```

Der Basis-Katalog (Produkte, Synonyme, Kategorien, Bildnamen) liegt als JSON in der App und wird beim ersten Start importiert.

---

## 7. Technik

> **Entscheidung (15.10.2026): Web-App (PWA) statt nativer App.** Auf dem vorhandenen Intel-Mac mit macOS 15 läuft kein aktuelles Xcode aus dem App Store. Die App wird deshalb als Progressive Web App gebaut: Sie läuft in Safari, wird über „Teilen → Zum Home-Bildschirm“ wie eine App installiert und funktioniert danach offline. Das SwiftUI-Projekt (`FeedYourself.xcodeproj`) bleibt als Referenz im Repository, wird aber nicht weitergeführt.

| Bereich | Wahl |
|---------|------|
| Plattform | Web-App (PWA) für iPhone-Safari, installierbar auf dem Home-Bildschirm, Hochformat |
| UI | HTML, CSS, JavaScript-Module, keine Bibliotheken und kein Build-Werkzeug nötig |
| Speicherung | IndexedDB im Gerät hinter einer Repository-Schicht; Sync später optional |
| Offline | Service Worker speichert alle App-Dateien; `tools/web/build.py` aktualisiert Liste und Version |
| Bilder | Kategorie-Fläche mit Symbol; Fotos später als Dateien in `web/images/` |
| Suche | Name + Synonyme, normalisiert (Umlaute, ß, Akzente), Präfix-, Teilwort- und Tippfehler-Treffer |
| Feedback | Animationen; Vibration nur, wo der Browser es kann (iPhone-Safari nicht) |
| Barrierefreiheit | echte Buttons, Beschriftungen für Screenreader, Dark Mode, reduzierte Bewegung |
| Tests | Node-Tests für Suche, Datenlogik und Planung (`npm test` in `web/`) |

Kein Konto, keine Analytics. Nach dem ersten Laden braucht die App kein Netz mehr.

**Grenzen der Web-App** (bewusst in Kauf genommen):
- Kein App Store. Installation über Safari, einmalig mit Internet.
- Safari kann Daten von Websites löschen, die man lange nicht nutzt. Als Home-Bildschirm-App ist das deutlich seltener; die App fordert dauerhaften Speicher an. Zusätzlich gibt es in den Einstellungen eine Sicherung als Datei; nach 30 Tagen ohne Sicherung erinnert die App daran.
- Keine Vibration und kein automatisches Freistellen von Fotos auf dem iPhone.
- Für die Installation braucht es einmalig ein HTTPS-Hosting, z. B. GitHub Pages (kostenlos).

---

## 8. Teilen & Synchronisieren (nach v1.0)

Ziel: Eine Liste gemeinsam nutzen, z. B. Partner:in plant zu Hause, du kaufst ein. Änderungen erscheinen bei allen, auch Schreibrechte für andere.

### 8.1 Optionen im Vergleich

| Weg | So funktioniert's | Plattformen | Link mit Schreibrecht | Offline | Kosten / Betrieb | Datenschutz |
|-----|-------------------|-------------|------------------------|---------|-------------------|-------------|
| **A. iCloud / CloudKit Sharing** | Liste liegt in der privaten iCloud des Besitzers und wird per Link (`CKShare`) mit Lese- oder Schreibrecht geteilt | nur iPhone, iPad, Mac (Apple-ID nötig) | ✅ eingeladene Personen oder „jeder mit Link“ | ✅ Änderungen werden nachgereicht | kostenlos, kein eigener Server | sehr gut, Daten liegen bei Apple im Konto der Nutzer:innen |
| **B. Eigenes Backend** (z. B. Supabase, Firebase) | Server-Datenbank mit Echtzeit-Updates, Einladung per Link | iOS, Android, Web | ✅ frei gestaltbar | ✅ mit lokalem Zwischenspeicher | Gratis-Stufe für kleine Nutzung, darüber kostenpflichtig (Preise vor Entscheidung prüfen); Wartung nötig | Konto nötig, Datenschutzerklärung und DSGVO-Prüfung |
| **C. Local-first mit Sync-Dienst** (z. B. Automerge, Ditto) | Jedes Gerät hat die volle Liste, Änderungen werden konfliktfrei zusammengeführt | iOS, Android, Web | ✅ | ✅✅ funktioniert auch ohne Netz, Ditto sogar Gerät-zu-Gerät per Bluetooth/WLAN im Laden | Sync-Server selbst betreiben oder Dienst bezahlen | gut, je nach Server |
| **D. Web-App / PWA zusätzlich** | Geteilter Link öffnet die Liste im Browser, ohne App-Installation | jeder Browser, auch Android | ✅ | eingeschränkt | Hosting + Backend aus B oder C nötig | wie B/C |
| **E. Apple Erinnerungen** | App schreibt die Liste in eine geteilte Erinnerungen-Liste | Apple-Geräte | ✅ über die Erinnerungen-App | ✅ | kostenlos | sehr gut |
| **F. Einmal weitergeben** | Liste als Text, Link oder Datei per Nachrichten/AirDrop senden | alle | ❌ keine Synchronisation | ✅ | kostenlos | sehr gut |

**Bewertung:**
- **A (iCloud)** passt am besten zu „native iOS-App, offline, ohne Konto“. Haken: SwiftData unterstützt das Teilen mit anderen Personen bisher nicht (laut Apple-Entwicklerforum auch nicht mit WWDC26). Lösung: lokal bei SwiftData bleiben und den Sync selbst mit **`CKSyncEngine`** (ab iOS 17) über eine geteilte Datenzone bauen. Das ist mehr Code, aber das Datenmodell ist dafür schon vorbereitet. Alternativ Core Data mit `NSPersistentCloudKitContainer`, das Teilen von Haus aus kann.
- **B/C/D** braucht man nur, wenn auch **Android-Nutzer:innen oder Menschen ohne App** mitschreiben sollen. Dafür kommen Server, Konten und Datenschutzaufwand dazu.
- **E (Erinnerungen)** ist reizvoll, weil es keinen eigenen Sync braucht. Aber: Kategorien/Abschnitte, Fotos und Mengen lassen sich über die Schnittstelle (EventKit) nicht sauber übertragen. Höchstens als einfache Export-Funktion sinnvoll.
- **F** ist als kleines Extra immer nützlich („Liste per Nachricht schicken“) und schon für v1.0 machbar.

### 8.2 Entscheidung (v0.5)

- **Kein Android.**
- **iCloud wird derzeit nicht genutzt** → Weg A ist zurückgestellt. Er bleibt möglich, falls sich das ändert; das Datenmodell bleibt dafür vorbereitet.
- **Browser als Option, je nach Umständen** → falls Teilen gebraucht wird: **B + D** (eigenes Backend mit Web-Ansicht) oder **C** (Local-first-Sync), zu entscheiden, wenn es so weit ist.

Daraus folgt:
1. **v1.0:** komplett offline, dazu **F** erweitert: Liste teilen per Link, den der Empfänger mit einem Tipp übernimmt (8.3).
2. **Später, bei Bedarf:** Web-Ansicht mit Sync. Damit das ohne Umbau geht, kapselt die App den Datenzugriff hinter einer eigenen Schicht (Repository), statt SwiftData direkt in den Ansichten zu verwenden.

### 8.3 Umgesetzt: Liste per Link teilen und übernehmen (ohne Server)

- **Teilen:** Der Knopf „Liste teilen“ unter der Planungsliste öffnet das Teilen-Menü (Nachrichten, WhatsApp, AirDrop, Mail …). Die Nachricht ist für Menschen lesbar, also nach Kategorien geordnet mit Menge und Anmerkung, und endet mit einem Link.
- **Der Link enthält die Liste selbst** (komprimiert hinter `#liste=…`). Es wird nichts hochgeladen, kein Server und kein Konto sind nötig. Typische Länge: 20 Produkte ≈ 360 Zeichen.
- **Übernehmen:** Wer den Link öffnet, sieht „Geteilte Liste übernehmen?“ mit allen Produkten. Ein Tipp fügt sie zur eigenen Liste hinzu, mit Rückgängig.
  - Hinzufügen statt ersetzen: Steht ein Produkt schon drauf, gilt die größere Menge, unterschiedliche Anmerkungen werden verbunden („Boskop / Elstar“).
  - Eigene Produkte des Absenders werden beim Empfänger angelegt, in derselben Kategorie, sonst unter „Sonstiges“.
- **iPhone-Besonderheit:** Links aus Nachrichten öffnen sich in Safari, nicht in der App auf dem Home-Bildschirm, und beide haben getrennte Speicher. Deshalb gibt es in den Einstellungen **„Geteilte Liste einfügen“**: Nachricht oder Link kopieren, einfügen (oder „Aus Zwischenablage“), fertig.
- **Grenze:** Das ist eine Übergabe, kein laufender Abgleich. Änderungen danach werden nicht automatisch synchronisiert; dafür bräuchte es Weg B oder C.

Quellen: [Apple Developer Forums – SwiftData & CloudKit Sharing](https://developer.apple.com/forums/thread/817369), [Apple: Sharing CloudKit data with other iCloud users](https://developer.apple.com/tutorials/data/documentation/cloudkit/sharing-cloudkit-data-with-other-icloud-users.md), [Apple Developer Forums – EventKit und Erinnerungen-Abschnitte](https://developer.apple.com/forums/thread/744915).

---

## 9. Roadmap

**MVP (v1.0)**
1. ✅ Datenmodell + Import Basis-Katalog (mit Platzhalterbildern)
2. ✅ Planungsmodus: Suche, Hinzufügen, Menge, Anmerkung, Löschen
3. ✅ Einkaufsmodus: Kacheln, Liste, Fokus, Tippen/Wischen, Zurückgestellt, Im Wagen, Rückgängig, Abschließen
4. ✅ „Zuletzt gekauft" mit 1-Tipp-Hinzufügen (sortierbar nach „Zuletzt“ / „Häufig“)
5. ✅ Einstellungen: Kategorien umbenennen, per Drag & Drop (oder Pfeiltasten) sortieren, hinzufügen, löschen
6. ✅ Eigene Produkte inkl. eigenem Foto (aufnehmen oder auswählen, auf dem Gerät freigestellt)
7. ✅ Ordner-Import für den Basis-Katalog (`photos.py import`) – Werkzeug fertig, Fotos selbst stehen noch aus
8. ✅ Liste teilen: lesbare Nachricht mit Link; der Empfänger übernimmt die Liste per Link oder durch Einfügen (siehe 8.3)
9. Veröffentlichen auf GitHub Pages, Installation auf dem iPhone
10. ✅ Sicherung: Daten als Datei exportieren (Teilen-Menü: iCloud Drive, AirDrop) und mit Rückfrage und Rückgängig einspielen

**Später**
- Teilen der Liste per Browser-Link mit Sync, falls nötig (siehe Kapitel 8)
- Mehrere Listen / Läden mit eigener Kategorie-Reihenfolge
- ✅ Maßeinheiten (Stück, Packung, g, kg, ml, l) – siehe 3.3
- Widget & Siri („Füge Milch zur Einkaufsliste hinzu")
- Apple Watch für den Einkaufsmodus
- Spracheingabe

---

### Katalog-Vorschläge (umgesetzt 16.10.2026)

Eigene Produkte können Nutzer für den gemeinsamen Katalog vorschlagen – ohne Server: Die App erzeugt eine Nachricht mit lesbarer Liste und Code (`FY-KATALOG:…`), die über das Teilen-Menü an die Person geht, die den Katalog pflegt. `tools/catalog/vorschlaege.py` liest die Nachrichten, fasst gleiche Vorschläge zusammen, zeigt Doppelte und übernimmt ausgewählte Produkte in `catalog.json`. Die Entscheidung bleibt beim Pflegenden; Nachrichten liegen nur lokal (`Catalog/Vorschlaege/` ist von Git ausgenommen). Verworfen: öffentliche GitHub-Issues (Konto nötig, Vorschläge öffentlich) und ein eigener Sammeldienst (Server, Datenschutz, Kosten).

## 10. Entscheidungen & offene Fragen

**Entschieden (v0.6)**
- Technik: Web-App (PWA) statt nativer App, weil kein passendes Xcode verfügbar ist
- Name: **FeedYourself**
- Einkaufsmodus: Kacheln, Liste **und** Fokus-Ansicht, umschaltbar
- Gesten: → wischen / Tippen = in den Wagen, ← wischen = zurückstellen (überall, kein Hochwischen)
- Planungsliste mit Fotos
- Einkauf abschließen nur per Knopf
- Basis-Fotos: eigene Fotos per Ordner-Import (Catalog/Inbox); Pixabay/Pexels-Werkzeug optional
- Farbwelt: Hell frisches Grün auf neutralem Grau, Dunkel kräftiges Gelb, Zurückstellen in Blau
- Basis-Katalog: 16 Kategorien, ca. 190 Produkte (deine Liste + Ergänzungen aus dem Entwurf)
- Teilen: kein Android, iCloud derzeit nicht; Browser-Ansicht später optional

**Offen**
1. Wortmarke in Serifenschrift (Fraunces) oder komplett SF Pro?
2. Welche Ansicht ist beim ersten Start voreingestellt: Kacheln oder Fokus?
