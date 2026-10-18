# FeedYourself – Projektkontext

Kurzfassung für die Arbeit an der App. Details: [README.md](README.md), [KONZEPT.md](KONZEPT.md).

- **Produkt:** grafische Einkaufsliste mit Fotos und zwei Modi – **Planen** (schnell erfassen, Ziel < 3 s) und **Einkaufen** (Kacheln, Liste, Fokus; Gesten, Zurückstellen, Rückgängig). Dazu gemeinsame Listen über den Cloudflare-Briefkasten, Sicherung, Katalog-Vorschläge und Pflegemodus (KONZEPT Kap. 1, 2, 8, 9).
- **Zielgruppe:** der Entwickler selbst und ein kleiner Kreis, mit dem Listen geteilt werden (Familie/Haushalt). Bedienung einhändig im Laden, unterwegs, auch offline. *Annahme, kein Research im Repo.*
- **Plattform und Stack:** PWA fürs iPhone (Safari), Vanilla JS mit ES-Modulen, IndexedDB, Service Worker, kein Framework. Node-Tests in `web/tests/` (Logik, keine UI-Flows). Das SwiftUI-Projekt ist zurückgestellt.
- **Designgrundlagen:** Designrichtung „Galerie“ (KONZEPT Kap. 5) mit Farbtabelle hell/dunkel, umgesetzt als Tokens in `:root` von `web/css/app.css`, Dunkelmodus über `data-theme`. Keine Komponentenbibliothek; gemeinsame Klassen (z. B. `.list-tile`) und Helfer `web/js/views/dom.js`.
