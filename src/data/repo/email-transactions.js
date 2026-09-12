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
 * Simpan banyak transaksi email sekaligus, MELEWATI yang `gmailMessageId`-nya
 * sudah tersimpan — jalur dedup utama saat menarik hasil pull dari Sheets
 * (lihat src/services/email-feed-sync.js), karena pull yang sama bisa saja
 * ditarik ulang dari checkpoint yang belum maju (mis. request putus di
 * tengah jalan sebelum checkpoint tersimpan).
 */
export async function simpanBanyakBaru(daftar) {
  if (!daftar.length) return [];
  const sudahAda = await ambilSemua(STORE.EMAIL_TRANSACTIONS);
  const idSudahAda = new Set(sudahAda.map((t) => t.gmailMessageId).filter(Boolean));
  const baru = daftar.filter((d) => !idSudahAda.has(d.gmailMessageId));
  if (!baru.length) return [];

  const siap = baru.map((d) => buatTransaksiEmail(d));
  await jalankan(STORE.EMAIL_TRANSACTIONS, 'readwrite', (store) => {
    siap.forEach((t) => store.put(t));
  });
  return siap;
}
