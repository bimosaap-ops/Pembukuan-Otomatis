/**
 * Repository transaksi email (Realtime Email Transaction Feed) — lihat
 * src/domain/entities.js `buatTransaksiEmail`.
 */

import { STORE, jalankan, ambilSemua, ambil, simpan, ambilLewatIndex } from '../db.js';
import { buatTransaksiEmail } from '../../domain/entities.js';

export async function semua() {
  return ambilSemua(STORE.EMAIL_TRANSACTIONS);
}

export async function satu(id) {
  return ambil(STORE.EMAIL_TRANSACTIONS, id);
}

export async function perGmailMessageId(gmailMessageId) {
  const rows = await ambilLewatIndex(STORE.EMAIL_TRANSACTIONS, 'gmailMessageId', gmailMessageId);
  return rows[0] || null;
}

export async function perStatus(statusCocok) {
  return ambilLewatIndex(STORE.EMAIL_TRANSACTIONS, 'statusCocok', statusCocok);
}

export async function simpanSatu(data) {
  const trx = buatTransaksiEmail(data);
  await simpan(STORE.EMAIL_TRANSACTIONS, trx);
  return trx;
}

/**
 * Saring baris tarikan menjadi yang benar-benar baru — murni, diekspor supaya
 * bisa diuji tanpa IndexedDB.
 *
 * Penyaringannya DUA arah, dan arah kedua bukan sekadar kehati-hatian:
 * indeks `gmailMessageId` bersifat unique (lihat db.js), jadi satu tarikan
 * yang kebetulan memuat dua baris ber-`gmailMessageId` sama — termasuk dua
 * baris yang sama-sama kosong — membuat `put` kedua ditolak dan SELURUH
 * transaksi penyimpanan dibatalkan. Akibatnya bukan satu baris yang hilang,
 * melainkan seluruh tarikan gagal, checkpoint tidak pernah maju, dan
 * kegagalan yang sama terulang setiap kali tombol "Tarik email" ditekan.
 * Kejadian pertama yang menang, konsisten dengan urutan kedatangan.
 *
 * @param {Array} daftar baris hasil tarikTransaksiEmail()
 * @param {Set<string>} idSudahAda gmailMessageId yang sudah tersimpan
 */
export function saringBarisBaru(daftar, idSudahAda) {
  const terlihat = new Set();
  return (daftar || []).filter((d) => {
    const gid = d && d.gmailMessageId ? String(d.gmailMessageId) : '';
    if (idSudahAda.has(gid) || terlihat.has(gid)) return false;
    terlihat.add(gid);
    return true;
  });
}

/**
 * Simpan banyak transaksi email sekaligus, MELEWATI yang `gmailMessageId`-nya
 * sudah tersimpan — jalur dedup utama saat menarik hasil pull dari Sheets
 * (lihat src/services/email-feed-sync.js), karena pull yang sama bisa saja
 * ditarik ulang dari checkpoint yang belum maju (mis. request putus di
 * tengah jalan sebelum checkpoint tersimpan).
 */
export async function simpanBanyakBaru(daftar) {
  if (!daftar.length) return [];
  const sudahAda = await ambilSemua(STORE.EMAIL_TRANSACTIONS);
  // String kosong IKUT dihitung, tidak disaring keluar: indeks unique tidak
  // membedakannya dari kunci lain, jadi satu record ber-gmailMessageId kosong
  // yang sudah tersimpan tetap membuat penyimpanan berikutnya ditolak.
  const idSudahAda = new Set(sudahAda.map((t) => String(t.gmailMessageId || '')));
  const baru = saringBarisBaru(daftar, idSudahAda);
  if (!baru.length) return [];

  const siap = baru.map((d) => buatTransaksiEmail(d));
  await jalankan(STORE.EMAIL_TRANSACTIONS, 'readwrite', (store) => {
    siap.forEach((t) => store.put(t));
  });
  return siap;
}
