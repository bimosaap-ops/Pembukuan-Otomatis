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

import { barisUntukSheet, validasiUrlWebhook, post } from '../src/services/sheets-sync.js';
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

test('barisUntukSheet mengisi kategoriNama dari kategoriMap berdasarkan kategoriId', () => {
  const t = buatTransaksi({ hash: 'h6', tanggal: '2025-07-04', deskripsi: 'Warteg', nominal: -20000, kategoriId: 'kat_makan' });
  const kategoriMap = new Map([['kat_makan', { id: 'kat_makan', nama: 'Makan & Minum' }]]);

  const baris = barisUntukSheet(t, new Map(), kategoriMap);
  assert.equal(baris.kategoriNama, 'Makan & Minum');
});

test('barisUntukSheet mengisi kategoriNama string kosong bila kategoriId tidak ada di kategoriMap, tanpa error', () => {
  const t = buatTransaksi({ hash: 'h7', tanggal: '2025-07-05', deskripsi: 'Tes', nominal: -1000, kategoriId: 'kat-tak-dikenal' });

  const baris = barisUntukSheet(t, new Map(), new Map());
  assert.equal(baris.kategoriNama, '');

  // kategoriMap kosong/undefined sama sekali juga tidak boleh melempar error.
  assert.doesNotThrow(() => barisUntukSheet(t, new Map(), undefined));
});

test('barisUntukSheet mengirim penanda transfer internal, dan defaultnya false', () => {
  const pindah = buatTransaksi({
    hash: 'h8', tanggal: '2025-07-06', deskripsi: 'TRF KE REKENING SENDIRI',
    nominal: -5000000, transferInternal: true,
  });
  assert.equal(barisUntukSheet(pindah, new Map()).transferInternal, true);

  // Transaksi biasa tidak boleh ikut tertandai: kalau ini bocor jadi true,
  // Dashboard akan membuang transaksi asli dari total gabungan.
  const biasa = buatTransaksi({ hash: 'h9', tanggal: '2025-07-06', deskripsi: 'ALFAMART', nominal: -15000 });
  assert.equal(barisUntukSheet(biasa, new Map()).transferInternal, false);

  // Nilai yang tidak pernah diisi harus jadi false, bukan undefined — sel
  // kosong di Sheet tidak bisa dibedakan dari "bukan transfer".
  assert.equal(typeof barisUntukSheet(biasa, new Map()).transferInternal, 'boolean');
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

/* ==========================================================================
   post — menilai apakah webhook benar-benar menerima data

   Salah menilai di sini pernah membuat aplikasi melaporkan "Terkirim 1938
   baris" padahal tab Sheet-nya kosong: balasan yang tidak bisa diurai dulu
   dibiarkan lolos sebagai sukses.
   ========================================================================== */

function palsukanFetch(balasan) {
  const asli = globalThis.fetch;
  globalThis.fetch = async () => balasan;
  return () => { globalThis.fetch = asli; };
}

const balasanTeks = (teks, ok = true, status = 200) => ({
  ok, status, text: async () => teks,
});

test('post menolak balasan HTML, tidak menganggapnya sukses', async () => {
  // Web App yang tidak dapat diakses publik membalas halaman login: status 200,
  // isinya HTML. Ini persis kegagalan yang menyamar jadi keberhasilan.
  const pulihkan = palsukanFetch(balasanTeks('<!DOCTYPE html><html>Sign in</html>'));
  try {
    await assert.rejects(
      () => post('https://script.google.com/x/exec', { rows: [] }),
      /tidak membalas JSON/i,
    );
  } finally { pulihkan(); }
});

test('post menolak balasan kosong', async () => {
  const pulihkan = palsukanFetch(balasanTeks(''));
  try {
    await assert.rejects(() => post('https://x/exec', {}), /tidak membalas JSON/i);
  } finally { pulihkan(); }
});

test('post meneruskan pesan galat dari server', async () => {
  const pulihkan = palsukanFetch(balasanTeks(JSON.stringify({ ok: false, error: 'Sheet sedang dipakai' })));
  try {
    await assert.rejects(() => post('https://x/exec', {}), /Sheet sedang dipakai/);
  } finally { pulihkan(); }
});

test('post mengembalikan hitungan dan identitas tujuan dari server apa adanya', async () => {
  const pulihkan = palsukanFetch(balasanTeks(JSON.stringify({
    ok: true, inserted: 5, updated: 2, dihapus: 1, total: 7, spreadsheet: 'catatan keuangan',
  })));
  try {
    const j = await post('https://x/exec', {});
    assert.equal(j.inserted, 5);
    assert.equal(j.total, 7);
    assert.equal(j.spreadsheet, 'catatan keuangan');
  } finally { pulihkan(); }
});

test('post menolak status HTTP yang bukan sukses', async () => {
  const pulihkan = palsukanFetch(balasanTeks('Not Found', false, 404));
  try {
    await assert.rejects(() => post('https://x/exec', {}), /404/);
  } finally { pulihkan(); }
});
