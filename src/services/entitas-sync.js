/**
 * Tarik AKUN/KATEGORI dari Google Sheets dan gabungkan ke IndexedDB —
 * pasangan pull dari syncEntitasKeSheets/hapusEntitasDariSheets di
 * sheets-sync.js (yang menangani arah push).
 *
 * Resolusi konflik: last-updated-wins berdasarkan `diubahPada` (AD-011).
 * Baris remote HANYA diterapkan kalau remote lebih baru dari lokal, atau
 * lokal belum punya record itu sama sekali (restore/bootstrap perangkat
 * baru). Tombstone ("Dihapus Pada" terisi) selalu dihormati kalau recordnya
 * masih ada secara lokal — dihapus, bukan diperbarui.
 *
 * Sengaja HANYA dipanggil manual dari tombol di Pengaturan, tidak dipasang
 * sebagai auto-pull saat aplikasi dibuka — sama seperti alasan
 * tarikTransaksiEmail belum di-poll otomatis di sisi PWA: pola ini baru,
 * lebih aman dibuktikan lewat pemakaian manual dulu sebelum dijadikan
 * otomatis.
 */

import {
  tarikEntitasDariSheets, akunDariBarisSheet, kategoriDariBarisSheet,
} from './sheets-sync.js';
import * as akunRepo from '../data/repo/accounts.js';
import * as kategoriRepo from '../data/repo/categories.js';

/**
 * Bandingkan waktu lokal vs remote untuk satu record — murni, diekspor
 * supaya bisa diuji tanpa IndexedDB. `diubahPada` dipakai kalau ada
 * (perubahan sungguhan), jatuh ke `dibuatPada` untuk record yang belum
 * pernah diedit ulang sejak dibuat. String ISO 8601 boleh dibandingkan
 * leksikografis langsung karena formatnya selalu UTC (akhiran "Z").
 * @returns {boolean} true kalau baris remote harus menang
 */
export function remoteLebihBaru(lokal, remote) {
  if (!lokal) return true; // belum ada secara lokal -- restore/bootstrap
  const waktuLokal = lokal.diubahPada || lokal.dibuatPada || '';
  const waktuRemote = remote.diubahPada || remote.dibuatPada || '';
  return waktuRemote > waktuLokal;
}

async function terapkanBarisAkun(row, lokal) {
  if (row.dihapusPada) {
    if (lokal) await akunRepo.hapusAkunSajaRecord(row.id);
    return lokal ? 'dihapus' : 'dilewati';
  }
  if (!remoteLebihBaru(lokal, row)) return 'dilewati';

  const disimpan = await akunRepo.simpanAkun(akunDariBarisSheet(row));
  // saldo/jumlahTransaksi tidak ikut dipetakan dari Sheet (lihat catatan di
  // akunDariBarisSheet) -- dihitung ulang dari transaksi lokal supaya tidak
  // ikut menimpa angka lokal yang lebih akurat dengan sisa perangkat lain.
  await akunRepo.hitungUlangSaldo(disimpan.id);
  return lokal ? 'diperbarui' : 'baru';
}

async function terapkanBarisKategori(row, lokal) {
  if (row.dihapusPada) {
    if (lokal) await kategoriRepo.hapusKategori(row.id);
    return lokal ? 'dihapus' : 'dilewati';
  }
  if (!remoteLebihBaru(lokal, row)) return 'dilewati';

  await kategoriRepo.simpanKategori(kategoriDariBarisSheet(row));
  return lokal ? 'diperbarui' : 'baru';
}

/**
 * Titik masuk utama: tarik seluruh baris AKUN atau KATEGORI dari Sheet dan
 * terapkan ke IndexedDB satu per satu. Melempar error bila gagal (URL belum
 * diisi, timeout, dll.) — pemanggil UI yang memutuskan cara menampilkannya,
 * sama seperti tarikTransaksiEmail().
 * @param {'akun'|'kategori'} entity
 */
export async function tarikDanGabungEntitas(entity) {
  const hasil = await tarikEntitasDariSheets(entity);
  if (hasil.skipped) return { skipped: true };

  const terapkan = entity === 'akun' ? terapkanBarisAkun : terapkanBarisKategori;
  const repo = entity === 'akun' ? akunRepo : kategoriRepo;

  const ringkasan = { baru: 0, diperbarui: 0, dihapus: 0, dilewati: 0 };
  for (const row of hasil.baris) {
    if (!row.id) continue;
    // Berurutan, bukan Promise.all: jumlah baris realistis (puluhan), dan
    // upsert-per-id harus melihat hasil operasi sebelumnya kalau ada ID yang
    // (seharusnya tidak pernah, tapi) terulang dalam satu tarikan.
    const lokal = await repo.satu(row.id);
    const status = await terapkan(row, lokal);
    ringkasan[status] += 1;
  }

  return { ok: true, ditarik: hasil.baris.length, ...ringkasan };
}
