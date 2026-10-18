/**
 * Hash SHA-256 memakai Web Crypto. Tersedia sama persis di browser dan di Node 18+,
 * jadi logika dedupe bisa diuji tanpa browser.
 */

const enc = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(data) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

/** Hash sebuah string. */
export function hashTeks(teks) {
  return sha256Hex(enc.encode(String(teks)));
}

/** Hash isi file (ArrayBuffer / Uint8Array) — dipakai mendeteksi upload file yang sama. */
export function hashBiner(buffer) {
  return sha256Hex(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
}

/** Id acak pendek untuk entitas baru. */
export function idBaru(prefix = '') {
  const s = hex(crypto.getRandomValues(new Uint8Array(8)));
  return prefix ? `${prefix}_${s}` : s;
}
