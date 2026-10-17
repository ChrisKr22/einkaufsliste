// Erlaubte Form für IDs, die von außen kommen (gemeinsame Liste, Sicherungsdatei).
// Alle IDs der App passen hinein: UUIDs (newId), Katalog-IDs (z. B. „gehackte-tomaten“), Listen- und Mitglieds-IDs.
// IDs landen in HTML-Attributen und CSS-Selektoren – alles andere wird abgewiesen.

export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const isSafeId = (value) => typeof value === 'string' && SAFE_ID.test(value);
