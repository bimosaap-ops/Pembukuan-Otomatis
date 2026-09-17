/**
 * Tes src/domain/tinjauanOtomatis.js -- analisa tambahan untuk transaksi
 * email "Perlu Ditinjau" (ambiguous) di luar aplikasi, pasangan dari
 * fitur "Ekspor untuk Ditinjau"/"Terapkan Hasil Tinjauan" (email-review.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { analisaTinjauanAmbiguous } from '../src/domain/tinjauanOtomatis.js';

function trx(over = {}) {
  return {
    id: 'e1', gmailMessageId: 'g1', bank: 'BCA', waktuTransaksi: '2026-09-15T12:30:00',
    nominal: 70000, arah: 'debit', merchantMentah: 'GOJEK', statusCocok: 'ambiguous',
    transaksiCocokId: '', skorCocok: 30, alasanCocok: 'confidence_insufficient',
    ...over,
  };
}

test('kandidat menang jelas lewat nominal+arah+merchant -> diusulkan tautkan', () => {
  const data = {
    transaksiEmail: [trx()],
    kandidatStatement: [
      { id: 'k1', tanggal: '2026-09-15', deskripsi: 'GOJEK RIDE JAKARTA', nominal: -70000, accountId: 'a1' },
      { id: 'k2', tanggal: '2026-09-15', deskripsi: 'TRANSFER LAIN TIDAK TERKAIT', nominal: -70000, accountId: 'a1' },
    ],
  };
  const { keputusan, catatan } = analisaTinjauanAmbiguous(data);
  assert.equal(keputusan.length, 1);
  assert.deepEqual(keputusan[0], {
    gmailMessageId: 'g1', aksi: 'tautkan', transaksiCocokId: 'k1', alasan: 'auto_review_merchant_match',
  });
  assert.equal(catatan[0].aksi, 'tautkan');
});

test('satu-satunya kandidat kebetulan nominal+arah sama tapi nama merchant tidak berhubungan -> tetap dilewati, bukan ditautkan', () => {
  // Kasus nyata: "Uda Denai" (warung) kebetulan nominalnya sama persis
  // dengan satu-satunya TOPUP e-wallet di jendela waktu yang sama -- tanpa
  // syarat merchantCocok, ini akan menang cuma lewat skor arah+nominal (3)
  // padahal jelas bukan transaksi yang sama.
  const data = {
    transaksiEmail: [trx({ merchantMentah: 'Uda Denai', nominal: 20000 })],
    kandidatStatement: [
      { id: 'k1', tanggal: '2026-06-16', deskripsi: 'TOPUP088291177279 0145200311031084', nominal: -20000, accountId: 'a1' },
      { id: 'k2', tanggal: '2026-06-14', deskripsi: 'TRANSAKSI DEBIT TGL: 14/06 QR 014 00000.00Keisya Mar', nominal: -18000, accountId: 'a1' },
    ],
  };
  const { keputusan, catatan } = analisaTinjauanAmbiguous(data);
  assert.equal(keputusan.length, 0);
  assert.equal(catatan[0].aksi, 'lewati');
});

test('dua kandidat sama-sama cocok kuat (nama mirip identik) -> tetap dilewati, bukan ditebak', () => {
  const data = {
    transaksiEmail: [trx({ merchantMentah: 'TOKO SAMA' })],
    kandidatStatement: [
      { id: 'k1', tanggal: '2026-09-15', deskripsi: 'TOKO SAMA CABANG A', nominal: -70000, accountId: 'a1' },
      { id: 'k2', tanggal: '2026-09-15', deskripsi: 'TOKO SAMA CABANG B', nominal: -70000, accountId: 'a1' },
    ],
  };
  const { keputusan, catatan } = analisaTinjauanAmbiguous(data);
  assert.equal(keputusan.length, 0);
  assert.equal(catatan[0].aksi, 'lewati');
});

test('tidak ada kandidat sama sekali dalam jendela DAN skor asli sangat rendah -> diusulkan abaikan', () => {
  const data = {
    transaksiEmail: [trx({ waktuTransaksi: '2026-01-01T08:00:00', skorCocok: 10 })],
    kandidatStatement: [
      { id: 'k1', tanggal: '2026-09-15', deskripsi: 'JAUH SEKALI TANGGALNYA', nominal: -70000, accountId: 'a1' },
    ],
  };
  const { keputusan, catatan } = analisaTinjauanAmbiguous(data);
  assert.equal(keputusan.length, 1);
  assert.equal(keputusan[0].aksi, 'abaikan');
  assert.equal(catatan[0].aksi, 'abaikan');
});

test('tidak ada kandidat dalam jendela tapi skor asli masih lumayan -> tetap dilewati (bukan asal abaikan)', () => {
  const data = {
    transaksiEmail: [trx({ waktuTransaksi: '2026-01-01T08:00:00', skorCocok: 25 })],
    kandidatStatement: [
      { id: 'k1', tanggal: '2026-09-15', deskripsi: 'JAUH SEKALI TANGGALNYA', nominal: -70000, accountId: 'a1' },
    ],
  };
  const { keputusan, catatan } = analisaTinjauanAmbiguous(data);
  assert.equal(keputusan.length, 0);
  assert.equal(catatan[0].aksi, 'lewati');
});

test('kandidat menang tapi selisih skor dengan kandidat kedua tipis -> tetap dilewati', () => {
  const data = {
    transaksiEmail: [trx({ merchantMentah: 'GOJEK' })],
    kandidatStatement: [
      // Sengaja cuma beda di arah, bukan merchant/nominal -- skor keduanya berdekatan.
      { id: 'k1', tanggal: '2026-09-15', deskripsi: 'BUKAN GOJEK SAMA SEKALI', nominal: -70000, accountId: 'a1' },
      { id: 'k2', tanggal: '2026-09-15', deskripsi: 'JUGA BUKAN GOJEK', nominal: -70000, accountId: 'a1' },
    ],
  };
  const { keputusan, catatan } = analisaTinjauanAmbiguous(data);
  assert.equal(keputusan.length, 0);
  assert.equal(catatan[0].aksi, 'lewati');
});

test('transaksi berstatus mismatch/missing tidak pernah diikutkan analisa', () => {
  const data = {
    transaksiEmail: [
      trx({ gmailMessageId: 'g-mismatch', statusCocok: 'mismatch' }),
      trx({ gmailMessageId: 'g-missing', statusCocok: 'missing' }),
    ],
    kandidatStatement: [
      { id: 'k1', tanggal: '2026-09-15', deskripsi: 'GOJEK RIDE JAKARTA', nominal: -70000, accountId: 'a1' },
    ],
  };
  const { keputusan, catatan } = analisaTinjauanAmbiguous(data);
  assert.equal(keputusan.length, 0);
  assert.equal(catatan.length, 0);
});

test('data kosong tidak melempar error', () => {
  const { keputusan, catatan } = analisaTinjauanAmbiguous({ transaksiEmail: [], kandidatStatement: [] });
  assert.deepEqual(keputusan, []);
  assert.deepEqual(catatan, []);
});
