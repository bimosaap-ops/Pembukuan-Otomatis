/**
 * Tes cocokkanTransaksiEmail() — fungsi murni di src/domain/rekonsiliasiEmail.js,
 * bagian Fase 5 Realtime Email Transaction Feed. Level matching yang diuji
 * cuma level 2 (jumlah+arah+waktu) dan level 3 (kemiripan merchant) — level 1
 * (RRN/nomor referensi) sengaja ditunda ke fase pengerasan, lihat rencana
 * implementasi.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cocokkanTransaksiEmail } from '../src/domain/rekonsiliasiEmail.js';
import { STATUS_COCOK_EMAIL } from '../src/domain/entities.js';

function emailTrx(over = {}) {
  return {
    waktuTransaksi: '2025-07-05T10:00:00.000Z',
    nominal: 50000,
    arah: 'debit',
    merchantMentah: 'WARUNG SATE BAROKAH',
    ...over,
  };
}

function kandidat(over = {}) {
  return {
    id: 'trx_1',
    tanggal: '2025-07-05T10:00:00.000Z',
    nominal: -50000,
    deskripsi: 'WARUNG SATE BAROKAH QRIS',
    ...over,
  };
}

test('cocokkanTransaksiEmail: tidak ada kandidat sama sekali -> missing', () => {
  const hasil = cocokkanTransaksiEmail(emailTrx(), []);
  assert.equal(hasil.status, STATUS_COCOK_EMAIL.MISSING);
  assert.equal(hasil.kandidatId, null);
  assert.equal(hasil.alasan, 'no_candidate_in_time_window');
});

test('cocokkanTransaksiEmail: satu-satunya kandidat di luar jendela waktu -> missing (bukan dipaksa cocok)', () => {
  const jauh = kandidat({ tanggal: '2025-08-01T10:00:00.000Z' });
  const hasil = cocokkanTransaksiEmail(emailTrx(), [jauh]);
  assert.equal(hasil.status, STATUS_COCOK_EMAIL.MISSING);
});

test('cocokkanTransaksiEmail: jumlah+arah+waktu+merchant cocok penuh -> matched', () => {
  const hasil = cocokkanTransaksiEmail(emailTrx(), [kandidat()]);
  assert.equal(hasil.status, STATUS_COCOK_EMAIL.MATCHED);
  assert.equal(hasil.kandidatId, 'trx_1');
  assert.ok(hasil.alasan.includes('amount_exact'));
  assert.ok(hasil.alasan.includes('direction_exact'));
});

test('cocokkanTransaksiEmail: waktu persis sama (<=5 menit) menghasilkan alasan time_very_close', () => {
  const hasil = cocokkanTransaksiEmail(emailTrx(), [kandidat()]);
  assert.ok(hasil.alasan.includes('time_very_close'));
});

test('cocokkanTransaksiEmail: waktu berbeda 6 jam (masih dalam jendela) menghasilkan alasan time_within_window', () => {
  const geser = kandidat({ tanggal: '2025-07-05T16:00:00.000Z' });
  const hasil = cocokkanTransaksiEmail(emailTrx(), [geser]);
  assert.equal(hasil.status, STATUS_COCOK_EMAIL.MATCHED);
  assert.ok(hasil.alasan.includes('time_within_window'));
});

test('cocokkanTransaksiEmail: kandidat plausible tapi nominal beda -> mismatch, BUKAN missing', () => {
  // Ini alasan kandidat sengaja tidak disaring oleh nominal dari awal: kalau
  // disaring, kasus ini akan salah jatuh ke `missing` padahal sebenarnya ada
  // jejak di statement dengan nominal yang salah.
  const bedaNominal = kandidat({ nominal: -75000 });
  const hasil = cocokkanTransaksiEmail(emailTrx(), [bedaNominal]);
  assert.equal(hasil.status, STATUS_COCOK_EMAIL.MISMATCH);
  assert.equal(hasil.kandidatId, 'trx_1');
  assert.ok(hasil.alasan.includes('amount_differs'));
});

test('cocokkanTransaksiEmail: arah berbeda (debit vs kredit) dengan nominal sama -> mismatch', () => {
  const bedaArah = kandidat({ nominal: 50000 }); // positif = kredit, emailTrx() = debit
  const hasil = cocokkanTransaksiEmail(emailTrx(), [bedaArah]);
  assert.equal(hasil.status, STATUS_COCOK_EMAIL.MISMATCH);
  assert.ok(hasil.alasan.includes('direction_differs'));
});

test('cocokkanTransaksiEmail: dua kandidat dengan skor berdekatan -> ambiguous, bukan auto-match salah satu', () => {
  const kandidat1 = kandidat({ id: 'trx_a', deskripsi: 'TOKO LAIN' });
  const kandidat2 = kandidat({ id: 'trx_b', deskripsi: 'TOKO LAIN JUGA' });
  const hasil = cocokkanTransaksiEmail(emailTrx(), [kandidat1, kandidat2]);
  assert.equal(hasil.status, STATUS_COCOK_EMAIL.AMBIGUOUS);
  assert.equal(hasil.kandidatId, null);
  assert.equal(hasil.alasan, 'multiple_candidates_similar_score');
});

test('cocokkanTransaksiEmail: kandidat terbaik jelas menang dari kandidat kedua -> tidak ambiguous', () => {
  const kuat = kandidat({ id: 'trx_kuat' }); // amount+direction+merchant cocok penuh
  const lemah = kandidat({
    id: 'trx_lemah',
    nominal: -12000, // nominal beda -> kehilangan skor amount_exact
    deskripsi: 'TOKO TIDAK TERKAIT',
  });
  const hasil = cocokkanTransaksiEmail(emailTrx(), [kuat, lemah]);
  assert.equal(hasil.status, STATUS_COCOK_EMAIL.MATCHED);
  assert.equal(hasil.kandidatId, 'trx_kuat');
});

test('cocokkanTransaksiEmail: skor kandidat terbaik terlalu rendah (mis. cuma waktu cocok) -> ambiguous', () => {
  // Arah juga dibuat beda (kredit, bukan debit) supaya cuma skor waktu yang
  // terkumpul (20 dari time_very_close) — di bawah ambangKuat bawaan (35).
  const lemah = kandidat({ nominal: 999999, deskripsi: 'TIDAK ADA KEMIRIPAN SAMA SEKALI' });
  const hasil = cocokkanTransaksiEmail(emailTrx(), [lemah]);
  assert.equal(hasil.status, STATUS_COCOK_EMAIL.AMBIGUOUS);
  assert.equal(hasil.alasan, 'confidence_insufficient');
});

test('cocokkanTransaksiEmail: kemiripan merchant menambah skor lewat normalisasiMerchant, bukan exact-string', () => {
  const beda = kandidat({
    nominal: -80000,
    deskripsi: 'QRIS WARUNG SATE BAROKAH MID 12345678',
  });
  const hasil = cocokkanTransaksiEmail(emailTrx({ nominal: 80000, arah: 'debit' }), [beda]);
  // nominal & arah cocok (nominal absolut sama, arah debit utk kandidat negatif),
  // merchant juga match walau formatnya beda (noise QRIS/MID di kandidat).
  assert.equal(hasil.status, STATUS_COCOK_EMAIL.MATCHED);
  assert.ok(hasil.alasan.includes('merchant_similarity'));
});

test('cocokkanTransaksiEmail: opsi ambangKuat/bedaAmbigu/jendelaWaktuMs bisa dioverride pemanggil', () => {
  const jauh = kandidat({ tanggal: '2025-07-08T10:00:00.000Z' }); // 3 hari setelahnya
  const default_ = cocokkanTransaksiEmail(emailTrx(), [jauh]);
  assert.equal(default_.status, STATUS_COCOK_EMAIL.MISSING, 'di luar jendela bawaan 24 jam');

  const diperluas = cocokkanTransaksiEmail(emailTrx(), [jauh], { jendelaWaktuMs: 7 * 24 * 60 * 60 * 1000 });
  assert.notEqual(diperluas.status, STATUS_COCOK_EMAIL.MISSING, 'jendela diperluas -> kandidat ikut dipertimbangkan');
});
