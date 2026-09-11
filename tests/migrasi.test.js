/**
 * Tes bagian murni migrasi hash.
 *
 * `jalankanMigrasi` menyentuh IndexedDB dan sengaja tidak diuji di sini (seluruh
 * tes di repositori ini menghindari pemalsu IndexedDB). Yang diuji adalah
 * `hitungHashBaru` — bagian yang kalau salah akan menghilangkan atau
 * menggandakan transaksi pengguna secara diam-diam.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { hitungHashBaru } from '../src/data/migrasi.js';
import { hitungBaseHash } from '../src/domain/dedupe.js';

const trx = (i, lebih = {}) => ({
  id: `trx_${String(i).padStart(4, '0')}`,
  accountId: 'acc_bca',
  tanggal: `2025-07-${String((i % 28) + 1).padStart(2, '0')}`,
  deskripsi: `Transaksi ${i}`,
  nominal: -(1000 + i),
  urutan: i,
  hash: `lama${i}#1`,
  baseHash: `lama${i}`,
  ...lebih,
});

test('hitungHashBaru menghasilkan hash unik untuk seluruh transaksi', async () => {
  const daftar = Array.from({ length: 2000 }, (_, i) => trx(i));
  const hasil = await hitungHashBaru(daftar);

  assert.equal(hasil.length, 2000, 'tidak boleh ada transaksi yang hilang');
  assert.equal(new Set(hasil.map((t) => t.hash)).size, 2000, 'hash harus unik — indeks database menolak yang kembar');
  assert.ok(hasil.every((t) => t.hash && t.baseHash), 'setiap transaksi harus punya hash baru');
  assert.deepEqual(hasil.map((t) => t.id), daftar.map((t) => t.id), 'urutan kembalian mengikuti masukan');
});

test('hitungHashBaru memberi nomor urut berbeda untuk kembar yang memang asli', async () => {
  // Dua pembayaran identik di hari yang sama memang bisa benar-benar terjadi.
  // Keduanya harus tetap tersimpan, dibedakan oleh nomor urut kejadian.
  // `id` sengaja dibuat BERLAWANAN dengan `urutan`: kalau nomor urut kejadian
  // diam-diam mengikuti id (atau urutan bacaan database), tes ini yang
  // menangkapnya. Dengan fixture yang idnya searah, cacat itu lolos.
  const kembar = [
    trx(1, { id: 'z', tanggal: '2025-07-05', deskripsi: 'QRIS KOPI', nominal: -20000, urutan: 3 }),
    trx(2, { id: 'm', tanggal: '2025-07-05', deskripsi: 'QRIS KOPI', nominal: -20000, urutan: 7 }),
    trx(3, { id: 'a', tanggal: '2025-07-05', deskripsi: 'QRIS KOPI', nominal: -20000, urutan: 9 }),
  ];
  const hasil = await hitungHashBaru(kembar);

  assert.equal(new Set(hasil.map((t) => t.baseHash)).size, 1, 'baseHash-nya memang sama');
  assert.deepEqual(hasil.map((t) => t.hash.split('#')[1]), ['1', '2', '3'],
    'nomor urut mengikuti urutan di statement, bukan id atau urutan bacaan database');
});

test('hitungHashBaru stabil: dijalankan dua kali hasilnya sama persis', async () => {
  // Kalau nomor urut bergantung pada urutan bacaan database yang kebetulan,
  // migrasi yang terulang akan menghasilkan hash berbeda dan Sheet melihat
  // seluruh pembukuan sebagai baris baru setiap kali.
  // id unik, tapi isinya berulang: tiap 5 transaksi punya baseHash yang sama,
  // sehingga penomoran kejadian benar-benar terpakai. (Dengan id yang ikut
  // berulang, daftarnya menyusut jadi 5 dan tesnya tidak menguji apa pun.)
  const daftar = Array.from({ length: 50 }, (_, i) => trx(i % 5, { id: `trx_unik_${i}`, urutan: i }));
  const acak = [...daftar].reverse();

  const a = await hitungHashBaru(daftar);
  const b = await hitungHashBaru(acak);

  const petaA = new Map(a.map((t) => [t.id, t.hash]));
  const petaB = new Map(b.map((t) => [t.id, t.hash]));
  for (const [id, hash] of petaA) assert.equal(petaB.get(id), hash, `hash untuk ${id} berubah antar jalan`);
});

test('hitungHashBaru memisahkan rekening — inti perbaikannya', async () => {
  const sama = { tanggal: '2025-07-05', deskripsi: 'QRIS KOPI', nominal: -20000, urutan: 1 };
  const hasil = await hitungHashBaru([
    { id: 'x', accountId: 'acc_bca', ...sama },
    { id: 'y', accountId: 'acc_permata', ...sama },
  ]);
  assert.notEqual(hasil[0].baseHash, hasil[1].baseHash, 'baris identik di rekening berbeda tidak boleh bertabrakan');
});

test('hash hasil migrasi cocok dengan yang dihitung jalur upload biasa', async () => {
  // Kalau keduanya berbeda, upload berikutnya tidak akan mengenali transaksi
  // yang sudah dimigrasikan sebagai duplikat, dan pembukuan tergandakan lagi.
  const t = trx(7);
  const [hasil] = await hitungHashBaru([t]);
  const lewatJalurUpload = await hitungBaseHash({
    accountId: t.accountId, tanggal: t.tanggal, deskripsi: t.deskripsi, nominal: t.nominal,
  });
  assert.equal(hasil.baseHash, lewatJalurUpload);
});
