/**
 * Tes jalankanBackfillEmail() dan bangunQueryPengirimGmail() di
 * sheets/Code.gs — menu "Tarik Email Lama (Backfill)", ditambahkan setelah
 * verifikasi produksi menunjukkan pollEmailTransaksi() cuma menoleh
 * JENDELA_PENCARIAN_EMAIL_HARI (3) hari ke belakang, sehingga transaksi
 * lama (mis. sejak awal tahun) yang sudah ada di Gmail sebelum pemantauan
 * dipasang tidak pernah ikut tertarik.
 *
 * bangunQueryPengirimGmail() sendiri adalah ROOT FIX untuk bug lanjutan
 * yang ditemukan dari data produksi nyata: backfill sejak Januari mandek
 * di sekitar Agustus setelah 3 kali jalan (Log Email menunjukkan
 * "Thread Diperiksa" selalu mentok di batas 300 tapi "Email Diproses"
 * anjlok 99->8->0) karena query Gmail lama TIDAK membatasi pengirim —
 * seluruh kotak masuk pribadi pengguna ikut tersisir dan email non-bank
 * yang diklasifikasi 'unknown' tidak pernah berlabel, sehingga terus
 * muncul lagi tiap pencarian dan menghabiskan kuota tanpa kemajuan.
 *
 * Sengaja HANYA menguji jalur yang tidak menyentuh Gmail sungguhan (early-
 * return konfigurasi kosong) plus argumen yang dikirim ke GmailApp.search
 * lewat GmailApp tiruan minimal — bukan seluruh alur klasifikasi/parsing
 * per pesan (itu tanggung jawab prosesThreadEmailTransaksi(), yang
 * dipakai bersama pollEmailTransaksi() dan sudah divalidasi lewat
 * verifikasi produksi manual, mengikuti pola repo ini yang tidak membuat
 * tiruan GmailThread/GmailMessage penuh).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../sheets/Code.gs', import.meta.url), 'utf8');

function buatSheetTiruan() {
  const data = [];
  const rangeStub = () => ({
    setFontWeight: () => rangeStub(), setFontColor: () => rangeStub(),
    setBackground: () => rangeStub(), setVerticalAlignment: () => rangeStub(),
    setNumberFormat: () => rangeStub(), setFontStyle: () => rangeStub(),
    setValue: () => rangeStub(),
  });
  return {
    appendRow(row) { data.push(row.slice()); },
    getLastRow() { return data.length; },
    getMaxRows() { return 1000; },
    setFrozenRows() {},
    setTabColor() {},
    hideSheet() {},
    setColumnWidths() {},
    setColumnWidth() {},
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
        setValue() { return range; },
        setFontWeight: () => range, setFontColor: () => range, setBackground: () => range,
        setVerticalAlignment: () => range, setNumberFormat: () => range, setFontStyle: () => range,
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
  };
}

function muatApi(ss, gmail) {
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    GmailApp: gmail || { search: () => { throw new Error('GmailApp tidak boleh dipanggil di jalur ini'); } },
    console: { warn: () => {}, log: () => {} },
  };
  return new Function(...Object.keys(sandbox),
    `${src}\n; return { jalankanBackfillEmail, pastikanKonfigurasiEmail, bangunQueryPengirimGmail, MAKS_THREAD_BACKFILL_PER_JALAN };`)(...Object.values(sandbox));
}

test('jalankanBackfillEmail: Konfigurasi Email kosong -> berhenti sebelum menyentuh Gmail sama sekali', () => {
  const ss = buatSpreadsheetTiruan();
  const api = muatApi(ss); // GmailApp tiruan sengaja melempar kalau dipanggil
  const hasil = api.jalankanBackfillEmail('2026-01-01');
  assert.match(hasil.alasan, /Konfigurasi Email masih kosong/);
  assert.equal(hasil.diproses, 0);
  assert.equal(hasil.masihAda, false);
});

test('jalankanBackfillEmail: tanggal YYYY-MM-DD dikonversi ke format Gmail YYYY/MM/DD pada query pencarian', () => {
  const ss = buatSpreadsheetTiruan();
  let queryDikirim = null;
  const gmail = {
    getUserLabelByName: () => ({ id: 'lbl' }),
    createLabel: () => ({ id: 'lbl' }),
    search: (query) => { queryDikirim = query; return []; },
  };
  const api = muatApi(ss, gmail);
  api.pastikanKonfigurasiEmail(ss);
  ss.getSheetByName('Konfigurasi Email').appendRow(['bca.co.id', '', 'BCA', true]);

  const hasil = api.jalankanBackfillEmail('2026-01-15');

  assert.match(queryDikirim, /after:2026\/01\/15/);
  // Regresi bug produksi: query WAJIB membatasi pengirim, bukan menyisir
  // seluruh kotak masuk -- lihat catatan di kepala berkas ini.
  assert.match(queryDikirim, /from:bca\.co\.id/);
  assert.equal(hasil.alasan, null);
  assert.equal(hasil.ditemukan, 0);
  assert.equal(hasil.masihAda, false);
});

test('jalankanBackfillEmail: masihAda true kalau jumlah thread ditemukan mencapai batas per-jalan (perlu diulang)', () => {
  const ss = buatSpreadsheetTiruan();
  const gmail = {
    getUserLabelByName: () => ({ id: 'lbl' }),
    createLabel: () => ({ id: 'lbl' }),
    search: (query, start, max) => Array.from({ length: max }, () => ({ getMessages: () => [], addLabel: () => {} })),
  };
  const api = muatApi(ss, gmail);
  api.pastikanKonfigurasiEmail(ss);
  ss.getSheetByName('Konfigurasi Email').appendRow(['bca.co.id', '', 'BCA', true]);

  const hasil = api.jalankanBackfillEmail('2026-01-01');

  assert.equal(hasil.ditemukan, api.MAKS_THREAD_BACKFILL_PER_JALAN);
  assert.equal(hasil.masihAda, true, 'jumlah ditemukan == batas per-jalan berarti kemungkinan masih ada sisa yang belum diperiksa');
});

test('bangunQueryPengirimGmail: menggabungkan beberapa pola pengirim aktif dengan OR', () => {
  const api = muatApi(buatSpreadsheetTiruan());
  const query = api.bangunQueryPengirimGmail([
    { polaPengirim: 'bca.co.id', aktif: true },
    { polaPengirim: 'permatabank.co.id', aktif: true },
  ]);
  assert.equal(query, '(from:bca.co.id OR from:permatabank.co.id)');
});

test('bangunQueryPengirimGmail: baris nonaktif diabaikan', () => {
  const api = muatApi(buatSpreadsheetTiruan());
  const query = api.bangunQueryPengirimGmail([
    { polaPengirim: 'bca.co.id', aktif: true },
    { polaPengirim: 'promo-bank-lain.co.id', aktif: false },
  ]);
  assert.equal(query, '(from:bca.co.id)');
});

test('bangunQueryPengirimGmail: baris aktif dengan polaPengirim kosong (aturan subjek-saja) -> fallback tanpa pembatasan', () => {
  const api = muatApi(buatSpreadsheetTiruan());
  const query = api.bangunQueryPengirimGmail([
    { polaPengirim: 'bca.co.id', aktif: true },
    { polaPengirim: '', polaSubjek: 'Transfer', aktif: true },
  ]);
  assert.equal(query, '', 'satu saja baris aktif tanpa polaPengirim harus mematahkan pembatasan sama sekali, bukan diam-diam melewatkan baris itu');
});

test('bangunQueryPengirimGmail: pola pengirim duplikat (dua bank, sender sama) tidak dobel di query', () => {
  const api = muatApi(buatSpreadsheetTiruan());
  const query = api.bangunQueryPengirimGmail([
    { polaPengirim: 'bca.co.id', aktif: true },
    { polaPengirim: 'bca.co.id', aktif: true },
  ]);
  assert.equal(query, '(from:bca.co.id)');
});

test('bangunQueryPengirimGmail: konfigurasi kosong -> string kosong', () => {
  const api = muatApi(buatSpreadsheetTiruan());
  assert.equal(api.bangunQueryPengirimGmail([]), '');
  assert.equal(api.bangunQueryPengirimGmail(null), '');
});
