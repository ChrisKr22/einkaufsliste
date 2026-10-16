// Verschlüsselung gemeinsamer Listen (KONZEPT.md 8.4) – über die WebCrypto-Schnittstelle des Browsers.
//
// Jede Liste hat einen zufälligen Listenschlüssel (256 Bit). Daraus werden zwei getrennte Schlüssel abgeleitet (HKDF):
//   – der Inhaltsschlüssel (AES-GCM) – verschlüsselt alles, was in den Briefkasten geht; verlässt nie das Gerät;
//   – der Schreib-Nachweis – den bekommt der Briefkasten, damit nur Mitglieder einwerfen können.
// Aus dem Schreib-Nachweis lässt sich der Inhaltsschlüssel nicht zurückrechnen; der Briefkasten kann also nichts lesen.

import { fromBase64Url, toBase64Url } from '../data/share.js';

const IV_BYTES = 12;
const SEAL_FORMAT = 'a';   // erstes Zeichen jedes versiegelten Texts: Version des Verfahrens
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Neuer zufälliger Listenschlüssel als Text (base64url, 43 Zeichen). */
export function newListKey() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Neue zufällige Listen-ID (128 Bit, base64url) – nicht zu erraten. */
export function newListId() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

async function hkdf(listKey, listId, purpose) {
  const raw = fromBase64Url(listKey);
  if (raw.length !== 32) throw new Error('ungültiger Listenschlüssel');
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits']);
  return { base, params: { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(`feedyourself/${listId}`), info: encoder.encode(purpose) } };
}

/**
 * Schlüssel einer Liste, einmal abgeleitet und dann wiederverwendet.
 * @returns {Promise<{listId: string, content: CryptoKey, writeProof: string}>}
 */
export async function listKeys(listKey, listId) {
  const content = await hkdf(listKey, listId, 'inhalt');
  const write = await hkdf(listKey, listId, 'schreiben');
  return {
    listId,
    content: await crypto.subtle.deriveKey(content.params, content.base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
    writeProof: toBase64Url(new Uint8Array(await crypto.subtle.deriveBits(write.params, write.base, 256))),
  };
}

/** Prüfwert des Schreib-Nachweises – den speichert der Briefkasten statt des Nachweises selbst. */
export async function proofHash(writeProof) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(writeProof))));
}

/**
 * Verschlüsselt ein JSON-taugliches Objekt. Die Listen-ID ist fest eingebunden:
 * Ein Text aus einer anderen Liste lässt sich hier nicht unterschieben.
 * @param {{listId: string, content: CryptoKey}} keys  aus `listKeys`
 * @returns {Promise<string>}
 */
export async function seal(keys, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = encoder.encode(JSON.stringify(payload));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(keys.listId) }, keys.content, data));
  const bytes = new Uint8Array(IV_BYTES + cipher.length);
  bytes.set(iv);
  bytes.set(cipher, IV_BYTES);
  return SEAL_FORMAT + toBase64Url(bytes);
}

/** Gegenstück zu `seal`; wirft bei falschem Schlüssel, fremder Liste oder verändertem Text. */
export async function unseal(keys, sealed) {
  if (typeof sealed !== 'string' || sealed[0] !== SEAL_FORMAT) throw new Error('unbekanntes Format');
  const bytes = fromBase64Url(sealed.slice(1));
  if (bytes.length <= IV_BYTES) throw new Error('beschädigt');
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: encoder.encode(keys.listId) },
      keys.content, bytes.slice(IV_BYTES));
  } catch {
    throw new Error('nicht lesbar – falscher Schlüssel oder beschädigt');
  }
  return JSON.parse(decoder.decode(plain));
}
