/**
 * Gabung ledger Transaksi (e-statement bulanan) + Transaksi Email (realtime)
 * jadi satu tanpa dobel. Dua arah masuk:
 *   1. Email baru tanpa padanan e-statement (MISSING) -> buatProvisionalDariEmail()
 *      mencatatnya sebagai baris PROVISIONAL (dari email-feed-sync.js).
 *   2. E-statement baru diupload -> rekonsiliasiSetelahUpload() mengganti
 *      baris provisional yang kini punya padanan (dari ingest.js).
 *
 * Pembuatan baris provisional dijaga flag EMAIL_LEDGER_MERGE_AKTIF (default
 * mati). MISMATCH/AMBIGUOUS tidak menghapus provisional, hanya menandainya
 * disengketakan; keputusan akhir di halaman Transaksi Email.
 */

import * as pengaturanRepo from '../data/repo/settings.js';
import * as trxRepo from '../data/repo/transactions.js';
import * as akunRepo from '../data/repo/accounts.js';
import * as kategoriRepo from '../data/repo/categories.js';
import * as kamusRepo from '../data/repo/merchant-dictionary.js';
import * as emailTrxRepo from '../data/repo/email-transactions.js';
import {
  buatTransaksi, SUMBER, STATUS_PROVISIONAL, STATUS_COCOK_EMAIL, STATUS_RESOLUSI_EMAIL, URUTAN_MANUAL,
} from '../domain/entities.js';
import { hitungBaseHash, hashFinal } from '../domain/dedupe.js';
import { cocokkanTransaksiEmail } from '../domain/rekonsiliasiEmail.js';
import { sarankanKategoriEmail } from '../domain/kategoriEmail.js';
import { rentangTanggalKandidat, tanggalWib } from '../core/dates.js';
import { syncAtauAntri, hapusDariSheets } from './sheets-sync.js';

/** Kata kunci penanda rekening RDN pada teks notifikasi email BCA (keputusan
 *  produk: BCA punya 2 rekening — utama & RDN — dan email cuma menyebut nama
 *  bank, tanpa nomor rekening, jadi perlu heuristik ini untuk memilih). */
const PENANDA_RDN = /RDN|STOCKBIT/i;

/** Baris provisional yang sudah lebih dari sekian hari belum terkonfirmasi
 *  e-statement mana pun -- lebih dari 1 siklus statement bulanan wajar +
 *  jeda upload, tapi belum tentu invalid (bisa jadi memang belum sempat
 *  diupload). Lihat provisionalKedaluwarsa(). */
const BATAS_HARI_PROVISIONAL = 45;

export async function ledgerMergeAktif() {
  return pengaturanRepo.baca(pengaturanRepo.KUNCI.EMAIL_LEDGER_MERGE_AKTIF, false);
}

/**
 * Kunci setting akun BCA (utama/RDN) untuk satu transaksi email. Kata kunci
 * RDN/Stockbit dicari di semua field teks email, karena bisa muncul di mana
 * saja. Murni.
 * @returns {string} salah satu dari pengaturanRepo.KUNCI.EMAIL_AKUN_*_BCA
 */
export function kunciSettingAkunBca(trxEmail) {
  const teksGabungan = [trxEmail.merchantMentah, trxEmail.jenisTransaksi, trxEmail.acquirer, trxEmail.lokasi]
    .filter(Boolean).join(' ');
  return PENANDA_RDN.test(teksGabungan)
    ? pengaturanRepo.KUNCI.EMAIL_AKUN_RDN_BCA
    : pengaturanRepo.KUNCI.EMAIL_AKUN_UTAMA_BCA;
}

/**
 * Rekening tujuan baris provisional. Bank selain BCA: satu rekening, lewat
 * cariAtauBuat(). BCA punya dua (utama/RDN), dipilih lewat setting (lihat
 * kunciSettingAkunBca()); bila setting kosong, jatuh ke akun BCA pertama --
 * lebih baik tercatat di rekening yang mungkin salah daripada hilang.
 */
export async function resolusiAkunEmail(trxEmail) {
  if (trxEmail.bank === 'BCA') {
    const kunciSetting = kunciSettingAkunBca(trxEmail);
    const accountId = await pengaturanRepo.baca(kunciSetting, '');
    if (accountId) {
      const akun = await akunRepo.satu(accountId);
      if (akun) return akun;
    }

    const semuaAkun = await akunRepo.daftar();
    const fallbackBca = semuaAkun.find((a) => a.bank === 'BCA');
    if (fallbackBca) return fallbackBca;
  }

  const { akun } = await akunRepo.cariAtauBuat({
    bank: trxEmail.bank, nomorRekening: '', namaPemilik: '',
  });
  return akun;
}

/**
 * Tanggal, deskripsi, dan nominal bertanda baris ledger provisional untuk
 * satu transaksi email -- murni, dipakai buatProvisionalDariEmail().
 */
export function bentukBarisEmail(trxEmail) {
  const magnitudo = Math.abs(Number(trxEmail.nominal) || 0);
  return {
    tanggal: tanggalWib(trxEmail.waktuTransaksi),
    // Tanggal yang dipakai SEBELUM perbaikan zona waktu (potongan ISO UTC).
    // Hanya untuk mengenali baris provisional lama yang masih bertanggal UTC
    // (mis. dari Sheet) -- jangan dipakai untuk baris baru.
    tanggalLama: String(trxEmail.waktuTransaksi || '').slice(0, 10),
    deskripsi: trxEmail.merchantMentah || `Transaksi ${trxEmail.bank || ''}`.trim(),
    nominal: trxEmail.arah === 'debit' ? -magnitudo : magnitudo,
  };
}

/** baseHash sebuah baris ledger. Baris hasil tarik Sheets dari sebelum
 *  perbaikan pull (#40) tersimpan dengan baseHash kosong -- dipulihkan dari
 *  hash penuh, yang selalu berbentuk `<baseHash>#<ordinal>`. */
function baseHashDari(t) {
  return t.baseHash || String(t.hash || '').split('#')[0];
}

/** Id email pemilik sebuah baris provisional: `emailTrxId`, atau -- untuk
 *  baris hasil tarik Sheets yang tidak membawa kolom itu -- ordinal
 *  `e<id>` pada hash penuh. */
function idEmailPemilik(t) {
  if (t.emailTrxId) return t.emailTrxId;
  const ordinal = String(t.hash || '').split('#')[1] || '';
  return ordinal.startsWith('e') ? ordinal.slice(1) : '';
}

/**
 * Dari baris provisional ber-baseHash sama dengan email `idEmail`, pilih yang
 * boleh diadopsi: milik email ini, atau tidak dimiliki email lokal lain.
 * Baris milik email lokal lain adalah transaksi kembar yang sah. Murni.
 *
 * @param {Array} kandidat baris provisional dengan baseHash yang sama
 * @param {string} idEmail id transaksi email yang sedang diproses
 * @param {Array} emailLokal seluruh record email_transactions lokal
 * @returns {object|null}
 */
export function pilihProvisionalTanpaPemilik(kandidat, idEmail, emailLokal) {
  const idLokal = new Set(emailLokal.map((e) => e.id));
  const dirujuk = new Map(emailLokal.filter((e) => e.provisionalTrxId).map((e) => [e.provisionalTrxId, e.id]));
  const milikSendiri = kandidat.find((t) => idEmailPemilik(t) === idEmail || dirujuk.get(t.id) === idEmail);
  if (milikSendiri) return milikSendiri;
  return kandidat.find((t) => !dirujuk.has(t.id) && !idLokal.has(idEmailPemilik(t))) || null;
}

/**
 * Buat baris ledger PROVISIONAL dari satu transaksi email berstatus MISSING
 * (tidak ada padanan e-statement sama sekali). Dipanggil dari
 * email-feed-sync.js SETELAH email itu sendiri sudah tersimpan di
 * `email_transactions` (butuh `trxEmail.id` yang sudah final).
 */
export async function buatProvisionalDariEmail(trxEmail, daftarKategori, kamusMap) {
  const akun = await resolusiAkunEmail(trxEmail);
  const {
    tanggal, tanggalLama, deskripsi, nominal: nominalBertanda,
  } = bentukBarisEmail(trxEmail);

  const saran = sarankanKategoriEmail(trxEmail, kamusMap, daftarKategori);
  const kategoriId = trxEmail.overrideUser ? trxEmail.kategoriFinal : saran.kategoriId;

  const baseHash = await hitungBaseHash({
    accountId: akun.id, tanggal, deskripsi, nominal: nominalBertanda,
  });

  // Pengaman duplikat: baris untuk trxEmail.id ini sudah ada -> tautkan ulang,
  // jangan buat baru (dua proses bisa memanggil fungsi ini nyaris bersamaan).
  // Dibandingkan lewat hash PENUH, bukan baseHash: baseHash sah bertabrakan
  // untuk dua transaksi berbeda yang mirip (toko, nominal, dan tanggal sama).
  const hashCalon = hashFinal(baseHash, `e${trxEmail.id}`);
  const barisSama = await trxRepo.satuLewatHash(hashCalon);
  if (barisSama) {
    await emailTrxRepo.simpanSatu({ ...trxEmail, provisionalTrxId: barisSama.id });
    return barisSama;
  }

  // Pengaman kedua: baris untuk email yang sama tapi dibuat dengan id email
  // lain (dari perangkat lain lewat tarik Sheets). Hash penuhnya berbeda, jadi
  // diadopsi alih-alih diduplikasi; hash tidak diganti karena itu kunci upsert
  // Sheets. baseHash bertanggal UTC ikut dicari untuk baris lama.
  const baseHashLama = tanggalLama === tanggal ? baseHash : await hitungBaseHash({
    accountId: akun.id, tanggal: tanggalLama, deskripsi, nominal: nominalBertanda,
  });
  const kandidatYatim = (await trxRepo.perSumber(SUMBER.EMAIL_PROVISIONAL))
    .filter((t) => baseHashDari(t) === baseHash || baseHashDari(t) === baseHashLama);
  if (kandidatYatim.length) {
    const emailLokal = await emailTrxRepo.semua();
    const yatim = pilihProvisionalTanpaPemilik(kandidatYatim, trxEmail.id, emailLokal);
    if (yatim) {
      const diadopsi = await trxRepo.simpanSatu({ ...yatim, emailTrxId: trxEmail.id });
      await emailTrxRepo.simpanSatu({ ...trxEmail, provisionalTrxId: diadopsi.id });
      return diadopsi;
    }
  }

  const data = buatTransaksi({
    accountId: akun.id,
    tanggal,
    deskripsi,
    nominal: nominalBertanda,
    // Bank belum konfirmasi baris ini (belum ada di e-statement) -- sama
    // seperti transaksi manual, `saldo` kosong berarti "tidak diketahui",
    // BUKAN nol. hitungUlangSaldo() sudah menghormati ini (hanya memakai
    // baris ber-`saldo` non-null sebagai titik-anchor, sisanya dijumlah
    // lewat `nominal` apa pun isi `saldo`-nya).
    saldo: null,
    kategoriId,
    sumber: SUMBER.EMAIL_PROVISIONAL,
    emailTrxId: trxEmail.id,
    statusProvisional: STATUS_PROVISIONAL.AKTIF,
    // Dari waktu transaksi asli, bukan "sekarang": provisionalKedaluwarsa()
    // mengukur usia baris dari field ini, termasuk baris hasil backfill.
    dibuatPada: trxEmail.waktuTransaksi,
    baseHash,
    // WAJIB ordinal dari id unik trxEmail (bukan skema ordinal dedupe.js
    // biasa, yang menghitung KEJADIAN per baseHash) -- provisional tidak
    // pernah "sudah ada N kali" dengan cara yang sama seperti baris
    // statement, dan ordinal berbasis konten berisiko collide dengan baris
    // statement asli yang datang belakangan.
    hash: hashFinal(baseHash, `e${trxEmail.id}`),
    // Jatuh sesudah baris statement pada tanggal yang sama, sama seperti
    // transaksi manual -- lihat entities.js.
    urutan: URUTAN_MANUAL,
  });

  const disimpan = await trxRepo.simpanSatu(data);
  await emailTrxRepo.simpanSatu({ ...trxEmail, provisionalTrxId: disimpan.id });

  // hitungUlangSaldo dan sinkron Sheets sengaja diserahkan ke pemanggil, yang
  // memproses banyak baris dalam satu loop: saldo cukup dihitung sekali per
  // rekening, dan satu syncAtauAntri() per batch menghindari race antrean
  // retry yang terjadi bila tiap baris mengirim POST sendiri.
  return disimpan;
}

/**
 * Ganti baris provisional milik `trxEmail` dengan baris statement yang cocok:
 * hapus provisional lokal, tandai email MATCHED. hitungUlangSaldo dan
 * hapusDariSheets sengaja diserahkan ke pemanggil (rekonsiliasiSetelahUpload),
 * supaya dijalankan sekali per batch.
 * @returns {{accountId: string, hash: string}|null} baris provisional yang
 *   dihapus, atau null bila email ini tidak punya provisional.
 */
async function gantikanProvisional(trxEmail, trxStatement) {
  const provisional = trxEmail.provisionalTrxId ? await trxRepo.satu(trxEmail.provisionalTrxId) : null;
  let dihapus = null;

  if (provisional) {
    await trxRepo.hapusTransaksi(provisional.id);
    dihapus = { accountId: provisional.accountId, hash: provisional.hash };
  }

  await emailTrxRepo.simpanSatu({
    ...trxEmail,
    statusCocok: STATUS_COCOK_EMAIL.MATCHED,
    transaksiCocokId: trxStatement.id,
    provisionalTrxId: '',
  });

  return dihapus;
}

/**
 * E-statement datang tapi TIDAK cocok persis (nominal/arah beda, atau skor
 * terlalu lemah/ambigu) dengan transaksi email yang tadinya MISSING. Baris
 * provisional TETAP ADA (saldo tidak disentuh) -- cuma ditandai sengketa
 * supaya kelihatan di halaman "Transaksi Email" dengan info tambahan
 * (lihat ui/views/email-transaksi.js) untuk resolusi manual pengguna.
 */
async function tandaiSengketa(trxEmail, trxStatement, cocok) {
  const provisional = trxEmail.provisionalTrxId ? await trxRepo.satu(trxEmail.provisionalTrxId) : null;
  if (provisional) {
    await trxRepo.simpanSatu({ ...provisional, statusProvisional: STATUS_PROVISIONAL.DISENGKETAKAN });
  }

  await emailTrxRepo.simpanSatu({
    ...trxEmail,
    statusCocok: cocok.status,
    // Null untuk AMBIGUOUS tanpa kandidat tunggal: jangan menebak salah satu.
    transaksiCocokId: trxStatement ? trxStatement.id : '',
    skorCocok: cocok.skor,
    alasanCocok: cocok.alasan,
  });
}

/**
 * Rencana rekonsiliasi, murni. Tiap email dicocokkan SEKALI terhadap seluruh
 * baris statement baru di jendela tanggalnya, supaya cocokkanTransaksiEmail()
 * punya konteks pembanding (memanggilnya per pasangan menghasilkan MISMATCH
 * palsu). Satu baris statement hanya untuk satu email dalam satu batch.
 *
 * @param {Array} transaksiBaruDariUpload baris e-statement yang baru disimpan
 * @param {Array} kandidatEmail transaksi email yang masih memegang baris provisional
 *   (lihat rekonsiliasiSetelahUpload())
 * @returns {Array<{trxEmail:object, trxStatement:object|null, cocok:object}>} `trxStatement`
 *   null berarti AMBIGUOUS tanpa kandidat tunggal; jangan ditebak.
 */
export function rencanakanRekonsiliasi(transaksiBaruDariUpload, kandidatEmail) {
  const rencana = [];
  const statementTerpakai = new Set();

  for (const trxEmail of (kandidatEmail || [])) {
    const rentang = rentangTanggalKandidat(trxEmail.waktuTransaksi);
    if (!rentang) continue;

    const kandidatStatement = (transaksiBaruDariUpload || []).filter((s) => {
      if (statementTerpakai.has(s.id)) return false;
      return s.tanggal >= rentang.dari && s.tanggal <= rentang.sampai;
    });
    if (!kandidatStatement.length) continue;

    const cocok = cocokkanTransaksiEmail(trxEmail, kandidatStatement);
    if (cocok.status === STATUS_COCOK_EMAIL.MISSING) continue; // tidak ada yang berubah, lewati

    // cocok.kandidatId bisa null (AMBIGUOUS "multiple_candidates_similar_score")
    // -- jangan jatuh balik ke kandidatStatement[0], itu menebak pasangan yang
    // cocokkanTransaksiEmail sendiri sengaja tidak menunjuk.
    const trxStatement = cocok.kandidatId
      ? (kandidatStatement.find((s) => s.id === cocok.kandidatId) || null)
      : null;
    rencana.push({ trxEmail, trxStatement, cocok });
    if (cocok.status === STATUS_COCOK_EMAIL.MATCHED && trxStatement) statementTerpakai.add(trxStatement.id);
  }

  return rencana;
}

/**
 * Dipanggil ingest.js simpanDraft() setelah baris e-statement tersimpan dan
 * sebelum hitungUlangSaldo() final (lihat gantikanProvisional()).
 *
 * @param {Array} transaksiBaruDariUpload baris yang baru disimpan simpanDraft()
 * @returns {{digantikan: number, disengketakan: number, akunTersentuh: Set<string>}}
 */
export async function rekonsiliasiSetelahUpload(transaksiBaruDariUpload) {
  const hasil = { digantikan: 0, disengketakan: 0, akunTersentuh: new Set() };
  if (!transaksiBaruDariUpload?.length) return hasil;

  // Kandidat: setiap email yang masih memegang baris provisional, apa pun
  // statusCocok-nya (MISMATCH/AMBIGUOUS lama bisa menemukan pasangan yang
  // benar di upload berikutnya) dan apa pun statusResolusi-nya (keputusan
  // tinjauan tidak menghapus baris dari ledger). Tanpa itu, provisional yang
  // tersingkir dari kandidat jadi DOBEL permanen begitu statement-nya masuk.
  // Sengketa baru hanya ditandai untuk email yang masih TERBUKA.
  const kandidatEmail = (await emailTrxRepo.semua())
    .filter((t) => t.provisionalTrxId && t.statusCocok !== STATUS_COCOK_EMAIL.MATCHED);
  if (!kandidatEmail.length) return hasil;

  const rencana = rencanakanRekonsiliasi(transaksiBaruDariUpload, kandidatEmail);
  const hashDihapus = [];

  for (const { trxEmail, trxStatement, cocok } of rencana) {
    if (cocok.status === STATUS_COCOK_EMAIL.MATCHED) {
      const dihapus = await gantikanProvisional(trxEmail, trxStatement);
      if (dihapus) {
        hasil.akunTersentuh.add(dihapus.accountId);
        hashDihapus.push(dihapus.hash);
      }
      hasil.digantikan += 1;
    } else if (trxEmail.statusResolusi === STATUS_RESOLUSI_EMAIL.TERBUKA) {
      await tandaiSengketa(trxEmail, trxStatement, cocok);
      hasil.disengketakan += 1;
    }
  }

  // Satu kali di akhir batch, bukan per baris -- lihat catatan di gantikanProvisional().
  if (hashDihapus.length) {
    hapusDariSheets(hashDihapus).catch((e) => console.warn('Hapus provisional (batch) di Sheets gagal:', e));
  }

  return hasil;
}

/**
 * Aksi backfill untuk satu transaksi email lama terhadap ledger sekarang,
 * murni. Hanya MATCHED (sudah ada baris statement yang mewakili) yang tidak
 * dibuatkan provisional; MISSING, MISMATCH, dan AMBIGUOUS tetap butuh baris
 * ledger.
 * @returns {{aksi: 'tautkan'|'provisional', cocok: object}}
 */
export function putuskanAksiBackfill(trxEmail, kandidatStatement) {
  const cocok = cocokkanTransaksiEmail(trxEmail, kandidatStatement);
  return { aksi: cocok.status === STATUS_COCOK_EMAIL.MATCHED ? 'tautkan' : 'provisional', cocok };
}

/**
 * Baris e-statement di ledger yang boleh mewakili `trxEmail`: dalam jendela
 * tanggalnya, bukan provisional, dan bank rekeningnya sama (transaksi email
 * Permata tidak mungkin diwakili baris BCA, lihat tautanSah).
 */
async function kandidatStatementUntuk(trxEmail, akunMap) {
  const rentang = rentangTanggalKandidat(trxEmail.waktuTransaksi);
  const kandidatMentah = rentang ? await trxRepo.rentangTanggal(rentang.dari, rentang.sampai) : [];
  const bankEmail = String(trxEmail.bank || '').trim().toLowerCase();
  return kandidatMentah.filter((k) => {
    if (k.sumber === SUMBER.EMAIL_PROVISIONAL) return false;
    const bankAkun = String(akunMap.get(k.accountId)?.bank || '').trim().toLowerCase();
    return !(bankEmail && bankAkun && bankEmail !== bankAkun);
  });
}

/**
 * Backfill transaksi email MISSING yang belum punya baris provisional.
 * Idempoten (yang sudah punya provisional dilewati). Status MISSING lama bisa
 * basi, jadi tiap kandidat dinilai ulang terhadap ledger sekarang (lihat
 * putuskanAksiBackfill()). Dipanggil dari Pengaturan dan
 * setelahTransaksiDihapus().
 *
 * @returns {{dibuat: number, diperbarui: number}}
 */
export async function backfillProvisionalEmailLama() {
  if (!(await ledgerMergeAktif())) return { dibuat: 0, diperbarui: 0 };

  const kandidatEmail = (await emailTrxRepo.semua()).filter((t) => t.statusCocok === STATUS_COCOK_EMAIL.MISSING
    && t.statusResolusi === STATUS_RESOLUSI_EMAIL.TERBUKA
    && !t.provisionalTrxId);
  if (!kandidatEmail.length) return { dibuat: 0, diperbarui: 0 };

  const [daftarKategori, kamusEntri] = await Promise.all([kategoriRepo.daftar(), kamusRepo.semua()]);
  const kamusMap = new Map(kamusEntri.map((e) => [e.merchantKey, e.kategoriId]));

  let dibuat = 0;
  let diperbarui = 0;
  // Dikumpulkan dulu, dikirim SEKALI di akhir -- lihat catatan di
  // buatProvisionalDariEmail() soal kenapa sync per baris di dalam loop
  // seperti ini berbahaya (race antar banyak POST request nyaris bersamaan).
  const baruDibuat = [];

  const akunMap = await akunRepo.peta();
  for (const trxEmail of kandidatEmail) {
    const kandidatStatement = await kandidatStatementUntuk(trxEmail, akunMap);
    const { aksi, cocok } = putuskanAksiBackfill(trxEmail, kandidatStatement);

    if (aksi === 'tautkan') {
      // Sudah ada baris statement ASLI di ledger sekarang -- JANGAN buat
      // provisional (dobel), cukup perbarui status tautannya.
      await emailTrxRepo.simpanSatu({
        ...trxEmail,
        statusCocok: cocok.status,
        transaksiCocokId: cocok.kandidatId || '',
        skorCocok: cocok.skor,
        alasanCocok: cocok.alasan,
      });
      diperbarui += 1;
      continue;
    }

    let disimpan = await buatProvisionalDariEmail(trxEmail, daftarKategori, kamusMap);
    dibuat += 1;

    if (cocok.status !== STATUS_COCOK_EMAIL.MISSING) {
      // Near-miss (MISMATCH/AMBIGUOUS) -- tandai sengketa dari awal, persis
      // tandaiSengketa() yang dipanggil rekonsiliasi biasa, supaya baris ini
      // langsung kelihatan perlu ditinjau alih-alih seolah baru & belum dicek.
      disimpan = await trxRepo.simpanSatu({ ...disimpan, statusProvisional: STATUS_PROVISIONAL.DISENGKETAKAN });
      await emailTrxRepo.simpanSatu({
        ...trxEmail,
        provisionalTrxId: disimpan.id,
        statusCocok: cocok.status,
        transaksiCocokId: cocok.kandidatId || '',
        skorCocok: cocok.skor,
        alasanCocok: cocok.alasan,
      });
    }

    baruDibuat.push(disimpan);
  }

  if (baruDibuat.length) {
    // Sekali per rekening yang tersentuh, bukan sekali per baris -- lihat
    // catatan di buatProvisionalDariEmail().
    const akunTersentuh = new Set(baruDibuat.map((t) => t.accountId));
    for (const accountId of akunTersentuh) {
      await akunRepo.hitungUlangSaldo(accountId);
    }

    Promise.all([akunRepo.peta(), kategoriRepo.peta()])
      .then(([akunMap, kategoriMap]) => syncAtauAntri(baruDibuat, akunMap, kategoriMap))
      .catch((e) => console.warn('Sheets sync backfill provisional gagal:', e));
  }

  return { dibuat, diperbarui };
}

/**
 * Baris provisional yang sudah lama (`> 45 hari`) belum terkonfirmasi
 * e-statement mana pun -- dipakai banner peringatan di Dashboard/Pengaturan.
 * Tidak menghapus apa pun, murni pelaporan.
 */
export async function provisionalKedaluwarsa() {
  const batas = Date.now() - BATAS_HARI_PROVISIONAL * 86400000;
  const semuaProvisional = await trxRepo.perSumber(SUMBER.EMAIL_PROVISIONAL);
  return semuaProvisional.filter((t) => t.statusProvisional === STATUS_PROVISIONAL.AKTIF
    && new Date(t.dibuatPada).getTime() < batas);
}

/**
 * Hapus satu baris provisional (tombol "Hapus baris provisional"), hitung
 * ulang saldo, dan lepaskan rujukannya dari email.
 */
export async function hapusProvisionalManual(trxEmail) {
  if (!trxEmail.provisionalTrxId) return null;
  const provisional = await trxRepo.satu(trxEmail.provisionalTrxId);
  if (!provisional) return null;

  await trxRepo.hapusTransaksi(provisional.id);
  hapusDariSheets([provisional.hash]).catch((e) => console.warn('Hapus provisional di Sheets gagal:', e));
  await akunRepo.hitungUlangSaldo(provisional.accountId);
  await emailTrxRepo.simpanSatu({ ...trxEmail, provisionalTrxId: '' });

  return provisional;
}

/**
 * Tautkan manual satu transaksi email ke baris e-statement pilihan pengguna.
 * Sama seperti gantikanProvisional() pada rekonsiliasi otomatis: begitu ada
 * baris statement yang mewakilinya, baris provisional-nya WAJIB hilang --
 * menandai MATCHED saja (perilaku lama) membiarkan transaksi yang sama
 * terhitung dua kali di saldo.
 */
export async function tautkanManual(trxEmail, trxStatement) {
  const akun = await akunRepo.satu(trxStatement.accountId);
  if (!tautanSah(trxEmail, trxStatement, akun)) {
    throw new Error('Baris ini tidak bisa mewakili transaksi email tersebut (arah atau rekeningnya berbeda).');
  }
  let email = trxEmail;
  if (trxEmail.provisionalTrxId && trxEmail.provisionalTrxId !== trxStatement.id) {
    await hapusProvisionalManual(trxEmail);
    email = { ...trxEmail, provisionalTrxId: '' };
  }
  await emailTrxRepo.simpanSatu({
    ...email,
    statusCocok: STATUS_COCOK_EMAIL.MATCHED,
    transaksiCocokId: trxStatement.id,
    skorCocok: null,
    alasanCocok: 'manual_link',
  });
}

/**
 * Bolehkah baris ledger ini dipakai mewakili transaksi email? Harus baris
 * e-statement (bukan provisional), arahnya sama (email debit = nominal
 * negatif), dan -- bila keduanya diketahui -- bank rekeningnya sama.
 *
 * Tanpa pemeriksaan ini "Tautkan manual" bisa memasangkan transfer KELUAR
 * dari Permata dengan baris MASUK-nya di BCA (sisi penerima transfer yang
 * sama), lalu menghapus satu-satunya catatan pengeluaran di Permata.
 */
export function tautanSah(trxEmail, trxStatement, akunStatement) {
  if (!trxStatement || trxStatement.sumber === SUMBER.EMAIL_PROVISIONAL) return false;
  const nominal = Number(trxStatement.nominal) || 0;
  const debit = trxEmail.arah === 'debit';
  if (debit ? nominal >= 0 : nominal <= 0) return false;
  const bankEmail = String(trxEmail.bank || '').trim().toLowerCase();
  const bankAkun = String(akunStatement?.bank || '').trim().toLowerCase();
  return !(bankEmail && bankAkun && bankEmail !== bankAkun);
}

/**
 * Rencana penyesuaian transaksi email setelah baris ledger `idTerhapus`
 * dihapus -- murni, diekspor untuk tes. Menjaga dua invarian: email tidak
 * pernah merujuk baris yang sudah tidak ada, dan transaksi yang dibuktikan
 * email tidak hilang dari pembukuan tanpa keputusan siapa pun.
 *
 *   - `evaluasiUlang`: email MATCHED yang baris statement-nya terhapus (mis.
 *     upload dibatalkan). Transaksinya tetap nyata, jadi email dikembalikan
 *     ke MISSING untuk dinilai ulang backfill: ditautkan ke baris lain bila
 *     ada, atau dibuatkan provisional lagi.
 *   - `tautkanAtauSelesaikan`: baris provisional-nya yang terhapus. Itu
 *     keputusan (pengguna, atau perangkat lain yang sudah menggantinya dengan
 *     baris statement), jadi tidak dibuat ulang: ditautkan ke baris statement
 *     bila ada, kalau tidak ditandai selesai.
 *   - `lepasKandidat`: hanya kandidat sengketanya yang terhapus.
 *
 * @param {Array} emailLokal seluruh record email_transactions lokal
 * @param {Set<string>} idTerhapus id transaksi ledger yang baru dihapus
 * @returns {Array<{email: object, aksi: 'evaluasiUlang'|'tautkanAtauSelesaikan'|'lepasKandidat'}>}
 */
export function rencanakanSetelahHapus(emailLokal, idTerhapus) {
  const rencana = [];
  for (const e of emailLokal || []) {
    const provHilang = Boolean(e.provisionalTrxId) && idTerhapus.has(e.provisionalTrxId);
    const cocokHilang = Boolean(e.transaksiCocokId) && idTerhapus.has(e.transaksiCocokId);
    if (!provHilang && !cocokHilang) continue;
    const lepas = {
      ...e,
      provisionalTrxId: provHilang ? '' : e.provisionalTrxId,
      transaksiCocokId: cocokHilang ? '' : e.transaksiCocokId,
    };
    if (e.statusCocok === STATUS_COCOK_EMAIL.MATCHED && cocokHilang) {
      rencana.push({
        email: { ...lepas, statusCocok: STATUS_COCOK_EMAIL.MISSING, skorCocok: null, alasanCocok: '' },
        aksi: 'evaluasiUlang',
      });
    } else if (provHilang) {
      rencana.push({ email: lepas, aksi: 'tautkanAtauSelesaikan' });
    } else {
      rencana.push({ email: lepas, aksi: 'lepasKandidat' });
    }
  }
  return rencana;
}

/**
 * Panggil SETIAP KALI baris ledger dihapus di luar modul ini (hapus manual,
 * batal upload, hapus rekening, penghapusan yang ditarik dari Sheets).
 * Lihat rencanakanSetelahHapus() untuk aturannya.
 *
 * @param {Array<string>} ids id transaksi yang sudah dihapus
 * @param {{evaluasiUlang?: boolean}} opsi `false` saat rekeningnya sendiri
 *   dihapus: email yang terdampak ditutup, karena menilainya ulang hanya
 *   akan membuat rekening baru lagi.
 * @returns {Promise<{disesuaikan: number}>}
 */
export async function setelahTransaksiDihapus(ids, { evaluasiUlang = true } = {}) {
  if (!ids?.length) return { disesuaikan: 0 };
  const rencana = rencanakanSetelahHapus(await emailTrxRepo.semua(), new Set(ids));
  if (!rencana.length) return { disesuaikan: 0 };

  const akunMap = await akunRepo.peta();
  let perluBackfill = false;
  for (const { email, aksi } of rencana) {
    if (aksi === 'tautkanAtauSelesaikan') {
      const cocok = cocokkanTransaksiEmail(email, await kandidatStatementUntuk(email, akunMap));
      const statement = cocok.status === STATUS_COCOK_EMAIL.MATCHED && cocok.kandidatId
        ? await trxRepo.satu(cocok.kandidatId) : null;
      await emailTrxRepo.simpanSatu(statement
        ? {
          ...email, statusCocok: STATUS_COCOK_EMAIL.MATCHED, transaksiCocokId: statement.id,
          skorCocok: cocok.skor, alasanCocok: cocok.alasan,
        }
        : {
          ...email,
          statusResolusi: email.statusResolusi === STATUS_RESOLUSI_EMAIL.TERBUKA
            ? STATUS_RESOLUSI_EMAIL.DISELESAIKAN : email.statusResolusi,
        });
      continue;
    }
    if (aksi === 'evaluasiUlang' && !evaluasiUlang) {
      // Rekeningnya ikut dihapus: ditutup, supaya backfill berikutnya tidak
      // membuat rekening baru hanya untuk email ini.
      await emailTrxRepo.simpanSatu({ ...email, statusResolusi: STATUS_RESOLUSI_EMAIL.DISELESAIKAN });
      continue;
    }
    await emailTrxRepo.simpanSatu(email);
    if (aksi === 'evaluasiUlang') perluBackfill = true;
  }
  if (perluBackfill) await backfillProvisionalEmailLama();
  return { disesuaikan: rencana.length };
}
