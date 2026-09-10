/**
 * Tes untuk bagian sheets-sync.js yang murni (tanpa database maupun jaringan).
 *
 * `bacaKonfigSheets`, `syncKeSheets`, `syncAtauAntri`, dan antrean-nya menyentuh
 * IndexedDB lewat data/repo, dan aplikasi ini sengaja tidak memakai pustaka luar
 * (termasuk pemalsu IndexedDB) untuk pengujian — konsisten dengan seluruh tes
 * lain di sini yang menguji lapisan domain/parser murni, bukan lapisan
 * data/repo. Karena itu yang diuji di sini dibatasi pada dua fungsi yang justru
 * paling rawan salah diam-diam: pembentukan baris untuk Sheet, dan validasi URL
 * webhook (kesalahan paling sering: menempel URL Sheet biasa, bukan Web App).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { barisUntukSheet, validasiUrlWebhook } from '../src/services/sheets-sync.js';
import { buatTransaksi } from '../src/domain/entities.js';

/* ==========================================================================
   barisUntukSheet
   ========================================================================== */

test('barisUntukSheet memisah nominal masuk/keluar ke debit dan kredit', () => {
  const masuk = buatTransaksi({ hash: 'h1', tanggal: '2025-07-01', deskripsi: 'Gaji', nominal: 5000000 });
  const keluar = buatTransaksi({ hash: 'h2', tanggal: '2025-07-02', deskripsi: 'Kopi', nominal: -25000 });

  const baris1 = barisUntukSheet(masuk, new Map());
  assert.equal(baris1.nominal, 5000000);
  assert.equal(baris1.kredit, 5000000);
  assert.equal(baris1.debit, 0);

  const baris2 = barisUntukSheet(keluar, new Map());
  assert.equal(baris2.nominal, -25000);
  assert.equal(baris2.debit, 25000, 'debit harus angka positif walau nominalnya negatif');
  assert.equal(baris2.kredit, 0);
});

test('barisUntukSheet mengisi data rekening dari akunMap berdasarkan accountId', () => {
  const t = buatTransaksi({ hash: 'h3', accountId: 'acc1', tanggal: '2025-07-01', deskripsi: 'Tes', nominal: 1000 });
  const akunMap = new Map([['acc1', { bank: 'BCA', nomorRekening: '1234567890', namaPemilik: 'BUDI' }]]);

  const baris = barisUntukSheet(t, akunMap);
  assert.equal(baris.bank, 'BCA');
  assert.equal(baris.nomorRekening, '1234567890');
  assert.equal(baris.namaPemilik, 'BUDI');
});

test('barisUntukSheet tidak melempar error saat rekening tidak ada di akunMap', () => {
  const t = buatTransaksi({ hash: 'h4', accountId: 'acc-tak-dikenal', tanggal: '2025-07-01', deskripsi: 'Tes', nominal: 1000 });

  const baris = barisUntukSheet(t, new Map());
  assert.equal(baris.bank, '');
  assert.equal(baris.nomorRekening, '');
  assert.equal(baris.namaPemilik, '');

  // akunMap kosong/undefined sama sekali juga tidak boleh melempar error.
  assert.doesNotThrow(() => barisUntukSheet(t, undefined));
});

test('barisUntukSheet menyertakan hash, kategoriId, sumber, dan uploadedFileId apa adanya', () => {
  const t = buatTransaksi({
    hash: 'h5', tanggal: '2025-07-03', deskripsi: 'ALFAMART', nominal: -15000,
    kategoriId: 'kat_belanja', sumber: 'pdf', uploadedFileId: 'upl1',
  });
  const baris = barisUntukSheet(t, new Map());
  assert.equal(baris.hash, 'h5');
  assert.equal(baris.kategoriId, 'kat_belanja');
  assert.equal(baris.sumber, 'pdf');
  assert.equal(baris.uploadedFileId, 'upl1');
});

/* ==========================================================================
   validasiUrlWebhook
   ========================================================================== */

test('validasiUrlWebhook menerima string kosong tanpa error (fitur nonaktif)', () => {
  assert.equal(validasiUrlWebhook(''), '');
  assert.equal(validasiUrlWebhook(null), '');
  assert.equal(validasiUrlWebhook(undefined), '');
});

test('validasiUrlWebhook menolak URL yang bukan https', () => {
  assert.throws(
    () => validasiUrlWebhook('http://script.google.com/macros/s/xxx/exec'),
    /https/i,
  );
});

test('validasiUrlWebhook menolak URL Sheet biasa dan mengarahkan ke Web App', () => {
  assert.throws(
    () => validasiUrlWebhook('https://docs.google.com/spreadsheets/d/xxxxx/edit'),
    /Web App/,
  );
});

test('validasiUrlWebhook menerima URL Web App yang benar dan merapikan spasi', () => {
  const url = validasiUrlWebhook('  https://script.google.com/macros/s/AKfycb.../exec  ');
  assert.equal(url, 'https://script.google.com/macros/s/AKfycb.../exec');
});
