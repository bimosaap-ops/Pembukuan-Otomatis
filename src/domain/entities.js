/**
 * Bentuk entitas dan nilai bawaannya. Modul murni — tidak menyentuh database.
 */

import { idBaru } from '../core/hash.js';
import { hariIni } from '../core/dates.js';

export const JENIS_AKUN = { BANK: 'bank', KAS: 'kas' };

/** Nomor urut untuk transaksi yang tidak berasal dari baris statement. */
export const URUTAN_MANUAL = 1000000;
export const SUMBER = { PDF: 'pdf', MANUAL: 'manual', EMAIL_PROVISIONAL: 'email_provisional' };
/**
 * Status baris ledger ber-`sumber: SUMBER.EMAIL_PROVISIONAL` ("Fase C" — lihat
 * services/email-ledger-merge.js): kosong untuk transaksi biasa (PDF/manual).
 * "aktif" = belum ada e-statement yang mengonfirmasi/menggantikannya sama
 * sekali. "disengketakan" = e-statement sudah datang tapi nominal/arahnya
 * tidak cocok (MISMATCH/AMBIGUOUS) — baris DIBIARKAN apa adanya (saldo tidak
 * boleh diam-diam berubah), menunggu keputusan manual lewat halaman
 * "Transaksi Email".
 */
export const STATUS_PROVISIONAL = { AKTIF: 'aktif', DISENGKETAKAN: 'disengketakan' };
export const TIPE_KATEGORI = { PEMASUKAN: 'pemasukan', PENGELUARAN: 'pengeluaran' };
export const STATUS_UPLOAD = { SUKSES: 'sukses', SEBAGIAN: 'sebagian', GAGAL: 'gagal' };

export const BANK_DIKENAL = [
  'BCA', 'Permata', 'Mandiri', 'BRI', 'BNI', 'CIMB Niaga', 'Danamon',
  'BTN', 'Panin', 'OCBC', 'Maybank', 'Jago', 'SeaBank', 'Blu', 'Jenius', 'Lainnya',
];

export function buatAkun(data = {}) {
  return {
    id: data.id || idBaru('acc'),
    bank: data.bank || '',
    nomorRekening: String(data.nomorRekening || '').trim(),
    namaPemilik: data.namaPemilik || '',
    mataUang: data.mataUang || 'IDR',
    jenis: data.jenis || JENIS_AKUN.BANK,
    saldoAwal: Number(data.saldoAwal) || 0,
    /* Dihitung ulang dari transaksi; disimpan agar daftar rekening tidak perlu
       memindai seluruh transaksi setiap kali dibuka. */
    saldo: Number(data.saldo) || 0,
    jumlahTransaksi: Number(data.jumlahTransaksi) || 0,
    warna: data.warna || '',
    catatan: data.catatan || '',
    dibuatPada: data.dibuatPada || new Date().toISOString(),
    /* Dipakai sync ke Google Sheets untuk resolusi konflik last-updated-wins
       (lihat services/entitas-sync.js) — bukan diisi di sini, sengaja hanya
       diteruskan apa adanya. repo/accounts.js yang menstempelnya ke waktu
       sekarang setiap kali pengguna benar-benar menyimpan lewat halaman
       Rekening, supaya pemanggil lain (mis. hitungUlangSaldo, atau saat
       menerapkan baris hasil pull) tidak ikut menganggapnya "baru diubah". */
    diubahPada: data.diubahPada || '',
  };
}

export function buatTransaksi(data = {}) {
  const nominal = Number(data.nominal) || 0;
  return {
    id: data.id || idBaru('trx'),
    /* `hash` unik per transaksi (baseHash + nomor urut kejadian);
       `baseHash` sama untuk transaksi kembar dan dipakai menghitung duplikat. */
    hash: data.hash || '',
    baseHash: data.baseHash || '',
    accountId: data.accountId || '',
    tanggal: data.tanggal || hariIni(),
    deskripsi: data.deskripsi || '',
    deskripsiRaw: data.deskripsiRaw || data.deskripsi || '',
    /* `nominal` adalah sumber kebenaran (positif = masuk, negatif = keluar);
       `debit`/`kredit` disimpan agar tampilan tabel dan export tidak perlu menghitung ulang. */
    nominal,
    debit: nominal < 0 ? Math.abs(nominal) : 0,
    kredit: nominal > 0 ? nominal : 0,
    saldo: data.saldo === null || data.saldo === undefined ? null : Number(data.saldo),
    kategoriId: data.kategoriId || '',
    transferInternal: Boolean(data.transferInternal),
    sumber: data.sumber || SUMBER.MANUAL,
    uploadedFileId: data.uploadedFileId || '',
    /* Posisi baris di dalam statement asalnya. IndexedDB mengembalikan record
       menurut kunci primer yang acak, jadi tanpa nomor urut ini transaksi yang
       bertanggal sama akan tersusun sembarang — dan saldo rekening bisa terambil
       dari baris yang salah. Transaksi manual memakai nilai besar supaya jatuh
       sesudah baris statement pada tanggal yang sama. */
    urutan: Number.isFinite(Number(data.urutan)) ? Number(data.urutan) : URUTAN_MANUAL,
    catatan: data.catatan || '',
    /* "Fase C": id record email_transactions yang melahirkan baris provisional
       ini (sumber === SUMBER.EMAIL_PROVISIONAL) -- kosong untuk transaksi
       PDF/manual biasa. Dipakai email-ledger-merge.js untuk menemukan baris
       ledger yang harus digantikan/ditandai sengketa saat e-statement datang. */
    emailTrxId: data.emailTrxId || '',
    /* "Fase C": lihat STATUS_PROVISIONAL -- kosong untuk transaksi bukan
       email_provisional. */
    statusProvisional: data.statusProvisional || '',
    dibuatPada: data.dibuatPada || new Date().toISOString(),
    diubahPada: data.diubahPada || '',
  };
}

export function buatFileUpload(data = {}) {
  return {
    id: data.id || idBaru('upl'),
    namaFile: data.namaFile || '',
    bank: data.bank || '',
    nomorRekening: data.nomorRekening || '',
    accountId: data.accountId || '',
    periodeAwal: data.periodeAwal || '',
    periodeAkhir: data.periodeAkhir || '',
    tanggalUpload: data.tanggalUpload || new Date().toISOString(),
    jumlahTransaksi: Number(data.jumlahTransaksi) || 0,
    berhasil: Number(data.berhasil) || 0,
    duplikat: Number(data.duplikat) || 0,
    status: data.status || STATUS_UPLOAD.SUKSES,
    catatan: data.catatan || '',
    fileHash: data.fileHash || '',
    ukuran: Number(data.ukuran) || 0,
  };
}

export function buatKategori(data = {}) {
  return {
    id: data.id || idBaru('kat'),
    nama: data.nama || '',
    tipe: data.tipe || TIPE_KATEGORI.PENGELUARAN,
    warna: data.warna || 'var(--c1)',
    ikon: data.ikon || '🏷',
    polaKataKunci: Array.isArray(data.polaKataKunci) ? data.polaKataKunci : [],
    /* Menentukan siapa yang menang bila satu deskripsi cocok dengan beberapa kategori.
       Kata kunci transfer sengaja berprioritas rendah karena sangat umum. */
    prioritas: data.prioritas === undefined ? 50 : Number(data.prioritas),
    bawaan: Boolean(data.bawaan),
    urutan: Number(data.urutan) || 0,
    dibuatPada: data.dibuatPada || new Date().toISOString(),
    /* Lihat catatan diubahPada di buatAkun() — pola yang sama persis. */
    diubahPada: data.diubahPada || '',
  };
}

/** Kategori penampung saat tidak ada aturan yang cocok. */
export const KATEGORI_LAINNYA_MASUK = 'kat_lain_masuk';
export const KATEGORI_LAINNYA_KELUAR = 'kat_lain_keluar';

/**
 * Status pencocokan transaksi email terhadap transaksi e-statement yang
 * sudah ada — hasil src/domain/rekonsiliasiEmail.js (fase berikutnya).
 * String kosong berarti belum pernah diperiksa sama sekali.
 */
export const STATUS_COCOK_EMAIL = {
  MATCHED: 'matched',
  MISSING: 'missing',
  MISMATCH: 'mismatch',
  AMBIGUOUS: 'ambiguous',
};

/** Keputusan pengguna atas satu transaksi email di dashboard exception (fase berikutnya). */
export const STATUS_RESOLUSI_EMAIL = {
  TERBUKA: 'terbuka',
  DISELESAIKAN: 'diselesaikan',
  DIABAIKAN: 'diabaikan',
};

/**
 * Transaksi hasil parse email bank (Realtime Email Transaction Feed),
 * ditarik dari tab "Transaksi Email" di Sheet. Field mengikuti field
 * `bangunBarisTarikTransaksiEmail()` di sheets/Code.gs (bank, waktuTransaksi,
 * nominal, arah, merchantMentah, jenisTransaksi, acquirer, lokasi, rrn,
 * nomorReferensi, versiParser, confidence) plus field yang genuinely baru di
 * sisi PWA: hasil rekonsiliasi dan kategorisasi (diisi fase berikutnya,
 * `''`/`null` berarti belum diproses — bukan default yang salah/menebak).
 */
export function buatTransaksiEmail(data = {}) {
  return {
    id: data.id || idBaru('trxe'),
    gmailMessageId: data.gmailMessageId || '',
    bank: data.bank || '',
    waktuTransaksi: data.waktuTransaksi || '',
    nominal: Number(data.nominal) || 0,
    arah: data.arah || '',
    merchantMentah: data.merchantMentah || '',
    /* Diisi merchantNormalisasi() (fase berikutnya) -- kosong berarti belum
       pernah dinormalisasi, bukan berarti merchant-nya memang tidak dikenal. */
    merchantKey: data.merchantKey || '',
    jenisTransaksi: data.jenisTransaksi || '',
    acquirer: data.acquirer || '',
    lokasi: data.lokasi || '',
    rrn: data.rrn || '',
    nomorReferensi: data.nomorReferensi || '',
    versiParser: data.versiParser || '',
    confidence: data.confidence || '',
    /* Hasil rekonsiliasiEmail.js. transaksiCocokId murni berarti "matched ke
       baris e-statement ASLI" -- SENGAJA field terpisah dari provisionalTrxId
       di bawah, supaya UI exception (email-transaksi.js) yang sudah membaca
       transaksiCocokId sebagai kandidat e-statement tidak perlu diubah makna. */
    statusCocok: data.statusCocok || '',
    transaksiCocokId: data.transaksiCocokId || '',
    skorCocok: data.skorCocok === null || data.skorCocok === undefined ? null : Number(data.skorCocok),
    alasanCocok: data.alasanCocok || '',
    /* "Fase C": id baris ledger PROVISIONAL (sumber === SUMBER.EMAIL_PROVISIONAL)
       yang dibuat untuk transaksi email ini saat statusCocok === MISSING --
       lihat services/email-ledger-merge.js. Kosong berarti belum pernah
       dibuatkan provisional (mis. status bukan MISSING, atau fitur belum
       aktif lewat pengaturan "emailLedgerMergeAktif"). */
    provisionalTrxId: data.provisionalTrxId || '',
    /* Hasil kategoriEmail.js (fase berikutnya). */
    kategoriSaran: data.kategoriSaran || '',
    kategoriFinal: data.kategoriFinal || '',
    confidenceKategori: data.confidenceKategori || '',
    overrideUser: Boolean(data.overrideUser),
    /* Keputusan pengguna di dashboard exception (fase berikutnya) — beda dari
       statusCocok, lihat PRD §26: status teknis vs keputusan pengguna tidak
       boleh disamakan. */
    statusResolusi: data.statusResolusi || STATUS_RESOLUSI_EMAIL.TERBUKA,
    diselesaikanPada: data.diselesaikanPada || '',
    dibuatPada: data.dibuatPada || new Date().toISOString(),
    diubahPada: data.diubahPada || '',
  };
}
