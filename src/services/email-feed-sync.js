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

import { bacaKonfigSheets, post, syncAtauAntri } from './sheets-sync.js';
import { ledgerMergeAktif, buatProvisionalDariEmail } from './email-ledger-merge.js';
import * as pengaturanRepo from '../data/repo/settings.js';
import * as emailTrxRepo from '../data/repo/email-transactions.js';
import * as trxRepo from '../data/repo/transactions.js';
import * as akunRepo from '../data/repo/accounts.js';
import * as kategoriRepo from '../data/repo/categories.js';
import * as kamusRepo from '../data/repo/merchant-dictionary.js';
import { cocokkanTransaksiEmail } from '../domain/rekonsiliasiEmail.js';
import { sarankanKategoriEmail } from '../domain/kategoriEmail.js';
import { normalisasiMerchant } from '../domain/merchantNormalisasi.js';
import { SUMBER, STATUS_COCOK_EMAIL } from '../domain/entities.js';
import { rentangTanggalKandidat } from '../core/dates.js';

/** Re-export: dipakai email-transaksi.js, email-review.js, dan tes yang sudah
 *  ada — implementasinya pindah ke core/dates.js supaya bisa dipakai ulang
 *  services/email-ledger-merge.js tanpa saling impor dengan berkas ini. */
export { rentangTanggalKandidat };

export const KUNCI_TARIK_EMAIL = {
  TERAKHIR_DITARIK: 'emailFeedTerakhirDitarik',
};

/** Lega dibanding BATAS_MS sheets-sync.js (8 detik): sisi Apps Script memindai
 *  seluruh tab "Transaksi Email" tiap dipanggil, bukan sekadar ping. */
const BATAS_MS = 20000;

export async function bacaCheckpoint() {
  return pengaturanRepo.baca(KUNCI_TARIK_EMAIL.TERAKHIR_DITARIK, '');
}

async function tulisCheckpoint(iso) {
  if (!iso) return;
  await pengaturanRepo.tulis(KUNCI_TARIK_EMAIL.TERAKHIR_DITARIK, iso);
}

/**
 * Gabungkan hasil rekonsiliasi + saran kategori ke dalam satu transaksi
 * email siap simpan. Murni — diekspor supaya bisa diuji tanpa IndexedDB.
 *
 * "Fase B": kategoriFinal diisi OTOMATIS dari saran, sama seperti transaksi
 * PDF-upload yang sudah auto-kategori tanpa gate (categorize.js dipanggil
 * langsung di ingest.js) — tidak menunggu klik manual "Simpan kategori" di
 * halaman Transaksi Email. `trx.overrideUser` (entities.js) jadi guard:
 * transaksi genuinely baru selalu false (default buatTransaksiEmail), jadi
 * auto-isi berlaku; tapi kalau fungsi ini pernah dipanggil ulang atas record
 * yang sudah dikoreksi manual pengguna, koreksi itu TIDAK tertimpa balik.
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
    kategoriFinal: trx.overrideUser ? trx.kategoriFinal : saran.kategoriId,
  };
}

/**
 * Proses satu transaksi email yang baru ditarik: cari kandidat e-statement
 * di sekitar tanggalnya, jalankan rekonsiliasi + saran kategori, lalu simpan
 * hasilnya. Terpisah dari `tarikTransaksiEmail` supaya orkestrasi utama tetap
 * pendek dan mudah dibaca.
 *
 * "Fase C": kalau tidak ada padanan e-statement sama sekali (MISSING) DAN
 * fitur gabung-ledger aktif (lihat pengaturanRepo.KUNCI.EMAIL_LEDGER_MERGE_AKTIF,
 * default MATI), transaksi ini langsung dicatat sebagai baris ledger
 * PROVISIONAL (email-ledger-merge.js) supaya tampil di Dashboard sebelum
 * e-statement bulan itu datang, bukan cuma "menunggu" di halaman Transaksi
 * Email.
 *
 * TIDAK mengirim ke Sheets di sini -- pemanggil (`tarikTransaksiEmail()`)
 * memproses banyak transaksi berurutan dalam satu loop; kalau tiap baris
 * menembak sync-nya sendiri-sendiri, satu pull dengan banyak transaksi baru
 * (mis. baru buka aplikasi setelah beberapa hari) memicu banyak POST request
 * nyaris bersamaan ke webhook yang sama -- saling menimpa antrean retry lokal
 * yang tidak dikunci, sebagian besar hilang diam-diam (lihat catatan di
 * buatProvisionalDariEmail()). Pemanggil mengumpulkan seluruh baris provisional
 * dari satu batch pull lalu mengirim SEKALI di akhir.
 * @returns {object|null} baris ledger provisional yang baru dibuat, atau null
 *   kalau tidak ada (MATCHED/MISMATCH/AMBIGUOUS, atau fitur gabung-ledger mati).
 */
async function prosesSatuTransaksiBaru(trx, daftarKategori, kamusMap) {
  const merchantKey = normalisasiMerchant(trx.merchantMentah);
  const rentang = rentangTanggalKandidat(trx.waktuTransaksi);
  const kandidatMentah = rentang ? await trxRepo.rentangTanggal(rentang.dari, rentang.sampai) : [];
  // WAJIB, bukan sekadar optimasi: baris ledger provisional (belum pernah
  // dikonfirmasi bank) tidak boleh ikut jadi kandidat kecocokan bagi
  // transaksi email BARU -- dua transaksi yang sama-sama belum terkonfirmasi
  // (mis. dua top-up GoPay nominal sama berdekatan waktu) bisa "cocok" satu
  // sama lain secara keliru, membuat MATCHED palsu yang menyembunyikan
  // transaksi asli dari radar rekonsiliasi.
  const kandidat = kandidatMentah.filter((k) => k.sumber !== SUMBER.EMAIL_PROVISIONAL);

  const cocok = cocokkanTransaksiEmail(trx, kandidat);
  const saran = sarankanKategoriEmail(trx, kamusMap, daftarKategori);

  const disimpan = await emailTrxRepo.simpanSatu(bangunPembaruanEmailTrx(trx, merchantKey, cocok, saran));

  if (cocok.status === STATUS_COCOK_EMAIL.MISSING && await ledgerMergeAktif()) {
    return buatProvisionalDariEmail(disimpan, daftarKategori, kamusMap);
  }
  return null;
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
    const provisionalBaru = [];
    for (const trx of disimpan) {
      const hasil = await prosesSatuTransaksiBaru(trx, daftarKategori, kamusMap);
      if (hasil) provisionalBaru.push(hasil);
    }

    // Satu kali di akhir batch, bukan per baris -- lihat catatan di
    // prosesSatuTransaksiBaru() soal kenapa sync per baris berisiko race.
    if (provisionalBaru.length) {
      const akunTersentuh = new Set(provisionalBaru.map((t) => t.accountId));
      for (const accountId of akunTersentuh) {
        await akunRepo.hitungUlangSaldo(accountId);
      }

      Promise.all([akunRepo.peta(), kategoriRepo.peta()])
        .then(([akunMap, kategoriMap]) => syncAtauAntri(provisionalBaru, akunMap, kategoriMap))
        .catch((e) => console.warn('Sheets sync provisional gagal:', e));
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
