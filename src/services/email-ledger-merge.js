/**
 * Gabung ledger Transaksi (e-statement bulanan) + Transaksi Email (realtime)
 * jadi SATU tanpa dobel ("Fase C" dari rencana implementasi 3 fase).
 *
 * Dipanggil dari DUA arah berbeda, makanya modul terpisah dari
 * email-feed-sync.js/ingest.js (bukan salah satu dari asalnya):
 *   1. Transaksi email BARU masuk, tidak ada padanan e-statement (MISSING)
 *      -> `buatProvisionalDariEmail()` mencatatnya sebagai baris ledger
 *      PROVISIONAL supaya langsung tampil di Dashboard, dipanggil dari
 *      services/email-feed-sync.js `prosesSatuTransaksiBaru()`.
 *   2. E-statement BARU diupload -> `rekonsiliasiSetelahUpload()` mencari
 *      transaksi email yang sebelumnya MISSING dan mungkin sekarang cocok,
 *      menggantikan baris provisional-nya (bukan membiarkan dobel), dipanggil
 *      dari services/ingest.js `simpanDraft()`.
 *
 * Flag dry-run WAJIB selama masa uji: `pengaturanRepo.KUNCI.EMAIL_LEDGER_MERGE_AKTIF`
 * (default MATI). Selama mati, rekonsiliasi & saran kategori transaksi email
 * (Fase A/B) tetap jalan penuh seperti biasa -- yang tidak terjadi HANYA
 * pembuatan baris ledger provisional.
 *
 * Kebijakan MISMATCH/AMBIGUOUS setelah e-statement datang: baris provisional
 * TIDAK dihapus otomatis, cuma ditandai `statusProvisional: 'disengketakan'`
 * (saldo tidak berubah oleh langkah ini) -- mempertahankan status quo yang
 * sudah ditampilkan ke pengguna lebih aman daripada diam-diam menghilangkan
 * uang dari Dashboard karena kandidat yang salah. Resolusi akhir (hapus
 * manual, atau biarkan) ada di tangan pengguna lewat halaman "Transaksi
 * Email" (lihat ui/views/email-transaksi.js).
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
import { normalisasiDeskripsi } from '../core/format.js';
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
 * Kunci setting Akun BCA (utama/RDN) yang relevan untuk satu transaksi email
 * — murni, tidak menyentuh database, diekspor supaya bisa diuji langsung.
 * Kata kunci RDN/Stockbit dicari di SELURUH teks yang tersedia dari parser
 * email (merchant, jenis transaksi, acquirer, lokasi), bukan cuma merchant,
 * karena penyebutan "RDN"/"Stockbit" bisa muncul di field mana saja
 * tergantung format notifikasi bank.
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
 * Tentukan rekening tujuan baris provisional dari data transaksi email.
 *
 * Bank selain BCA tidak ambigu di data produksi (1 rekening per bank) --
 * `cariAtauBuat()` yang sama dipakai upload e-statement. BCA ambigu (2
 * rekening): default ke setting "emailAkunUtamaBCA", kecuali teks email
 * menyebut RDN/Stockbit -> "emailAkunRdnBCA" (lihat kunciSettingAkunBca()).
 * Setting kosong/akun sudah terhapus -> fallback ke akun BCA pertama yang
 * ditemukan, supaya transaksinya tetap tercatat (lebih aman terlihat di
 * rekening yang mungkin salah daripada hilang tak tercatat sama sekali).
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
 * satu transaksi email -- murni. Dipakai bersama oleh pembuat baris
 * (buatProvisionalDariEmail) dan pembersih dobel
 * (rencanakanBersihProvisionalDobel) supaya keduanya pasti menghitung kunci
 * yang sama.
 */
export function bentukBarisEmail(trxEmail) {
  const magnitudo = Math.abs(Number(trxEmail.nominal) || 0);
  return {
    tanggal: tanggalWib(trxEmail.waktuTransaksi),
    // Tanggal yang dipakai SEBELUM perbaikan zona waktu (potongan ISO UTC).
    // Hanya untuk mengenali baris provisional lama yang belum dikoreksi
    // migrasiTanggalProvisionalWib() -- jangan dipakai untuk baris baru.
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
 * Dari baris provisional yang ber-baseHash sama dengan transaksi email
 * `idEmail`, pilih satu yang boleh diadopsi -- murni, diekspor untuk tes.
 *
 * Boleh diadopsi = milik email ini sendiri, ATAU tidak dimiliki email LAIN
 * yang ada di perangkat ini (pemiliknya id asing). Baris yang sudah dipegang
 * email lokal lain TIDAK disentuh: itu transaksi kembar yang sah (dua kali
 * beli di toko sama, nominal sama, hari sama -- dua email berbeda).
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
 * Rencana pembersihan baris provisional dobel yang SUDAH terlanjur ada --
 * murni, diekspor untuk tes; dijalankan sekali oleh migrasi
 * hapusProvisionalDobelEmail() (data/migrasi.js).
 *
 * Per kelompok baseHash yang berisi lebih dari satu baris provisional,
 * jumlah yang dipertahankan = jumlah transaksi email lokal yang memang
 * menghasilkan kunci itu (bank + tanggal + deskripsi + nominal). Kelompok
 * tanpa satu pun email pasangan DILEWATI -- tanpa pembanding, dua baris
 * kembar tidak bisa dibedakan dari dua transaksi sah, dan menghapus uang
 * yang benar-benar keluar lebih buruk daripada membiarkan dobel.
 *
 * Yang dipertahankan lebih dulu: baris yang dirujuk `provisionalTrxId`
 * email lokal (tidak pernah dihapus), lalu baris yang paling akhir diubah
 * (menjaga koreksi kategori yang mungkin dibuat pengguna di Sheet). Email
 * yang belum memegang baris mana pun ditautkan ke baris yang dipertahankan,
 * supaya rekonsiliasi saat e-statement bulan itu diupload bisa
 * menggantikannya -- tanpa tautan, baris itu akan dobel lagi dengan baris
 * statement.
 *
 * @param {Array} provisional seluruh baris ledger ber-sumber email_provisional
 * @param {Array} emailLokal seluruh record email_transactions lokal
 * @param {Map} akunMap accountId -> akun (untuk bank)
 * @returns {{hapus: Array, tautkan: Array<{email: object, trx: object}>}}
 */
export function rencanakanBersihProvisionalDobel(provisional, emailLokal, akunMap) {
  const kunci = (bank, tanggal, deskripsi, nominal) => [
    bank || '', tanggal, normalisasiDeskripsi(deskripsi), (Math.round(Number(nominal) * 100) / 100).toFixed(2),
  ].join('|');

  const emailPerKunci = new Map();
  for (const e of emailLokal) {
    const b = bentukBarisEmail(e);
    // Didaftarkan di bawah tanggal WIB DAN tanggal UTC lama: pembersihan ini
    // berjalan sebelum migrasiTanggalProvisionalWib(), saat baris yang
    // terlanjur ada masih bertanggal UTC.
    for (const tgl of new Set([b.tanggal, b.tanggalLama])) {
      const k = kunci(e.bank, tgl, b.deskripsi, b.nominal);
      if (!emailPerKunci.has(k)) emailPerKunci.set(k, []);
      emailPerKunci.get(k).push(e);
    }
  }

  const idAda = new Set(provisional.map((t) => t.id));
  const dirujuk = new Set(emailLokal.map((e) => e.provisionalTrxId).filter((id) => idAda.has(id)));

  const kelompok = new Map();
  for (const t of provisional) {
    const bh = baseHashDari(t);
    if (!bh) continue;
    if (!kelompok.has(bh)) kelompok.set(bh, []);
    kelompok.get(bh).push(t);
  }

  const hapus = [];
  const tautkan = [];
  for (const baris of kelompok.values()) {
    if (baris.length < 2) continue;
    const contoh = baris[0];
    const email = emailPerKunci.get(kunci(
      akunMap.get(contoh.accountId)?.bank, contoh.tanggal, contoh.deskripsi, contoh.nominal,
    )) || [];
    if (!email.length) continue;

    const dipegang = baris.filter((t) => dirujuk.has(t.id));
    const bebas = baris.filter((t) => !dirujuk.has(t.id))
      .sort((a, b) => String(b.diubahPada || '').localeCompare(String(a.diubahPada || '')));
    const sisaKuota = Math.max(email.length - dipegang.length, 0);
    const dipertahankan = bebas.slice(0, sisaKuota);
    hapus.push(...bebas.slice(sisaKuota));

    const emailTanpaBaris = email.filter((e) => !dirujuk.has(e.provisionalTrxId));
    dipertahankan.forEach((trx, i) => {
      if (emailTanpaBaris[i]) tautkan.push({ email: emailTanpaBaris[i], trx });
    });
  }
  return { hapus, tautkan };
}

/**
 * Rencana penghapusan baris provisional dobel yang HANYA ada di Sheet --
 * murni, diekspor untuk tes; dijalankan sekali oleh
 * hapusProvisionalYatimDiSheet() (data/migrasi.js).
 *
 * Melengkapi rencanakanBersihProvisionalDobel(), yang hanya melihat database
 * lokal. Di data produksi insiden 2026-10-06, perangkat utama memegang 2290
 * transaksi sementara Sheet 2343 -- selisihnya tepat 53 baris dobel, yang
 * tidak pernah tertarik ke perangkat (checkpoint tarik sudah melewatinya).
 * Pembersih lokal tidak melihat satu pun kelompok berisi dua baris.
 *
 * Baris Sheet dianggap yatim bila ber-sumber email_provisional, hash dan
 * id-nya tidak ada di perangkat ini, dan perangkat ini sudah memegang baris
 * provisional dengan awalan hash yang sama. Yang dihapus hanya kelebihannya
 * terhadap jumlah email pasangan; kelompok tanpa email pasangan atau tanpa
 * baris lokal dilewati (bisa jadi transaksi sah yang belum tertarik).
 *
 * Kelompok dipakai lewat AWALAN HASH, bukan field baseHash: hash tidak
 * pernah berubah, sedangkan baseHash lokal dihitung ulang oleh
 * migrasiTanggalProvisionalWib().
 *
 * @param {Array} barisSheet hasil tarikTransaksiDariSheets(null).baris
 * @param {Array} transaksiLokal seluruh transaksi lokal
 * @param {Array} emailLokal seluruh record email_transactions lokal
 * @param {Map} akunMap accountId -> akun (untuk bank)
 * @returns {Array} baris Sheet yang harus dihapus
 */
export function rencanakanHapusYatimSheet(barisSheet, transaksiLokal, emailLokal, akunMap) {
  const awalan = (t) => String(t.hash || '').split('#')[0];
  const hashLokal = new Set(transaksiLokal.map((t) => t.hash).filter(Boolean));
  const idLokal = new Set(transaksiLokal.map((t) => t.id));

  const lokalPerAwalan = new Map();
  for (const t of transaksiLokal) {
    if (t.sumber !== SUMBER.EMAIL_PROVISIONAL || !awalan(t)) continue;
    if (!lokalPerAwalan.has(awalan(t))) lokalPerAwalan.set(awalan(t), []);
    lokalPerAwalan.get(awalan(t)).push(t);
  }

  const yatimPerAwalan = new Map();
  for (const r of barisSheet) {
    if (r.sumber !== SUMBER.EMAIL_PROVISIONAL || !awalan(r)) continue;
    if (hashLokal.has(r.hash) || idLokal.has(r.id)) continue;
    if (!yatimPerAwalan.has(awalan(r))) yatimPerAwalan.set(awalan(r), []);
    yatimPerAwalan.get(awalan(r)).push(r);
  }

  const kunci = (bank, tanggal, deskripsi, nominal) => [
    bank || '', tanggal, normalisasiDeskripsi(deskripsi), (Math.round(Number(nominal) * 100) / 100).toFixed(2),
  ].join('|');
  const jumlahEmail = new Map();
  for (const e of emailLokal) {
    const b = bentukBarisEmail(e);
    for (const tgl of new Set([b.tanggal, b.tanggalLama])) {
      const k = kunci(e.bank, tgl, b.deskripsi, b.nominal);
      jumlahEmail.set(k, (jumlahEmail.get(k) || 0) + 1);
    }
  }

  const hapus = [];
  for (const [aw, yatim] of yatimPerAwalan) {
    const lokal = lokalPerAwalan.get(aw) || [];
    if (!lokal.length) continue;
    const contoh = lokal[0];
    // Tanggal dari baris Sheet (tanggal asal awalan hash), bukan dari baris
    // lokal yang mungkin sudah dikoreksi ke WIB.
    const harapan = jumlahEmail.get(kunci(
      akunMap.get(contoh.accountId)?.bank, yatim[0].tanggal, contoh.deskripsi, contoh.nominal,
    )) || 0;
    if (!harapan) continue;
    const kuota = Math.max(harapan - lokal.length, 0);
    const urut = [...yatim].sort((a, b) => String(b.diubahPada || '').localeCompare(String(a.diubahPada || '')));
    hapus.push(...urut.slice(kuota));
  }
  return hapus;
}

/**
 * Rencana koreksi tanggal baris provisional lama yang tercatat dengan tanggal
 * UTC -- murni, diekspor untuk tes; dijalankan sekali oleh
 * migrasiTanggalProvisionalWib() (data/migrasi.js).
 *
 * Hanya baris yang emailnya ada di perangkat ini yang dikoreksi (pemilik
 * dari `emailTrxId`, ordinal `e<id>` pada hash, atau `provisionalTrxId`
 * email), dan hanya bila tanggalnya masih persis tanggal UTC lama -- baris
 * yang tanggalnya sudah diubah pengguna lewat Sheet tidak disentuh.
 * `baseHash` ikut dihitung ulang oleh pemanggil; `hash` sengaja tetap
 * (kunci upsert Sheets), jadi Sheet memperbarui baris yang sama.
 *
 * @returns {Array<{trx: object, tanggal: string}>}
 */
export function rencanakanKoreksiTanggalProvisional(provisional, emailLokal) {
  const emailPerId = new Map(emailLokal.map((e) => [e.id, e]));
  const emailPerTrx = new Map(emailLokal.filter((e) => e.provisionalTrxId).map((e) => [e.provisionalTrxId, e]));
  const rencana = [];
  for (const t of provisional) {
    const email = emailPerTrx.get(t.id) || emailPerId.get(idEmailPemilik(t));
    if (!email) continue;
    const { tanggal, tanggalLama } = bentukBarisEmail(email);
    if (tanggal !== tanggalLama && t.tanggal === tanggalLama) rencana.push({ trx: t, tanggal });
  }
  return rencana;
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

  // Pengaman duplikat: kalau baris ledger untuk trxEmail.id ini SUDAH ada
  // (hash penuh = baseHash + ordinal `e<trxEmail.id>`, lihat `hash` di bawah),
  // JANGAN buat baris baru -- tautkan ulang saja. Ditemukan langsung di
  // produksi: dua proses (mis. "Tarik email" dan backfill) yang kebetulan
  // berjalan nyaris bersamaan bisa memicu buatProvisionalDariEmail() dua kali
  // untuk transaksi email YANG SAMA sebelum keduanya sempat saling melihat
  // hasil satu sama lain -- dobel.
  //
  // SENGAJA dibandingkan lewat hash PENUH (bukan baseHash saja): baseHash
  // cuma akun+tanggal+deskripsi+nominal, dan itu SAH bertabrakan untuk dua
  // transaksi BERBEDA yang kebetulan mirip (mis. dua kali beli kopi di toko
  // sama, nominal sama, tanggal sama, tapi trxEmail.id beda -- data produksi
  // sendiri punya kasus ini, "PT Tokopedia" muncul 3x di 07 Sep dengan
  // emailTrxId berbeda-beda, ketiganya transaksi asli). Ordinal `e<trxEmail.id>`
  // pada hash penuh memisahkan kasus itu dari kasus SATU trxEmail.id yang
  // diproses dua kali -- cuma yang kedua yang harus dicegah.
  const hashCalon = hashFinal(baseHash, `e${trxEmail.id}`);
  const barisSama = await trxRepo.satuLewatHash(hashCalon);
  if (barisSama) {
    await emailTrxRepo.simpanSatu({ ...trxEmail, provisionalTrxId: barisSama.id });
    return barisSama;
  }

  // Pengaman kedua: baris provisional untuk email yang SAMA tapi dibuat
  // dengan id email LAIN -- id dari perangkat lain (tiba lewat tarik Sheets,
  // `emailTrxId`-nya tidak ikut terbawa) atau dari data lokal yang pernah
  // dibersihkan. Hash penuhnya berbeda, jadi pengaman di atas tidak
  // melihatnya; inilah yang membuat 53 transaksi email 18-29 Sep tercatat
  // dua kali (insiden 2026-10-06). Baris seperti itu diadopsi, bukan
  // diduplikasi. Hash-nya sengaja TIDAK diganti: hash adalah kunci upsert
  // Sheets, mengubahnya berarti hapus + tulis ulang di sana.
  // baseHash bertanggal UTC ikut dicari: baris dari perangkat yang belum
  // menjalankan migrasiTanggalProvisionalWib() masih memakainya.
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
    // WAJIB dari waktu transaksi asli, BUKAN "sekarang" (bawaan buatTransaksi()
    // kalau tidak diisi) -- provisionalKedaluwarsa() (watchdog 45 hari) memakai
    // field ini untuk mengukur usia baris. Untuk transaksi yang baru saja
    // ditarik, keduanya nyaris sama; tapi untuk backfill transaksi email LAMA
    // (lihat backfillProvisionalEmailLama()), memakai "sekarang" akan membuat
    // baris yang sudah berbulan-bulan menunggu terlihat baru dibuat sedetik
    // lalu -- watchdog tidak akan pernah menandainya.
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

  // hitungUlangSaldo TIDAK dipanggil di sini -- sengaja diserahkan ke
  // pemanggil (yang memproses banyak baris dalam satu loop, lihat
  // prosesSatuTransaksiBaru()/tarikTransaksiEmail() dan
  // backfillProvisionalEmailLama() di bawah): kalau fungsi ini menghitung
  // ulang saldo per baris, 64 baris untuk rekening yang sama berarti 64 kali
  // pemindaian penuh transaksi rekening itu, padahal cuma hasil PANGGILAN
  // TERAKHIR yang berarti -- pemanggil cukup menghitung ulang SEKALI per
  // rekening yang tersentuh, di akhir loop (pola sama seperti ingest.js).
  //
  // Sheets TIDAK disentuh di sini -- sengaja diserahkan ke pemanggil
  // (lihat email-feed-sync.js prosesSatuTransaksiBaru()/tarikTransaksiEmail(),
  // dan backfillProvisionalEmailLama() di bawah). Kedua pemanggil itu
  // memproses BANYAK transaksi dalam satu loop; kalau fungsi ini menembak
  // syncAtauAntri()-nya sendiri per baris, N baris = N POST request hampir
  // bersamaan ke webhook YANG SAMA, saling menimpa antrean retry lokal
  // (bacaAntrean/tulisAntrean tidak dikunci) -- yang tersisa di Sheets cuma
  // baris yang kebetulan menang race itu, sisanya hilang tanpa error (dilihat
  // langsung di produksi: dari 64 baris BCA, 0 yang sampai ke Sheets). Satu
  // panggilan syncAtauAntri() per BATCH (bukan per baris) menghindari ini.
  return disimpan;
}

/**
 * Ganti baris provisional milik `trxEmail` dengan baris statement asli
 * (`trxStatement`) yang baru dikonfirmasi cocok -- hapus provisional-nya
 * (lokal + Sheets), tandai email trx sebagai benar-benar MATCHED. TIDAK
 * memanggil hitungUlangSaldo di sini: pemanggil (rekonsiliasiSetelahUpload)
 * yang mengumpulkan seluruh akun tersentuh lalu menghitung ulang SEKALI di
 * akhir, supaya tidak ada window saldo dihitung dari state yang belum tuntas.
 * TIDAK memanggil hapusDariSheets di sini -- pemanggil (rekonsiliasiSetelahUpload)
 * bisa memproses BANYAK baris dalam satu batch upload; kalau tiap baris
 * menghapus dari Sheets sendiri-sendiri, itu race yang sama persis dengan
 * yang diperbaiki di buatProvisionalDariEmail() (lihat catatan di sana), cuma
 * lewat antrean hapus (bacaAntreanHapus/tulisAntreanHapus) alih-alih antrean
 * kirim. Pemanggil mengumpulkan seluruh hash yang perlu dihapus lalu memanggil
 * hapusDariSheets() SEKALI di akhir.
 * @returns {{accountId: string, hash: string}|null} data baris provisional yang
 *   barusan dihapus lokal, atau null kalau tidak ada baris provisional untuk email ini.
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
    // `trxStatement` bisa null (AMBIGUOUS "multiple_candidates_similar_score"
    // -- cocokkanTransaksiEmail sengaja tidak menunjuk kandidat mana pun
    // karena skornya nyaris sama). Sama seperti konvensi yang sudah ada di
    // email-feed-sync.js (`cocok.kandidatId || ''`): JANGAN pernah menebak
    // satu baris statement sebagai "kandidat"-nya -- itu akan tampil ke
    // pengguna sebagai tautan ke transaksi yang sebenarnya tidak pernah
    // benar-benar terpilih.
    transaksiCocokId: trxStatement ? trxStatement.id : '',
    skorCocok: cocok.skor,
    alasanCocok: cocok.alasan,
  });
}

/**
 * Rencanakan hasil rekonsiliasi TANPA menyentuh database sama sekali --
 * murni, diekspor supaya bisa diuji langsung tanpa IndexedDB. Untuk tiap
 * transaksi email kandidat, kumpulkan SELURUH baris statement baru yang
 * jendela tanggalnya beririsan (reuse rentangTanggalKandidat) lalu jalankan
 * cocokkanTransaksiEmail() SEKALI dengan seluruh kandidat itu sekaligus --
 * pola yang sama dengan pemanggilan aslinya di email-feed-sync.js
 * `prosesSatuTransaksiBaru()`. Ini penting: memanggilnya sekali per pasangan
 * (satu email vs satu statement) akan membuat cocokkanTransaksiEmail
 * kehilangan konteks pembanding (skor kandidat #2 dsb.), sehingga
 * menghasilkan MISMATCH palsu untuk pasangan yang sama sekali tidak
 * berhubungan padahal statement yang benar ada di kandidat lain pada batch
 * yang sama.
 *
 * Constraint one-to-one dalam SATU batch: begitu satu baris statement
 * MATCHED ke satu transaksi email, baris itu tidak lagi jadi kandidat untuk
 * transaksi email lain di batch yang sama (satu baris e-statement tidak
 * mungkin merupakan 2 transaksi bank berbeda).
 *
 * @param {Array} transaksiBaruDariUpload baris e-statement yang baru disimpan
 * @param {Array} kandidatEmail transaksi email TERBUKA yang punya baris provisional
 *   (statusCocok apa pun -- termasuk MISMATCH/AMBIGUOUS lama, lihat rekonsiliasiSetelahUpload())
 * @returns {Array<{trxEmail:object, trxStatement:object|null, cocok:object}>} `trxStatement`
 *   null berarti AMBIGUOUS tanpa kandidat tunggal (skor dua kandidat nyaris
 *   sama) -- lihat cocokkanTransaksiEmail(), JANGAN ditebak jadi salah satunya.
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
 * Dipanggil dari ingest.js `simpanDraft()` SETELAH baris e-statement baru
 * tersimpan (`trxRepo.simpanBanyakTransaksi`), SEBELUM `hitungUlangSaldo()`
 * final dan SEBELUM `emit(EVENT.DATA_BERUBAH)` -- lihat catatan risiko di
 * gantikanProvisional() soal kenapa hitungUlangSaldo TIDAK dipanggil di sini.
 *
 * @param {Array} transaksiBaruDariUpload baris yang baru disimpan simpanDraft()
 * @returns {{digantikan: number, disengketakan: number, akunTersentuh: Set<string>}}
 */
export async function rekonsiliasiSetelahUpload(transaksiBaruDariUpload) {
  const hasil = { digantikan: 0, disengketakan: 0, akunTersentuh: new Set() };
  if (!transaksiBaruDariUpload?.length) return hasil;

  // Kandidat email: SEMUA yang masih TERBUKA dan sudah punya baris provisional
  // -- ini SENGAJA tidak dibatasi ke statusCocok===MISSING saja. Baris yang
  // sudah ditandai MISMATCH/AMBIGUOUS oleh upload statement SEBELUMNYA (lihat
  // tandaiSengketa()) tetap harus dievaluasi ulang di sini: statement yang
  // salah pasang bulan lalu tidak menutup kemungkinan statement yang BENAR
  // muncul di upload berikutnya. Tanpa ini baris disengketakan tidak pernah
  // ketemu pasangannya lagi -- provisional-nya nyangkut selamanya, dan begitu
  // pasangan yang benar akhirnya diupload, baris itu jadi DOBEL permanen
  // (provisional lama + statement baru sama-sama masuk ledger) karena sudah
  // tersingkir dari daftar kandidat. Yang benar-benar tidak perlu dievaluasi
  // ulang cuma yang sudah DISELESAIKAN/DIABAIKAN pengguna secara eksplisit.
  const kandidatEmail = (await emailTrxRepo.semua())
    .filter((t) => t.statusResolusi === STATUS_RESOLUSI_EMAIL.TERBUKA && t.provisionalTrxId);
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
    } else {
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
 * Putuskan aksi backfill untuk SATU transaksi email lama terhadap ledger
 * SEKARANG -- murni, diekspor supaya bisa diuji tanpa IndexedDB.
 *
 * Hanya MATCHED yang berarti "sudah ada baris statement ASLI yang benar-benar
 * mewakilinya" -- itu satu-satunya kasus yang TIDAK BOLEH dibuatkan
 * provisional (akan dobel dengan baris asli yang sudah ada). MISSING,
 * MISMATCH, DAN AMBIGUOUS semuanya berarti "belum ada baris statement asli
 * yang mewakilinya" -- ketiganya tetap perlu baris provisional, persis
 * seperti kalau transaksi ini baru saja ditarik hari ini dan kandidat
 * terdekatnya kebetulan tidak cocok (lihat prosesSatuTransaksiBaru() di
 * email-feed-sync.js: cuma MISSING yang memicu provisional di jalur baru,
 * tapi itu karena transaksi baru MEMANG tidak mungkin MISMATCH/AMBIGUOUS
 * terhadap ledgernya sendiri yang belum pernah menyinggungnya -- transaksi
 * LAMA yang dinilai ulang di sini bisa saja sudah kadung MISMATCH/AMBIGUOUS
 * dari rekonsiliasi lama, dan itu TETAP butuh baris ledger, bukan cuma
 * status).
 * @returns {{aksi: 'tautkan'|'provisional', cocok: object}}
 */
export function putuskanAksiBackfill(trxEmail, kandidatStatement) {
  const cocok = cocokkanTransaksiEmail(trxEmail, kandidatStatement);
  return { aksi: cocok.status === STATUS_COCOK_EMAIL.MATCHED ? 'tautkan' : 'provisional', cocok };
}

/**
 * Backfill SATU KALI (tapi aman dipanggil berulang -- idempoten) untuk
 * transaksi email LAMA yang statusnya sudah MISSING dari SEBELUM fitur ini
 * diaktifkan pengguna. `prosesSatuTransaksiBaru()` di email-feed-sync.js
 * cuma memproses transaksi email yang BARU ditarik (lihat `simpanBanyakBaru`
 * yang men-skip `gmailMessageId` yang sudah ada) -- tanpa backfill ini,
 * backlog lama tidak akan PERNAH dapat baris provisional walau flag sudah
 * dinyalakan, karena tidak ada pemicu lain yang mengevaluasinya ulang.
 *
 * PENTING: status MISSING yang tersimpan di baris lama bisa BASI. Transaksi
 * itu mungkin diparse SEBELUM e-statement pasangannya sempat diupload, dan
 * sebelum Fase C ada, tidak ada apa pun yang mengevaluasinya ulang begitu
 * statement itu akhirnya masuk. Karena itu setiap kandidat dinilai ULANG di
 * sini terhadap ledger SEKARANG (lihat putuskanAksiBackfill()) sebelum
 * diputuskan.
 *
 * Dipanggil dari UI Pengaturan (kartuGabungLedgerEmail) setiap kali tombol
 * "Simpan" ditekan dengan flag aktif -- filter `!t.provisionalTrxId` membuat
 * baris yang sudah pernah dibuatkan provisional tidak diproses dua kali,
 * jadi aman dipanggil ulang berkali-kali (mis. pengguna cuma mengganti
 * pilihan rekening BCA lalu Simpan lagi).
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
    const rentang = rentangTanggalKandidat(trxEmail.waktuTransaksi);
    const kandidatMentah = rentang ? await trxRepo.rentangTanggal(rentang.dari, rentang.sampai) : [];
    // Bank rekening harus sama: transaksi email Permata tidak mungkin
    // diwakili baris e-statement BCA (lihat tautanSah).
    const bankEmail = String(trxEmail.bank || '').trim().toLowerCase();
    const kandidatStatement = kandidatMentah.filter((k) => {
      if (k.sumber === SUMBER.EMAIL_PROVISIONAL) return false;
      const bankAkun = String(akunMap.get(k.accountId)?.bank || '').trim().toLowerCase();
      return !(bankEmail && bankAkun && bankEmail !== bankAkun);
    });
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
 * Hapus satu baris provisional secara manual (dipakai tombol "Hapus baris
 * provisional" di halaman Transaksi Email untuk kasus disengketakan yang
 * ternyata memang keliru/dobel) -- hitung ulang saldo akunnya, dan lepaskan
 * rujukan di record email trx supaya tidak menunjuk ke baris yang sudah
 * tidak ada.
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
 * Transaksi email yang sudah MATCHED ke baris statement tapi masih memegang
 * baris provisional -- sisa "Tautkan manual" versi lama. Murni, diekspor
 * untuk tes; dijalankan oleh bersihkanProvisionalTertaut() (data/migrasi.js).
 *
 * @param {Array} emailLokal record transaksi email
 * @param {Map<string, object>} transaksiPerId transaksi ledger per id
 * @returns {Array} transaksi email yang provisional-nya harus dihapus
 */
export function rencanakanBersihProvisionalTertaut(emailLokal, transaksiPerId, akunMap = new Map()) {
  return (emailLokal || []).filter((e) => {
    if (e.statusCocok !== STATUS_COCOK_EMAIL.MATCHED) return false;
    if (!e.provisionalTrxId || !e.transaksiCocokId || e.provisionalTrxId === e.transaksiCocokId) return false;
    const statement = transaksiPerId.get(e.transaksiCocokId);
    const provisional = transaksiPerId.get(e.provisionalTrxId);
    return Boolean(statement && provisional
      && provisional.sumber === SUMBER.EMAIL_PROVISIONAL
      && tautanSah(e, statement, akunMap.get(statement.accountId)));
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
 * Tautan manual yang tidak sah (lihat tautanSah) -- ke baris provisional,
 * ke baris yang sudah tidak ada, ke arah berlawanan, atau ke bank lain.
 * Murni, diekspor untuk tes; dijalankan oleh perbaikiTautanManualSalah().
 * Hanya tautan manual yang disentuh: tautan otomatis sudah melewati
 * cocokkanTransaksiEmail().
 */
export function rencanakanPerbaikiTautanManual(emailLokal, transaksiPerId, akunMap = new Map()) {
  return (emailLokal || []).filter((e) => {
    if (e.statusCocok !== STATUS_COCOK_EMAIL.MATCHED || e.alasanCocok !== 'manual_link') return false;
    const statement = transaksiPerId.get(e.transaksiCocokId);
    return !tautanSah(e, statement, statement ? akunMap.get(statement.accountId) : null);
  });
}
