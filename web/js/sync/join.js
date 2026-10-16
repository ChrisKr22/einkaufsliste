// Beitritt zu einer gemeinsamen Liste (KONZEPT.md 8.4) – Einladung, Geräteschlüssel, Prüfcode.
//
// Ablauf:
//   1. Ein Mitglied erzeugt ein Einladungs-Geheimnis und schickt den Link (#beitreten=Liste.Geheimnis.Name).
//      Beim Briefkasten liegt nur der Prüfwert eines daraus abgeleiteten Tokens – er kennt das Geheimnis nicht.
//   2. Das neue Gerät erzeugt ein eigenes Schlüsselpaar (ECDH P-256) und stellt eine Anfrage:
//      öffentlicher Schlüssel + Gerätename, verschlüsselt mit dem Einladungs-Geheimnis.
//   3. Beide Geräte zeigen denselben 4-stelligen Prüfcode (aus Geheimnis + öffentlichem Schlüssel).
//      Wer die Einladung abgefangen hat, hat einen anderen Schlüssel und damit einen anderen Code.
//   4. Das bestätigende Mitglied verschlüsselt den Listenschlüssel nur für dieses Gerät.

import { fromBase64Url, toBase64Url } from '../data/share.js';
import { listKeys, newListKey } from './crypto.js';

export const JOIN_PARAM = 'beitreten';
const encoder = new TextEncoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

/** Neues Einladungs-Geheimnis (256 Bit). */
export const newInviteSecret = newListKey;

/**
 * Schlüssel einer Einladung: `content` verschlüsselt die Anfrage, `token` weist sie beim Briefkasten aus.
 * @returns {Promise<{listId: string, content: CryptoKey, token: string}>}
 */
export async function inviteKeys(secret, listId) {
  const keys = await listKeys(secret, `einladung/${listId}`);
  return { listId, content: keys.content, token: keys.writeProof };
}

// ---------------------------------------------------------------- Link

export function inviteLink(baseUrl, { listId, secret, name }) {
  return `${baseUrl}#${JOIN_PARAM}=${listId}.${secret}.${toBase64Url(encoder.encode(name ?? ''))}`;
}

/** Findet eine Einladung in einem Link oder einer eingefügten Nachricht. @returns {{listId, secret, name}|null} */
export function parseInvite(text) {
  const match = new RegExp(`[#&]${JOIN_PARAM}=([A-Za-z0-9_-]{22})\\.([A-Za-z0-9_-]{43})(?:\\.([A-Za-z0-9_-]*))?`).exec(String(text ?? ''));
  if (!match) return null;
  let name = '';
  try {
    name = match[3] ? new TextDecoder().decode(fromBase64Url(match[3])) : '';
  } catch { /* Name ist nur Beiwerk */ }
  return { listId: match[1], secret: match[2], name: name.slice(0, 60) };
}

export function inviteText(link, listName) {
  return `Komm in meine Einkaufsliste „${listName}“ bei FeedYourself:\n${link}\n\n`
    + 'Der Link gilt 30 Minuten. In der App auf dem Home-Bildschirm: Link kopieren und unter Einstellungen › „Geteilte Liste einfügen“ einsetzen.';
}

// ---------------------------------------------------------------- Geräteschlüssel

/** Schlüsselpaar dieses Geräts für den Beitritt; als JWK speicherbar. */
export async function newDeviceKeys() {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  return {
    publicJwk: publicPart(await crypto.subtle.exportKey('jwk', pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  };
}

const publicPart = ({ kty, crv, x, y }) => ({ kty, crv, x, y });

function validPublicJwk(jwk) {
  return jwk && jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string';
}

/** 4-stelliger Prüfcode aus Einladungs-Geheimnis und öffentlichem Schlüssel des neuen Geräts. */
export async function checkCode(secret, publicJwk) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${secret}|${publicJwk.x}|${publicJwk.y}`)));
  const number = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  return String(number % 10_000).padStart(4, '0');
}

async function sharedKey(privateKey, publicJwk) {
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk, ECDH, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('feedyourself/beitritt'), info: encoder.encode('schluessel') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * Verschlüsselt etwas nur für das Gerät mit diesem öffentlichen Schlüssel (Einmal-Schlüsselpaar des Absenders).
 * @returns {Promise<string>} JSON-Text { epk, iv, data }
 */
export async function sealForDevice(publicJwk, payload) {
  if (!validPublicJwk(publicJwk)) throw new Error('ungültiger Geräteschlüssel');
  const ephemeral = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const key = await sharedKey(ephemeral.privateKey, publicJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload))));
  const epk = publicPart(await crypto.subtle.exportKey('jwk', ephemeral.publicKey));
  return JSON.stringify({ epk, iv: toBase64Url(iv), data: toBase64Url(data) });
}

/** Gegenstück zu `sealForDevice` mit dem eigenen privaten Schlüssel (JWK). */
export async function openForDevice(privateJwk, sealed) {
  const { epk, iv, data } = JSON.parse(sealed);
  if (!validPublicJwk(epk)) throw new Error('ungültige Antwort');
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, ECDH, false, ['deriveBits']);
  const key = await sharedKey(privateKey, epk);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, key, fromBase64Url(data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('Antwort nicht lesbar');
  }
}

export { validPublicJwk };
