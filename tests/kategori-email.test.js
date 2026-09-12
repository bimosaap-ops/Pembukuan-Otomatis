/**
 * Tes sarankanKategoriEmail() — fungsi murni di src/domain/kategoriEmail.js,
 * bagian Fase 6 Realtime Email Transaction Feed. Menguji dua jalur saran
 * (kamus merchant lebih dulu, lalu tentukanKategori() yang sudah ada) dan
 * tiga tingkat keyakinan (tinggi/sedang/rendah).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sarankanKategoriEmail, KEYAKINAN_KATEGORI_EMAIL } from '../src/domain/kategoriEmail.js';
import { KATEGORI_BAWAAN } from '../src/domain/categorize.js';
import { KATEGORI_LAINNYA_KELUAR, KATEGORI_LAINNYA_MASUK } from '../src/domain/entities.js';

function emailTrx(over = {}) {
  return {
    merchantMentah: 'WARUNG SATE BAROKAH',
    nominal: 50000,
    arah: 'debit',
    ...over,
  };
}

test('sarankanKategoriEmail: merchant dikenal di kamus -> keyakinan tinggi, tidak lewat tentukanKategori sama sekali', () => {
  const kamus = new Map([['WARUNG SATE BAROKAH', 'kat_makan']]);
  const hasil = sarankanKategoriEmail(emailTrx(), kamus, KATEGORI_BAWAAN);
  assert.equal(hasil.kategoriId, 'kat_makan');
  assert.equal(hasil.keyakinan, KEYAKINAN_KATEGORI_EMAIL.TINGGI);
  assert.equal(hasil.merchantKey, 'WARUNG SATE BAROKAH');
});

test('sarankanKategoriEmail: kamus kosong tapi tentukanKategori menemukan kata kunci nyata -> keyakinan sedang', () => {
  const kamus = new Map();
  const hasil = sarankanKategoriEmail(emailTrx({ merchantMentah: 'GOFOOD JAKARTA' }), kamus, KATEGORI_BAWAAN);
  assert.equal(hasil.kategoriId, 'kat_makan');
  assert.equal(hasil.keyakinan, KEYAKINAN_KATEGORI_EMAIL.SEDANG);
});

test('sarankanKategoriEmail: tidak ada match sama sekali -> jatuh ke kategori penampung arah, keyakinan rendah', () => {
  const kamus = new Map();
  const hasil = sarankanKategoriEmail(emailTrx({ merchantMentah: 'ZZZ MERCHANT TAK DIKENAL' }), kamus, KATEGORI_BAWAAN);
  assert.equal(hasil.kategoriId, KATEGORI_LAINNYA_KELUAR);
  assert.equal(hasil.keyakinan, KEYAKINAN_KATEGORI_EMAIL.RENDAH);
});

test('sarankanKategoriEmail: arah kredit dengan merchant tak dikenal -> penampung pemasukan, bukan pengeluaran', () => {
  const kamus = new Map();
  const hasil = sarankanKategoriEmail(
    emailTrx({ merchantMentah: 'ZZZ MERCHANT TAK DIKENAL', arah: 'kredit' }),
    kamus,
    KATEGORI_BAWAAN,
  );
  assert.equal(hasil.kategoriId, KATEGORI_LAINNYA_MASUK);
  assert.equal(hasil.keyakinan, KEYAKINAN_KATEGORI_EMAIL.RENDAH);
});

test('sarankanKategoriEmail: kamus dicek dengan merchant_key ternormalisasi, bukan teks mentah apa adanya', () => {
  // Merchant mentah beda format (noise QRIS/MID, urutan huruf besar-kecil beda)
  // tapi ternormalisasi jadi kunci yang sama dengan yang tersimpan di kamus.
  const kamus = new Map([['WARUNG SATE BAROKAH', 'kat_makan']]);
  const hasil = sarankanKategoriEmail(
    emailTrx({ merchantMentah: 'qris warung sate barokah mobile' }),
    kamus,
    KATEGORI_BAWAAN,
  );
  assert.equal(hasil.kategoriId, 'kat_makan');
  assert.equal(hasil.keyakinan, KEYAKINAN_KATEGORI_EMAIL.TINGGI);
});

test('sarankanKategoriEmail: kamus merchant menang walau tentukanKategori juga akan menemukan kategori lain', () => {
  // "GOFOOD" akan cocok "kat_makan" lewat tentukanKategori, tapi kamus
  // pengguna sendiri (dipelajari dari override sebelumnya) harus menang.
  const kamus = new Map([['GOFOOD JAKARTA', 'kat_operasional']]);
  const hasil = sarankanKategoriEmail(emailTrx({ merchantMentah: 'GOFOOD JAKARTA' }), kamus, KATEGORI_BAWAAN);
  assert.equal(hasil.kategoriId, 'kat_operasional');
  assert.equal(hasil.keyakinan, KEYAKINAN_KATEGORI_EMAIL.TINGGI);
});

test('sarankanKategoriEmail: merchantKey selalu ikut dikembalikan, bahkan saat keyakinan rendah', () => {
  const kamus = new Map();
  const hasil = sarankanKategoriEmail(emailTrx({ merchantMentah: 'ZZZ TAK DIKENAL' }), kamus, KATEGORI_BAWAAN);
  assert.equal(hasil.merchantKey, 'ZZZ TAK DIKENAL');
});
