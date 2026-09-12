/**
 * Tes parser email transaksi BCA/Permata di sheets/Code.gs — semuanya
 * FUNGSI MURNI (string masuk, object/Date/number keluar, tidak menyentuh
 * GmailApp/Sheets), dimuat langsung dari sumber lewat pola
 * fs.readFileSync + `new Function` yang sudah dipakai
 * tests/dashboard-sheet.test.js dan tests/email-classify.test.js.
 *
 * Fixture BCA/Permata di bawah disusun dari SAMPLE EMAIL ASLI yang
 * dikirim pengguna (nomor rekening tujuan Permata yang sebelumnya tampil
 * utuh di sample sengaja disamarkan di sini — bukan bagian yang diuji).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../sheets/Code.gs', import.meta.url), 'utf8');
const api = new Function(`${src}\n; return {
  parseEmailBCA, parseEmailPermata, parseEmailBerdasarkanBank,
  parseNominalIDR, parseTanggalJamGabungan, parseTanggalJamTerpisah, ekstrakField,
};`)();
const {
  parseEmailBCA, parseEmailPermata, parseEmailBerdasarkanBank,
  parseNominalIDR, parseTanggalJamGabungan, parseTanggalJamTerpisah, ekstrakField,
} = api;

const EMAIL_BCA = `
Hai BIMO SAPUTRO,
Anda baru saja melakukan transaksi dengan menggunakan fasilitas myBCA.
Berikut ini adalah detail transaksi Anda :

Status                : Berhasil
Tanggal Transaksi     : 11 Sep 2026 13:53:28
Jenis Transaksi       : Pembayaran QRIS
Pembayaran Ke         : Warung Sate Solo Barokah,
Lokasi Merchant       : JAKARTA TIMUR, 13450, ID
Pengakuisisi          : GOPAY
Merchant PAN          : 936009143001373479
Terminal ID           : A01
Sumber Dana           : TAHAPAN - 6090****94
Customer PAN          : 9360001410174522135
Total Bayar           : IDR 99,000.00
RRN                   : 315108853
Nomor Referensi       : 952712026091135324660QRS1141733407

Mohon simpan email ini sebagai referensi transaksi Anda.
Apabila Anda tidak mengenal transaksi ini, segera hubungi HaloBCA di 1500888.

Hormat Kami,
PT Bank Central Asia Tbk
`;

const EMAIL_PERMATA = `
Terima kasih Anda telah menggunakan Permata ME.

Berikut ini adalah informasi transaksi yang telah Anda lakukan di Permata ME :

Tanggal                     : 24 Aug 2026
Jam                         : 10:13:35
Rekening Asal               : 12XXXXXX10 (IDR) - Payroll
Kategori                    : Transfer BI-FAST
Bank Tujuan                 : BCA
Rekening Tujuan             : 6090XXXX94
Nama Penerima                : BIMO SAPUTRO
Nominal                     : IDR 11,000,000
Biaya Transaksi             : IDR 0
Tanggal Transfer            : 24 Aug 2026
Nama Pengingat              : -
Berita                      : -
Masuk ke Transaction Basket : Tidak
Info Tambahan               : -
Nomor referensi transaksi   : 408582925
Status Transaksi            : Berhasil
Dibuat oleh                 : BIMO SAPUTRO
Ketentuan                   : -

Semoga informasi ini bermanfaat bagi Anda.
`;

// Sub-template kedua BCA: transfer ke sesama rekening BCA (field pembeda
// "Jenis Transfer", bukan "Jenis Transaksi"). Ditemukan lewat verifikasi
// produksi pengguna sendiri terhadap Gmail asli -- teks di bawah adalah
// ISI EMAIL ASLI yang tertangkap apa adanya di tab _EmailMasuk (bukan
// sample yang diminta duluan), nama penerima & nomor rekening tujuan
// disamarkan di sini karena bukan bagian yang diuji.
const EMAIL_BCA_TRANSFER = `
Hai BIMO SAPUTRO,
Anda baru saja melakukan transaksi dengan menggunakan fasilitas myBCA.
Berikut ini adalah detail transaksi Anda :
Status : Berhasil
Tanggal Transaksi : 11 Sep 2026 23:51:56
Jenis Transfer : Transfer ke rekening BCA
Dari Rekening : 6090xxxx94
Mata Uang Asal : IDR - Indonesian Rupiah
Rekening Tujuan : 1640XXXX93
Mata Uang Tujuan : IDR - Indonesian Rupiah
Nama Penerima : PENERIMA CONTOH
Nominal Tujuan : IDR 3,000,000.00
Berita : -
Nomor Referensi : 82810E1E-936E-4C63-8C72-AD6AC4496318
Mohon simpan email ini sebagai referensi transaksi Anda.
Apabila Anda tidak mengenal transaksi ini, segera hubungi Halo BCA di
1500888.

Hormat Kami,
PT Bank Central Asia Tbk
`;

// Sub-template ketiga (masih di bawah field pembeda "Jenis Transaksi"):
// pembayaran BCA Virtual Account (mis. top-up GoPay). TIDAK punya field
// "Pembayaran Ke" sama sekali -- ditemukan lewat verifikasi produksi lain
// yang gagal parse karena itu. Teks di bawah ISI EMAIL ASLI dari
// _EmailMasuk, nama pemilik VA disamarkan karena bukan bagian yang diuji.
const EMAIL_BCA_VA = `
Hai BIMO SAPUTRO,

Anda baru saja melakukan transaksi dengan menggunakan fasilitas myBCA.
Berikut ini adalah detail transaksi Anda :

Status : Berhasil
Tanggal Transaksi : 10 Sep 2026 09:50:46
Jenis Transaksi : Transfer ke BCA Virtual Account
Dari Rekening : 6090xxxx94
No. BCA Virtual Account : 70001088291177279
Nama : Bxxx Sxxxxxx
Nama Perusahaan/Produk : PT DOMPET ANAK BANGSA / GOPAY TOPUP
Nominal Bayar : IDR 400,000.00
Biaya Admin : IDR 1,000.00
Total Bayar : IDR 401,000.00
Keterangan :
Nomor Referensi : C9878E43-8901-4F1C-9DC2-0ADAEFB9144A

Mohon simpan email ini sebagai referensi transaksi Anda.
`;

test('parseEmailBCA: sub-template Virtual Account (top-up, tanpa field "Pembayaran Ke") terparse benar', () => {
  const hasil = parseEmailBCA(EMAIL_BCA_VA);
  assert.equal(hasil.parsedOk, true);
  assert.equal(hasil.bank, 'BCA');
  assert.equal(hasil.amount, 401000, 'Total Bayar termasuk biaya admin, bukan Nominal Bayar saja');
  assert.equal(hasil.direction, 'debit');
  assert.equal(hasil.merchantRaw, 'PT DOMPET ANAK BANGSA / GOPAY TOPUP', 'fallback ke Nama Perusahaan/Produk karena Pembayaran Ke tidak ada');
  assert.equal(hasil.jenisTransaksi, 'Transfer ke BCA Virtual Account');
  assert.equal(hasil.refNo, 'C9878E43-8901-4F1C-9DC2-0ADAEFB9144A');
  assert.equal(hasil.rrn, null, 'template VA tidak menyertakan RRN');
});

test('parseEmailBCA: sample asli "Internet Transaction Journal" terparse lengkap', () => {
  const hasil = parseEmailBCA(EMAIL_BCA);
  assert.equal(hasil.parsedOk, true);
  assert.equal(hasil.bank, 'BCA');
  assert.equal(hasil.amount, 99000);
  assert.equal(hasil.direction, 'debit');
  assert.equal(hasil.merchantRaw, 'Warung Sate Solo Barokah', 'koma di akhir "Pembayaran Ke" harus dibuang');
  assert.equal(hasil.jenisTransaksi, 'Pembayaran QRIS');
  assert.equal(hasil.acquirer, 'GOPAY');
  assert.equal(hasil.location, 'JAKARTA TIMUR, 13450, ID');
  assert.equal(hasil.rrn, '315108853');
  assert.equal(hasil.refNo, '952712026091135324660QRS1141733407');
  assert.equal(hasil.parserVersion, 'bca-v1');
  assert.equal(hasil.confidence, 'high');

  const t = hasil.eventTime;
  assert.equal(t.getFullYear(), 2026);
  assert.equal(t.getMonth(), 8, 'September = indeks 8');
  assert.equal(t.getDate(), 11);
  assert.equal(t.getHours(), 13);
  assert.equal(t.getMinutes(), 53);
  assert.equal(t.getSeconds(), 28);
});

test('parseEmailPermata: sample asli "Transfer - Other Bank BI-FAST" terparse lengkap', () => {
  const hasil = parseEmailPermata(EMAIL_PERMATA);
  assert.equal(hasil.parsedOk, true);
  assert.equal(hasil.bank, 'Permata');
  assert.equal(hasil.amount, 11000000);
  assert.equal(hasil.direction, 'debit');
  assert.equal(hasil.merchantRaw, 'BIMO SAPUTRO');
  assert.equal(hasil.jenisTransaksi, 'Transfer BI-FAST');
  assert.equal(hasil.refNo, '408582925');
  assert.equal(hasil.parserVersion, 'permata-v1');
  assert.equal(hasil.confidence, 'high');

  const t = hasil.eventTime;
  assert.equal(t.getFullYear(), 2026);
  assert.equal(t.getMonth(), 7, 'Agustus = indeks 7');
  assert.equal(t.getDate(), 24);
  assert.equal(t.getHours(), 10);
  assert.equal(t.getMinutes(), 13);
  assert.equal(t.getSeconds(), 35);
});

test('parseEmailBCA: sub-template transfer sesama BCA (field "Jenis Transfer") terparse benar', () => {
  const hasil = parseEmailBCA(EMAIL_BCA_TRANSFER);
  assert.equal(hasil.parsedOk, true);
  assert.equal(hasil.bank, 'BCA');
  assert.equal(hasil.amount, 3000000);
  assert.equal(hasil.direction, 'debit');
  assert.equal(hasil.merchantRaw, 'PENERIMA CONTOH');
  assert.equal(hasil.jenisTransaksi, 'Transfer ke rekening BCA');
  assert.equal(hasil.acquirer, null, 'template transfer tidak punya field acquirer');
  assert.equal(hasil.location, null);
  assert.equal(hasil.rrn, null, 'template transfer tidak menyertakan RRN sama sekali');
  assert.equal(hasil.refNo, '82810E1E-936E-4C63-8C72-AD6AC4496318');
  assert.equal(hasil.parserVersion, 'bca-v1');

  const t = hasil.eventTime;
  assert.equal(t.getFullYear(), 2026);
  assert.equal(t.getMonth(), 8);
  assert.equal(t.getDate(), 11);
  assert.equal(t.getHours(), 23);
  assert.equal(t.getMinutes(), 51);
  assert.equal(t.getSeconds(), 56);
});

test('parseEmailBCA: dispatcher memilih sub-template pembayaran vs transfer dengan benar', () => {
  assert.equal(parseEmailBCA(EMAIL_BCA).jenisTransaksi, 'Pembayaran QRIS');
  assert.equal(parseEmailBCA(EMAIL_BCA_TRANSFER).jenisTransaksi, 'Transfer ke rekening BCA');
});

test('parseEmailBCA: template tak dikenal (bukan keduanya) -> parsedOk:false dengan pesan jelas', () => {
  const hasil = parseEmailBCA('Email BCA yang formatnya belum pernah dilihat sama sekali.');
  assert.equal(hasil.parsedOk, false);
  assert.match(hasil.error, /tidak dikenali/);
});

test('parseEmailBCA: tahan terhadap perataan spasi tunggal (bukan kolom rata kanan)', () => {
  // getPlainBody() hasil konversi HTML->teks tidak dijamin mempertahankan
  // perataan visual yang terlihat di tangkapan layar -- parser tidak boleh
  // bergantung pada lebar spasi tertentu.
  const rapat = EMAIL_BCA.replace(/ {2,}: /g, ': ');
  const hasil = parseEmailBCA(rapat);
  assert.equal(hasil.parsedOk, true);
  assert.equal(hasil.amount, 99000);
  assert.equal(hasil.merchantRaw, 'Warung Sate Solo Barokah');
});

test('parseEmailBCA: field minimum hilang -> parsedOk:false, bukan data setengah terisi', () => {
  const rusak = EMAIL_BCA.replace(/Total Bayar\s*:\s*IDR 99,000\.00\n/, '');
  const hasil = parseEmailBCA(rusak);
  assert.equal(hasil.parsedOk, false);
  assert.ok(hasil.error, 'harus menyertakan pesan error yang menjelaskan field mana yang hilang');
  assert.equal(hasil.amount, undefined, 'tidak boleh ada field transaksi yang terisi saat parsedOk:false');
});

test('parseEmailPermata: field minimum hilang -> parsedOk:false', () => {
  const rusak = EMAIL_PERMATA.replace(/Nominal\s*:\s*IDR 11,000,000\n/, '');
  const hasil = parseEmailPermata(rusak);
  assert.equal(hasil.parsedOk, false);
  assert.ok(hasil.error);
});

test('parseEmailBerdasarkanBank: dispatch ke parser yang benar per nama bank', () => {
  assert.equal(parseEmailBerdasarkanBank('BCA', EMAIL_BCA).bank, 'BCA');
  assert.equal(parseEmailBerdasarkanBank('Permata', EMAIL_PERMATA).bank, 'Permata');
});

test('parseEmailBerdasarkanBank: bank tak dikenal -> parsedOk:false dengan pesan jelas', () => {
  const hasil = parseEmailBerdasarkanBank('BankAsing', 'apa saja');
  assert.equal(hasil.parsedOk, false);
  assert.match(hasil.error, /BankAsing/);
});

test('parseNominalIDR: format dengan dan tanpa desimal', () => {
  assert.equal(parseNominalIDR('IDR 99,000.00'), 99000);
  assert.equal(parseNominalIDR('IDR 11,000,000'), 11000000);
  assert.equal(parseNominalIDR('IDR 0'), 0);
  assert.equal(parseNominalIDR(''), null);
  assert.equal(parseNominalIDR(null), null);
});

test('parseTanggalJamGabungan dan parseTanggalJamTerpisah: singkatan bulan Indonesia dan Inggris sama-sama dikenali', () => {
  const a = parseTanggalJamGabungan('11 Sep 2026 13:53:28');
  assert.equal(a.getMonth(), 8);

  const b = parseTanggalJamTerpisah('24 Aug 2026', '10:13:35');
  assert.equal(b.getMonth(), 7);

  // Singkatan Indonesia untuk bulan yang sama harus menghasilkan bulan yang sama.
  const c = parseTanggalJamTerpisah('24 Agu 2026', '10:13:35');
  assert.equal(c.getMonth(), b.getMonth());

  assert.equal(parseTanggalJamGabungan('teks tidak relevan'), null);
  assert.equal(parseTanggalJamTerpisah('bukan tanggal', '10:00:00'), null);
});

test('ekstrakField: nilai yang sendiri memuat ":" tidak terpotong di titik dua pertama', () => {
  const hasil = ekstrakField('Jam                         : 10:13:35', 'Jam');
  assert.equal(hasil, '10:13:35');
});

test('ekstrakField: label tidak ditemukan mengembalikan string kosong, bukan error', () => {
  assert.equal(ekstrakField('Status : Berhasil', 'TidakAda'), '');
});
