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
import { hitungBaseHash, hashFinal } from '../domain/dedupe.js';
import { KUNCI_SHEETS } from '../services/sheets-sync.js';

/** Bendera di store settings; nilainya versi migrasi yang sudah dijalankan. */
export const KUNCI_MIGRASI = 'migrasiHashRekening';

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
