/**
 * Migrasi data sekali jalan, dijaga bendera di store `settings`.
 *
 * Bukan lewat `onupgradeneeded` di db.js: migrasi di sini butuh operasi async,
 * dan transaksi IndexedDB keburu tertutup sebelum `await` pertama selesai.
 * Bagian yang menghitung dipisah jadi fungsi murni supaya bisa diuji tanpa
 * IndexedDB.
 */

import * as pengaturanRepo from './repo/settings.js';
import * as kategoriRepo from './repo/categories.js';
import { KATEGORI_BAWAAN, tambahPola } from '../domain/categorize.js';

/**
 * Bendera migrasi kata kunci kategori bawaan — lihat migrasiKataKunciBawaan.
 *
 * PENTING: bendera ini SEKALI JALAN per nilai string-nya. Menambah kata kunci
 * baru ke KATEGORI_BAWAAN di rilis berikutnya TIDAK sampai ke pengguna yang
 * sudah menjalankan versi ini — persis kelas masalah yang migrasi ini sendiri
 * dibuat untuk menutup, sekarang kena ke migrasinya sendiri. Naikkan angka di
 * belakang ('V1' -> 'V2' -> ...) SETIAP KALI KATEGORI_BAWAAN dapat kata kunci
 * baru, supaya migrasi ini jalan sekali lagi dan menyusul yang tertinggal.
 * (Ketahuan lewat SOLARIABUA/JAMBILLIARD/DANAMONPENGGANTIAN yang tidak ikut
 * terkoreksi walau kode sudah benar dan sudah live — kata kuncinya sendiri
 * tidak pernah sampai ke daftar kategori pengguna karena bendera V1 sudah
 * terpakai dari rilis sebelumnya.)
 */
export const KUNCI_MIGRASI_KATA_KUNCI = 'migrasiKataKunciBawaanV2';
/**
 * Hitung kategori bawaan mana yang perlu ditambah kata kuncinya.
 *
 * Fungsi murni: menerima daftar kategori milik
 * pengguna dan daftar definisi bawaan, mengembalikan HANYA kategori yang
 * benar-benar berubah (dengan `polaKataKunci` sudah tergabung) — tidak
 * menyentuh database. Dicocokkan lewat `id`, yang tidak pernah berubah untuk
 * kategori bawaan; kategori buatan pengguna sendiri (id bukan bawaan) dan
 * kategori bawaan yang pernah dihapus pengguna tidak ikut diproses. Duplikat
 * dijaga oleh `tambahPola`, yang juga berarti hanya MENAMBAH — tidak pernah
 * mengurangi kata kunci atau mengganti urutan yang sudah ada.
 *
 * @param {Array} kategoriSekarang milik pengguna, dari kategoriRepo.daftar()
 * @param {Array} kategoriBawaan definisi terkini, KATEGORI_BAWAAN
 * @returns {{kategoriBerubah: Array, jumlahKataKunci: number}}
 */
export function gabungKataKunciBaru(kategoriSekarang, kategoriBawaan) {
  const kategoriBerubah = [];
  let jumlahKataKunci = 0;

  for (const def of kategoriBawaan) {
    const punyaPengguna = kategoriSekarang.find((k) => k.id === def.id);
    if (!punyaPengguna) continue; // kategori bawaan ini pernah dihapus pengguna — biarkan.

    let diperbarui = punyaPengguna;
    for (const pola of def.polaKataKunci || []) {
      const sebelum = diperbarui.polaKataKunci?.length || 0;
      diperbarui = tambahPola(diperbarui, pola);
      if ((diperbarui.polaKataKunci?.length || 0) > sebelum) jumlahKataKunci += 1;
    }

    if (diperbarui !== punyaPengguna) kategoriBerubah.push(diperbarui);
  }

  return { kategoriBerubah, jumlahKataKunci };
}

/**
 * Tambahkan kata kunci baru dari KATEGORI_BAWAAN ke kategori bawaan yang sudah
 * dipakai pengguna. Aman dipanggil tiap aplikasi dibuka (berhenti sendiri
 * lewat bendera, seperti jalankanMigrasi di atas).
 *
 * semaiBawaan() (lihat repo/categories.js) hanya menyalin KATEGORI_BAWAAN ke
 * IndexedDB SEKALI saat aplikasi pertama dipakai — "setelah itu daftar
 * sepenuhnya milik pengguna". Artinya menambah kata kunci baru ke
 * KATEGORI_BAWAAN di kode (mis. menambah "BAKSO", "SATE", "WARTEG" ke Makan &
 * Minum) tidak pernah sampai ke pengguna yang sudah lama memakai aplikasi —
 * kategori "Makan & Minum" di perangkat mereka membeku di daftar kata kunci
 * lama selamanya. Migrasi ini menutup celah itu.
 *
 * Tidak mengubah kategori transaksi mana pun dengan sendirinya — pengguna
 * tetap perlu menekan "Kelompokkan ulang semua transaksi" di halaman
 * Kategori (sudah ada) supaya transaksi lama ikut menikmati kata kunci baru.
 */
export async function migrasiKataKunciBawaan() {
  const sudah = await pengaturanRepo.baca(KUNCI_MIGRASI_KATA_KUNCI, '');
  if (sudah) return { dilewati: true };

  const kategoriSekarang = await kategoriRepo.daftar();
  const { kategoriBerubah, jumlahKataKunci } = gabungKataKunciBaru(kategoriSekarang, KATEGORI_BAWAAN);

  for (const kat of kategoriBerubah) await kategoriRepo.simpanKategori(kat);

  await pengaturanRepo.tulis(KUNCI_MIGRASI_KATA_KUNCI, '1');
  return { dijalankan: true, jumlahKategori: kategoriBerubah.length, jumlahKataKunci };
}
