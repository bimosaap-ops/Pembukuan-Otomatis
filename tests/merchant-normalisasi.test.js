/**
 * Tes normalisasiMerchant() — fungsi murni di src/domain/merchantNormalisasi.js,
 * bagian Fase 5 Realtime Email Transaction Feed. Lihat PRD §24 untuk pipeline
 * yang diikuti (canonicalize -> buang noise/ID -> buang akhiran bisnis ->
 * fallback keamanan).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisasiMerchant } from '../src/domain/merchantNormalisasi.js';

test('normalisasiMerchant: input kosong/null/undefined menghasilkan string kosong', () => {
  assert.equal(normalisasiMerchant(''), '');
  assert.equal(normalisasiMerchant(null), '');
  assert.equal(normalisasiMerchant(undefined), '');
  assert.equal(normalisasiMerchant('   '), '');
});

test('normalisasiMerchant: canonicalize -> uppercase, tanda baca jadi spasi, spasi dirapatkan', () => {
  assert.equal(normalisasiMerchant('warung sate, solo!!  barokah.'), 'WARUNG SATE SOLO BAROKAH');
});

test('normalisasiMerchant: kata noise umum (QRIS, MOBILE, dst.) dibuang', () => {
  assert.equal(normalisasiMerchant('QRIS WARUNG SATE BAROKAH MOBILE'), 'WARUNG SATE BAROKAH');
  assert.equal(normalisasiMerchant('PEMBAYARAN INTERNET BANKING TOKOPEDIA'), 'TOKOPEDIA');
});

test('normalisasiMerchant: label ID (MID/TID/TERMINAL) dan token ID acak dibuang', () => {
  assert.equal(normalisasiMerchant('TOKO MAJU JAYA MID 12345678 TID 99887766'), 'TOKO MAJU JAYA');
  assert.equal(
    normalisasiMerchant('WARUNG KOPI 9527120260911135324660QRS1141733407'),
    'WARUNG KOPI',
  );
});

test('normalisasiMerchant: token digit murni panjang (nomor referensi/kartu) dibuang', () => {
  assert.equal(normalisasiMerchant('TRANSFER 255515732408 BUDI SANTOSO'), 'TRANSFER BUDI SANTOSO');
});

test('normalisasiMerchant: nama merchant asli yang panjang & huruf semua TIDAK ikut terbuang', () => {
  // Regresi terhadap flaw di regex literal PRD (^[A-Z0-9]{8,}$), yang akan
  // salah menganggap "STARBUCKS"/"MCDONALDS" sebagai token ID acak.
  assert.equal(normalisasiMerchant('STARBUCKS'), 'STARBUCKS');
  assert.equal(normalisasiMerchant('MCDONALDS INDONESIA'), 'MCDONALDS INDONESIA');
});

test('normalisasiMerchant: akhiran TBK dibuang, tapi PT/CV/UD dipertahankan', () => {
  assert.equal(normalisasiMerchant('BANK CENTRAL ASIA TBK'), 'BANK CENTRAL ASIA');
  assert.equal(normalisasiMerchant('PT SUMBER ALFARIA TRIJAYA'), 'PT SUMBER ALFARIA TRIJAYA');
  assert.equal(normalisasiMerchant('CV BAROKAH JAYA'), 'CV BAROKAH JAYA');
  assert.equal(normalisasiMerchant('UD MAJU MAKMUR'), 'UD MAJU MAKMUR');
});

test('normalisasiMerchant: fallback keamanan dipakai kalau hasil penyaringan jadi terlalu pendek/kosong', () => {
  // Seluruh teks cuma noise/ID -> penyaringan agresif akan menghasilkan
  // string kosong; fallback harus mengembalikan versi canonicalize saja,
  // bukan string kosong (dua merchant beda tidak boleh jatuh ke kunci sama
  // gara-gara sama-sama "kosong").
  assert.equal(normalisasiMerchant('QRIS MOBILE'), 'QRIS MOBILE');
  assert.equal(normalisasiMerchant('MID TID TERMINAL'), 'MID TID TERMINAL');
});

test('normalisasiMerchant: dua merchant yang berbeda tidak jatuh ke kunci yang sama', () => {
  const a = normalisasiMerchant('QRIS WARUNG A MID 11112222');
  const b = normalisasiMerchant('QRIS WARUNG B MID 33334444');
  assert.notEqual(a, b);
});
