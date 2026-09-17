/**
 * Tes bagian murni src/services/email-ledger-merge.js ("Fase C" — gabung
 * ledger Transaksi + Transaksi Email tanpa dobel). Fungsi yang menyentuh
 * repo (buatProvisionalDariEmail, rekonsiliasiSetelahUpload, dst.) sengaja
 * tidak diuji di sini — mengikuti pola yang sama dengan seluruh tes lain di
 * repo ini (lihat migrasi.test.js, entitas-sync.test.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { kunciSettingAkunBca, rencanakanRekonsiliasi, putuskanAksiBackfill } from '../src/services/email-ledger-merge.js';
import { KUNCI } from '../src/data/repo/settings.js';
import { STATUS_COCOK_EMAIL } from '../src/domain/entities.js';

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
