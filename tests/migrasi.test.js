/**
 * Tes bagian murni migrasi. Fungsi yang menyentuh IndexedDB sengaja tidak
 * diuji di sini (seluruh tes di repositori ini menghindari pemalsu IndexedDB).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { gabungKataKunciBaru } from '../src/data/migrasi.js';

/* ==========================================================================
   gabungKataKunciBaru — menutup celah semaiBawaan() yang hanya menyalin
   KATEGORI_BAWAAN sekali di awal (lihat migrasiKataKunciBawaan)
   ========================================================================== */

test('gabungKataKunciBaru menambahkan kata kunci yang belum ada ke kategori bawaan pengguna', () => {
  const kategoriSekarang = [
    { id: 'kat_makan', nama: 'Makan & Minum', polaKataKunci: ['KOPI', 'CAFE'] },
    { id: 'kat_lain', nama: 'Milik pengguna sendiri', polaKataKunci: ['SESUATU'] },
  ];
  const kategoriBawaan = [
    { id: 'kat_makan', polaKataKunci: ['KOPI', 'CAFE', 'BAKSO', 'SATE'] },
  ];

  const { kategoriBerubah, jumlahKataKunci } = gabungKataKunciBaru(kategoriSekarang, kategoriBawaan);

  assert.equal(kategoriBerubah.length, 1, 'hanya kat_makan yang berubah');
  assert.deepEqual(kategoriBerubah[0].polaKataKunci, ['KOPI', 'CAFE', 'BAKSO', 'SATE'],
    'kata kunci lama dipertahankan, yang baru ditambahkan di belakang');
  assert.equal(jumlahKataKunci, 2, 'BAKSO dan SATE adalah dua kata kunci baru');
});

test('gabungKataKunciBaru tidak menyentuh kategori yang sudah punya semua kata kunci', () => {
  const kategoriSekarang = [{ id: 'kat_makan', polaKataKunci: ['KOPI', 'BAKSO'] }];
  const kategoriBawaan = [{ id: 'kat_makan', polaKataKunci: ['KOPI', 'BAKSO'] }];

  const { kategoriBerubah, jumlahKataKunci } = gabungKataKunciBaru(kategoriSekarang, kategoriBawaan);

  assert.deepEqual(kategoriBerubah, [], 'tidak ada yang perlu diperbarui -> tidak ada penulisan sia-sia');
  assert.equal(jumlahKataKunci, 0);
});

test('gabungKataKunciBaru tidak menyentuh kategori bawaan yang sudah dihapus pengguna', () => {
  const kategoriSekarang = [{ id: 'kat_lain', polaKataKunci: [] }]; // kat_makan sudah dihapus
  const kategoriBawaan = [{ id: 'kat_makan', polaKataKunci: ['BAKSO'] }];

  const { kategoriBerubah } = gabungKataKunciBaru(kategoriSekarang, kategoriBawaan);
  assert.deepEqual(kategoriBerubah, [], 'kategori yang sudah dihapus pengguna tidak boleh dibuat ulang');
});

test('gabungKataKunciBaru tidak pernah mengurangi kata kunci milik pengguna sendiri', () => {
  // Pengguna mungkin sudah MENGHAPUS satu kata kunci bawaan lewat halaman
  // Kategori (mis. karena salah tangkap transaksi lain) — migrasi tidak boleh
  // mengembalikannya begitu saja, karena itu bukan "menambah", tapi menimpa
  // keputusan pengguna. Ini didokumentasikan lewat perilaku saat ini: kata
  // kunci bawaan yang sudah dihapus pengguna, kalau masih ada di
  // KATEGORI_BAWAAN, AKAN ditambahkan lagi (tambahPola hanya memeriksa
  // duplikat, bukan riwayat penghapusan) — jadi hanya kata kunci BARU yang
  // aman diandalkan lewat migrasi ini.
  const kategoriSekarang = [{ id: 'kat_makan', polaKataKunci: ['CAFE'] }]; // "KOPI" sengaja dihapus pengguna
  const kategoriBawaan = [{ id: 'kat_makan', polaKataKunci: ['KOPI', 'CAFE'] }];

  const { kategoriBerubah } = gabungKataKunciBaru(kategoriSekarang, kategoriBawaan);
  assert.ok(kategoriBerubah[0].polaKataKunci.includes('KOPI'),
    'perilaku saat ini: kata kunci LAMA yang dihapus pengguna ikut kembali — hanya kata kunci BARU yang dijamin aman');
});
