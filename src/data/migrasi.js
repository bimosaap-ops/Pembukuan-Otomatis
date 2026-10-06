/**
 * Migrasi data sekali jalan.
 *
 * Berbeda dari `onupgradeneeded` di db.js: migrasi di sini butuh operasi async,
 * dan transaksi IndexedDB keburu tertutup sebelum `await` pertama selesai.
 * Karena itu migrasi dijalankan sesudah database terbuka, dijaga bendera di
 * store `settings`, bukan lewat kenaikan VERSI_DB. Bagian yang menghitung
 * dipisah jadi fungsi murni supaya bisa diuji tanpa IndexedDB.
 */

import * as pengaturanRepo from './repo/settings.js';
import * as trxRepo from './repo/transactions.js';
import * as kategoriRepo from './repo/categories.js';
import * as emailTrxRepo from './repo/email-transactions.js';
import * as akunRepo from './repo/accounts.js';
import { hitungBaseHash } from '../domain/dedupe.js';
import { KATEGORI_BAWAAN, tambahPola } from '../domain/categorize.js';
import {
  hapusDariSheets, syncAtauAntri, tarikTransaksiDariSheets,
} from '../services/sheets-sync.js';
import {
  rencanakanBersihProvisionalDobel, rencanakanKoreksiTanggalProvisional, rencanakanHapusYatimSheet,
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
/** Bendera pembersihan provisional dobel lintas id email — lihat hapusProvisionalDobelEmail. */
export const KUNCI_MIGRASI_HAPUS_PROVISIONAL_DOBEL_EMAIL = 'hapusProvisionalDobelEmailV1';
/** Bendera koreksi tanggal UTC -> WIB baris provisional — lihat migrasiTanggalProvisionalWib. */
export const KUNCI_MIGRASI_TANGGAL_PROVISIONAL_WIB = 'tanggalProvisionalWibV1';
/** Bendera pembersihan provisional dobel yang hanya ada di Sheet — lihat hapusProvisionalYatimDiSheet. */
export const KUNCI_MIGRASI_HAPUS_YATIM_SHEET = 'hapusProvisionalYatimSheetV1';

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
 * Bersihkan baris provisional dobel dari insiden 2026-10-06: satu transaksi
 * email tercatat dua kali karena diproses dengan dua id email berbeda (id
 * dulu acak per perangkat, lihat buatTransaksiEmail() di entities.js).
 * Penyebabnya sudah ditutup di dua tempat (id deterministik dari
 * gmailMessageId, dan pengaman adopsi di buatProvisionalDariEmail()); ini
 * membersihkan yang sudah terlanjur ada.
 *
 * Sasarannya dihitung (lihat rencanakanBersihProvisionalDobel), bukan daftar
 * id: id baris hasil tarik Sheets berbeda di setiap perangkat. Aturannya konservatif --
 * hanya kelompok yang jumlah barisnya melebihi jumlah email pasangannya
 * yang disentuh, dan baris yang dipegang email lokal tidak pernah dihapus.
 */
export async function hapusProvisionalDobelEmail() {
  const sudah = await pengaturanRepo.baca(KUNCI_MIGRASI_HAPUS_PROVISIONAL_DOBEL_EMAIL, '');
  if (sudah) return { dilewati: true };

  const [provisional, emailLokal, akunMap] = await Promise.all([
    trxRepo.perSumber(SUMBER.EMAIL_PROVISIONAL),
    emailTrxRepo.semua(),
    akunRepo.peta(),
  ]);
  const { hapus, tautkan } = rencanakanBersihProvisionalDobel(provisional, emailLokal, akunMap);

  const akunTersentuh = new Set();
  for (const t of hapus) {
    await trxRepo.hapusTransaksi(t.id);
    akunTersentuh.add(t.accountId);
  }
  for (const { email, trx } of tautkan) {
    await trxRepo.simpanSatu({ ...trx, emailTrxId: email.id });
    await emailTrxRepo.simpanSatu({ ...email, provisionalTrxId: trx.id });
  }
  for (const accountId of akunTersentuh) {
    if (accountId) await akunRepo.hitungUlangSaldo(accountId);
  }

  const hashDihapus = hapus.map((t) => t.hash).filter(Boolean);
  if (hashDihapus.length) {
    hapusDariSheets(hashDihapus).catch((e) => console.warn('Hapus provisional dobel di Sheets gagal:', e));
  }

  await pengaturanRepo.tulis(KUNCI_MIGRASI_HAPUS_PROVISIONAL_DOBEL_EMAIL, '1');
  return {
    dijalankan: true,
    jumlah: hapus.length,
    nominal: hapus.reduce((n, t) => n + Math.abs(Number(t.nominal) || 0), 0),
  };
}

/**
 * Koreksi tanggal baris provisional yang tercatat dengan tanggal UTC
 * (transaksi email pukul 00:00-06:59 WIB jatuh sehari lebih awal; lihat
 * tanggalWib() di core/dates.js). WAJIB dijalankan SESUDAH
 * hapusProvisionalDobelEmail(): pembersih itu mengelompokkan baris per
 * baseHash, dan baseHash ikut berubah di sini.
 *
 * Hash tidak diubah, jadi sinkron Sheets memperbarui baris yang sama
 * (upsert berbasis hash), bukan menambah baris baru.
 */
export async function migrasiTanggalProvisionalWib() {
  const sudah = await pengaturanRepo.baca(KUNCI_MIGRASI_TANGGAL_PROVISIONAL_WIB, '');
  if (sudah) return { dilewati: true };

  const [provisional, emailLokal] = await Promise.all([
    trxRepo.perSumber(SUMBER.EMAIL_PROVISIONAL),
    emailTrxRepo.semua(),
  ]);
  const rencana = rencanakanKoreksiTanggalProvisional(provisional, emailLokal);

  const diperbarui = [];
  const akunTersentuh = new Set();
  for (const { trx, tanggal } of rencana) {
    const baseHash = await hitungBaseHash({
      accountId: trx.accountId, tanggal, deskripsi: trx.deskripsi, nominal: trx.nominal,
    });
    diperbarui.push(await trxRepo.simpanSatu({
      ...trx, tanggal, baseHash, diubahPada: new Date().toISOString(),
    }));
    akunTersentuh.add(trx.accountId);
  }
  for (const accountId of akunTersentuh) {
    if (accountId) await akunRepo.hitungUlangSaldo(accountId);
  }

  if (diperbarui.length) {
    Promise.all([akunRepo.peta(), kategoriRepo.peta()])
      .then(([akunMap, kategoriMap]) => syncAtauAntri(diperbarui, akunMap, kategoriMap))
      .catch((e) => console.warn('Sheets sync koreksi tanggal provisional gagal:', e));
  }

  await pengaturanRepo.tulis(KUNCI_MIGRASI_TANGGAL_PROVISIONAL_WIB, '1');
  return { dijalankan: true, jumlah: diperbarui.length };
}

/**
 * Hapus baris provisional dobel yang HANYA ada di Sheet (lihat
 * rencanakanHapusYatimSheet). Butuh satu tarik penuh dari Sheet; kalau
 * Sheets tidak aktif atau tarik gagal, bendera TIDAK ditulis supaya dicoba
 * lagi saat aplikasi dibuka berikutnya.
 *
 * Perangkat lain yang terlanjur menarik baris itu ikut membersihkannya
 * lewat jalur tarik biasa (`dihapus` dari tab _Arsip).
 */
export async function hapusProvisionalYatimDiSheet() {
  const sudah = await pengaturanRepo.baca(KUNCI_MIGRASI_HAPUS_YATIM_SHEET, '');
  if (sudah) return { dilewati: true };

  const hasil = await tarikTransaksiDariSheets(null);
  if (hasil.skipped) return { dilewati: true };

  const [transaksiLokal, emailLokal, akunMap] = await Promise.all([
    trxRepo.semua(),
    emailTrxRepo.semua(),
    akunRepo.peta(),
  ]);
  const hapus = rencanakanHapusYatimSheet(hasil.baris, transaksiLokal, emailLokal, akunMap);

  if (hapus.length) {
    const kirim = await hapusDariSheets(hapus.map((r) => r.hash));
    if (kirim.skipped) return { dilewati: true };
  }

  await pengaturanRepo.tulis(KUNCI_MIGRASI_HAPUS_YATIM_SHEET, '1');
  return {
    dijalankan: true,
    jumlah: hapus.length,
    nominal: hapus.reduce((n, r) => n + Math.abs(Number(r.nominal) || 0), 0),
  };
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
