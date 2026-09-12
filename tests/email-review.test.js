/**
 * Tes bagian murni src/services/email-review.js: bangunEksporTinjauan(),
 * validasiKeputusan(), terapkanSatuKeputusan(). Pasangan fitur "Ekspor
 * untuk Ditinjau"/"Terapkan Hasil Tinjauan" untuk membantu menyelesaikan
 * transaksi email "Perlu Ditinjau"/"Tidak Cocok" secara massal (mis.
 * setelah backfill besar menghasilkan puluhan exception sekaligus).
 *
 * eksporUntukTinjauan()/terapkanHasilTinjauan() sendiri sengaja TIDAK
 * diuji langsung di sini -- menyentuh IndexedDB lewat repo, konsisten
 * dengan konvensi tes repo ini (lihat email-feed-sync.test.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bangunEksporTinjauan, validasiKeputusan, terapkanSatuKeputusan,
} from '../src/services/email-review.js';
import { STATUS_COCOK_EMAIL, STATUS_RESOLUSI_EMAIL } from '../src/domain/entities.js';

test('bangunEksporTinjauan: menyusun transaksiEmail dan kandidatStatement sesuai bentuk yang diharapkan', () => {
  const daftar = [{
    id: 'trxe_1', gmailMessageId: 'msg_1', bank: 'BCA', waktuTransaksi: '2026-08-05T10:00:00.000Z',
    nominal: 50000, arah: 'debit', merchantMentah: 'WARUNG SATE', statusCocok: STATUS_COCOK_EMAIL.AMBIGUOUS,
    transaksiCocokId: '', skorCocok: 20, alasanCocok: 'confidence_insufficient',
  }];
  const kandidatMap = new Map([
    ['trx_a', { id: 'trx_a', tanggal: '2026-08-05', deskripsi: 'QRIS WARUNG SATE', nominal: -50000, accountId: 'acc_1' }],
  ]);

  const hasil = bangunEksporTinjauan(daftar, kandidatMap);

  assert.ok(hasil.dibuatPada, 'dibuatPada harus terisi otomatis');
  assert.equal(hasil.transaksiEmail.length, 1);
  assert.equal(hasil.transaksiEmail[0].gmailMessageId, 'msg_1');
  assert.equal(hasil.transaksiEmail[0].statusCocok, STATUS_COCOK_EMAIL.AMBIGUOUS);
  assert.equal(hasil.kandidatStatement.length, 1);
  assert.equal(hasil.kandidatStatement[0].id, 'trx_a');
  assert.equal(hasil.kandidatStatement[0].nominal, -50000);
});

test('bangunEksporTinjauan: daftar/kandidat kosong menghasilkan array kosong, bukan error', () => {
  const hasil = bangunEksporTinjauan([], new Map());
  assert.deepEqual(hasil.transaksiEmail, []);
  assert.deepEqual(hasil.kandidatStatement, []);
});

test('bangunEksporTinjauan: transaksiCocokId/alasanCocok kosong tetap string kosong, bukan null/undefined', () => {
  const daftar = [{
    id: 'trxe_2', gmailMessageId: 'msg_2', bank: 'BCA', waktuTransaksi: '2026-08-06T10:00:00.000Z',
    nominal: 20000, arah: 'debit', merchantMentah: 'KOPI', statusCocok: STATUS_COCOK_EMAIL.MISSING,
    transaksiCocokId: null, skorCocok: 0, alasanCocok: null,
  }];
  const hasil = bangunEksporTinjauan(daftar, new Map());
  assert.equal(hasil.transaksiEmail[0].transaksiCocokId, '');
  assert.equal(hasil.transaksiEmail[0].alasanCocok, '');
});

test('validasiKeputusan: keputusan lengkap dengan aksi tautkan valid', () => {
  const hasil = validasiKeputusan({ gmailMessageId: 'msg_1', aksi: 'tautkan', transaksiCocokId: 'trx_a' });
  assert.equal(hasil.valid, true);
});

test('validasiKeputusan: aksi selesai/abaikan valid tanpa transaksiCocokId', () => {
  assert.equal(validasiKeputusan({ gmailMessageId: 'msg_1', aksi: 'selesai' }).valid, true);
  assert.equal(validasiKeputusan({ gmailMessageId: 'msg_1', aksi: 'abaikan' }).valid, true);
});

test('validasiKeputusan: aksi tautkan TANPA transaksiCocokId tidak valid', () => {
  const hasil = validasiKeputusan({ gmailMessageId: 'msg_1', aksi: 'tautkan' });
  assert.equal(hasil.valid, false);
  assert.match(hasil.error, /transaksiCocokId/);
});

test('validasiKeputusan: gmailMessageId kosong tidak valid', () => {
  const hasil = validasiKeputusan({ gmailMessageId: '', aksi: 'selesai' });
  assert.equal(hasil.valid, false);
});

test('validasiKeputusan: aksi tidak dikenal tidak valid', () => {
  const hasil = validasiKeputusan({ gmailMessageId: 'msg_1', aksi: 'hapus' });
  assert.equal(hasil.valid, false);
  assert.match(hasil.error, /aksi harus salah satu dari/);
});

test('validasiKeputusan: input bukan objek (null/array/string) ditolak dengan jelas', () => {
  assert.equal(validasiKeputusan(null).valid, false);
  assert.equal(validasiKeputusan(undefined).valid, false);
  assert.equal(validasiKeputusan('msg_1').valid, false);
});

test('terapkanSatuKeputusan: aksi tautkan mengisi statusCocok/transaksiCocokId/alasanCocok, mengosongkan skorCocok', () => {
  const trx = { id: 'trxe_1', statusCocok: STATUS_COCOK_EMAIL.AMBIGUOUS, skorCocok: 20, statusResolusi: STATUS_RESOLUSI_EMAIL.TERBUKA };
  const hasil = terapkanSatuKeputusan(trx, { gmailMessageId: 'msg_1', aksi: 'tautkan', transaksiCocokId: 'trx_a', alasan: 'cocok manual' });

  assert.equal(hasil.id, 'trxe_1', 'id asli dipertahankan supaya simpanSatu memperbarui baris yang sama');
  assert.equal(hasil.statusCocok, STATUS_COCOK_EMAIL.MATCHED);
  assert.equal(hasil.transaksiCocokId, 'trx_a');
  assert.equal(hasil.alasanCocok, 'cocok manual');
  assert.equal(hasil.skorCocok, null);
  assert.equal(hasil.statusResolusi, STATUS_RESOLUSI_EMAIL.TERBUKA, 'statusResolusi tidak ikut berubah oleh aksi tautkan');
});

test('terapkanSatuKeputusan: aksi tautkan tanpa alasan eksplisit -> alasanCocok default "tinjauan_manual"', () => {
  const trx = { id: 'trxe_1', statusCocok: STATUS_COCOK_EMAIL.AMBIGUOUS };
  const hasil = terapkanSatuKeputusan(trx, { gmailMessageId: 'msg_1', aksi: 'tautkan', transaksiCocokId: 'trx_a' });
  assert.equal(hasil.alasanCocok, 'tinjauan_manual');
});

test('terapkanSatuKeputusan: aksi selesai hanya mengubah statusResolusi, statusCocok/transaksiCocokId tidak disentuh', () => {
  const trx = { id: 'trxe_1', statusCocok: STATUS_COCOK_EMAIL.MISMATCH, transaksiCocokId: 'trx_a', statusResolusi: STATUS_RESOLUSI_EMAIL.TERBUKA };
  const hasil = terapkanSatuKeputusan(trx, { gmailMessageId: 'msg_1', aksi: 'selesai' });

  assert.equal(hasil.statusResolusi, STATUS_RESOLUSI_EMAIL.DISELESAIKAN);
  assert.equal(hasil.statusCocok, STATUS_COCOK_EMAIL.MISMATCH, 'statusCocok mismatch tetap dipertahankan apa adanya');
  assert.equal(hasil.transaksiCocokId, 'trx_a');
});

test('terapkanSatuKeputusan: aksi abaikan hanya mengubah statusResolusi jadi diabaikan', () => {
  const trx = { id: 'trxe_1', statusCocok: STATUS_COCOK_EMAIL.MISSING, statusResolusi: STATUS_RESOLUSI_EMAIL.TERBUKA };
  const hasil = terapkanSatuKeputusan(trx, { gmailMessageId: 'msg_1', aksi: 'abaikan' });

  assert.equal(hasil.statusResolusi, STATUS_RESOLUSI_EMAIL.DIABAIKAN);
  assert.equal(hasil.statusCocok, STATUS_COCOK_EMAIL.MISSING);
});
