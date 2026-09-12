/**
 * Tes klasifikasikanEmail() di sheets/Code.gs — fungsi murni (tidak
 * menyentuh GmailApp/Sheets sama sekali), jadi dimuat langsung dari sumber
 * tanpa tiruan API Apps Script sama sekali, mengikuti pola
 * fs.readFileSync + `new Function` yang sudah dipakai di
 * tests/dashboard-sheet.test.js untuk menguji fungsi lain di berkas yang
 * sama tanpa Apps Script sungguhan.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../sheets/Code.gs', import.meta.url), 'utf8');
const { klasifikasikanEmail } = new Function(`${src}\n; return { klasifikasikanEmail };`)();

const konfig = [
  { polaPengirim: 'bca.co.id', polaSubjek: 'Notifikasi Transaksi', bank: 'BCA', aktif: true },
  { polaPengirim: 'permatabank.com', polaSubjek: '', bank: 'Permata', aktif: true },
  { polaPengirim: 'promo@bca.co.id', polaSubjek: '', bank: 'BCA', aktif: false },
];

test('klasifikasikanEmail: cocok pola aktif -> transaction_email dengan bank yang benar', () => {
  const hasil = klasifikasikanEmail('BCA <noreply@bca.co.id>', 'Notifikasi Transaksi Kartu Debit', konfig);
  assert.deepEqual(hasil, { outcome: 'transaction_email', bank: 'BCA' });
});

test('klasifikasikanEmail: pola pengirim tanpa syarat subjek tetap cocok', () => {
  const hasil = klasifikasikanEmail('PermataMobile <notif@permatabank.com>', 'Transaksi Kartu Anda', konfig);
  assert.deepEqual(hasil, { outcome: 'transaction_email', bank: 'Permata' });
});

test('klasifikasikanEmail: subjek memuat kata kecuali -> non_transaction walau pengirim cocok', () => {
  const hasil = klasifikasikanEmail('BCA <noreply@bca.co.id>', 'PROMO Kartu Kredit Bulan Ini', konfig);
  assert.deepEqual(hasil, { outcome: 'non_transaction', bank: null });
});

test('klasifikasikanEmail: kata kecuali diperiksa case-insensitive', () => {
  const hasil = klasifikasikanEmail('bank@example.com', 'otp verifikasi login', konfig);
  assert.deepEqual(hasil, { outcome: 'non_transaction', bank: null });
});

test('klasifikasikanEmail: pengirim tidak cocok pola manapun -> unknown, bukan non_transaction', () => {
  // Penting: "unknown" TIDAK boleh disamakan dengan "non_transaction" --
  // pollEmailTransaksi() sengaja tidak melabeli thread "unknown" supaya
  // tetap diperiksa ulang begitu pengguna menambah pola baru.
  const hasil = klasifikasikanEmail('marketing@tokopedia.com', 'Diskon 50% Hari Ini', konfig);
  assert.deepEqual(hasil, { outcome: 'unknown', bank: null });
});

test('klasifikasikanEmail: baris konfigurasi nonaktif tidak ikut dicocokkan', () => {
  const hasil = klasifikasikanEmail('promo@bca.co.id', 'Info Terbaru', konfig);
  assert.deepEqual(hasil, { outcome: 'unknown', bank: null });
});

test('klasifikasikanEmail: baris konfigurasi kosong (tanpa pola sama sekali) diabaikan, bukan cocok-semua', () => {
  const kosong = [{ polaPengirim: '', polaSubjek: '', bank: 'BCA', aktif: true }];
  const hasil = klasifikasikanEmail('siapapun@contoh.com', 'apa saja', kosong);
  assert.deepEqual(hasil, { outcome: 'unknown', bank: null },
    'baris tanpa pola pengirim maupun subjek tidak boleh jadi wildcard yang cocok ke semua email');
});

test('klasifikasikanEmail: daftar konfigurasi kosong -> selalu unknown', () => {
  const hasil = klasifikasikanEmail('BCA <noreply@bca.co.id>', 'Notifikasi Transaksi', []);
  assert.deepEqual(hasil, { outcome: 'unknown', bank: null });
});
