/**
 * Tes buatTransaksiEmail() — fungsi murni di src/domain/entities.js, bagian
 * data model Fase 4 Realtime Email Transaction Feed. Repo yang memakainya
 * (src/data/repo/email-transactions.js) sengaja TIDAK diuji langsung di
 * sini — seluruh tes di repo ini menghindari pemalsu IndexedDB, mengikuti
 * pola yang sama dengan repo/transactions.js dan repo/categories.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buatTransaksiEmail, STATUS_COCOK_EMAIL, STATUS_RESOLUSI_EMAIL } from '../src/domain/entities.js';

test('buatTransaksiEmail: nilai bawaan aman dipakai tanpa satu field pun diisi', () => {
  const t = buatTransaksiEmail();
  assert.ok(t.id.startsWith('trxe_'), 'id harus berprefiks trxe_ mengikuti pola buatTransaksi (trx_)/buatAkun (acc_)');
  assert.equal(t.gmailMessageId, '');
  assert.equal(t.nominal, 0);
  assert.equal(t.statusCocok, '', 'string kosong = belum pernah diperiksa, bukan status yang menebak');
  assert.equal(t.merchantKey, '', 'kosong = belum dinormalisasi, bukan berarti merchant tidak dikenal');
  assert.equal(t.skorCocok, null);
  assert.equal(t.overrideUser, false);
  assert.equal(t.statusResolusi, STATUS_RESOLUSI_EMAIL.TERBUKA);
  assert.ok(t.dibuatPada, 'dibuatPada harus terisi otomatis kalau tidak diberikan');
});

test('buatTransaksiEmail: field yang diberikan dipertahankan apa adanya', () => {
  const t = buatTransaksiEmail({
    id: 'trxe_tetap',
    gmailMessageId: 'msg_1',
    bank: 'BCA',
    nominal: '99000', // sengaja string, harus dikonversi ke number
    arah: 'debit',
    merchantMentah: 'Warung Sate Solo Barokah',
    rrn: '315108853',
    statusCocok: STATUS_COCOK_EMAIL.MATCHED,
    transaksiCocokId: 'trx_abc',
    skorCocok: '85',
  });

  assert.equal(t.id, 'trxe_tetap');
  assert.equal(t.gmailMessageId, 'msg_1');
  assert.equal(t.nominal, 99000, 'nominal string harus dikonversi ke number, sama seperti buatTransaksi');
  assert.equal(t.bank, 'BCA');
  assert.equal(t.merchantMentah, 'Warung Sate Solo Barokah');
  assert.equal(t.rrn, '315108853');
  assert.equal(t.statusCocok, STATUS_COCOK_EMAIL.MATCHED);
  assert.equal(t.transaksiCocokId, 'trx_abc');
  assert.equal(t.skorCocok, 85);
});

test('buatTransaksiEmail: dua pemanggilan tanpa id menghasilkan id yang berbeda', () => {
  const a = buatTransaksiEmail();
  const b = buatTransaksiEmail();
  assert.notEqual(a.id, b.id);
});

test('STATUS_COCOK_EMAIL dan STATUS_RESOLUSI_EMAIL: nilai berbeda satu sama lain (tidak ada string kembar antar status)', () => {
  const semuaCocok = Object.values(STATUS_COCOK_EMAIL);
  assert.equal(new Set(semuaCocok).size, semuaCocok.length);
  const semuaResolusi = Object.values(STATUS_RESOLUSI_EMAIL);
  assert.equal(new Set(semuaResolusi).size, semuaResolusi.length);
});
