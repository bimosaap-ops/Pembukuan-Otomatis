/** Repository kategori, termasuk penyemaian kategori bawaan saat pertama dipakai. */

import { STORE, ambilSemua, ambil, simpan, simpanBanyak, hapus } from '../db.js';
import { buatKategori } from '../../domain/entities.js';
import { KATEGORI_BAWAAN } from '../../domain/categorize.js';
import * as pengaturan from './settings.js';

let cache = null;

export function kosongkanCache() {
  cache = null;
}

/** Isi kategori bawaan sekali saja; setelah itu daftar sepenuhnya milik pengguna. */
export async function semaiBawaan() {
  const sudah = await pengaturan.baca(pengaturan.KUNCI.KATEGORI_TERSEMAI, false);
  if (sudah) return false;

  const ada = await ambilSemua(STORE.CATEGORIES);
  if (!ada.length) {
    await simpanBanyak(STORE.CATEGORIES, KATEGORI_BAWAAN.map((k) => buatKategori(k)));
  }
  await pengaturan.tulis(pengaturan.KUNCI.KATEGORI_TERSEMAI, true);
  kosongkanCache();
  return true;
}

export async function daftar() {
  if (cache) return cache;
  const rows = await ambilSemua(STORE.CATEGORIES);
  rows.sort((a, b) => (a.tipe === b.tipe ? (a.urutan ?? 0) - (b.urutan ?? 0) : a.tipe.localeCompare(b.tipe)));
  cache = rows;
  return rows;
}

export async function peta() {
  const rows = await daftar();
  return new Map(rows.map((k) => [k.id, k]));
}

export async function satu(id) {
  return ambil(STORE.CATEGORIES, id);
}

export async function simpanKategori(data) {
  const kat = buatKategori(data);
  await simpan(STORE.CATEGORIES, kat);
  kosongkanCache();
  return kat;
}

export async function hapusKategori(id) {
  await hapus(STORE.CATEGORIES, id);
  kosongkanCache();
}
