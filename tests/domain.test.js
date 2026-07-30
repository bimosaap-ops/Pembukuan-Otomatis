import test from 'node:test';
import assert from 'node:assert/strict';

import { kunciDasar, bubuhiBaseHash, tandaiDuplikat, paksaSimpan, ringkasDuplikat } from '../src/domain/dedupe.js';
import { tentukanKategori, saranPola, tambahPola, KATEGORI_BAWAAN } from '../src/domain/categorize.js';
import { KATEGORI_LAINNYA_KELUAR, KATEGORI_LAINNYA_MASUK } from '../src/domain/entities.js';
import { parseStatement } from '../src/parsers/registry.js';
import { statementBCA, statementBCAAgustus } from './fixtures/statements.js';

const AKUN = { bank: 'BCA', nomorRekening: '1234567890' };

/** Meniru database: menghitung berapa transaksi tersimpan per baseHash. */
function petaJumlah(tersimpan) {
  const peta = new Map();
  tersimpan.forEach((t) => peta.set(t.baseHash, (peta.get(t.baseHash) || 0) + 1));
  return peta;
}

/* ==========================================================================
   Kunci duplikat
   ========================================================================== */

test('kunci duplikat dibentuk dari lima komponen dan tahan beda penulisan', () => {
  const a = kunciDasar({ bank: 'BCA', nomorRekening: '1234567890', tanggal: '2025-07-02', deskripsi: 'TRSF  E-BANKING cr', nominal: 5000000 });
  const b = kunciDasar({ bank: 'bca', nomorRekening: '1234-567-890', tanggal: '2025-07-02', deskripsi: 'trsf e-banking CR', nominal: 5000000.0 });
  assert.equal(a, b, 'spasi ganda, huruf besar-kecil, dan tanda pisah nomor tidak boleh membedakan');

  const beda = kunciDasar({ bank: 'BCA', nomorRekening: '1234567890', tanggal: '2025-07-02', deskripsi: 'TRSF E-BANKING CR', nominal: 5000001 });
  assert.notEqual(a, beda, 'nominal berbeda harus menghasilkan kunci berbeda');
});

/* ==========================================================================
   Akumulasi antar upload — inti kebutuhan pengguna
   ========================================================================== */

test('upload statement yang sama dua kali tidak menggandakan data', async () => {
  const hasil = parseStatement([statementBCA()]);
  const baris = await bubuhiBaseHash(hasil.transaksi, AKUN);

  const pertama = tandaiDuplikat(baris, new Map());
  assert.equal(ringkasDuplikat(pertama).baru, 6, 'upload pertama: semua transaksi masuk');
  assert.equal(ringkasDuplikat(pertama).duplikat, 0);

  const tersimpan = pertama.filter((b) => !b.duplikat);
  const kedua = tandaiDuplikat(baris, petaJumlah(tersimpan));

  assert.equal(ringkasDuplikat(kedua).baru, 0, 'upload kedua: tidak ada yang ditambahkan');
  assert.equal(ringkasDuplikat(kedua).duplikat, 6);
});

test('dua transaksi kembar yang memang asli tetap tersimpan dua-duanya', async () => {
  const hasil = parseStatement([statementBCA()]);
  const baris = await bubuhiBaseHash(hasil.transaksi, AKUN);

  // Statement contoh memuat dua QRIS ALFAMART Rp 20.000 pada tanggal yang sama.
  const kembar = baris.filter((b) => b.deskripsi.includes('ALFAMART'));
  assert.equal(kembar.length, 2);
  assert.equal(kembar[0].baseHash, kembar[1].baseHash, 'keduanya punya kunci dasar yang sama');

  const ditandai = tandaiDuplikat(baris, new Map());
  const hasilKembar = ditandai.filter((b) => b.deskripsi.includes('ALFAMART'));
  assert.equal(hasilKembar.filter((b) => !b.duplikat).length, 2, 'keduanya harus tetap masuk');
  assert.notEqual(hasilKembar[0].hash, hasilKembar[1].hash, 'hash akhir tetap unik');
});

test('statement bulan berikutnya menambah data, bukan menimpa', async () => {
  const juli = await bubuhiBaseHash(parseStatement([statementBCA()]).transaksi, AKUN);
  const agustus = await bubuhiBaseHash(parseStatement([statementBCAAgustus()]).transaksi, AKUN);

  const tersimpan = tandaiDuplikat(juli, new Map()).filter((b) => !b.duplikat);
  const hasilAgustus = tandaiDuplikat(agustus, petaJumlah(tersimpan));

  assert.equal(ringkasDuplikat(hasilAgustus).baru, 2, 'dua transaksi Agustus adalah data baru');
  const total = tersimpan.length + hasilAgustus.filter((b) => !b.duplikat).length;
  assert.equal(total, 8, 'pembukuan terakumulasi jadi 8 transaksi');
});

test('statement dengan periode tumpang tindih hanya menambahkan selisihnya', async () => {
  const juli = await bubuhiBaseHash(parseStatement([statementBCA()]).transaksi, AKUN);
  const tersimpan = tandaiDuplikat(juli, new Map()).filter((b) => !b.duplikat);

  // Unduhan ulang yang memuat seluruh Juli plus satu transaksi baru di akhir bulan.
  const ulang = [...juli, {
    tanggal: '2025-07-28', deskripsi: 'PEMBAYARAN PLN', nominal: -450000, saldo: 9995000,
    baseHash: 'hash-transaksi-baru',
  }];

  const hasil = tandaiDuplikat(ulang, petaJumlah(tersimpan));
  assert.equal(ringkasDuplikat(hasil).baru, 1);
  assert.equal(ringkasDuplikat(hasil).duplikat, 6);
});

test('baris duplikat bisa dipaksa simpan tanpa merusak keunikan hash', async () => {
  const juli = await bubuhiBaseHash(parseStatement([statementBCA()]).transaksi, AKUN);
  const tersimpan = tandaiDuplikat(juli, new Map()).filter((b) => !b.duplikat);
  const jumlah = petaJumlah(tersimpan);

  const kedua = tandaiDuplikat(juli, jumlah);
  const dipaksa = paksaSimpan(kedua[0], kedua, jumlah);

  assert.equal(dipaksa.duplikat, false);
  assert.equal(dipaksa.ordinal, 2, 'kejadian berikutnya sesudah yang sudah tersimpan');
  assert.ok(!tersimpan.some((t) => t.hash === dipaksa.hash), 'hash tidak bentrok dengan data lama');
});

/* ==========================================================================
   Kategorisasi
   ========================================================================== */

test('kategori otomatis mengenali pola khas transaksi Indonesia', () => {
  const uji = [
    ['QRIS DEBIT ALFAMART JAKARTA', -20000, 'kat_belanja'],
    ['PEMBAYARAN PLN PREPAID', -450000, 'kat_tagihan'],
    ['BIAYA ADM', -15000, 'kat_biaya_bank'],
    ['TARIKAN TUNAI ATM 0123', -500000, 'kat_tarik_tunai'],
    ['PEMBAYARAN TOKOPEDIA MARKETPLACE', -1250000, 'kat_belanja_online'],
    ['GOFOOD JAKARTA SELATAN', -75000, 'kat_makan'],
    ['SPBU PERTAMINA 34.123', -200000, 'kat_transport'],
    ['BUNGA TABUNGAN', 12500, 'kat_bunga'],
    ['GAJI BULAN JULI', 8000000, 'kat_gaji'],
    ['ZAKAT PENGHASILAN BAZNAS', -200000, 'kat_donasi'],
  ];

  uji.forEach(([deskripsi, nominal, harapan]) => {
    assert.equal(tentukanKategori(deskripsi, nominal, KATEGORI_BAWAAN), harapan, `"${deskripsi}" seharusnya masuk ${harapan}`);
  });
});

test('kata "GAJI" masuk kategori berbeda tergantung arah transaksi', () => {
  assert.equal(tentukanKategori('GAJI KARYAWAN JULI', 8000000, KATEGORI_BAWAAN), 'kat_gaji');
  assert.equal(tentukanKategori('GAJI KARYAWAN JULI', -8000000, KATEGORI_BAWAAN), 'kat_gaji_karyawan');
});

test('kata kunci spesifik mengalahkan kata kunci transfer yang umum', () => {
  // "TRANSFER" ada di kategori Transfer Keluar, tapi PLN jauh lebih khas.
  assert.equal(tentukanKategori('TRANSFER PEMBAYARAN PLN', -450000, KATEGORI_BAWAAN), 'kat_tagihan');
  assert.equal(tentukanKategori('TRSF E-BANKING DB 12345 BUDI', -1000000, KATEGORI_BAWAAN), 'kat_transfer_keluar');
});

test('transaksi tanpa pola yang dikenal jatuh ke kategori penampung', () => {
  assert.equal(tentukanKategori('XYZQW 8891', -100000, KATEGORI_BAWAAN), KATEGORI_LAINNYA_KELUAR);
  assert.equal(tentukanKategori('XYZQW 8891', 100000, KATEGORI_BAWAAN), KATEGORI_LAINNYA_MASUK);
});

test('koreksi manual menghasilkan kata kunci yang bisa dipakai ulang', () => {
  const pola = saranPola('PEMBAYARAN VIA MOBILE BANKING KLINIK SEHAT SENTOSA 0812');
  assert.ok(pola.length >= 4);
  assert.ok(!['PEMBAYARAN', 'MOBILE', 'BANKING', 'VIA'].includes(pola), `kata umum tidak boleh dipilih, dapat "${pola}"`);

  const kategori = tambahPola({ id: 'kat_kesehatan', polaKataKunci: ['APOTEK'] }, pola);
  assert.ok(kategori.polaKataKunci.includes(pola));

  const lagi = tambahPola(kategori, pola.toLowerCase());
  assert.equal(lagi.polaKataKunci.length, kategori.polaKataKunci.length, 'kata kunci yang sama tidak ditambah dua kali');
});


/* ==========================================================================
   Penyeragaman nomor rekening
   ========================================================================== */

test('nomor rekening yang ditulis berbeda tetap dianggap satu rekening', async () => {
  const { normalkanNomor } = await import('../src/data/repo/accounts.js');

  // Rekening koran menulis "1238847210", unduhan Mutasi Transaksi "0012-3884-7210".
  assert.equal(normalkanNomor('1238847210'), normalkanNomor('0012-3884-7210'));
  assert.equal(normalkanNomor('0012-3884-7210'), '1238847210');
  assert.equal(normalkanNomor(' 1238847210 '), '1238847210');
  assert.equal(normalkanNomor('001.238.847.210'), '1238847210');

  // Rekening yang memang berbeda tidak boleh menyatu.
  assert.notEqual(normalkanNomor('1238847210'), normalkanNomor('1238840550'));
  assert.equal(normalkanNomor(''), '');
  assert.equal(normalkanNomor(null), '');
});

test('kata kunci kategori tidak menangkap potongan nama orang', async () => {
  const { tentukanKategori: tentukan, KATEGORI_BAWAAN: bawaan } = await import('../src/domain/categorize.js');

  // "SAFITRI" memuat "TRI", "DANAMON" memuat "DANA" — keduanya nama, bukan merchant.
  assert.equal(tentukan('PB KE GIANI SAFITRI 1238840550 Permata ME', -107100, bawaan), 'kat_transfer_keluar');
  assert.equal(tentukan('TRF BIFAST KE TRI SATYANINGSIH 3430368264', -2950000, bawaan), 'kat_transfer_keluar');
  assert.equal(tentukan('TRF DARI BESTINDO BANK DANAMON Dana Dimuka', 5730000, bawaan), 'kat_transfer_masuk');

  // Bentuk yang tidak ambigu tetap harus kena.
  assert.equal(tentukan('PULSA TELKOMSEL 0812', -50000, bawaan), 'kat_pulsa');
  assert.equal(tentukan('ISI SALDO DANA 0812', -100000, bawaan), 'kat_dompet_digital');
});
