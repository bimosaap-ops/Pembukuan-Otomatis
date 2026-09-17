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
import { rentangTanggalKandidat } from '../core/dates.js';
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
 * Buat baris ledger PROVISIONAL dari satu transaksi email berstatus MISSING
 * (tidak ada padanan e-statement sama sekali). Dipanggil dari
 * email-feed-sync.js SETELAH email itu sendiri sudah tersimpan di
 * `email_transactions` (butuh `trxEmail.id` yang sudah final).
 */
export async function buatProvisionalDariEmail(trxEmail, daftarKategori, kamusMap) {
  const akun = await resolusiAkunEmail(trxEmail);
  const magnitudo = Math.abs(Number(trxEmail.nominal) || 0);
  const nominalBertanda = trxEmail.arah === 'debit' ? -magnitudo : magnitudo;
  const tanggal = String(trxEmail.waktuTransaksi || '').slice(0, 10);
  const deskripsi = trxEmail.merchantMentah || `Transaksi ${trxEmail.bank || ''}`.trim();

  const saran = sarankanKategoriEmail(trxEmail, kamusMap, daftarKategori);
  const kategoriId = trxEmail.overrideUser ? trxEmail.kategoriFinal : saran.kategoriId;

  const baseHash = await hitungBaseHash({
    accountId: akun.id, tanggal, deskripsi, nominal: nominalBertanda,
  });

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
  await akunRepo.hitungUlangSaldo(akun.id);
  await emailTrxRepo.simpanSatu({ ...trxEmail, provisionalTrxId: disimpan.id });

  // Sheets: latar belakang, tidak pernah ditunggu -- pola sama persis dengan
  // ingest.js/transaksi.js (kegagalan jaringan tidak boleh menunda apa pun
  // yang sudah tersimpan lokal).
  Promise.all([akunRepo.peta(), kategoriRepo.peta()])
    .then(([akunMap, kategoriMap]) => syncAtauAntri([disimpan], akunMap, kategoriMap))
    .catch((e) => console.warn('Sheets sync provisional gagal:', e));

  return disimpan;
}

/**
 * Ganti baris provisional milik `trxEmail` dengan baris statement asli
 * (`trxStatement`) yang baru dikonfirmasi cocok -- hapus provisional-nya
 * (lokal + Sheets), tandai email trx sebagai benar-benar MATCHED. TIDAK
 * memanggil hitungUlangSaldo di sini: pemanggil (rekonsiliasiSetelahUpload)
 * yang mengumpulkan seluruh akun tersentuh lalu menghitung ulang SEKALI di
 * akhir, supaya tidak ada window saldo dihitung dari state yang belum tuntas.
 * @returns {string|null} accountId baris provisional yang barusan dihapus
 */
async function gantikanProvisional(trxEmail, trxStatement) {
  const provisional = trxEmail.provisionalTrxId ? await trxRepo.satu(trxEmail.provisionalTrxId) : null;
  let accountIdTersentuh = null;

  if (provisional) {
    await trxRepo.hapusTransaksi(provisional.id);
    hapusDariSheets([provisional.hash]).catch((e) => console.warn('Hapus provisional di Sheets gagal:', e));
    accountIdTersentuh = provisional.accountId;
  }

  await emailTrxRepo.simpanSatu({
    ...trxEmail,
    statusCocok: STATUS_COCOK_EMAIL.MATCHED,
    transaksiCocokId: trxStatement.id,
    provisionalTrxId: '',
  });

  return accountIdTersentuh;
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

  for (const { trxEmail, trxStatement, cocok } of rencana) {
    if (cocok.status === STATUS_COCOK_EMAIL.MATCHED) {
      const accountIdLama = await gantikanProvisional(trxEmail, trxStatement);
      if (accountIdLama) hasil.akunTersentuh.add(accountIdLama);
      hasil.digantikan += 1;
    } else {
      await tandaiSengketa(trxEmail, trxStatement, cocok);
      hasil.disengketakan += 1;
    }
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

  for (const trxEmail of kandidatEmail) {
    const rentang = rentangTanggalKandidat(trxEmail.waktuTransaksi);
    const kandidatMentah = rentang ? await trxRepo.rentangTanggal(rentang.dari, rentang.sampai) : [];
    const kandidatStatement = kandidatMentah.filter((k) => k.sumber !== SUMBER.EMAIL_PROVISIONAL);
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

    const disimpan = await buatProvisionalDariEmail(trxEmail, daftarKategori, kamusMap);
    dibuat += 1;

    if (cocok.status !== STATUS_COCOK_EMAIL.MISSING) {
      // Near-miss (MISMATCH/AMBIGUOUS) -- tandai sengketa dari awal, persis
      // tandaiSengketa() yang dipanggil rekonsiliasi biasa, supaya baris ini
      // langsung kelihatan perlu ditinjau alih-alih seolah baru & belum dicek.
      await trxRepo.simpanSatu({ ...disimpan, statusProvisional: STATUS_PROVISIONAL.DISENGKETAKAN });
      await emailTrxRepo.simpanSatu({
        ...trxEmail,
        provisionalTrxId: disimpan.id,
        statusCocok: cocok.status,
        transaksiCocokId: cocok.kandidatId || '',
        skorCocok: cocok.skor,
        alasanCocok: cocok.alasan,
      });
    }
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
