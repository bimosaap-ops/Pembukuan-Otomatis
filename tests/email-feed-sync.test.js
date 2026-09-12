/**
 * Tes bagian murni src/services/email-feed-sync.js (Fase 7 Realtime Email
 * Transaction Feed): rentangTanggalKandidat() dan bangunPembaruanEmailTrx().
 * Orkestrator utama (`tarikTransaksiEmail`) sengaja TIDAK diuji langsung di
 * sini — menyentuh IndexedDB (email-transactions, transactions, categories,
 * merchant-dictionary) dan jaringan (webhook), mengikuti pola yang sama
 * dengan `syncKeSheets`/`syncAtauAntri` di sheets-sync.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rentangTanggalKandidat, bangunPembaruanEmailTrx } from '../src/services/email-feed-sync.js';
import { STATUS_COCOK_EMAIL } from '../src/domain/entities.js';
import { KEYAKINAN_KATEGORI_EMAIL } from '../src/domain/kategoriEmail.js';

test('rentangTanggalKandidat: waktu tidak valid mengembalikan null', () => {
  assert.equal(rentangTanggalKandidat(''), null);
  assert.equal(rentangTanggalKandidat('bukan-tanggal'), null);
  assert.equal(rentangTanggalKandidat(undefined), null);
});

test('rentangTanggalKandidat: rentang bawaan +-2 hari dari waktu transaksi', () => {
  const hasil = rentangTanggalKandidat('2025-07-05T10:00:00.000Z');
  assert.equal(hasil.dari, '2025-07-03');
  assert.equal(hasil.sampai, '2025-07-07');
});

test('rentangTanggalKandidat: jendela bisa dioverride pemanggil', () => {
  const hasil = rentangTanggalKandidat('2025-07-05T10:00:00.000Z', 1);
  assert.equal(hasil.dari, '2025-07-04');
  assert.equal(hasil.sampai, '2025-07-06');
});

test('rentangTanggalKandidat: rentang tetap benar melewati batas bulan/tahun', () => {
  const hasil = rentangTanggalKandidat('2025-01-01T00:00:00.000Z');
  assert.equal(hasil.dari, '2024-12-30');
  assert.equal(hasil.sampai, '2025-01-03');
});

test('bangunPembaruanEmailTrx: menggabungkan hasil cocok+saran ke field yang benar, mempertahankan field asli trx', () => {
  const trx = { id: 'trxe_1', gmailMessageId: 'msg_1', merchantMentah: 'WARUNG SATE BAROKAH' };
  const cocok = { status: STATUS_COCOK_EMAIL.MATCHED, kandidatId: 'trx_abc', skor: 90, alasan: 'amount_exact;direction_exact' };
  const saran = { kategoriId: 'kat_makan', keyakinan: KEYAKINAN_KATEGORI_EMAIL.SEDANG, merchantKey: 'WARUNG SATE BAROKAH' };

  const hasil = bangunPembaruanEmailTrx(trx, 'WARUNG SATE BAROKAH', cocok, saran);

  assert.equal(hasil.id, 'trxe_1', 'id asli dipertahankan supaya simpanSatu memperbarui baris yang sama, bukan bikin baru');
  assert.equal(hasil.gmailMessageId, 'msg_1');
  assert.equal(hasil.merchantKey, 'WARUNG SATE BAROKAH');
  assert.equal(hasil.statusCocok, STATUS_COCOK_EMAIL.MATCHED);
  assert.equal(hasil.transaksiCocokId, 'trx_abc');
  assert.equal(hasil.skorCocok, 90);
  assert.equal(hasil.alasanCocok, 'amount_exact;direction_exact');
  assert.equal(hasil.kategoriSaran, 'kat_makan');
  assert.equal(hasil.confidenceKategori, KEYAKINAN_KATEGORI_EMAIL.SEDANG);
});

test('bangunPembaruanEmailTrx: kandidatId null (missing/ambiguous) disimpan sebagai string kosong, bukan "null"', () => {
  const trx = { id: 'trxe_2' };
  const cocok = { status: STATUS_COCOK_EMAIL.MISSING, kandidatId: null, skor: 0, alasan: 'no_candidate_in_time_window' };
  const saran = { kategoriId: 'kat_lain_keluar', keyakinan: KEYAKINAN_KATEGORI_EMAIL.RENDAH, merchantKey: '' };

  const hasil = bangunPembaruanEmailTrx(trx, '', cocok, saran);

  assert.equal(hasil.transaksiCocokId, '');
  assert.equal(hasil.statusCocok, STATUS_COCOK_EMAIL.MISSING);
});
