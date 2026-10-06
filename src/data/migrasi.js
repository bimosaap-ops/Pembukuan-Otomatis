/**
 * Pemeliharaan data yang dijalankan saat aplikasi dibuka.
 *
 * Dua jenis:
 *   - Migrasi berbendera (store `settings`), berhenti sendiri setelah sekali
 *     jalan. Bukan lewat `onupgradeneeded` di db.js karena butuh operasi
 *     async, dan transaksi IndexedDB keburu tertutup sebelum `await` pertama.
 *   - Pemeriksaan integritas tanpa bendera, aman diulang tiap buka: kondisi
 *     yang diperbaikinya tidak terbentuk oleh alur yang benar, jadi biasanya
 *     tidak menemukan apa pun.
 *
 * Bagian yang menghitung dipisah jadi fungsi murni supaya bisa diuji tanpa
 * IndexedDB.
 */

import * as pengaturanRepo from './repo/settings.js';
import * as trxRepo from './repo/transactions.js';
import * as kategoriRepo from './repo/categories.js';
import * as emailTrxRepo from './repo/email-transactions.js';
import * as akunRepo from './repo/accounts.js';
import { KATEGORI_BAWAAN, tambahPola } from '../domain/categorize.js';
import { hapusDariSheets } from '../services/sheets-sync.js';
import {
  rencanakanBersihProvisionalTertaut, hapusProvisionalManual,
  rencanakanPerbaikiTautanManual, backfillProvisionalEmailLama, rencanakanHapusProvisionalTakTerjangkau,
  rencanakanPulihkanProvisionalHilang,
} from '../services/email-ledger-merge.js';
import { SUMBER, STATUS_COCOK_EMAIL } from '../domain/entities.js';

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

/**
 * Hapus baris provisional milik transaksi email yang sudah ditautkan ke baris
 * e-statement -- sisa "Tautkan manual" versi lama yang hanya menandai MATCHED
 * tanpa menghapus provisional-nya, sehingga transaksinya terhitung dua kali.
 * Tanpa bendera: kondisinya sendiri (MATCHED + masih memegang provisional)
 * tidak pernah terbentuk oleh alur yang benar, jadi aman diperiksa tiap buka.
 */
export async function bersihkanProvisionalTertaut() {
  const [emailLokal, transaksi, akunMap] = await Promise.all([emailTrxRepo.semua(), trxRepo.semua(), akunRepo.peta()]);
  const perId = new Map(transaksi.map((t) => [t.id, t]));
  const sasaran = rencanakanBersihProvisionalTertaut(emailLokal, perId, akunMap);
  let nominal = 0;
  for (const email of sasaran) {
    const dihapus = await hapusProvisionalManual(email);
    if (dihapus) nominal += Math.abs(Number(dihapus.nominal) || 0);
  }
  return { jumlah: sasaran.length, nominal };
}

/**
 * Kembalikan tautan manual yang tidak sah (ke baris provisional, ke arah
 * berlawanan, ke bank lain, atau ke baris yang sudah hilang) menjadi
 * MISSING, lalu jalankan backfill supaya transaksi yang provisional-nya
 * sudah terhapus mendapat baris provisional lagi. Kasus nyata 2026-10-06:
 * tiga transfer keluar Permata ditautkan ke baris masuk di BCA, provisional
 * Permata-nya terhapus, dan pengeluaran Rp 24.670.000 hilang dari Permata.
 */
export async function perbaikiTautanManualSalah() {
  const [emailLokal, transaksi, akunMap] = await Promise.all([emailTrxRepo.semua(), trxRepo.semua(), akunRepo.peta()]);
  const perId = new Map(transaksi.map((t) => [t.id, t]));
  const sasaran = rencanakanPerbaikiTautanManual(emailLokal, perId, akunMap);
  for (const e of sasaran) {
    const provisionalAda = e.provisionalTrxId && perId.get(e.provisionalTrxId)?.sumber === SUMBER.EMAIL_PROVISIONAL;
    await emailTrxRepo.simpanSatu({
      ...e,
      statusCocok: STATUS_COCOK_EMAIL.MISSING,
      transaksiCocokId: '',
      skorCocok: null,
      alasanCocok: '',
      provisionalTrxId: provisionalAda ? e.provisionalTrxId : '',
    });
  }
  const backfill = sasaran.length ? await backfillProvisionalEmailLama() : { dibuat: 0 };
  return { jumlah: sasaran.length, dibuatUlang: backfill.dibuat || 0 };
}

/**
 * Hapus baris provisional yang tidak terjangkau dari UI tetapi sudah punya
 * kembaran di e-statement (lihat rencanakanHapusProvisionalTakTerjangkau).
 * Email perujuknya (bila ada) ditautkan ke baris statement kembarannya.
 */
export async function hapusProvisionalTakTerjangkau() {
  const [transaksi, emailLokal] = await Promise.all([trxRepo.semua(), emailTrxRepo.semua()]);
  const rencana = rencanakanHapusProvisionalTakTerjangkau(transaksi, emailLokal);
  if (!rencana.length) return { jumlah: 0, nominal: 0 };

  const akunTersentuh = new Set();
  for (const { provisional, statement, email } of rencana) {
    await trxRepo.hapusTransaksi(provisional.id);
    akunTersentuh.add(provisional.accountId);
    if (email) {
      await emailTrxRepo.simpanSatu({
        ...email,
        provisionalTrxId: '',
        statusCocok: STATUS_COCOK_EMAIL.MATCHED,
        transaksiCocokId: statement.id,
      });
    }
  }
  for (const accountId of akunTersentuh) {
    if (accountId) await akunRepo.hitungUlangSaldo(accountId);
  }
  const hash = rencana.map((r) => r.provisional.hash).filter(Boolean);
  if (hash.length) hapusDariSheets(hash).catch((e) => console.warn('Hapus provisional tak terjangkau di Sheets gagal:', e));
  return {
    jumlah: rencana.length,
    nominal: rencana.reduce((n, r) => n + Math.abs(Number(r.provisional.nominal) || 0), 0),
  };
}

/**
 * Buat ulang baris provisional untuk transaksi email terbuka yang rujukan
 * provisional-nya menunjuk baris yang sudah hilang (lihat
 * rencanakanPulihkanProvisionalHilang). Rujukannya dikosongkan dan status
 * dikembalikan ke MISSING, lalu backfill menilai ulang terhadap e-statement
 * sekarang: ditautkan bila sudah ada padanannya, dibuatkan provisional bila
 * belum.
 */
export async function pulihkanProvisionalHilang() {
  const [emailLokal, transaksi] = await Promise.all([emailTrxRepo.semua(), trxRepo.semua()]);
  const sasaran = rencanakanPulihkanProvisionalHilang(emailLokal, new Set(transaksi.map((t) => t.id)));
  if (!sasaran.length) return { jumlah: 0, dibuat: 0 };
  for (const e of sasaran) {
    await emailTrxRepo.simpanSatu({
      ...e, provisionalTrxId: '', statusCocok: STATUS_COCOK_EMAIL.MISSING, transaksiCocokId: '',
    });
  }
  const hasil = await backfillProvisionalEmailLama();
  return { jumlah: sasaran.length, dibuat: hasil.dibuat || 0 };
}
