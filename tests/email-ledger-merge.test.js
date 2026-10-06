/**
 * Tes bagian murni src/services/email-ledger-merge.js ("Fase C" — gabung
 * ledger Transaksi + Transaksi Email tanpa dobel). Fungsi yang menyentuh
 * repo (buatProvisionalDariEmail, rekonsiliasiSetelahUpload, dst.) sengaja
 * tidak diuji di sini — mengikuti pola yang sama dengan seluruh tes lain di
 * repo ini (lihat migrasi.test.js, entitas-sync.test.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  tautanSah, rencanakanSetelahHapus,
  kunciSettingAkunBca, rencanakanRekonsiliasi, putuskanAksiBackfill,
  pilihProvisionalTanpaPemilik, bentukBarisEmail,
} from '../src/services/email-ledger-merge.js';
import { KUNCI } from '../src/data/repo/settings.js';
import { STATUS_COCOK_EMAIL, buatTransaksiEmail } from '../src/domain/entities.js';
import { tanggalWib } from '../src/core/dates.js';

/* ==========================================================================
   kunciSettingAkunBca
   ========================================================================== */

function emailTrx(over = {}) {
  return {
    id: 'trxe_1',
    waktuTransaksi: '2025-07-05T10:00:00.000Z',
    nominal: 50000,
    arah: 'debit',
    merchantMentah: 'WARUNG SATE BAROKAH',
    jenisTransaksi: '',
    acquirer: '',
    lokasi: '',
    ...over,
  };
}

test('kunciSettingAkunBca: default ke akun utama kalau tidak ada penanda RDN', () => {
  assert.equal(kunciSettingAkunBca(emailTrx()), KUNCI.EMAIL_AKUN_UTAMA_BCA);
});

test('kunciSettingAkunBca: "RDN" di merchantMentah -> akun RDN', () => {
  const hasil = kunciSettingAkunBca(emailTrx({ merchantMentah: 'SETOR RDN BCA SEKURITAS' }));
  assert.equal(hasil, KUNCI.EMAIL_AKUN_RDN_BCA);
});

test('kunciSettingAkunBca: "Stockbit" (case-insensitive) di lokasi -> akun RDN', () => {
  const hasil = kunciSettingAkunBca(emailTrx({ lokasi: 'stockbit sekuritas' }));
  assert.equal(hasil, KUNCI.EMAIL_AKUN_RDN_BCA);
});

test('kunciSettingAkunBca: penanda RDN di jenisTransaksi atau acquirer juga terdeteksi', () => {
  assert.equal(kunciSettingAkunBca(emailTrx({ jenisTransaksi: 'Transfer ke RDN' })), KUNCI.EMAIL_AKUN_RDN_BCA);
  assert.equal(kunciSettingAkunBca(emailTrx({ acquirer: 'RDN BCA' })), KUNCI.EMAIL_AKUN_RDN_BCA);
});

test('kunciSettingAkunBca: kata biasa yang kebetulan memuat "rdn" sebagai substring tetap terdeteksi (regex sederhana, disengaja)', () => {
  // Dicatat sebagai batasan yang diterima: heuristik ini sederhana (substring,
  // bukan word-boundary) -- false positive dianggap lebih aman daripada false
  // negative (salah taruh ke rekening RDN vs kehilangan sinyal RDN sungguhan).
  assert.equal(kunciSettingAkunBca(emailTrx({ merchantMentah: 'PT ABERDNESIA JAYA' })), KUNCI.EMAIL_AKUN_RDN_BCA);
});

/* ==========================================================================
   rencanakanRekonsiliasi
   ========================================================================== */

function statement(over = {}) {
  return {
    id: 'trx_stmt_1',
    tanggal: '2025-07-05',
    nominal: -50000,
    deskripsi: 'WARUNG SATE BAROKAH QRIS',
    ...over,
  };
}

test('rencanakanRekonsiliasi: kandidat email yang cocok persis -> MATCHED masuk rencana', () => {
  const rencana = rencanakanRekonsiliasi([statement()], [emailTrx()]);
  assert.equal(rencana.length, 1);
  assert.equal(rencana[0].cocok.status, STATUS_COCOK_EMAIL.MATCHED);
  assert.equal(rencana[0].trxEmail.id, 'trxe_1');
  assert.equal(rencana[0].trxStatement.id, 'trx_stmt_1');
});

test('rencanakanRekonsiliasi: kandidat email di luar jendela tanggal statement -> tidak masuk rencana sama sekali', () => {
  const jauh = emailTrx({ waktuTransaksi: '2025-01-01T10:00:00.000Z' });
  const rencana = rencanakanRekonsiliasi([statement()], [jauh]);
  assert.deepEqual(rencana, []);
});

test('rencanakanRekonsiliasi: nominal jauh beda tapi tanggal statement dalam jendela -> MISMATCH (bukan MISSING), tetap masuk rencana', () => {
  // MISSING di dalam rencanakanRekonsiliasi HANYA terjadi saat kandidat
  // statement-nya kosong sama sekali (di luar jendela tanggal, sudah dicakup
  // tes di atas) -- begitu ada minimal satu kandidat dalam jendela,
  // cocokkanTransaksiEmail() selalu memutuskan MATCHED/MISMATCH/AMBIGUOUS,
  // tidak pernah MISSING lagi, walau nominalnya jauh berbeda.
  const beda = emailTrx({ nominal: 999999 });
  const rencana = rencanakanRekonsiliasi([statement()], [beda]);
  assert.equal(rencana.length, 1);
  assert.equal(rencana[0].cocok.status, STATUS_COCOK_EMAIL.MISMATCH);
});

test('rencanakanRekonsiliasi: nominal/arah beda -> MISMATCH tetap masuk rencana (bukan diabaikan)', () => {
  const beda = emailTrx({ nominal: 75000 });
  const rencana = rencanakanRekonsiliasi([statement()], [beda]);
  assert.equal(rencana.length, 1);
  assert.equal(rencana[0].cocok.status, STATUS_COCOK_EMAIL.MISMATCH);
});

test('rencanakanRekonsiliasi: constraint one-to-one -- begitu satu statement MATCHED, tidak lagi jadi kandidat untuk transaksi email lain di batch yang sama', () => {
  const stmt = statement(); // satu-satunya baris statement baru
  const emailPertama = emailTrx({ id: 'trxe_1' }); // cocok kuat dengan stmt
  // Merchant & nominal sama sekali tidak berhubungan -- andai stmt masih
  // tersedia, ini akan MISMATCH; tapi karena stmt sudah "habis" dipakai
  // emailPertama, emailKedua tidak punya kandidat sama sekali (bukan
  // dievaluasi lalu ditolak -- benar-benar tidak dilirik).
  const emailKedua = emailTrx({ id: 'trxe_2', merchantMentah: 'TOKO LAIN TIDAK NYAMBUNG', nominal: 999999 });

  const rencana = rencanakanRekonsiliasi([stmt], [emailPertama, emailKedua]);

  assert.equal(rencana.length, 1);
  assert.equal(rencana[0].trxEmail.id, 'trxe_1');
  assert.equal(rencana[0].trxStatement.id, stmt.id);
});

test('rencanakanRekonsiliasi: dua kandidat statement sama persis untuk satu email -> AMBIGUOUS (bukan menebak salah satu)', () => {
  const email = emailTrx();
  const statementSama1 = statement({ id: 'trx_stmt_1' });
  const statementSama2 = statement({ id: 'trx_stmt_2' }); // baris lain, kebetulan identik

  const rencana = rencanakanRekonsiliasi([statementSama1, statementSama2], [email]);

  assert.equal(rencana.length, 1);
  assert.equal(rencana[0].cocok.status, STATUS_COCOK_EMAIL.AMBIGUOUS);
  // Krusial: cocokkanTransaksiEmail sengaja tidak menunjuk kandidat (kandidatId
  // null) karena skor stmt1 dan stmt2 sama persis -- rencanakanRekonsiliasi
  // TIDAK BOLEH menebak salah satunya sebagai trxStatement, karena itu akan
  // berakhir sebagai transaksiCocokId palsu (lihat tandaiSengketa()).
  assert.equal(rencana[0].trxStatement, null);
});

test('rencanakanRekonsiliasi: dua transaksi email independen masing-masing dapat baris statement sendiri', () => {
  const emailA = emailTrx({ id: 'trxe_a', merchantMentah: 'TOKO A' });
  const emailB = emailTrx({ id: 'trxe_b', merchantMentah: 'TOKO B', nominal: 20000 });
  const stmtA = statement({ id: 'stmt_a', deskripsi: 'TOKO A QRIS' });
  const stmtB = statement({ id: 'stmt_b', deskripsi: 'TOKO B QRIS', nominal: -20000 });

  const rencana = rencanakanRekonsiliasi([stmtA, stmtB], [emailA, emailB]);

  assert.equal(rencana.length, 2);
  const pasangan = new Set(rencana.map((r) => `${r.trxEmail.id}->${r.trxStatement.id}`));
  assert.ok(pasangan.has('trxe_a->stmt_a'));
  assert.ok(pasangan.has('trxe_b->stmt_b'));
});

test('rencanakanRekonsiliasi: tidak ada baris statement sama sekali -> rencana kosong, tidak error', () => {
  assert.deepEqual(rencanakanRekonsiliasi([], [emailTrx()]), []);
});

test('rencanakanRekonsiliasi: tidak ada kandidat email sama sekali -> rencana kosong, tidak error', () => {
  assert.deepEqual(rencanakanRekonsiliasi([statement()], []), []);
});

/* ==========================================================================
   putuskanAksiBackfill -- backfillProvisionalEmailLama()
   ========================================================================== */

test('putuskanAksiBackfill: MATCHED (sudah ada baris statement asli di ledger sekarang) -> aksi "tautkan", TIDAK buat provisional', () => {
  const { aksi, cocok } = putuskanAksiBackfill(emailTrx(), [statement()]);
  assert.equal(aksi, 'tautkan');
  assert.equal(cocok.status, STATUS_COCOK_EMAIL.MATCHED);
});

test('putuskanAksiBackfill: MISSING (tidak ada kandidat statement dalam jendela) -> aksi "provisional"', () => {
  const { aksi, cocok } = putuskanAksiBackfill(emailTrx(), []);
  assert.equal(aksi, 'provisional');
  assert.equal(cocok.status, STATUS_COCOK_EMAIL.MISSING);
});

test('putuskanAksiBackfill: MISMATCH (nominal beda, bukan padanan asli) -> TETAP "provisional", bukan "tautkan"', () => {
  // Krusial: kandidat statement ADA dan dievaluasi, tapi nominalnya tidak
  // cocok -- ini BUKAN berarti "sudah tercakup ledger", jadi tetap harus
  // dibuatkan baris provisional (nanti ditandai sengketa), sama seperti kalau
  // transaksi ini baru saja ditarik hari ini dan kebetulan tidak ketemu.
  const beda = emailTrx({ nominal: 999999 });
  const { aksi, cocok } = putuskanAksiBackfill(beda, [statement()]);
  assert.equal(aksi, 'provisional');
  assert.equal(cocok.status, STATUS_COCOK_EMAIL.MISMATCH);
});

test('putuskanAksiBackfill: AMBIGUOUS (dua kandidat skor nyaris sama) -> TETAP "provisional", bukan "tautkan"', () => {
  const statementSama1 = statement({ id: 'trx_stmt_1' });
  const statementSama2 = statement({ id: 'trx_stmt_2' });
  const { aksi, cocok } = putuskanAksiBackfill(emailTrx(), [statementSama1, statementSama2]);
  assert.equal(aksi, 'provisional');
  assert.equal(cocok.status, STATUS_COCOK_EMAIL.AMBIGUOUS);
});

/* ==========================================================================
   Adopsi baris provisional lintas id email
   ========================================================================== */

function provisional(over = {}) {
  return {
    id: 'trx_1',
    accountId: 'acc_bca',
    tanggal: '2026-09-28',
    deskripsi: 'Warung kabita',
    nominal: -15000,
    baseHash: 'bh1',
    hash: 'bh1#etrxe_lain',
    emailTrxId: '',
    diubahPada: '2026-10-06T02:17:34.558Z',
    ...over,
  };
}

const emailKabita = emailTrx({
  id: 'trxe_lokal', bank: 'BCA', waktuTransaksi: '2026-09-28T14:52:33.000Z', nominal: 15000, merchantMentah: 'Warung kabita',
});

test('buatTransaksiEmail: id diturunkan dari gmailMessageId supaya sama di semua perangkat', () => {
  assert.equal(buatTransaksiEmail({ gmailMessageId: '1a0e880ed813c1b5' }).id, 'trxe_1a0e880ed813c1b5');
  assert.equal(buatTransaksiEmail({ gmailMessageId: '1a0e880ed813c1b5' }).id,
    buatTransaksiEmail({ gmailMessageId: '1a0e880ed813c1b5' }).id);
});

test('bentukBarisEmail: debit jadi nominal negatif, tanggal dari waktuTransaksi', () => {
  assert.deepEqual(bentukBarisEmail(emailKabita), {
    tanggal: '2026-09-28', tanggalLama: '2026-09-28', deskripsi: 'Warung kabita', nominal: -15000,
  });
});

test('pilihProvisionalTanpaPemilik: baris dari id email asing (hasil tarik Sheets) diadopsi', () => {
  const baris = provisional();
  assert.equal(pilihProvisionalTanpaPemilik([baris], 'trxe_lokal', [emailKabita]), baris);
});

test('pilihProvisionalTanpaPemilik: baris milik email lokal LAIN (transaksi kembar sah) tidak diadopsi', () => {
  const kembar = emailTrx({ id: 'trxe_kembar', provisionalTrxId: 'trx_1' });
  const baris = provisional({ hash: 'bh1#etrxe_kembar', emailTrxId: 'trxe_kembar' });
  assert.equal(pilihProvisionalTanpaPemilik([baris], 'trxe_lokal', [emailKabita, kembar]), null);
});

test('pilihProvisionalTanpaPemilik: dua email kembar mengadopsi dua baris yang berbeda', () => {
  const a = provisional({ id: 'trx_a', hash: 'bh1#etrxe_asingA' });
  const b = provisional({ id: 'trx_b', hash: 'bh1#etrxe_asingB' });
  const e1 = emailTrx({ id: 'trxe_1' });
  const e2 = emailTrx({ id: 'trxe_2' });
  const pertama = pilihProvisionalTanpaPemilik([a, b], 'trxe_1', [e1, e2]);
  assert.equal(pertama, a);
  // Sesudah diadopsi, baris a dipegang trxe_1 -- trxe_2 harus mendapat b.
  const sesudah = [{ ...a, emailTrxId: 'trxe_1' }, b];
  assert.equal(pilihProvisionalTanpaPemilik(sesudah, 'trxe_2', [{ ...e1, provisionalTrxId: 'trx_a' }, e2]), b);
});

/* ==========================================================================
   Tanggal transaksi email: WIB, bukan potongan ISO UTC
   ========================================================================== */

// DIVA QUINTA MAHMUDA, 20 Sep 2026 01:02 WIB = 19 Sep 18:02 UTC.
const emailDiniHari = emailTrx({
  id: 'trxe_diva', bank: 'BCA', waktuTransaksi: '2026-09-19T18:02:47.000Z', nominal: 700000, merchantMentah: 'DIVA QUINTA MAHMUDA',
});

test('tanggalWib: dini hari WIB tetap di tanggal WIB, bukan tanggal UTC', () => {
  assert.equal(tanggalWib('2026-09-19T18:02:47.000Z'), '2026-09-20');
  assert.equal(tanggalWib('2026-09-19T16:59:59.000Z'), '2026-09-19');
  assert.equal(tanggalWib('2026-09-30T17:00:00.000Z'), '2026-10-01', 'pergantian bulan ikut WIB');
  assert.equal(tanggalWib(''), '');
  assert.equal(tanggalWib('bukan-tanggal'), 'bukan-tang');
});

test('bentukBarisEmail: transaksi dini hari memakai tanggal WIB', () => {
  const b = bentukBarisEmail(emailDiniHari);
  assert.equal(b.tanggal, '2026-09-20');
  assert.equal(b.tanggalLama, '2026-09-19');
});

/* --------------------------------------------------------------------------
   tautanSah — satu-satunya gerbang tautan manual (tautkanManual)
   -------------------------------------------------------------------------- */

test('tautanSah: arah, bank, dan sumber harus sesuai', () => {
  const akun = { bank: 'BCA' };
  const debitBca = { arah: 'debit', bank: 'BCA' };
  assert.equal(tautanSah(debitBca, { sumber: 'pdf', nominal: -50000 }, akun), true);
  assert.equal(tautanSah(debitBca, { sumber: 'pdf', nominal: 50000 }, akun), false, 'arah berlawanan');
  assert.equal(tautanSah(debitBca, { sumber: 'email_provisional', nominal: -50000 }, akun), false, 'baris provisional');
  assert.equal(tautanSah({ arah: 'debit', bank: 'Permata' }, { sumber: 'pdf', nominal: -50000 }, akun), false, 'bank lain');
  assert.equal(tautanSah(debitBca, null, akun), false, 'baris tidak ada');
});

/* --------------------------------------------------------------------------
   rencanakanSetelahHapus — email tidak pernah merujuk baris yang sudah hilang
   -------------------------------------------------------------------------- */

const emailRujuk = (id, extra = {}) => ({
  id, statusCocok: STATUS_COCOK_EMAIL.MISSING, statusResolusi: 'terbuka', provisionalTrxId: '', transaksiCocokId: '', ...extra,
});

test('rencanakanSetelahHapus: baris statement dari email MATCHED terhapus -> dinilai ulang sebagai MISSING', () => {
  const e = emailRujuk('e', { statusCocok: STATUS_COCOK_EMAIL.MATCHED, transaksiCocokId: 'pdf1', skorCocok: 90, alasanCocok: 'manual_link' });
  const [r] = rencanakanSetelahHapus([e], new Set(['pdf1']));
  assert.equal(r.aksi, 'evaluasiUlang');
  assert.equal(r.email.statusCocok, STATUS_COCOK_EMAIL.MISSING);
  assert.equal(r.email.transaksiCocokId, '');
  assert.equal(r.email.skorCocok, null);
  assert.equal(r.email.alasanCocok, '');
});

test('rencanakanSetelahHapus: baris provisional terhapus -> rujukan dilepas, tidak dibuat ulang', () => {
  const e = emailRujuk('e', { provisionalTrxId: 'prov1' });
  const [r] = rencanakanSetelahHapus([e], new Set(['prov1']));
  assert.equal(r.aksi, 'tautkanAtauSelesaikan');
  assert.equal(r.email.provisionalTrxId, '');
});

test('rencanakanSetelahHapus: hanya kandidat sengketa yang terhapus -> kandidat dilepas, status tetap', () => {
  const e = emailRujuk('e', { statusCocok: STATUS_COCOK_EMAIL.AMBIGUOUS, transaksiCocokId: 'pdf1', provisionalTrxId: 'prov1' });
  const [r] = rencanakanSetelahHapus([e], new Set(['pdf1']));
  assert.equal(r.aksi, 'lepasKandidat');
  assert.equal(r.email.transaksiCocokId, '');
  assert.equal(r.email.provisionalTrxId, 'prov1');
  assert.equal(r.email.statusCocok, STATUS_COCOK_EMAIL.AMBIGUOUS);
});

test('rencanakanSetelahHapus: email yang tidak merujuk baris terhapus tidak disentuh', () => {
  const daftar = [
    emailRujuk('a', { provisionalTrxId: 'provLain' }),
    emailRujuk('b', { statusCocok: STATUS_COCOK_EMAIL.MATCHED, transaksiCocokId: 'pdfLain' }),
    emailRujuk('c'),
  ];
  assert.deepEqual(rencanakanSetelahHapus(daftar, new Set(['pdf1', 'prov1'])), []);
});
