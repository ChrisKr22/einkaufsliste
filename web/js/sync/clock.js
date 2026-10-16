// Hybrid-Uhr für den Abgleich gemeinsamer Listen (KONZEPT.md 8.4).
// Jeder Zeitstempel ist Uhrzeit + Zähler + Geräte-ID und als Text sortierbar. Wer einen fremden Stempel gesehen hat,
// erzeugt danach nur noch größere – auch wenn die eigene Uhr nachgeht. So gewinnt bei „letzte Änderung gewinnt“
// immer die Änderung, die wirklich danach kam, und zwei Stempel sind nie gleich (die Geräte-ID entscheidet).

const TIME_DIGITS = 13;   // Millisekunden seit 1970, reicht bis zum Jahr 2286
const COUNTER_DIGITS = 4; // Basis 36, bis 1,6 Mio. Änderungen in derselben Millisekunde

export function formatStamp(time, counter, deviceId) {
  return `${String(time).padStart(TIME_DIGITS, '0')}.${counter.toString(36).padStart(COUNTER_DIGITS, '0')}.${deviceId}`;
}

/** @returns {{time: number, counter: number, deviceId: string}} */
export function parseStamp(stamp) {
  const [time, counter, ...rest] = String(stamp).split('.');
  const parsed = { time: Number(time), counter: parseInt(counter, 36), deviceId: rest.join('.') };
  if (!Number.isFinite(parsed.time) || !Number.isFinite(parsed.counter) || !parsed.deviceId) throw new Error('ungültiger Zeitstempel');
  return parsed;
}

/**
 * @param {string} deviceId  zufällige ID dieses Geräts (ohne Punkt am Anfang)
 * @param {{now?: () => number, state?: {time: number, counter: number}}} [options]  state: gespeicherter Stand
 */
export function createClock(deviceId, { now = () => Date.now(), state } = {}) {
  let time = state?.time ?? 0;
  let counter = state?.counter ?? 0;

  return {
    deviceId,
    /** Neuer Stempel für eine eigene Änderung. */
    tick() {
      const wall = now();
      if (wall > time) {
        time = wall;
        counter = 0;
      } else {
        counter++;
      }
      return formatStamp(time, counter, deviceId);
    },
    /** Fremden Stempel gesehen: Die nächsten eigenen Stempel liegen danach. */
    receive(stamp) {
      const seen = parseStamp(stamp);
      if (seen.time > time || (seen.time === time && seen.counter > counter)) {
        time = seen.time;
        counter = seen.counter;
      }
    },
    /** Zum Speichern; mit `createClock(id, { state })` wieder aufnehmen. */
    get state() {
      return { time, counter };
    },
  };
}
