import test from 'node:test';
import assert from 'node:assert/strict';

import { parseStatement } from '../src/parsers/registry.js';
import { susunBaris, rangkaiTeks } from '../src/parsers/layout.js';
import { deteksiBank, bacaKepala, ADAPTER } from '../src/parsers/detect.js';
import { parseAngka } from '../src/core/format.js';
import { parseTanggal } from '../src/core/dates.js';
import { validasiBaris, cocokkanRingkasan } from '../src/domain/validate.js';
import { rapikanDeskripsi, barisChrome, potongChrome } from '../src/parsers/util.js';
import {
  statementBCA, statementBCAAgustus, statementBCAAkhirTahun, statementBCADuaHalaman,
  statementPermataRekeningKoran, statementGenerikTanpaHeader, baris,
  statementPermataKakiDiPitaUraian, statementBCADisclaimerRenggang,
} from './fixtures/statements.js';

/* ==========================================================================
   Pembacaan angka dan tanggal
   ========================================================================== */

test('parseAngka membaca format Indonesia dan internasional', () => {
  assert.equal(parseAngka('1.234.567,89'), 1234567.89);
  assert.equal(parseAngka('1,234,567.89'), 1234567.89);
  assert.equal(parseAngka('15.000,00'), 15000);
  assert.equal(parseAngka('1.500'), 1500);
  assert.equal(parseAngka('1234,89'), 1234.89);
  assert.equal(parseAngka('500.000,00 DB'), 500000);
  assert.equal(parseAngka('(250.000,00)'), -250000);
  assert.equal(parseAngka('-75.000'), -75000);
  assert.equal(parseAngka('bukan angka'), null);
  assert.equal(parseAngka(''), null);
});

test('parseTanggal menangani format yang lazim di statement bank', () => {
  assert.equal(parseTanggal('25/07/2025'), '2025-07-25');
  assert.equal(parseTanggal('25-07-25'), '2025-07-25');
  assert.equal(parseTanggal('2025-07-25'), '2025-07-25');
  assert.equal(parseTanggal('25 Jul 2025'), '2025-07-25');
  assert.equal(parseTanggal('25 Juli 2025'), '2025-07-25');
  assert.equal(parseTanggal('05/07', 2025), '2025-07-05');
  assert.equal(parseTanggal('31/02/2025'), null, 'tanggal yang tidak ada harus ditolak');
  assert.equal(parseTanggal('05/07'), null, 'tanpa tahun acuan tidak boleh menebak');
});

/* ==========================================================================
   Penyusunan baris dari koordinat
   ========================================================================== */

test('susunBaris mengelompokkan potongan sejajar jadi satu baris', () => {
  const potongan = [
    ...baris(700, [[40, '01/07'], [95, 'SALDO AWAL'], [470, '10.000.000,00']]),
    ...baris(686, [[40, '02/07'], [95, 'TRSF'], [470, '15.000.000,00']]),
    // Selisih 1pt masih dianggap satu baris dengan yang di atasnya.
    ...baris(685, [[520, 'CR']]),
  ];

  const hasil = susunBaris(potongan);
  assert.equal(hasil.length, 2);
  assert.equal(hasil[0].teks, '01/07 SALDO AWAL 10.000.000,00');
  assert.ok(hasil[1].teks.endsWith('CR'), 'potongan dengan selisih 1pt ikut baris kedua');
  assert.ok(hasil[0].y > hasil[1].y, 'baris diurutkan dari atas ke bawah');
});

test('rangkaiTeks menyisipkan spasi pada jarak antar kolom', () => {
  const items = baris(700, [[40, 'TANGGAL'], [200, 'KETERANGAN']]);
  assert.equal(rangkaiTeks(items), 'TANGGAL KETERANGAN');
});

/* ==========================================================================
   Deteksi bank dan kepala berkas
   ========================================================================== */

test('deteksiBank mengenali BCA dan Permata', () => {
  assert.equal(deteksiBank('PT. BANK CENTRAL ASIA Tbk').adapter, ADAPTER.BCA);
  assert.equal(deteksiBank('PermataBank').adapter, ADAPTER.PERMATA);
  assert.equal(deteksiBank('BANK PERMATA').bank, 'Permata');
  assert.equal(deteksiBank('Koperasi Simpan Pinjam').adapter, ADAPTER.GENERIK);
});

test('deteksiBank mengenali BCA dari judul kolom walau kata "BCA" tidak bersih di kop', () => {
  // Statement BCA "Rekening Tahapan" sungguhan: kata "BCA" hanya muncul di
  // paragraf disclaimer yang tercetak dengan jarak antar huruf ("B C A"), jadi
  // tidak cocok dengan pola nama bank. Tanpa judul kolom sebagai penanda, deteksi
  // jatuh ke pemindaian seluruh dokumen dan bisa salah kena nama bank lawan
  // transaksi di uraian (mis. "LLG-BANK JAGO" pada transfer masuk).
  const kop = [
    'REKENING TAHAPAN',
    'BIMO SAPUTRO NO. REKENING : 6090378994',
    'PERIODE : JULI 2026',
    'C A T A T A N :',
    '• B C A b e r h a k s e t i a p s a a t m e l a k u k a n k o r e k s i',
    'TANGGAL KETERANGAN CBG MUTASI SALDO',
    '01/07 SALDO AWAL 2,428,676.44',
  ].join('\n');
  const isiPenuh = `${kop}\n06/07 KR OTOMATIS LLG-BANK JAGO 0938 2,346,168.00`;

  const hasil = deteksiBank(isiPenuh, kop);
  assert.equal(hasil.adapter, ADAPTER.BCA);
  assert.equal(hasil.bank, 'BCA');
});

test('tanda penerbit di kaki halaman mengalahkan nama bank lawan transaksi di kop', () => {
  /* Kejadian sungguhan: satu rekening koran Permata terbaca sebagai BCA, lalu
     59 transaksinya masuk ke rekening BCA — saldo dua rekening ikut salah.
     Penyebabnya urutan potongan teks hasil ekstraksi PDF: 25 baris pertama
     halaman satu berisi baris transaksi, bukan kop, sehingga yang terbaca di
     "kop" hanya nama bank TUJUAN transfer. */
  const kop = [
    '01/08 TRF BIFAST KE LIM KHENG HONG 230300 275.000,00 36.172.275,00',
    '2901 BANK CENTRAL ASIA Permata ME 09:45:27 - 000027308218',
    '04/08 TRF BIFAST KE HANDI AGUNG 758014963 1.344.000,00 34.828.275,00',
    '9 BANK CENTRAL ASIA Permata ME 14:52:01 - 000027687442',
  ].join('\n');
  const isiPenuh = `${kop}\nPermataBank.com | Permata Tel 1500-111 atau (021) 2985-0611\nNo.CIF B0024WQ`;

  const hasil = deteksiBank(isiPenuh, kop);
  assert.equal(hasil.bank, 'Permata', 'alamat situs penerbit tidak mungkin jadi uraian transaksi');
  assert.equal(hasil.adapter, ADAPTER.PERMATA);
});

test('nama bank di kop tetap menang bila tidak ada tanda penerbit yang eksklusif', () => {
  // Tanpa tanda eksklusif, aturan lama berlaku: kop lebih dipercaya daripada
  // seluruh dokumen, justru supaya nama bank lawan transaksi tidak menang.
  const kop = 'PT BANK PERMATA Tbk\nNO. REKENING : 1238847210';
  const isiPenuh = `${kop}\nTRF BIFAST KE BUDI BANK CENTRAL ASIA\nTRF BIFAST KE ANI BANK CENTRAL ASIA`;

  assert.equal(deteksiBank(isiPenuh, kop).bank, 'Permata');
});

test('dua tanda penerbit berbeda mengembalikan keputusan ke kop', () => {
  // Beberapa statement yang digabung jadi satu berkas: tidak ada penerbit
  // tunggal yang bisa dipastikan, jadi menebak lebih buruk daripada memakai kop.
  const kop = 'PT. BANK CENTRAL ASIA Tbk\nNO. REKENING : 6090378994';
  const isiPenuh = `${kop}\nwww.bca.co.id\nPermataBank.com`;

  assert.equal(deteksiBank(isiPenuh, kop).bank, 'BCA');
});

test('bacaKepala mengambil nomor rekening, nama, dan periode', () => {
  const kepala = bacaKepala([
    'PT. BANK CENTRAL ASIA Tbk',
    'NO. REKENING : 1234567890',
    'NAMA : BUDI SANTOSO',
    'PERIODE : JULI 2025',
  ].join('\n'));

  assert.equal(kepala.bank, 'BCA');
  assert.equal(kepala.nomorRekening, '1234567890');
  assert.equal(kepala.namaPemilik, 'BUDI SANTOSO');
  assert.equal(kepala.periode.tahun, 2025);
  assert.equal(kepala.periode.bulanIdx, 6);
});

/* ==========================================================================
   Adapter BCA
   ========================================================================== */

test('adapter BCA membaca seluruh transaksi dengan arah yang benar', () => {
  const hasil = parseStatement([statementBCA()]);

  assert.equal(hasil.kodeAdapter, ADAPTER.BCA);
  assert.equal(hasil.bank, 'BCA');
  assert.equal(hasil.nomorRekening, '1234567890');
  assert.equal(hasil.namaPemilik, 'BUDI SANTOSO');
  assert.equal(hasil.transaksi.length, 6, 'baris SALDO AWAL tidak dihitung sebagai transaksi');

  const [t1, t2, t3, t4, t5, t6] = hasil.transaksi;

  assert.equal(t1.tanggal, '2025-07-02');
  assert.equal(t1.nominal, 5000000, 'tanpa akhiran DB berarti transaksi masuk');
  assert.equal(t1.saldo, 15000000);
  assert.ok(t1.deskripsi.includes('TRSF E-BANKING CR'));
  assert.ok(t1.deskripsi.includes('JAYA KONSTRUKSI'), 'baris lanjutan digabung ke deskripsi');

  assert.equal(t2.nominal, -15000, 'akhiran DB berarti transaksi keluar');
  assert.equal(t3.nominal, -20000);
  assert.equal(t4.nominal, -20000);
  assert.equal(t5.nominal, -1500000);
  assert.ok(t5.deskripsi.includes('SUPPLIER BESI'));
  assert.equal(t6.nominal, -3000000);

  assert.equal(hasil.saldoAwal, 10000000);
  assert.equal(hasil.periodeAwal, '2025-07-02');
  assert.equal(hasil.periodeAkhir, '2025-07-25');
});

test('adapter BCA menaikkan tahun saat statement melewati Desember', () => {
  const hasil = parseStatement([statementBCAAkhirTahun()]);
  assert.equal(hasil.transaksi[0].tanggal, '2024-12-30');
  assert.equal(hasil.transaksi[1].tanggal, '2025-01-02', 'Januari sesudah Desember masuk tahun berikutnya');
});

test('total hasil parsing BCA cocok dengan ringkasan di statement', () => {
  const hasil = parseStatement([statementBCA()]);
  const cek = cocokkanRingkasan(hasil.transaksi, hasil.ringkasan);

  assert.ok(cek, 'ringkasan MUTASI CR/DB harus terbaca');
  assert.ok(cek.semuaCocok, `ada total yang tidak cocok: ${JSON.stringify(cek.cek)}`);
});

test('kop dan disclaimer yang dicetak ulang di halaman kedua tidak tersambung ke deskripsi transaksi', () => {
  const hasil = parseStatement(statementBCADuaHalaman());

  assert.equal(hasil.transaksi.length, 2, '"SALDO AWAL" bukan transaksi, hanya saldo pembuka');

  const trxTerakhirHal1 = hasil.transaksi[0];
  assert.equal(trxTerakhirHal1.tanggal, '2025-07-02');
  assert.ok(
    !/KETENTUAN/i.test(trxTerakhirHal1.deskripsi),
    `deskripsi tercemar baris halaman berikutnya: "${trxTerakhirHal1.deskripsi}"`,
  );
  assert.equal(trxTerakhirHal1.deskripsi, 'TRSF E-BANKING DB PEMBAYARAN GRAB');

  // Transaksi di halaman kedua tetap terbaca dengan benar setelah tutup() per halaman.
  assert.equal(hasil.transaksi[1].tanggal, '2025-07-10');
  assert.equal(hasil.transaksi[1].deskripsi, 'BIAYA ADM');

  const cek = cocokkanRingkasan(hasil.transaksi, hasil.ringkasan);
  assert.ok(cek?.semuaCocok, `ada total yang tidak cocok: ${JSON.stringify(cek?.cek)}`);
});

/* ==========================================================================
   Adapter Permata
   ========================================================================== */

test('adapter Permata membaca rekening koran: kolom debet/kredit, dua kolom tanggal, tanggal DD/MM', () => {
  const hasil = parseStatement(statementPermataRekeningKoran());

  assert.equal(hasil.kodeAdapter, ADAPTER.PERMATA);
  assert.equal(hasil.bank, 'Permata');
  assert.equal(hasil.nomorRekening, '1238847210');
  assert.equal(hasil.periodeAwal, '2025-07-01', 'periode diambil dari kop, bukan tanggal transaksi pertama');
  assert.equal(hasil.periodeAkhir, '2025-07-31');
  assert.equal(hasil.transaksi.length, 6,
    'halaman sampul, disclaimer, SALDO AWAL, dan baris Total tidak ikut terhitung');

  const [t1, t2, t3, t4, t5, t6] = hasil.transaksi;

  // Tahun tidak tertulis di baris transaksi; diambil dari "Periode Laporan".
  assert.equal(t1.tanggal, '2025-07-02');
  assert.equal(t1.nominal, -189500, 'angka di kolom Debet berarti keluar');
  assert.ok(t1.deskripsi.startsWith('PAY TOKOPEDIA'));
  assert.ok(!/189\.500|646\.862/.test(t1.deskripsi), 'nominal tidak boleh tercampur ke uraian');

  assert.equal(t2.nominal, 18360430, 'angka di kolom Kredit berarti masuk');
  assert.ok(t2.deskripsi.includes('Bonus'), 'uraian tiga baris tergabung utuh');
  assert.ok(!/0897188808600101$/.test('') && t2.deskripsi.includes('0897188808600101'),
    'nomor referensi panjang tetap bagian uraian, bukan dibaca sebagai uang');

  assert.equal(t3.nominal, -107100);
  assert.equal(t4.nominal, -17000000);
  assert.equal(t5.nominal, 2719);
  assert.equal(t6.nominal, -544);
  assert.equal(t6.saldo, 1902367);
  assert.equal(hasil.saldoAwal, 836362);
});

test('total debet dan kredit pada baris penutup dipakai memastikan tak ada baris terlewat', () => {
  const hasil = parseStatement(statementPermataRekeningKoran());
  const cek = cocokkanRingkasan(hasil.transaksi, hasil.ringkasan);

  assert.ok(cek, 'baris Total harus terbaca sebagai ringkasan');
  assert.ok(cek.semuaCocok, `ada total yang tidak cocok: ${JSON.stringify(cek.cek)}`);

  const { ringkas } = validasiBaris(hasil.transaksi);
  assert.equal(ringkas.curiga, 0, 'saldo berjalan harus nyambung di seluruh baris');
  assert.equal(ringkas.adaKolomSaldo, true);
});

test('nama bank lain di uraian transaksi tidak mengalahkan penerbit statement', () => {
  // Uraian memuat "BANK CENTRAL ASIA" sebagai bank tujuan transfer, sedangkan
  // penerbitnya Permata. Dulu hal ini membuat statement Permata dikira BCA.
  const hasil = parseStatement(statementPermataRekeningKoran());
  assert.equal(hasil.bank, 'Permata');
  assert.ok(hasil.teksMentah.includes('BANK CENTRAL ASIA'), 'uraian memang memuat nama bank lain');
});

/* ==========================================================================
   Adapter generik
   ========================================================================== */

test('adapter generik menyimpulkan arah transaksi dari perubahan saldo', () => {
  const hasil = parseStatement([statementGenerikTanpaHeader()]);

  assert.equal(hasil.kodeAdapter, ADAPTER.GENERIK);
  assert.equal(hasil.transaksi.length, 4);

  const nominal = hasil.transaksi.map((t) => t.nominal);
  assert.deepEqual(nominal, [1000000, -250000, -500000, 750000]);
  assert.equal(hasil.transaksi[0].tanggal, '2025-07-02');
  assert.equal(hasil.transaksi[3].saldo, 3000000);
});

/* ==========================================================================
   Validasi saldo berjalan
   ========================================================================== */

test('validasiBaris menandai baris yang saldonya tidak nyambung', () => {
  const { baris: hasil, ringkas } = validasiBaris([
    { tanggal: '2025-07-01', deskripsi: 'A', nominal: 1000, saldo: 11000 },
    { tanggal: '2025-07-02', deskripsi: 'B', nominal: -500, saldo: 10500 },
    { tanggal: '2025-07-03', deskripsi: 'C', nominal: -500, saldo: 9000 },
  ]);

  assert.equal(ringkas.curiga, 1);
  assert.equal(hasil[1].curiga, false);
  assert.equal(hasil[2].curiga, true, 'selisih saldo 1.000 padahal mutasi 500');
});

test('validasiBaris tidak salah menandai bila saldo hanya tercetak pada sebagian baris', () => {
  // Statement BCA sungguhan tidak mencetak saldo di setiap baris. Baris tanpa
  // saldo di antara dua baris bersaldo tetap harus ikut dijumlahkan sebelum
  // dibandingkan — sebelum diperbaiki, tiap baris sesudah baris tak-bersaldo
  // salah ditandai padahal mutasinya benar.
  const { baris: hasil, ringkas } = validasiBaris([
    { tanggal: '2025-07-01', deskripsi: 'Saldo awal', nominal: 100000, saldo: 2000000 },
    { tanggal: '2025-07-01', deskripsi: 'Tanpa saldo 1', nominal: -50000, saldo: null },
    { tanggal: '2025-07-01', deskripsi: 'Tanpa saldo 2', nominal: -30000, saldo: null },
    { tanggal: '2025-07-02', deskripsi: 'Bersaldo lagi', nominal: -20000, saldo: 1900000 },
  ]);

  assert.equal(ringkas.curiga, 0);
  assert.equal(hasil.every((b) => !b.curiga), true);
});

test('validasiBaris tidak mengeluh bila statement tidak punya kolom saldo', () => {
  const { ringkas } = validasiBaris([
    { tanggal: '2025-07-01', deskripsi: 'A', nominal: 1000, saldo: null },
    { tanggal: '2025-07-02', deskripsi: 'B', nominal: -500, saldo: null },
  ]);
  assert.equal(ringkas.adaKolomSaldo, false);
  assert.equal(ringkas.curiga, 0);
});

/* ==========================================================================
   Statement bulan berikutnya tetap terbaca sebagai kelanjutan
   ========================================================================== */

test('statement bulan berikutnya terbaca dengan periode yang benar', () => {
  const juli = parseStatement([statementBCA()]);
  const agustus = parseStatement([statementBCAAgustus()]);

  assert.equal(agustus.nomorRekening, juli.nomorRekening, 'rekening yang sama');
  assert.equal(agustus.periodeAwal, '2025-08-04');
  assert.equal(agustus.transaksi.length, 2);
  assert.equal(agustus.transaksi[0].nominal, 2000000);
  assert.equal(agustus.transaksi[1].nominal, -450000);
});

/* ==========================================================================
   Cetakan statement yang menyusup ke uraian transaksi
   ========================================================================== */

test('rapikanDeskripsi memotong kaki halaman dan disclaimer berhuruf renggang', () => {
  assert.equal(
    rapikanDeskripsi('TRANSAKSI DEBIT TGL: 08/07 QR 013 00000.00Pecel lele m e l a k u k a n s a n g g a h a n a t a s'),
    'TRANSAKSI DEBIT TGL: 08/07 QR 013 00000.00Pecel lele',
  );
  assert.equal(
    rapikanDeskripsi('PENDAPATAN BUNGA PermataBank.com Permata Tel 1500-111 atau (021) 2985-0611'),
    'PENDAPATAN BUNGA',
  );
  assert.equal(
    rapikanDeskripsi('PAJAK ATAS BUNGA Account Statement Periode Laporan BIMO CONTOH 01 AGUSTUS 2025'),
    'PAJAK ATAS BUNGA',
  );
});

test('nama bank lawan transaksi tidak ikut terpotong', () => {
  // Batas yang paling mudah keliru: "BANK CENTRAL ASIA" adalah uraian yang sah
  // pada statement Permata, bukan tanda penerbit.
  const uraian = 'TRF BIFAST KE ASROF 7151357010 BANK CENTRAL ASIA Permata ME 09:23:38 - 000027756132';
  assert.equal(rapikanDeskripsi(uraian), uraian);
  assert.equal(potongChrome(uraian), uraian);
  assert.equal(barisChrome(uraian), false);
});

test('barisChrome hanya benar untuk baris yang seluruhnya cetakan statement', () => {
  assert.equal(barisChrome('PermataBank.com | Permata Tel 1500-111 atau (021) 2985-0611'), true);
  assert.equal(barisChrome('m e l a k u k a n s a n g g a h a n a t a s L a p o r a n'), true);
  assert.equal(barisChrome('ta ME 00:36:08 750888291177279'), false, 'sambungan uraian harus lolos');
  assert.equal(barisChrome(''), false);
});

test('adapter Permata tidak menyambung kaki halaman ke uraian transaksi', () => {
  const hasil = parseStatement(statementPermataKakiDiPitaUraian());

  assert.equal(hasil.transaksi.length, 1);
  const [t] = hasil.transaksi;
  // Tanda hubung di ujung dibuang rapikanDeskripsi sejak semula, bukan efek
  // pemotongan cetakan statement.
  assert.equal(t.deskripsi, 'PB KE GIANI CONTOH 1238840550 Perm ata ME 09:33:46');
  assert.ok(!/PermataBank\.com/i.test(t.deskripsi));
  assert.ok(!/Periode Laporan/i.test(t.deskripsi));
});

test('adapter BCA tidak menyambung disclaimer berhuruf renggang ke uraian transaksi', () => {
  const hasil = parseStatement([statementBCADisclaimerRenggang()]);

  assert.equal(hasil.transaksi.length, 2);
  const [t1, t2] = hasil.transaksi;
  assert.equal(t1.deskripsi, 'TRANSAKSI DEBIT TGL: 08/07 QR 013 00000.00Pecel lele');
  assert.equal(t1.nominal, -25000);
  assert.equal(t2.deskripsi, 'QRIS DEBIT ALFAMART', 'transaksi sesudah disclaimer tetap terbaca');
});
