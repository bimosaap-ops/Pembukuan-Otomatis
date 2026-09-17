/** Penyimpanan preferensi sederhana (key -> value). */

import { STORE, ambil, ambilSemua, simpan, hapus } from '../db.js';

export const KUNCI = {
  TEMA: 'tema',
  PERIODE_DEFAULT: 'periodeDefault',
  FOLDER_EXPORT: 'folderExport',
  FOLDER_UPLOAD: 'folderUpload',
  KATEGORI_TERSEMAI: 'kategoriTersemai',
  SEMBUNYIKAN_SALDO: 'sembunyikanSaldo',
  /* "Fase C" (lihat services/email-ledger-merge.js): rekening BCA tujuan
     provisional saat notifikasi email cuma menyebut nama bank "BCA" tanpa
     nomor rekening (ada 2 rekening BCA) -- ID akun, bukan nomor rekening
     mentah, supaya tetap valid kalau nomor rekeningnya berubah format. */
  EMAIL_AKUN_UTAMA_BCA: 'emailAkunUtamaBCA',
  EMAIL_AKUN_RDN_BCA: 'emailAkunRdnBCA',
  /* Flag dry-run: saat false (default), rekonsiliasi & saran kategori email
     tetap jalan penuh seperti biasa, tapi TIDAK ADA baris ledger provisional
     yang dibuat -- lihat "Urutan implementasi" di rencana Fase C. */
  EMAIL_LEDGER_MERGE_AKTIF: 'emailLedgerMergeAktif',
};

export async function baca(key, bawaan = null) {
  const row = await ambil(STORE.SETTINGS, key);
  return row === undefined || row === null ? bawaan : row.value;
}

export async function tulis(key, value) {
  await simpan(STORE.SETTINGS, { key, value });
  return value;
}

export async function hapusKunci(key) {
  return hapus(STORE.SETTINGS, key);
}

export async function bacaSemua() {
  const rows = await ambilSemua(STORE.SETTINGS);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
