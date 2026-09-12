/**
 * Kamus merchant -> kategori, dipelajari dari override pengguna saat
 * menyelesaikan transaksi email "Perlu Ditinjau" (lihat
 * src/domain/kategoriEmail.js, fase berikutnya). Konsep ini genuinely baru
 * — bukan perluasan `polaKataKunci` kategori yang sudah ada di
 * categorize.js, lihat rencana implementasi Realtime Email Transaction
 * Feed §C soal alasannya.
 */

import { STORE, ambil, ambilSemua, simpan, hapus } from '../db.js';

export async function cari(merchantKey) {
  const kunci = String(merchantKey || '').trim();
  if (!kunci) return null;
  return ambil(STORE.MERCHANT_DICTIONARY, kunci);
}

export async function semua() {
  return ambilSemua(STORE.MERCHANT_DICTIONARY);
}

/** Buat/perbarui satu entri kamus. `dibuatPada` dipertahankan bila entri sudah ada. */
export async function tetapkan(merchantKey, kategoriId) {
  const kunci = String(merchantKey || '').trim();
  if (!kunci || !kategoriId) return null;

  const ada = await ambil(STORE.MERCHANT_DICTIONARY, kunci);
  const entri = {
    merchantKey: kunci,
    kategoriId,
    dibuatPada: ada?.dibuatPada || new Date().toISOString(),
    diperbaruiPada: new Date().toISOString(),
  };
  await simpan(STORE.MERCHANT_DICTIONARY, entri);
  return entri;
}

export async function hapusEntri(merchantKey) {
  const kunci = String(merchantKey || '').trim();
  if (!kunci) return;
  return hapus(STORE.MERCHANT_DICTIONARY, kunci);
}
