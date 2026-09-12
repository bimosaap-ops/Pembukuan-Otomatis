/**
 * Tes reparseEmailGagal() dan format kolom RRN/Nomor Referensi di
 * sheets/Code.gs — keduanya BUTUH tiruan Sheets (baca/tulis sel), beda dari
 * parseEmailBCA/Permata yang murni. Tiruan di sini sengaja minimal (hanya
 * dukung getRange/getValues/setValues/getLastRow yang dipakai fungsi ini),
 * tidak selengkap tests/dashboard-sheet.test.js yang juga menguji rumus.
 *
 * Konteks bug yang diuji di sini: verifikasi produksi pertama menemukan
 * bahwa email yang gagal parse (mis. template BCA belum dikenal) tertahan
 * PERMANEN gagal walau parsernya sudah diperbaiki, karena baris di
 * "_EmailMasuk" tidak pernah dicoba ulang. reparseEmailGagal() menutup
 * celah itu dengan mem-parse ulang dari teks yang sudah tersimpan, tanpa
 * menyentuh Gmail lagi.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../sheets/Code.gs', import.meta.url), 'utf8');

function buatSheetTiruan(nama) {
  const data = []; // data[0] = baris 1 (header), dst -- sengaja 0-indexed di sini, dikonversi di getRange
  const rangeStub = () => ({ setFontWeight: () => rangeStub(), setFontColor: () => rangeStub(), setBackground: () => rangeStub(), setVerticalAlignment: () => rangeStub(), setNumberFormat: () => rangeStub() });
  return {
    _data: data,
    appendRow(row) { data.push(row.slice()); },
    getLastRow() { return data.length; },
    getMaxRows() { return 1000; },
    setFrozenRows() {},
    setTabColor() {},
    hideSheet() {},
    getRange(r, c, nRows, nCols) {
      if (nRows === undefined) return rangeStub();
      const range = {
        getValues() {
          const out = [];
          for (let i = 0; i < nRows; i += 1) {
            const baris = data[r - 1 + i] || [];
            out.push(Array.from({ length: nCols }, (_, j) => (baris[c - 1 + j] === undefined ? '' : baris[c - 1 + j])));
          }
          return out;
        },
        setValues(matriks) {
          matriks.forEach((barisArr, i) => {
            const idx = r - 1 + i;
            if (!data[idx]) data[idx] = [];
            barisArr.forEach((v, j) => { data[idx][c - 1 + j] = v; });
          });
          return range;
        },
        setFontWeight: () => range,
        setFontColor: () => range,
        setBackground: () => range,
        setVerticalAlignment: () => range,
        setNumberFormat: () => range,
      };
      return range;
    },
  };
}

function buatSpreadsheetTiruan() {
  const sheets = {};
  return {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => { sheets[n] = buatSheetTiruan(n); return sheets[n]; },
    getNumSheets: () => Object.keys(sheets).length,
    _sheets: sheets,
  };
}

function muatApi(ss) {
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    console: { warn: () => {}, log: () => {} },
  };
  return new Function(...Object.keys(sandbox),
    `${src}\n; return { reparseEmailGagal, pastikanEmailMasuk, pastikanTransaksiEmail, HEADER_EMAIL_MASUK, HEADER_TRANSAKSI_EMAIL };`)(...Object.values(sandbox));
}

// Teks asli (nama/rekening disamarkan) untuk sub-template transfer BCA --
// persis yang gagal di verifikasi produksi pertama sebelum parser diperbaiki.
const EMAIL_BCA_TRANSFER = `
Status : Berhasil
Tanggal Transaksi : 11 Sep 2026 23:51:56
Jenis Transfer : Transfer ke rekening BCA
Nama Penerima : PENERIMA CONTOH
Nominal Tujuan : IDR 3,000,000.00
Nomor Referensi : 82810E1E-936E-4C63-8C72-AD6AC4496318
`;

test('reparseEmailGagal: baris gagal yang kini terparse -> Berhasil Diparse jadi TRUE, baris baru masuk Transaksi Email', () => {
  const ss = buatSpreadsheetTiruan();
  const api = muatApi(ss);
  const emailMasuk = api.pastikanEmailMasuk(ss);
  api.pastikanTransaksiEmail(ss);

  emailMasuk.appendRow([
    'msg_transfer_1', 'BCA', 'BCA <bca@bca.co.id>', 'Internet Transaction Journal',
    new Date(), EMAIL_BCA_TRANSFER, false, 'Field minimum tidak ditemukan', new Date(),
  ]);

  const hasil = api.reparseEmailGagal();
  assert.equal(hasil.diperbaiki, 1);

  const barisSetelah = emailMasuk.getRange(2, 1, 1, api.HEADER_EMAIL_MASUK.length).getValues()[0];
  assert.equal(barisSetelah[6], true, 'Berhasil Diparse harus jadi TRUE di baris yang sama, bukan baris baru');
  assert.equal(barisSetelah[7], '', 'Pesan Error harus dikosongkan');
  assert.equal(emailMasuk.getLastRow(), 2, 'tidak boleh ada baris _EmailMasuk yang digandakan');

  const transaksiEmail = api.pastikanTransaksiEmail(ss);
  assert.equal(transaksiEmail.getLastRow(), 2, 'header + 1 baris hasil reparse');
  const baris = transaksiEmail.getRange(2, 1, 1, api.HEADER_TRANSAKSI_EMAIL.length).getValues()[0];
  assert.equal(baris[0], 'msg_transfer_1');
  assert.equal(baris[3], 3000000);
  assert.equal(baris[5], 'PENERIMA CONTOH');
});

test('reparseEmailGagal: dipanggil dua kali tidak menggandakan baris Transaksi Email', () => {
  const ss = buatSpreadsheetTiruan();
  const api = muatApi(ss);
  const emailMasuk = api.pastikanEmailMasuk(ss);
  api.pastikanTransaksiEmail(ss);

  emailMasuk.appendRow([
    'msg_transfer_2', 'BCA', 'BCA <bca@bca.co.id>', 'Internet Transaction Journal',
    new Date(), EMAIL_BCA_TRANSFER, false, 'Field minimum tidak ditemukan', new Date(),
  ]);

  api.reparseEmailGagal();
  const hasilKedua = api.reparseEmailGagal();

  assert.equal(hasilKedua.diperbaiki, 0, 'baris yang sudah Berhasil Diparse=TRUE tidak diproses ulang');
  const transaksiEmail = api.pastikanTransaksiEmail(ss);
  assert.equal(transaksiEmail.getLastRow(), 2, 'panggilan kedua tidak boleh menambah baris lagi');
});

test('reparseEmailGagal: baris yang masih gagal dengan parser sekarang dibiarkan apa adanya', () => {
  const ss = buatSpreadsheetTiruan();
  const api = muatApi(ss);
  const emailMasuk = api.pastikanEmailMasuk(ss);
  api.pastikanTransaksiEmail(ss);

  emailMasuk.appendRow([
    'msg_masih_gagal', 'BCA', 'BCA <bca@bca.co.id>', 'Internet Transaction Journal',
    new Date(), 'Email BCA format yang belum pernah dilihat parser sama sekali.', false, 'Field minimum tidak ditemukan', new Date(),
  ]);

  const hasil = api.reparseEmailGagal();
  assert.equal(hasil.diperbaiki, 0);

  const baris = emailMasuk.getRange(2, 1, 1, api.HEADER_EMAIL_MASUK.length).getValues()[0];
  assert.equal(baris[6], false, 'tetap FALSE -- jangan ditandai berhasil kalau memang belum berhasil');
});

test('pastikanTransaksiEmail: format teks kolom RRN/Nomor Referensi terpasang meski tab SUDAH ada sebelumnya', () => {
  // Regresi: perbaikan format sebelumnya cuma dipasang di dalam blok
  // "tab belum ada", jadi tidak pernah sampai ke tab yang sudah lebih dulu
  // dibuat pengguna (persis yang terjadi di produksi). Tes ini memanggil
  // pastikanTransaksiEmail() DUA KALI -- panggilan kedua mensimulasikan
  // "tab sudah ada" -- dan memastikan setNumberFormat tetap terpanggil di
  // panggilan kedua lewat penanda pada tiruan Range.
  const ss = buatSpreadsheetTiruan();
  const api = muatApi(ss);
  let dipanggil = 0;
  api.pastikanTransaksiEmail(ss); // panggilan pertama: tab dibuat

  const t = ss.getSheetByName('Transaksi Email');
  const asli = t.getRange.bind(t);
  t.getRange = (...a) => {
    const r = asli(...a);
    const asliFormat = r.setNumberFormat.bind(r);
    r.setNumberFormat = (...fa) => { dipanggil += 1; return asliFormat(...fa); };
    return r;
  };

  api.pastikanTransaksiEmail(ss); // panggilan kedua: tab SUDAH ada
  assert.ok(dipanggil > 0, 'setNumberFormat harus tetap terpanggil walau tab sudah ada dari sebelumnya');
});

test('pastikanTransaksiEmail: rentang format kolom RRN/Nomor Referensi mengikuti baris terisi, bukan kapasitas sheet penuh', () => {
  // Regresi terhadap percobaan pertama: memformat getMaxRows() (~1000) tiap
  // kali fungsi ini dipanggil membuat tab tampak berisi ~1000 baris begitu
  // dibuka di Sheets, padahal datanya cuma segelintir -- ditemukan lewat
  // verifikasi produksi (Transaksi Email melompat dari 9 jadi 999 baris).
  const ss = buatSpreadsheetTiruan();
  const api = muatApi(ss);
  api.pastikanTransaksiEmail(ss);

  const t = ss.getSheetByName('Transaksi Email');
  t.appendRow(['msg_1', 'BCA', new Date(), 1000, 'debit', 'A', 'B', '', '', '1', 'ref1', 'bca-v1', 'high', new Date()]);
  t.appendRow(['msg_2', 'BCA', new Date(), 2000, 'debit', 'C', 'D', '', '', '2', 'ref2', 'bca-v1', 'high', new Date()]);

  const nRowsTerpanggil = [];
  const asli = t.getRange.bind(t);
  t.getRange = (r, c, nRows, nCols) => {
    if (c === 10) nRowsTerpanggil.push(nRows);
    return asli(r, c, nRows, nCols);
  };

  api.pastikanTransaksiEmail(ss); // tab sudah ada, 2 baris data (+ header)

  assert.ok(nRowsTerpanggil.length > 0, 'harus ada pemanggilan getRange di kolom J (RRN)');
  nRowsTerpanggil.forEach((n) => {
    assert.ok(n <= 5, `rentang format (${n} baris) harus mengikuti baris terisi (2), bukan kapasitas sheet penuh (mock ini getMaxRows()=1000)`);
  });
});
