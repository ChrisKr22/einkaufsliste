# Briefkasten für gemeinsame Listen (Cloudflare Worker)

Ein kleines Programm bei Cloudflare, das für jede gemeinsame Liste verschlüsselte Änderungen aufbewahrt
(KONZEPT.md, Abschnitt 8.4). Es kann keine Inhalte lesen, speichert keine IP-Adressen und führt kein Protokoll.

## Einmalige Einrichtung (ca. 15 Minuten)

1. **Konto anlegen:** <https://dash.cloudflare.com/sign-up> – kostenlos, nur E-Mail-Adresse, keine Kreditkarte.
   Empfehlung: unter *My Profile › Authentication* die Zwei-Faktor-Anmeldung einschalten.
2. **Im Terminal anmelden** (öffnet den Browser; dort „Allow“ bestätigen):

   ```bash
   cd tools/sync && npx wrangler@4 login
   ```

3. **Online stellen:**

   ```bash
   cd tools/sync && npx wrangler@4 deploy
   ```

   Beim ersten Mal fragt Cloudflare nach einem Namen für die eigene `workers.dev`-Adresse (z. B. `chriskr22`).
   Am Ende steht die Adresse des Briefkastens, etwa `https://feedyourself-sync.chriskr22.workers.dev`.
4. **Prüfen:** die Adresse im Browser öffnen – es erscheint `{"service":"feedyourself-sync","ok":true}`.
5. **Adresse an Claude geben.** Sie ist kein Geheimnis; sie kommt in den Code der App.

Spätere Änderungen am Worker: Schritt 3 wiederholen.

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
