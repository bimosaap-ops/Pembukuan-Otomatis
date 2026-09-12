/**
 * Migrasi data sekali jalan.
 *
 * Berbeda dari `onupgradeneeded` di db.js: migrasi di sini butuh operasi async
 * (menghitung SHA-256 lewat `crypto.subtle`), dan transaksi IndexedDB keburu
 * tertutup sebelum `await` pertama selesai. Karena itu migrasi dijalankan
 * sesudah database terbuka, dijaga bendera di store `settings`, bukan lewat
 * kenaikan VERSI_DB.
 *
 * Bagian yang menghitung dipisah jadi fungsi murni (`hitungHashBaru`) supaya
 * bisa diuji tanpa IndexedDB — sama seperti `kirimBaris` di sheets-sync.
 */

import * as pengaturanRepo from './repo/settings.js';
import * as trxRepo from './repo/transactions.js';
import * as kategoriRepo from './repo/categories.js';
import { hitungBaseHash, hashFinal } from '../domain/dedupe.js';
import { KATEGORI_BAWAAN, tambahPola } from '../domain/categorize.js';
import { KUNCI_SHEETS } from '../services/sheets-sync.js';

/** Bendera di store settings; nilainya versi migrasi yang sudah dijalankan. */
export const KUNCI_MIGRASI = 'migrasiHashRekening';
/** Bendera migrasi kata kunci kategori bawaan — lihat migrasiKataKunciBawaan. */
export const KUNCI_MIGRASI_KATA_KUNCI = 'migrasiKataKunciBawaanV1';
/** Bendera migrasi kategori Investasi — lihat migrasiKategoriInvestasi. */
export const KUNCI_MIGRASI_KATEGORI_INVESTASI = 'migrasiKategoriInvestasiV1';

/**
 * Hitung hash baru untuk seluruh transaksi.
 *
 * Fungsi murni: menerima daftar transaksi biasa, mengembalikan daftar yang
 * `baseHash` dan `hash`-nya sudah diperbarui. Tidak menyentuh database.
 *
 * Urutannya dibuat stabil dan tidak bergantung urutan bacaan database — tanggal,
 * lalu `urutan` di dalam statement, lalu `id`. Kalau nomor urut kejadian
 * bergantung pada urutan yang kebetulan, menjalankan migrasi dua kali bisa
 * menghasilkan hash berbeda untuk transaksi yang sama, dan Sheet akan melihatnya
 * sebagai baris baru setiap kali.
 *
 * @param {Array} transaksi
 * @returns {Promise<Array>} transaksi dengan hash baru, urut seperti masukan
 */
export async function hitungHashBaru(transaksi) {
  const urut = [...transaksi].sort((a, b) => (
    String(a.tanggal).localeCompare(String(b.tanggal))
    || (Number(a.urutan) || 0) - (Number(b.urutan) || 0)
    || String(a.id).localeCompare(String(b.id))
  ));

  const baseBaru = await Promise.all(urut.map((t) => hitungBaseHash({
    accountId: t.accountId,
    tanggal: t.tanggal,
    deskripsi: t.deskripsi,
    nominal: t.nominal,
  })));

  const terpakai = new Map();
  const perId = new Map();
  urut.forEach((t, i) => {
    const base = baseBaru[i];
    const ke = (terpakai.get(base) || 0) + 1;
    terpakai.set(base, ke);
    perId.set(t.id, { ...t, baseHash: base, hash: hashFinal(base, ke) });
  });

  // Dikembalikan mengikuti urutan masukan supaya pemanggil tidak perlu peduli
  // pada pengurutan internal di atas.
  return transaksi.map((t) => perId.get(t.id));
}

/**
 * Jalankan migrasi bila belum pernah. Aman dipanggil tiap aplikasi dibuka.
 *
 * @returns {Promise<{dilewati:true}|{dijalankan:true, jumlah:number}>}
 */
export async function jalankanMigrasi() {
  const sudah = await pengaturanRepo.baca(KUNCI_MIGRASI, '');
  if (sudah) return { dilewati: true };

  const transaksi = await trxRepo.semua();
  if (!transaksi.length) {
    // Pembukuan kosong: tidak ada yang perlu dihitung, tapi bendera tetap
    // ditandai supaya perangkat baru tidak memeriksa ulang tiap kali dibuka.
    await pengaturanRepo.tulis(KUNCI_MIGRASI, '1');
    return { dilewati: true };
  }

  const baru = await hitungHashBaru(transaksi);

  // Keunikan diperiksa di memori lebih dulu. Indeks `hash` di IndexedDB bersifat
  // unik, dan penulisan yang ditolak di tengah jalan akan meninggalkan pembukuan
  // separuh lama separuh baru — keadaan yang jauh lebih sulit dibereskan
  // daripada tidak bermigrasi sama sekali.
  const unik = new Set(baru.map((t) => t.hash));
  if (unik.size !== baru.length) {
    throw new Error('Migrasi dibatalkan: hash baru tidak unik.');
  }

  await trxRepo.simpanBanyakTransaksi(baru);
  await pengaturanRepo.tulis(KUNCI_MIGRASI, '1');
  // Antrean hapus berisi hash lama yang sekarang tidak menunjuk apa pun —
  // mengirimkannya hanya akan menyuruh Sheet menghapus baris yang tidak ada.
  await pengaturanRepo.tulis(KUNCI_SHEETS.ANTREAN_HAPUS, []);

  return { dijalankan: true, jumlah: baru.length };
}

/**
 * Hitung kategori bawaan mana yang perlu ditambah kata kuncinya.
 *
 * Fungsi murni (seperti hitungHashBaru): menerima daftar kategori milik
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

/**
 * Cari kategori dari `definisiBaru` yang belum ada di daftar pengguna.
 *
 * Fungsi murni, dicocokkan lewat `id` seperti gabungKataKunciBaru — tapi
 * sengaja TIDAK menggunakan ulang fungsi itu, karena maksudnya berlawanan:
 * gabungKataKunciBaru mengabaikan kategori yang tidak ditemukan (menganggap
 * sudah dihapus pengguna), sedangkan di sini kategori yang tidak ditemukan
 * justru itulah yang harus dibuat — kategori yang benar-benar baru di kode
 * tidak mungkin "sudah dihapus pengguna" karena belum pernah ada baginya
 * untuk dihapus.
 *
 * @param {Array} kategoriSekarang milik pengguna, dari kategoriRepo.daftar()
 * @param {Array} definisiBaru definisi kategori yang harus ada, subset KATEGORI_BAWAAN
 * @returns {Array} definisi yang belum dimiliki pengguna, siap disimpan apa adanya
 */
export function kategoriBaruYangBelumAda(kategoriSekarang, definisiBaru) {
  const idSekarang = new Set(kategoriSekarang.map((k) => k.id));
  return definisiBaru.filter((def) => !idSekarang.has(def.id));
}

/**
 * Tambahkan kategori "Investasi" (Pemasukan) bagi pengguna yang sudah
 * menjalankan semaiBawaan() sebelum kategori ini ditambahkan ke
 * KATEGORI_BAWAAN. Tanpa migrasi ini, pengguna lama tidak akan pernah punya
 * kategori ini sama sekali — beda dari migrasiKataKunciBawaan yang cuma
 * menambah kata kunci ke kategori yang sudah ada, di sini kategorinya
 * sendiri yang hilang.
 *
 * Tidak mengubah kategori transaksi mana pun dengan sendirinya — pengguna
 * tetap perlu menekan "Kelompokkan ulang semua transaksi" di halaman
 * Kategori supaya transaksi lama (mis. "LLG-BANK JAGO REKSA DANA ...") ikut
 * pindah ke kategori baru ini.
 */
export async function migrasiKategoriInvestasi() {
  const sudah = await pengaturanRepo.baca(KUNCI_MIGRASI_KATEGORI_INVESTASI, '');
  if (sudah) return { dilewati: true };

  const kategoriSekarang = await kategoriRepo.daftar();
  const definisiBaru = KATEGORI_BAWAAN.filter((k) => k.id === 'kat_investasi');
  const kategoriBaru = kategoriBaruYangBelumAda(kategoriSekarang, definisiBaru);

  for (const kat of kategoriBaru) await kategoriRepo.simpanKategori(kat);

  await pengaturanRepo.tulis(KUNCI_MIGRASI_KATEGORI_INVESTASI, '1');
  return { dijalankan: true, jumlahKategori: kategoriBaru.length };
}
