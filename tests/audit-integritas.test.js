/**
 * Regresi untuk temuan audit integritas data (lihat laporan audit):
 *
 *   1. baseHash hilang pada transaksi hasil pull dari Google Sheets;
 *   2. saldo berjalan berangkat dari Saldo Awal rekening walau periode
 *      tersaring, sehingga angkanya berbeda dari saldo rekening sesungguhnya;
 *   3. transfer internal dikeluarkan dari tren saldo, padahal uangnya memang
 *      berpindah dan hitungUlangSaldo() menghitungnya;
 *   4. urutan Buku Kas tidak mengikuti urutan baris statement;
 *   5. daftar aset service worker tertinggal dari berkas yang benar-benar ada;
 *   6. satu tarikan transaksi email yang memuat gmailMessageId kembar
 *      membatalkan SELURUH penyimpanan (indeks unique).
 *
 * Semuanya murni — tidak ada yang menyentuh IndexedDB, sesuai pembagian tes
 * di repositori ini.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

import { barisUntukSheet, transaksiDariBarisSheet } from '../src/services/sheets-sync.js';
import { hitungBaseHash, hashFinal, bubuhiBaseHash, tandaiDuplikat } from '../src/domain/dedupe.js';
import { buatTransaksi } from '../src/domain/entities.js';
import { trenSaldo, saldoPembukaPeriode, totalMutasi, totalSaldoAwal } from '../src/domain/analytics.js';
import { bukuKas } from '../src/domain/reports.js';
import { saringBarisBaru } from '../src/data/repo/email-transactions.js';
import { statementTerawalBersaldo, koreksiSaldoAwalAkun } from '../src/domain/validate.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const AKAR = join(DIR, '..');

/* ==========================================================================
   1. baseHash pada baris hasil pull
   ========================================================================== */

test('transaksi hasil pull membawa baseHash, bukan string kosong', () => {
  const row = { id: 'trx1', hash: 'abc123#4', tanggal: '2025-07-01', nominal: -20000 };
  assert.equal(transaksiDariBarisSheet(row).baseHash, 'abc123');
});

test('baseHash hasil pull sama persis dengan baseHash aslinya (pulang-pergi)', async () => {
  const asli = buatTransaksi({
    id: 'trx9', accountId: 'acc1', tanggal: '2025-08-01',
    deskripsi: 'QRIS KOPI KLOTO', nominal: -25000,
  });
  asli.baseHash = await hitungBaseHash(asli);
  asli.hash = hashFinal(asli.baseHash, 1);

  const balik = transaksiDariBarisSheet(barisUntukSheet(asli, new Map(), new Map()));
  assert.equal(balik.baseHash, asli.baseHash);
  assert.equal(balik.hash, asli.hash);
});

test('upload ulang e-statement di perangkat yang menariknya dari Sheets dikenali duplikat', async () => {
  // Perangkat A: transaksi hasil upload, lalu dikirim ke Sheets.
  const asli = { accountId: 'acc1', tanggal: '2025-07-05', deskripsi: 'QRIS KOPI', nominal: -20000 };
  const baseAsli = await hitungBaseHash(asli);
  const rowSheet = barisUntukSheet(
    { ...asli, id: 'trx_a', hash: hashFinal(baseAsli, 1), baseHash: baseAsli },
    new Map([['acc1', { bank: 'BCA', nomorRekening: '1234567890' }]]),
    new Map(),
  );

  // Perangkat B menarik baris itu; inilah yang tersimpan secara lokal.
  const hasilPull = transaksiDariBarisSheet(rowSheet);

  // Perangkat B lalu meng-upload PDF yang sama. hitungPerBaseHash membaca
  // indeks `baseHash`, jadi yang dihitung persis nilai di baris hasil pull.
  const jumlahLama = new Map([[hasilPull.baseHash, 1]]);
  const ditandai = tandaiDuplikat(await bubuhiBaseHash([asli], 'acc1'), jumlahLama);

  assert.equal(ditandai[0].duplikat, true, 'baris yang sama tidak boleh dihitung sebagai transaksi baru');
  assert.equal(ditandai[0].hash, hasilPull.hash, 'hash-nya memang identik — itu sebabnya indeks unique menolaknya');
});

/* ==========================================================================
   2 & 3. Saldo berjalan: titik berangkat periode & transfer internal
   ========================================================================== */

const AKUN = [{ id: 'a1', saldoAwal: 0 }];

/** 14 bulan berturut-turut, masing-masing satu pemasukan Rp 1.000.000. */
function riwayat14Bulan() {
  const bulan = ['2024-12', '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
    '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01'];
  return bulan.map((ym, i) => ({
    id: `t${i}`, tanggal: `${ym}-10`, nominal: 1000000, urutan: 0, dibuatPada: '',
  }));
}

test('saldoPembukaPeriode menambahkan mutasi sebelum periode ke saldo awal rekening', () => {
  const semua = riwayat14Bulan();
  const dari = '2025-02-01';
  const sebelum = semua.filter((t) => t.tanggal < dari);

  assert.equal(sebelum.length, 2);
  assert.equal(saldoPembukaPeriode(AKUN, sebelum), 2000000);
  assert.equal(saldoPembukaPeriode(AKUN, []), 0);
});

test('tren saldo periode tersaring berakhir di saldo rekening sesungguhnya', () => {
  const semua = riwayat14Bulan();
  const dari = '2025-02-01';
  const sampai = '2026-01-31';
  const periode = semua.filter((t) => t.tanggal >= dari && t.tanggal <= sampai);
  const saldoSesungguhnya = totalSaldoAwal(AKUN) + totalMutasi(semua); // seperti hitungUlangSaldo

  const tren = trenSaldo(periode, saldoPembukaPeriode(AKUN, semua.filter((t) => t.tanggal < dari)), { dari, sampai });

  assert.equal(tren[tren.length - 1].nilai, saldoSesungguhnya);
});

test('buku kas periode tersaring berakhir di saldo rekening sesungguhnya', () => {
  const semua = riwayat14Bulan();
  const dari = '2025-02-01';
  const periode = semua.filter((t) => t.tanggal >= dari);
  const hasil = bukuKas(periode, saldoPembukaPeriode(AKUN, semua.filter((t) => t.tanggal < dari)));

  assert.equal(hasil.saldoAwal, 2000000);
  assert.equal(hasil.saldoAkhir, totalSaldoAwal(AKUN) + totalMutasi(semua));
});

test('transfer internal ikut menggerakkan tren saldo, sama seperti hitungUlangSaldo', () => {
  const trx = [
    { id: 'x1', tanggal: '2026-01-05', nominal: -5000000, transferInternal: true, urutan: 0, dibuatPada: '' },
    { id: 'x2', tanggal: '2026-01-06', nominal: 2000000, transferInternal: false, urutan: 1, dibuatPada: '' },
  ];
  const tren = trenSaldo(trx, 0, {});

  assert.equal(totalMutasi(trx), -3000000);
  assert.equal(tren[tren.length - 1].nilai, -3000000);
  assert.equal(bukuKas(trx, 0).saldoAkhir, -3000000, 'buku kas dan tren saldo harus sepakat');
});

/* ==========================================================================
   4. Urutan Buku Kas
   ========================================================================== */

test('buku kas mengikuti urutan baris statement, bukan urutan penulisan ke database', () => {
  // `urutan` 0,1,2 = urutan cetak statement; `dibuatPada` sengaja terbalik.
  const trx = [
    { id: 'b', tanggal: '2025-07-05', nominal: -30000, urutan: 1, dibuatPada: '2025-07-05T00:00:01Z', deskripsi: 'B' },
    { id: 'c', tanggal: '2025-07-05', nominal: -20000, urutan: 2, dibuatPada: '2025-07-05T00:00:00Z', deskripsi: 'C' },
    { id: 'a', tanggal: '2025-07-05', nominal: -10000, urutan: 0, dibuatPada: '2025-07-05T00:00:02Z', deskripsi: 'A' },
  ];
  const hasil = bukuKas(trx, 100000);

  assert.deepEqual(hasil.baris.map((b) => b.deskripsi), ['A', 'B', 'C']);
  assert.deepEqual(hasil.baris.map((b) => b.saldoBerjalan), [90000, 60000, 40000]);
});

/* ==========================================================================
   5. Daftar aset service worker
   ========================================================================== */

function berkasJs(dir) {
  return readdirSync(dir).flatMap((nama) => {
    const jalur = join(dir, nama);
    if (statSync(jalur).isDirectory()) return berkasJs(jalur);
    return nama.endsWith('.js') ? [relative(AKAR, jalur).split(sep).join('/')] : [];
  });
}

test('service worker menyimpan SETIAP modul src/ untuk dipakai offline', () => {
  const sw = readFileSync(join(AKAR, 'service-worker.js'), 'utf8');
  const daftar = sw.split('const ASET = [')[1].split('];')[0];
  const aset = new Set([...daftar.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]));

  const hilang = berkasJs(join(AKAR, 'src')).filter((f) => !aset.has(f));
  assert.deepEqual(hilang, [], 'modul ini tidak akan tersedia offline setelah CACHE_NAME dinaikkan');
});

test('service worker tidak menyimpan berkas src/ yang sudah tidak ada', () => {
  const sw = readFileSync(join(AKAR, 'service-worker.js'), 'utf8');
  const daftar = sw.split('const ASET = [')[1].split('];')[0];
  const aset = [...daftar.matchAll(/'\.\/(src\/[^']+)'/g)].map((m) => m[1]);
  const ada = new Set(berkasJs(join(AKAR, 'src')));

  assert.deepEqual(aset.filter((f) => !ada.has(f)), []);
});

/* ==========================================================================
   6. gmailMessageId kembar dalam satu tarikan
   ========================================================================== */

test('gmailMessageId kembar dalam satu tarikan disaring, bukan membatalkan seluruh simpan', () => {
  const baris = [
    { gmailMessageId: 'm1', nominal: 10000 },
    { gmailMessageId: 'm2', nominal: 20000 },
    { gmailMessageId: 'm1', nominal: 10000 },
  ];
  const hasil = saringBarisBaru(baris, new Set());

  assert.deepEqual(hasil.map((b) => b.gmailMessageId), ['m1', 'm2']);
});

test('baris ber-gmailMessageId kosong juga cuma boleh lolos satu kali', () => {
  const hasil = saringBarisBaru([{ nominal: 1 }, { gmailMessageId: '', nominal: 2 }], new Set());
  assert.equal(hasil.length, 1);
});

test('yang sudah tersimpan tetap dilewati seperti sebelumnya', () => {
  const hasil = saringBarisBaru([{ gmailMessageId: 'm1' }, { gmailMessageId: 'm2' }], new Set(['m1']));
  assert.deepEqual(hasil.map((b) => b.gmailMessageId), ['m2']);
});

/* ==========================================================================
   7. Saldo Awal rekening diambil dari statement PALING AWAL

   Skenario di bawah bukan karangan: angkanya diambil apa adanya dari tab
   "Statement", "Akun", dan "Kontrol Saldo" pada pembukuan produksi
   (rekening Permata), tempat kesalahan ini menggeser seluruh saldo hitungan
   sebesar Rp 8.012.650 dan membuat 21 dari 21 bulan dilaporkan ❌.
   ========================================================================== */

/** Urutannya sengaja acak: yang menentukan periode, bukan urutan pemanggilan. */
const UPLOAD_PERMATA = [
  { id: 'upl_mei25', periodeAwal: '2025-05-04', saldoAwalStatement: 11669299 },
  { id: 'upl_des24', periodeAwal: '2024-12-01', saldoAwalStatement: 3656649 },
  { id: 'upl_apr25', periodeAwal: '2025-04-01', saldoAwalStatement: 11824666 },
  { id: 'upl_agu26', periodeAwal: '2026-08-01', saldoAwalStatement: 454954 },
];

test('statement terawal dikenali dari periode, bukan dari urutan upload', () => {
  const t = statementTerawalBersaldo(UPLOAD_PERMATA);
  assert.equal(t.id, 'upl_des24');
  assert.equal(t.nilai, 3656649);
});

test('saldo awal yang terlanjur diisi statement bukan-terawal dikoreksi', () => {
  // Rp 11.669.299 = Saldo Awal statement Mei 2025, yang kebetulan di-upload
  // paling dulu. Statement Desember 2024 menyusul belakangan.
  assert.equal(koreksiSaldoAwalAkun(11669299, UPLOAD_PERMATA), 3656649);
  assert.equal(11669299 - 3656649, 8012650, 'persis selisih yang dilaporkan Kontrol Saldo');
});

test('saldo awal yang sudah benar tidak disentuh', () => {
  assert.equal(koreksiSaldoAwalAkun(3656649, UPLOAD_PERMATA), null);
});

test('rekening yang saldo awalnya masih kosong diisi dari statement terawal', () => {
  assert.equal(koreksiSaldoAwalAkun(0, UPLOAD_PERMATA), 3656649);
  assert.equal(koreksiSaldoAwalAkun(null, UPLOAD_PERMATA), 3656649);
  assert.equal(koreksiSaldoAwalAkun(undefined, UPLOAD_PERMATA), 3656649);
});

test('angka yang diketik sendiri oleh pengguna tidak pernah ditimpa', () => {
  // 7.500.000 tidak sama dengan Saldo Awal statement mana pun -> milik pengguna.
  assert.equal(koreksiSaldoAwalAkun(7500000, UPLOAD_PERMATA), null);
});

test('rekening tanpa statement bersaldo dibiarkan apa adanya', () => {
  // Seluruh 23 statement BCA pada pembukuan produksi tidak menyimpan Saldo
  // Awal — jalur ini tidak boleh menebak angka apa pun untuk mereka.
  const tanpaSaldo = [
    { id: 'u1', periodeAwal: '2025-07-01', saldoAwalStatement: null },
    { id: 'u2', periodeAwal: '2025-08-01', saldoAwalStatement: '' },
  ];
  assert.equal(statementTerawalBersaldo(tanpaSaldo), null);
  assert.equal(koreksiSaldoAwalAkun(0, tanpaSaldo), null);
  assert.equal(koreksiSaldoAwalAkun(2181262, tanpaSaldo), null);
  assert.equal(koreksiSaldoAwalAkun(0, []), null);
});

test('saldo awal nol yang memang benar tidak dilaporkan sebagai perubahan', () => {
  const nol = [{ id: 'u1', periodeAwal: '2025-01-01', saldoAwalStatement: 0 }];
  assert.equal(koreksiSaldoAwalAkun(0, nol), null);
  assert.equal(koreksiSaldoAwalAkun(null, nol), null);
});
