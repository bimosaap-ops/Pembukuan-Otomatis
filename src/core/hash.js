/**
 * Hash SHA-256 memakai Web Crypto. Tersedia sama persis di browser dan di Node 18+,
 * jadi logika dedupe bisa diuji tanpa browser.
 */

const enc = new TextEncoder();

async function sha256Hex(data) {
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** Hash sebuah string. */
export function hashTeks(teks) {
  return sha256Hex(enc.encode(String(teks)));
}

/** Hash isi file (ArrayBuffer / Uint8Array) — dipakai mendeteksi upload file yang sama. */
export function hashBiner(buffer) {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return sha256Hex(view);
}

/** Id acak pendek untuk entitas baru. */
export function idBaru(prefix = '') {
  const acak = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (let i = 0; i < acak.length; i += 1) s += acak[i].toString(16).padStart(2, '0');
  return prefix ? `${prefix}_${s}` : s;
}
