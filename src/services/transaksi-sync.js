/**
 * Tarik TRANSAKSI dari Google Sheets dan gabungkan ke IndexedDB — pasangan
 * arah pull dari entitas-sync.js, tapi untuk ledger utama.
 *
 * Beda penting dari entitas-sync.js:
 *   - Checkpoint (bukan full-pull): tabel ini bisa berisi ribuan baris.
 *   - Penghapusan dibaca dari _Arsip (lihat sheets/Code.gs tarikTransaksi),
 *     BUKAN tombstone di tab utama — alur hapus TRANSAKSI yang sudah ada
 *     (hapusBaris -> arsipkan) sama sekali tidak diubah.
 *   - accountId tidak portable antar perangkat, jadi setiap baris di-resolve
 *     lewat akunRepo.cariAtauBuat() — sama seperti alur upload e-statement.
 *   - Sebelum menyimpan baris baru, dicek dulu apakah hash-nya sudah ada
 *     secara lokal lewat id lain — bisa terjadi kalau dua perangkat meng-
 *     upload statement yang sama sebelum sempat saling sync. Index `hash` di
 *     IndexedDB unique, jadi baris begitu WAJIB dilewati, bukan disimpan.
 *   - saldo/jumlahTransaksi rekening dihitung ulang di akhir untuk setiap
 *     akun yang tersentuh (baru/diperbarui/dihapus) — sama seperti
 *     entitas-sync.js tidak pernah mempercayai angka turunan dari luar.
 *
 * Resolusi konflik memakai remoteLebihBaru() yang sama dengan entitas-sync
 * (murni membaca diubahPada/dibuatPada, tidak spesifik ke satu entity).
 */

import {
  tarikTransaksiDariSheets, transaksiDariBarisSheet,
} from './sheets-sync.js';
import { remoteLebihBaru } from './entitas-sync.js';
import * as pengaturanRepo from '../data/repo/settings.js';
import * as trxRepo from '../data/repo/transactions.js';
import * as akunRepo from '../data/repo/accounts.js';

export const KUNCI_TARIK_TRANSAKSI = {
  TERAKHIR_DITARIK: 'transaksiTerakhirDitarik',
};

export async function bacaCheckpointTransaksi() {
  return pengaturanRepo.baca(KUNCI_TARIK_TRANSAKSI.TERAKHIR_DITARIK, '');
}

async function tulisCheckpointTransaksi(iso) {
  if (!iso) return;
  await pengaturanRepo.tulis(KUNCI_TARIK_TRANSAKSI.TERAKHIR_DITARIK, iso);
}

/**
 * Terapkan satu baris hasil tarik. Diekspor terpisah dari orkestrasi utama
 * supaya alurnya mudah diikuti, tapi tetap menyentuh IndexedDB (tidak diuji
 * langsung — konsisten dengan pembagian tes di repo ini).
 * @returns {{status: string, accountId: string}}
 */
async function terapkanBarisTransaksi(row) {
  const lokal = await trxRepo.satu(row.id);
  const mapped = transaksiDariBarisSheet(row);

  if (!lokal) {
    // Dua perangkat bisa meng-upload statement yang sama sebelum sempat
    // saling sync -- hash sama, id acak beda. Index `hash` unique di
    // IndexedDB, jadi ini WAJIB dilewati, bukan disimpan sebagai transaksi
    // baru (akan melempar ConstraintError kalau dipaksakan).
    const kembar = await trxRepo.satuLewatHash(mapped.hash);
    if (kembar) return { status: 'dilewati', accountId: kembar.accountId };

    const { akun } = await akunRepo.cariAtauBuat({
      bank: row.bank, nomorRekening: row.nomorRekening, namaPemilik: row.namaPemilik,
    });
    await trxRepo.simpanSatu({ ...mapped, accountId: akun.id });
    return { status: 'baru', accountId: akun.id };
  }

  if (!remoteLebihBaru(lokal, mapped)) return { status: 'dilewati', accountId: lokal.accountId };

  // Bank/No. Rekening bisa diedit manual langsung di Sheet ("Fase A": Sheets
  // jadi editor utama untuk Transaksi) -- accountId tidak portable antar
  // perangkat/Sheet, jadi diresolusi ULANG lewat cariAtauBuat() setiap kali
  // baris hasil pull menunjuk bank/nomor rekening BERBEDA dari akun lokal
  // saat ini, bukan sekadar dipertahankan apa adanya seperti sebelumnya.
  // Tanpa ini, memindahkan transaksi ke rekening lain lewat Sheet tidak
  // akan pernah benar-benar berpindah di PWA.
  const akunLokal = await akunRepo.satu(lokal.accountId);
  const akunSama = akunLokal
    && akunLokal.bank === row.bank
    && akunRepo.normalkanNomor(akunLokal.nomorRekening) === akunRepo.normalkanNomor(row.nomorRekening);

  let accountId = lokal.accountId;
  let accountIdLama = null;
  if (!akunSama) {
    const { akun } = await akunRepo.cariAtauBuat({
      bank: row.bank, nomorRekening: row.nomorRekening, namaPemilik: row.namaPemilik,
    });
    accountId = akun.id;
    accountIdLama = lokal.accountId;
  }

  // Digabung dengan record lokal (bukan dipakai apa adanya): field yang
  // tidak ikut disinkronkan (catatan, uploadedFileId, urutan, dibuatPada,
  // baseHash, deskripsiRaw) harus tetap seperti semula, bukan tertimpa
  // default kosong dari buatTransaksi().
  await trxRepo.simpanSatu({ ...lokal, ...mapped, accountId });
  return { status: 'diperbarui', accountId, accountIdLama };
}

/**
 * Titik masuk utama: tarik transaksi baru/berubah/terhapus sejak checkpoint,
 * terapkan ke IndexedDB, lalu hitung ulang saldo setiap rekening yang
 * tersentuh. Melempar error bila gagal — pemanggil UI yang memutuskan cara
 * menampilkannya, sama seperti tarikTransaksiEmail()/tarikDanGabungEntitas().
 */
export async function tarikDanGabungTransaksi() {
  const sejak = await bacaCheckpointTransaksi();
  const hasil = await tarikTransaksiDariSheets(sejak || null);
  if (hasil.skipped) return { skipped: true };

  const tersentuh = new Set();
  const ringkasan = { baru: 0, diperbarui: 0, dihapus: 0, dilewati: 0 };

  for (const id of hasil.dihapus) {
    const lokal = await trxRepo.satu(id);
    if (!lokal) continue;
    await trxRepo.hapusTransaksi(id);
    tersentuh.add(lokal.accountId);
    ringkasan.dihapus += 1;
  }

  for (const row of hasil.baris) {
    if (!row.id) continue;
    const { status, accountId, accountIdLama } = await terapkanBarisTransaksi(row);
    if (accountId) tersentuh.add(accountId);
    if (accountIdLama) tersentuh.add(accountIdLama);
    ringkasan[status] += 1;
  }

  for (const accountId of tersentuh) {
    if (accountId) await akunRepo.hitungUlangSaldo(accountId);
  }

  await tulisCheckpointTransaksi(hasil.sekarang);
  return { ok: true, ditarik: hasil.baris.length, ...ringkasan };
}
