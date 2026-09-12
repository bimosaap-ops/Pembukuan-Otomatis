/**
 * Tes bangunBarisLogEmail() dan perluDicatatLogEmail() di sheets/Code.gs —
 * observability ringan untuk pollEmailTransaksi() (Fase 9 Realtime Email
 * Transaction Feed). Keduanya fungsi murni, tidak butuh tiruan Sheets/Gmail
 * sama sekali.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../sheets/Code.gs', import.meta.url), 'utf8');

function muatApi() {
  return new Function(`${src}\n; return { bangunBarisLogEmail, perluDicatatLogEmail, HEADER_LOG_EMAIL };`)();
}

const { bangunBarisLogEmail, perluDicatatLogEmail, HEADER_LOG_EMAIL } = muatApi();

test('HEADER_LOG_EMAIL: tujuh kolom, urutannya cocok dengan bangunBarisLogEmail', () => {
  assert.equal(HEADER_LOG_EMAIL.length, 7);
});

test('bangunBarisLogEmail: menyusun kolom sesuai urutan header, waktu berupa Date', () => {
  const baris = bangunBarisLogEmail({ ditemukan: 12, diproses: 9, diparsing: 7, diperbaiki: 2, alasan: null });
  assert.ok(baris[0] instanceof Date);
  assert.equal(baris[1], 12); // Thread Diperiksa
  assert.equal(baris[2], 9); // Email Diproses
  assert.equal(baris[3], 7); // Berhasil Diparse
  assert.equal(baris[4], 2); // Gagal Diparse = diproses(9) - diparsing(7)
  assert.equal(baris[5], 2); // Diperbaiki Reparse
  assert.equal(baris[6], ''); // Catatan kosong kalau alasan null
});

test('bangunBarisLogEmail: alasan (mis. konfigurasi kosong) ikut ke kolom Catatan', () => {
  const baris = bangunBarisLogEmail({
    ditemukan: 0, diproses: 0, diparsing: 0, diperbaiki: 3,
    alasan: 'Konfigurasi Email masih kosong — isi pola pengirim/subjek dulu.',
  });
  assert.equal(baris[6], 'Konfigurasi Email masih kosong — isi pola pengirim/subjek dulu.');
});

test('bangunBarisLogEmail: Gagal Diparse tidak pernah negatif walau diparsing > diproses', () => {
  // Skenario tidak realistis, tapi perhitungan harus tetap aman (mis. kalau
  // reparseEmailGagal menambah diparsing di luar hitungan diproses jalan ini).
  const baris = bangunBarisLogEmail({ ditemukan: 1, diproses: 0, diparsing: 5, diperbaiki: 0, alasan: null });
  assert.equal(baris[4], 0);
});

test('bangunBarisLogEmail: field yang hilang/undefined dianggap nol atau string kosong, bukan error', () => {
  const baris = bangunBarisLogEmail({});
  assert.equal(baris[1], 0);
  assert.equal(baris[2], 0);
  assert.equal(baris[3], 0);
  assert.equal(baris[4], 0);
  assert.equal(baris[5], 0);
  assert.equal(baris[6], '');
});

test('perluDicatatLogEmail: jalan yang tidak menemukan/memperbaiki/gagal apa pun TIDAK layak dicatat', () => {
  assert.equal(perluDicatatLogEmail({ diproses: 0, diperbaiki: 0, alasan: null }), false);
});

test('perluDicatatLogEmail: email baru diproses layak dicatat', () => {
  assert.equal(perluDicatatLogEmail({ diproses: 3, diperbaiki: 0, alasan: null }), true);
});

test('perluDicatatLogEmail: perbaikan reparse layak dicatat walau tidak ada email baru', () => {
  assert.equal(perluDicatatLogEmail({ diproses: 0, diperbaiki: 1, alasan: null }), true);
});

test('perluDicatatLogEmail: alasan (mis. konfigurasi kosong) layak dicatat', () => {
  assert.equal(perluDicatatLogEmail({ diproses: 0, diperbaiki: 0, alasan: 'Konfigurasi Email masih kosong.' }), true);
});
