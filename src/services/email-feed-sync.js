/**
 * Sinkron transaksi email (Realtime Email Transaction Feed): tarik hasil
 * parse dari tab "Transaksi Email" lewat webhook Apps Script YANG SAMA
 * dipakai sheets-sync.js (`doPost{tarikTransaksiEmail:true}`, lihat
 * sheets/Code.gs), gabungkan ke IndexedDB (dedup gmailMessageId lewat
 * email-transactions.simpanBanyakBaru), lalu jalankan rekonsiliasi
 * (rekonsiliasiEmail.js) dan saran kategori (kategoriEmail.js) untuk tiap
 * transaksi yang baru masuk.
 *
 * Checkpoint (`emailFeedTerakhirDitarik`, disimpan di settings) memakai
 * waktu SERVER Apps Script (`jawab.sekarang`), bukan waktu klien — konsisten
 * dengan alasan `bangunBarisTarikTransaksiEmail` di Code.gs menyaring
 * `dibuatPada > sejak`: kalau memakai jam klien yang mungkin sedikit
 * meleset dari jam server, baris yang baru saja ditulis Code.gs tepat di
 * sekitar checkpoint bisa lolos tak tertarik atau tertarik dua kali.
 */

import { bacaKonfigSheets, post } from './sheets-sync.js';
import * as pengaturanRepo from '../data/repo/settings.js';
import * as emailTrxRepo from '../data/repo/email-transactions.js';
import * as trxRepo from '../data/repo/transactions.js';
import * as kategoriRepo from '../data/repo/categories.js';
import * as kamusRepo from '../data/repo/merchant-dictionary.js';
import { cocokkanTransaksiEmail } from '../domain/rekonsiliasiEmail.js';
import { sarankanKategoriEmail } from '../domain/kategoriEmail.js';
import { normalisasiMerchant } from '../domain/merchantNormalisasi.js';

export const KUNCI_TARIK_EMAIL = {
  TERAKHIR_DITARIK: 'emailFeedTerakhirDitarik',
};

/** Lega dibanding BATAS_MS sheets-sync.js (8 detik): sisi Apps Script memindai
 *  seluruh tab "Transaksi Email" tiap dipanggil, bukan sekadar ping. */
const BATAS_MS = 20000;

/** Jendela tanggal di sekitar waktu transaksi email untuk mengambil kandidat
 *  rekonsiliasi lewat trxRepo.rentangTanggal() (indeks tanggal, bukan pindai
 *  penuh) — lebih lebar dari jendela WAKTU di rekonsiliasiEmail.js (24 jam)
 *  supaya perbedaan zona waktu/pembulatan tanggal di kedua sisi tidak sampai
 *  memangkas kandidat yang seharusnya dipertimbangkan; penyaringan presisi
 *  tetap tanggung jawab cocokkanTransaksiEmail() sendiri.
 */
const JENDELA_HARI_KANDIDAT = 2;

export async function bacaCheckpoint() {
  return pengaturanRepo.baca(KUNCI_TARIK_EMAIL.TERAKHIR_DITARIK, '');
}

async function tulisCheckpoint(iso) {
  if (!iso) return;
  await pengaturanRepo.tulis(KUNCI_TARIK_EMAIL.TERAKHIR_DITARIK, iso);
}

/**
 * Rentang tanggal (string 'YYYY-MM-DD', cocok untuk trxRepo.rentangTanggal)
 * di sekitar sebuah waktu transaksi email. Murni, tidak menyentuh database
 * — diekspor supaya bisa diuji langsung.
 * @returns {{dari: string, sampai: string}|null} null kalau waktuIso tidak valid
 */
export function rentangTanggalKandidat(waktuIso, jendelaHari = JENDELA_HARI_KANDIDAT) {
  const t = new Date(waktuIso);
  if (Number.isNaN(t.getTime())) return null;

  const fmt = (d) => d.toISOString().slice(0, 10);
  const dari = new Date(t.getTime());
  dari.setUTCDate(dari.getUTCDate() - jendelaHari);
  const sampai = new Date(t.getTime());
  sampai.setUTCDate(sampai.getUTCDate() + jendelaHari);

  return { dari: fmt(dari), sampai: fmt(sampai) };
}

/**
 * Gabungkan hasil rekonsiliasi + saran kategori ke dalam satu transaksi
 * email siap simpan. Murni — diekspor supaya bisa diuji tanpa IndexedDB.
 */
export function bangunPembaruanEmailTrx(trx, merchantKey, cocok, saran) {
  return {
    ...trx,
    merchantKey,
    statusCocok: cocok.status,
    transaksiCocokId: cocok.kandidatId || '',
    skorCocok: cocok.skor,
    alasanCocok: cocok.alasan,
    kategoriSaran: saran.kategoriId,
    confidenceKategori: saran.keyakinan,
  };
}

/**
 * Proses satu transaksi email yang baru ditarik: cari kandidat e-statement
 * di sekitar tanggalnya, jalankan rekonsiliasi + saran kategori, lalu simpan
 * hasilnya. Terpisah dari `tarikTransaksiEmail` supaya orkestrasi utama tetap
 * pendek dan mudah dibaca.
 */
async function prosesSatuTransaksiBaru(trx, daftarKategori, kamusMap) {
  const merchantKey = normalisasiMerchant(trx.merchantMentah);
  const rentang = rentangTanggalKandidat(trx.waktuTransaksi);
  const kandidat = rentang ? await trxRepo.rentangTanggal(rentang.dari, rentang.sampai) : [];

  const cocok = cocokkanTransaksiEmail(trx, kandidat);
  const saran = sarankanKategoriEmail(trx, kamusMap, daftarKategori);

  await emailTrxRepo.simpanSatu(bangunPembaruanEmailTrx(trx, merchantKey, cocok, saran));
}

/**
 * Titik masuk utama: tarik transaksi email baru dari Sheet, gabungkan ke
 * IndexedDB, dan proses (rekonsiliasi + saran kategori) yang benar-benar
 * baru. Dipanggil manual dari tombol "Tarik email transaksi sekarang" di
 * Pengaturan (fase UI berikutnya) — TIDAK dipasang sebagai polling
 * otomatis di sisi PWA, karena polling sungguhan sudah berjalan di sisi
 * Apps Script (trigger `pollEmailTransaksi`) dan sisi PWA hanya perlu
 * menarik saat dibuka/diminta.
 *
 * Melempar error bila gagal (URL belum diisi, timeout, dll.) — pemanggil UI
 * yang memutuskan cara menampilkannya, sama seperti `testWebhook()`.
 */
export async function tarikTransaksiEmail() {
  const { url, aktif } = await bacaKonfigSheets();
  if (!aktif || !url) return { skipped: true };

  const sejak = await bacaCheckpoint();
  const jawab = await post(url, {
    tarikTransaksiEmail: true,
    sejak: sejak || null,
  }, BATAS_MS);

  if (jawab.ok === false) throw new Error(jawab.error || 'Gagal menarik transaksi email dari Sheets');

  const baris = Array.isArray(jawab.baris) ? jawab.baris : [];
  const disimpan = await emailTrxRepo.simpanBanyakBaru(baris);

  if (disimpan.length) {
    const [daftarKategori, kamusEntri] = await Promise.all([kategoriRepo.daftar(), kamusRepo.semua()]);
    const kamusMap = new Map(kamusEntri.map((e) => [e.merchantKey, e.kategoriId]));
    // Berurutan, bukan Promise.all: jumlah transaksi email per pull realistis
    // (puluhan, bukan ribuan), dan trxRepo.rentangTanggal() sendiri sudah
    // cukup cepat (lewat indeks tanggal).
    for (const trx of disimpan) {
      await prosesSatuTransaksiBaru(trx, daftarKategori, kamusMap);
    }
  }

  await tulisCheckpoint(jawab.sekarang);
  return { ok: true, ditarik: baris.length, baru: disimpan.length };
}

/** Dipakai Pengaturan untuk menampilkan "terakhir ditarik pada". */
export async function statusTarikEmail() {
  const terakhirDitarikPada = await bacaCheckpoint();
  return { terakhirDitarikPada: terakhirDitarikPada || null };
}
