/**
 * Uji ujung-ke-ujung: berkas PDF sungguhan dibuka dengan pdf.js, lalu seluruh
 * pipeline dijalankan sampai menghasilkan transaksi.
 *
 * Berbeda dengan `parser.test.js` yang memberi masukan koordinat buatan, di sini
 * koordinatnya datang dari pdf.js sendiri — jadi yang teruji termasuk penyusunan
 * baris dari tata letak PDF asli dan penanganan berkas ber-password.
 *
 * Berkas ujinya dibuat oleh `tests/buat-fixture-pdf.py`. Bila belum ada,
 * seluruh berkas uji ini dilewati agar `node --test` tetap bisa jalan tanpa Python.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseStatement } from '../src/parsers/registry.js';
import { ADAPTER } from '../src/parsers/detect.js';
import { validasiBaris, cocokkanRingkasan } from '../src/domain/validate.js';
import { bubuhiBaseHash, tandaiDuplikat, ringkasDuplikat } from '../src/domain/dedupe.js';

const require = createRequire(import.meta.url);
const DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(DIR, 'fixtures');

const adaFixture = existsSync(join(FIXTURE, 'bca-juli-2025.pdf'));
const opsi = adaFixture
  ? {}
  : { skip: 'Fixture PDF belum dibuat — jalankan: python3 tests/buat-fixture-pdf.py' };

function muatPdfJs() {
  // Build UMD pdf.js mendaftarkan dirinya ke objek global, bukan lewat
  // module.exports, sehingga di Node diambil dari globalThis setelah require.
  // Berkas worker juga dimuat lebih dulu: tanpa itu pdf.js mencoba menyisipkan
  // <script> untuk worker-nya dan gagal karena Node tidak punya DOM.
  require('../vendor/pdfjs/pdf.worker.min.js');
  require('../vendor/pdfjs/pdf.min.js');
  const pdfjsLib = globalThis.pdfjsLib;
  if (!pdfjsLib) throw new Error('pdf.js tidak termuat dari folder vendor.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = join(DIR, '..', 'vendor', 'pdfjs', 'pdf.worker.min.js');
  return pdfjsLib;
}

/** Membuka PDF dan mengambil potongan teks — sepadan dengan `ekstrakPotongan` di browser. */
async function potonganDariPdf(namaFile, password = '') {
  const pdfjsLib = muatPdfJs();
  const data = new Uint8Array(readFileSync(join(FIXTURE, namaFile)));

  const dokumen = await pdfjsLib.getDocument({
    data,
    password: password || undefined,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const halaman = [];
  for (let i = 1; i <= dokumen.numPages; i += 1) {
    const page = await dokumen.getPage(i);
    const isi = await page.getTextContent();
    halaman.push(isi.items.filter((it) => typeof it.str === 'string').map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
      h: it.height || Math.abs(it.transform[3]) || 8,
    })));
  }
  await dokumen.destroy();
  return halaman;
}

test('PDF BCA sungguhan terbaca lengkap dan totalnya cocok dengan ringkasan', opsi, async () => {
  const hasil = parseStatement(await potonganDariPdf('bca-juli-2025.pdf'));

  assert.equal(hasil.kodeAdapter, ADAPTER.BCA);
  assert.equal(hasil.nomorRekening, '1234567890');
  assert.equal(hasil.namaPemilik, 'BUDI SANTOSO');
  assert.equal(hasil.transaksi.length, 10, 'sepuluh transaksi, SALDO AWAL tidak ikut');

  const t = hasil.transaksi;
  assert.equal(t[0].tanggal, '2025-07-02');
  assert.equal(t[0].nominal, 5000000);
  assert.ok(t[0].deskripsi.includes('JAYA KONSTRUKSI'), 'baris lanjutan tergabung');
  assert.equal(t[1].nominal, -15000, 'akhiran DB berarti keluar');
  assert.equal(t[t.length - 1].nominal, 12500, 'bunga masuk sebagai transaksi kredit');
  assert.equal(hasil.saldoAwal, 10000000);

  const cek = cocokkanRingkasan(hasil.transaksi, hasil.ringkasan);
  assert.ok(cek?.semuaCocok, `total tidak cocok: ${JSON.stringify(cek?.cek)}`);

  const { ringkas } = validasiBaris(hasil.transaksi);
  assert.equal(ringkas.curiga, 0, 'saldo berjalan harus konsisten dari awal sampai akhir');
});

test('PDF Permata sungguhan membedakan kolom debet dan kredit', opsi, async () => {
  const hasil = parseStatement(await potonganDariPdf('permata-juli-2025.pdf'));

  assert.equal(hasil.kodeAdapter, ADAPTER.PERMATA);
  assert.equal(hasil.nomorRekening, '0987654321');
  assert.equal(hasil.namaPemilik, 'SITI RAHAYU');
  assert.equal(hasil.transaksi.length, 6);

  const nominal = hasil.transaksi.map((t) => t.nominal);
  assert.deepEqual(nominal, [7500000, -450000, -11000, -1250000, -300000, 12500]);
  assert.ok(hasil.transaksi[1].deskripsi.includes('NO PELANGGAN'));

  const { ringkas } = validasiBaris(hasil.transaksi);
  assert.equal(ringkas.curiga, 0);
});

test('PDF bank lain tanpa judul kolom tetap terbaca lewat perubahan saldo', opsi, async () => {
  const hasil = parseStatement(await potonganDariPdf('bank-lain-juli-2025.pdf'));

  assert.equal(hasil.kodeAdapter, ADAPTER.GENERIK);
  assert.equal(hasil.transaksi.length, 5);
  assert.deepEqual(
    hasil.transaksi.map((t) => t.nominal),
    [1000000, -250000, -500000, 750000, -200000],
  );
});

test('PDF ber-password ditolak tanpa password dan terbaca dengan password yang benar', opsi, async () => {
  await assert.rejects(
    () => potonganDariPdf('bca-juli-2025-terkunci.pdf'),
    (e) => e?.name === 'PasswordException',
    'membuka tanpa password harus melempar PasswordException',
  );

  await assert.rejects(
    () => potonganDariPdf('bca-juli-2025-terkunci.pdf', 'salah'),
    (e) => e?.name === 'PasswordException',
  );

  const hasil = parseStatement(await potonganDariPdf('bca-juli-2025-terkunci.pdf', 'rahasia123'));
  assert.equal(hasil.transaksi.length, 10);
  assert.equal(hasil.nomorRekening, '1234567890');
});

test('dua PDF berurutan terakumulasi tanpa menggandakan data', opsi, async () => {
  const akun = { bank: 'BCA', nomorRekening: '1234567890' };

  const juli = parseStatement(await potonganDariPdf('bca-juli-2025.pdf'));
  const agustus = parseStatement(await potonganDariPdf('bca-agustus-2025.pdf'));

  const barisJuli = await bubuhiBaseHash(juli.transaksi, akun);
  const simpanan = tandaiDuplikat(barisJuli, new Map()).filter((b) => !b.duplikat);
  assert.equal(simpanan.length, 10);

  const jumlah = new Map();
  simpanan.forEach((b) => jumlah.set(b.baseHash, (jumlah.get(b.baseHash) || 0) + 1));

  // Upload ulang berkas Juli yang sama persis.
  const ulang = tandaiDuplikat(barisJuli, jumlah);
  assert.equal(ringkasDuplikat(ulang).baru, 0, 'upload ulang tidak menambah apa pun');

  // Lalu statement bulan berikutnya.
  const barisAgustus = await bubuhiBaseHash(agustus.transaksi, akun);
  const hasilAgustus = tandaiDuplikat(barisAgustus, jumlah);
  assert.equal(ringkasDuplikat(hasilAgustus).baru, 3, 'tiga transaksi Agustus adalah data baru');
  assert.equal(simpanan.length + 3, 13, 'pembukuan terakumulasi menjadi 13 transaksi');
});
