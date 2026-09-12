/**
 * Tes bangunBarisTarikTransaksiEmail() di sheets/Code.gs — fungsi yang
 * dipanggil doPost{tarikTransaksiEmail} untuk menyusun baris "Transaksi
 * Email" jadi objek datar siap-JSON bagi PWA. Sengaja dipisah dari doPost
 * itu sendiri supaya diuji tanpa mensimulasikan payload HTTP.
 *
 * Tiruan Sheets mengikuti pola yang sama dengan tests/email-reparse.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../sheets/Code.gs', import.meta.url), 'utf8');

function buatSheetTiruan() {
  const data = [];
  return {
    appendRow(row) { data.push(row.slice()); },
    getLastRow() { return data.length; },
    getRange(r, c, nRows, nCols) {
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nRows; i += 1) {
            const baris = data[r - 1 + i] || [];
            out.push(Array.from({ length: nCols }, (_, j) => (baris[c - 1 + j] === undefined ? '' : baris[c - 1 + j])));
          }
          return out;
        },
      };
    },
  };
}

function muatApi() {
  const sandbox = { console: { warn: () => {}, log: () => {} } };
  return new Function(...Object.keys(sandbox),
    `${src}\n; return { bangunBarisTarikTransaksiEmail, HEADER_TRANSAKSI_EMAIL };`)(...Object.values(sandbox));
}

function isiBaris(t, header, over = {}) {
  const dasar = {
    0: 'msg_1', 1: 'BCA', 2: new Date(2026, 8, 11, 13, 53, 28), 3: 99000, 4: 'debit',
    5: 'Warung Sate Solo Barokah', 6: 'Pembayaran QRIS', 7: 'GOPAY', 8: 'JAKARTA TIMUR',
    9: '315108853', 10: 'REF123', 11: 'bca-v1', 12: 'high', 13: new Date(2026, 8, 13, 1, 28, 24),
  };
  Object.assign(dasar, over);
  const baris = header.map((_, i) => dasar[i]);
  t.appendRow(baris);
}

test('bangunBarisTarikTransaksiEmail: tab kosong -> array kosong, tidak error', () => {
  const api = muatApi();
  const t = buatSheetTiruan();
  t.appendRow(api.HEADER_TRANSAKSI_EMAIL);
  const hasil = api.bangunBarisTarikTransaksiEmail(t, null);
  assert.deepEqual(hasil, []);
});

test('bangunBarisTarikTransaksiEmail: sejak=null menarik semua baris, field ter-mapping benar', () => {
  const api = muatApi();
  const t = buatSheetTiruan();
  t.appendRow(api.HEADER_TRANSAKSI_EMAIL);
  isiBaris(t, api.HEADER_TRANSAKSI_EMAIL);

  const hasil = api.bangunBarisTarikTransaksiEmail(t, null);
  assert.equal(hasil.length, 1);
  const r = hasil[0];
  assert.equal(r.gmailMessageId, 'msg_1');
  assert.equal(r.bank, 'BCA');
  assert.equal(r.waktuTransaksi, new Date(2026, 8, 11, 13, 53, 28).toISOString());
  assert.equal(r.nominal, 99000);
  assert.equal(r.arah, 'debit');
  assert.equal(r.merchantMentah, 'Warung Sate Solo Barokah');
  assert.equal(r.rrn, '315108853');
  assert.equal(r.nomorReferensi, 'REF123');
  assert.equal(r.versiParser, 'bca-v1');
  assert.equal(typeof r.dibuatPada, 'string', 'Dibuat Pada harus ISO string, bukan objek Date mentah (perlu lolos JSON.stringify)');
});

test('bangunBarisTarikTransaksiEmail: hanya baris lebih baru dari sejak yang dikembalikan', () => {
  const api = muatApi();
  const t = buatSheetTiruan();
  t.appendRow(api.HEADER_TRANSAKSI_EMAIL);
  isiBaris(t, api.HEADER_TRANSAKSI_EMAIL, { 0: 'msg_lama', 13: new Date(2026, 8, 10, 0, 0, 0) });
  isiBaris(t, api.HEADER_TRANSAKSI_EMAIL, { 0: 'msg_baru', 13: new Date(2026, 8, 13, 0, 0, 0) });

  const sejak = new Date(2026, 8, 12, 0, 0, 0);
  const hasil = api.bangunBarisTarikTransaksiEmail(t, sejak);

  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].gmailMessageId, 'msg_baru');
});

test('bangunBarisTarikTransaksiEmail: baris tepat di waktu sejak TIDAK ikut tertarik (batas eksklusif)', () => {
  const api = muatApi();
  const t = buatSheetTiruan();
  t.appendRow(api.HEADER_TRANSAKSI_EMAIL);
  const waktu = new Date(2026, 8, 12, 0, 0, 0);
  isiBaris(t, api.HEADER_TRANSAKSI_EMAIL, { 0: 'msg_pas', 13: waktu });

  const hasil = api.bangunBarisTarikTransaksiEmail(t, waktu);
  assert.equal(hasil.length, 0, 'checkpoint dari respons sebelumnya sudah termasuk baris itu, jangan ditarik dobel');
});

test('bangunBarisTarikTransaksiEmail: RRN/Nomor Referensi kosong dipetakan ke null, bukan string kosong', () => {
  const api = muatApi();
  const t = buatSheetTiruan();
  t.appendRow(api.HEADER_TRANSAKSI_EMAIL);
  isiBaris(t, api.HEADER_TRANSAKSI_EMAIL, { 0: 'msg_transfer', 9: '', 10: 'REF-ADA' });

  const hasil = api.bangunBarisTarikTransaksiEmail(t, null);
  assert.equal(hasil[0].rrn, null, 'template transfer tidak punya RRN sama sekali');
  assert.equal(hasil[0].nomorReferensi, 'REF-ADA');
});

test('bangunBarisTarikTransaksiEmail: baris tanpa Gmail Message ID dilewati (bekas rentang format tanpa data)', () => {
  const api = muatApi();
  const t = buatSheetTiruan();
  t.appendRow(api.HEADER_TRANSAKSI_EMAIL);
  isiBaris(t, api.HEADER_TRANSAKSI_EMAIL, { 0: '' });
  isiBaris(t, api.HEADER_TRANSAKSI_EMAIL, { 0: 'msg_asli' });

  const hasil = api.bangunBarisTarikTransaksiEmail(t, null);
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].gmailMessageId, 'msg_asli');
});
