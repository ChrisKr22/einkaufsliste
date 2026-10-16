# Briefkasten für gemeinsame Listen (Cloudflare Worker)

Ein kleines Programm bei Cloudflare, das für jede gemeinsame Liste verschlüsselte Änderungen aufbewahrt
(KONZEPT.md, Abschnitt 8.4). Es kann keine Inhalte lesen, speichert keine IP-Adressen und führt kein Protokoll.

## Einmalige Einrichtung – nur im Browser (ca. 15 Minuten)

Cloudflare holt den Code aus GitHub und baut den Worker auf den eigenen Servern. Auf dem Mac wird nichts
installiert, und dort liegt kein Zugang zum Cloudflare-Konto.

1. **Anmelden** auf <https://dash.cloudflare.com>. Empfehlung: unter *My Profile › Authentication* die
   Zwei-Faktor-Anmeldung einschalten.
2. **Workers & Pages › Create › Import a repository** (bzw. „Mit Git verbinden“) › **GitHub** verbinden.
   Bei der Freigabe auf GitHub **„Only select repositories“** wählen und nur `einkaufsliste` freigeben.
3. **Repository `ChrisKr22/einkaufsliste`** wählen und einstellen:

   | Feld | Wert |
   |---|---|
   | Project name / Worker-Name | `feedyourself-sync` (muss zu `name` in `wrangler.toml` passen) |
   | Production branch | `main` |
   | Root directory (Pfad) | `tools/sync` |
   | Build command | leer lassen |
   | Deploy command | `npx wrangler deploy` |

   Cloudflare installiert dabei die festgelegte Wrangler-Version aus `package-lock.json`.
4. **Deploy** – der erste Durchlauf dauert 1–2 Minuten. Danach unter *Settings › Build › Build watch paths*
   `tools/sync/*` eintragen, damit nur Änderungen am Briefkasten einen neuen Durchlauf auslösen.
5. **Prüfen:** Die Adresse steht beim Worker unter *Domains & Routes*, etwa
   `https://feedyourself-sync.<name>.workers.dev`. Im Browser öffnen – es erscheint
   `{"service":"feedyourself-sync","ok":true}`.
6. **Adresse an Claude geben.** Sie ist kein Geheimnis; sie kommt in den Code der App.

Spätere Änderungen am Worker: committen und pushen – Cloudflare baut und veröffentlicht von selbst.

### Alternative: aus dem Terminal

Nur falls der Weg über GitHub nicht geht. Lädt Wrangler auf den Mac und legt dort beim Anmelden einen
Zugang zum ganzen Cloudflare-Konto ab – darum danach wieder abmelden.

```bash
cd tools/sync && npm ci && npx wrangler login && npx wrangler deploy && npx wrangler logout
```

## Werkzeug-Version

Wrangler ist auf **4.148.0** festgelegt (`package.json`), alle mitgeladenen Pakete über `package-lock.json`;
`sharp` ist auf 0.35.5 angehoben (CVE-2026-96889 in 0.35.4). Stand der Prüfung gegen die OSV-Datenbank:
16.10.2026, keine bekannten Lücken. Neue Versionen nur gezielt übernehmen, nicht am Tag ihres Erscheinens.

## Kosten und Grenzen

- Gratis-Tarif: rund 100 000 Anfragen pro Tag. Ein einstündiger Einkauf mit drei Geräten braucht etwa 2 000–3 000.
- Über der Grenze entstehen **keine** Kosten – der Abgleich pausiert bis zum nächsten Tag, die App arbeitet lokal weiter.
- Briefkästen, die 180 Tage niemand benutzt hat, löschen sich selbst.

## Schnittstelle

Alle Pfade beginnen mit `/v1/lists/<Listen-ID>` (22 Zeichen base64url). „Nachweis“ = Kopfzeilen
`Authorization: Bearer <Schreib-Nachweis>` **und** `X-Member: <Mitglieds-ID>`; der Briefkasten kennt nur den
SHA-256-Prüfwert des Nachweises. Höchstens 5 Mitglieder (Plätze) pro Liste; Einladungen gelten höchstens 30 Minuten.

| Anfrage | Zugang | Zweck |
|---|---|---|
| `PUT` | – | Briefkasten anlegen: `{ proofHash, memberId }` (erster Platz) |
| `GET` | Nachweis | `{ last, members, maxMembers }` |
| `DELETE` | Nachweis | Briefkasten samt Inhalt löschen |
| `POST /ops` | Nachweis | Änderungen einwerfen: `{ data }` → `{ nr }` |
| `GET /ops?after=N` | Nachweis | Änderungen nach Nummer N: `{ snapshot, items: [{nr, data}], last, more }` |
| `PUT /snapshot` | Nachweis | Gesamtstand bis Nummer `upto` ablegen; ältere Änderungen werden gelöscht |
| `PUT /proof` | Nachweis | neuer Schreib-Nachweis (nach neuem Listenschlüssel) |
| `GET /members` | Nachweis | Plätze: `{ members: [{mid, at}], maxMembers }` |
| `DELETE /members/<mid>` | Nachweis | austreten bzw. entfernen – Zugang endet sofort |
| `POST /invites` | Nachweis | Einladung gültig machen: `{ hash, ttlMs }` (höchstens 30 Minuten) |
| `POST /requests` | Einladung (`X-Invite`) | Beitrittsanfrage: `{ data }` → `{ rid }`; 409, wenn die Liste voll ist |
| `GET /requests/<rid>` | Einladung | Antwort abholen: `{ answer }` (null, solange offen; bis 24 h nach der Anfrage) |
| `GET /requests` | Nachweis | offene Anfragen |
| `POST /requests/<rid>` | Nachweis | bestätigen `{ answer }` (die `rid` wird Mitglieds-ID des neuen Geräts) oder ablehnen `{ reject: true }` |

## Tests

```bash
cd tools/sync && npm test
```

Die Tests laufen ohne Cloudflare: Der Speicher wird mit dem in Node eingebauten SQLite nachgebildet.
