/** Penyimpanan preferensi sederhana (key -> value). */

import { STORE, ambil, ambilSemua, simpan, hapus } from '../db.js';

export const KUNCI = {
  TEMA: 'tema',
  PERIODE_DEFAULT: 'periodeDefault',
  FOLDER_EXPORT: 'folderExport',
  FOLDER_UPLOAD: 'folderUpload',
  KATEGORI_TERSEMAI: 'kategoriTersemai',
  SEMBUNYIKAN_SALDO: 'sembunyikanSaldo',
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
