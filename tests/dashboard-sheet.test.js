/**
 * Menjalankan pastikanDashboard di atas tiruan API Apps Script.
 *
 * Tiruan ini sengaja MEMODELKAN BATAS GRID dan MENCATAT RENTANG BARIS tiap blok:
 * dua bug yang sudah pernah lolos ke pengguna adalah lebar kolom di luar grid
 * ("Kolom tersebut melampaui batas") dan blok yang saling tindih. Keduanya
 * tidak mungkin tertangkap oleh pemeriksaan sintaks semata.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../sheets/Code.gs', import.meta.url), 'utf8');
const nomorKolom = (huruf) => [...huruf].reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0);

function jalankan({ pakaiKoma, rekening, bulan, kategori }) {
  const rumus = {}, charts = [], props = {}, pelanggaran = [];
  const dibuat = [];

  // Baris data tiruan: kolom sesuai HEADER (15 kolom).
  const barisData = [];
  rekening.forEach((label, iR) => {
    for (let b = 0; b < bulan; b += 1) {
      for (let k = 0; k < kategori; k += 1) {
        const bln = `20${25 + Math.floor(b / 12)}-${String((b % 12) + 1).padStart(2, '0')}`;
        const [bank, nomor] = label.includes('|') ? label.split('|') : [label, ''];
        barisData.push([
          `hash${iR}_${b}_${k}`, `${bln}-05`, 'Uji', -1000, 1000, 0,
          `kat_uji_${k}`, bank, nomor, 'Pemilik', 'pdf', '', new Date(), `Kategori ${k}`, false,
          // Sebagian baris tanpa saldo, seperti transaksi manual: rumus Saldo
          // Bank harus menyaringnya keluar, bukan memperlakukannya sebagai nol.
          k % 3 === 0 ? '' : 1000000 - (b * 1000) - k,
        ]);
      }
    }
  });

  function buatSheet(nama, kolomAwal = 26, barisAwal = 1000) {
    let maxKolom = kolomAwal, maxBaris = barisAwal;
    const cekA1 = (a1) => {
      for (const m of String(a1).matchAll(/\$?([A-Z]+)\$?(\d+)/g)) {
        const k = nomorKolom(m[1]), b = Number(m[2]);
        if (k > maxKolom) pelanggaran.push(`${nama}: "${a1}" kolom ${m[1]}(${k}) > ${maxKolom}`);
        if (b > maxBaris) pelanggaran.push(`${nama}: "${a1}" baris ${b} > ${maxBaris}`);
      }
    };
    function buatRange(a1) {
      let proxy;
      const t = {
        setFormula(f) { rumus[a1] = f; return proxy; },
        // setFormulas (jamak) dipakai blok saldo per rekening. Tanpa dicatat di
        // sini, rumus-rumus itu lolos dari SELURUH pemeriksaan di bawah —
        // termasuk pemeriksaan pemisah argumen lokal Indonesia.
        setFormulas(matriks) {
          matriks.forEach((baris, i) => baris.forEach((f, j) => {
            if (f) rumus[`${a1}#${i}_${j}`] = f;
          }));
          return proxy;
        },
        setValue: () => proxy,
        getValue: () => (pakaiKoma ? 3 : 1.2),
        getValues: () => (nama === 'Transaksi' ? barisData.map((r) => r.slice()) : [[]]),
        setValues: () => proxy,
        clearContent: () => proxy,
        applyRowBanding: () => ({ setHeaderRowColor: () => {} }),
        getDisplayValue: () => '',
      };
      proxy = new Proxy(t, { get: (o, k) => (k in o ? o[k] : () => proxy) });
      return proxy;
    }
    const sh = {
      getName: () => nama,
      getIndex: () => 1,
      getMaxColumns: () => maxKolom,
      getMaxRows: () => maxBaris,
      getLastRow: () => (nama === 'Transaksi' ? barisData.length + 1 : 1),
      getBandings: () => [],
      insertColumnsAfter: (after, n) => { maxKolom += n; },
      insertRowsAfter: (after, n) => { maxBaris += n; },
      setColumnWidth: (k) => { if (k > maxKolom) pelanggaran.push(`${nama}: setColumnWidth(${k}) > ${maxKolom}`); },
      setColumnWidths: (m, j) => { if (m + j - 1 > maxKolom) pelanggaran.push(`${nama}: setColumnWidths(${m},${j}) -> ${m + j - 1} > ${maxKolom}`); },
      setRowHeight: (b) => { if (b > maxBaris) pelanggaran.push(`${nama}: setRowHeight(${b}) > ${maxBaris}`); },
      setRowHeights: (m, j) => { if (m + j - 1 > maxBaris) pelanggaran.push(`${nama}: setRowHeights(${m},${j}) > ${maxBaris}`); },
      getRange: (...a) => {
        if (typeof a[0] === 'string') { cekA1(a[0]); return buatRange(a[0]); }
        const [b, k, tb = 1, tk = 1] = a;
        if (k + tk - 1 > maxKolom) pelanggaran.push(`${nama}: getRange(${a}) kolom ${k + tk - 1} > ${maxKolom}`);
        if (b + tb - 1 > maxBaris) pelanggaran.push(`${nama}: getRange(${a}) baris ${b + tb - 1} > ${maxBaris}`);
        return buatRange(`R${b}C${k}`);
      },
      newChart() {
        const b = new Proxy({ build: () => ({}) }, { get: (t, k) => (k in t ? t[k] : () => b) });
        return b;
      },
      insertChart: (c) => charts.push(c),
    };
    return new Proxy(sh, { get: (o, k) => (k in o ? o[k] : () => o) });
  }

  const lembar = { Transaksi: buatSheet('Transaksi', 16, 5000) };
  const ss = {
    getSheetByName: (n) => lembar[n] || null,
    insertSheet: (n) => { dibuat.push(n); lembar[n] = buatSheet(n); return lembar[n]; },
    deleteSheet: (s) => { delete lembar[s.getName()]; },
    getNumSheets: () => Object.keys(lembar).length,
    getSheets: () => Object.values(lembar),
    getSpreadsheetLocale: () => 'in_ID',
  };

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      BandingTheme: { LIGHT_GREY: 'LG' },
      newConditionalFormatRule() {
        const b = new Proxy({ build: () => ({}) }, { get: (t, k) => (k in t ? t[k] : () => b) });
        return b;
      },
      getUi: () => new Proxy({}, { get: () => () => ({}) }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    Charts: { ChartType: { PIE: 'PIE', COLUMN: 'COLUMN' } },
    Utilities: { formatDate: (dt) => `${dt.getFullYear()}-01` },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    ContentService: { createTextOutput: () => ({ setMimeType: () => ({}) }), MimeType: { JSON: 'json' } },
    console: { warn: () => {}, log: () => {} },
  };

  const api = new Function(...Object.keys(sandbox),
    `${src}\n; return { pastikanDashboard, statistikData, hurufKolom, VERSI_DASHBOARD };`)(...Object.values(sandbox));
  api.pastikanDashboard(ss, 'Transaksi');
  return { rumus, charts, props, pelanggaran, dibuat, api };
}

// Salah di sini menggeser seluruh matriks kategori x bulan.
test('hurufKolom benar di batas A->Z->AA', () => {
  const { api } = jalankan({ pakaiKoma: true, rekening: ['BCA|111'], bulan: 2, kategori: 2 });
  for (const [n, h] of [[1, 'A'], [26, 'Z'], [27, 'AA'], [28, 'AB'], [52, 'AZ'], [53, 'BA']]) {
    assert.equal(api.hurufKolom(n), h, `hurufKolom(${n}) harus ${h}`);
  }
});

const SUSUNAN = [
  { rekening: ['BCA|1234567890'], bulan: 3, kategori: 3 },
  { rekening: ['BCA|1234567890', 'Permata|3310001122'], bulan: 12, kategori: 8 },
  { rekening: ['BCA|1234567890', 'Permata|3310001122', 'Kas Proyek'], bulan: 21, kategori: 16 },
  // Nama harus cukup khas: nama satu huruf akan "ketemu" di dalam rumus biasa
  // (mis. huruf kolom) dan membuat pemeriksaan kebocoran di bawah jadi palsu.
  { rekening: ['Bank Alpha|1', 'Bank Beta|2', 'Bank Gamma|3', 'Bank Delta|4', 'Kas Pusat'], bulan: 40, kategori: 20 },
  // Nama ber-apostrof: kalau label bocor ke dalam string QUERY, rumusnya pecah.
  { rekening: ["Bank O'Brien|999", 'BCA|111'], bulan: 6, kategori: 4 },
];

for (const susunan of SUSUNAN) {
  for (const pakaiKoma of [true, false]) {
    const label = `${susunan.rekening.length} rekening x ${susunan.bulan} bulan, pemisah "${pakaiKoma ? ',' : ';'}"`;

    test(`Dashboard terbangun utuh: ${label}`, () => {
      const h = jalankan({ pakaiKoma, ...susunan });

      assert.deepEqual(h.pelanggaran, [], `melampaui batas grid:\n  ${h.pelanggaran.join('\n  ')}`);

      // Invarian terpenting untuk tata letak bertumpuk: blok tidak saling tindih.
      const rentang = JSON.parse(h.props.rentangBlokDashboard || '[]');
      assert.ok(rentang.length >= 3, 'rentang blok harus tercatat');
      const urut = rentang.slice().sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < urut.length; i += 1) {
        assert.ok(urut[i][0] > urut[i - 1][1], `blok bertabrakan: [${urut[i - 1]}] dan [${urut[i]}]`);
      }

      // Jangkar yang dipantau dashboardRusak harus benar-benar berisi rumus.
      const jangkar = JSON.parse(h.props.selRumusDashboard || '[]');
      assert.ok(jangkar.length > 0, 'jangkar rumus harus tercatat');
      for (const sel of jangkar) assert.ok(h.rumus[sel], `jangkar ${sel} tidak berisi rumus`);

      for (const [sel, f] of Object.entries(h.rumus)) {
        assert.equal((f.match(/\(/g) || []).length, (f.match(/\)/g) || []).length, `kurung ${sel}`);
        assert.equal((f.match(/\{/g) || []).length, (f.match(/\}/g) || []).length, `kurawal ${sel}`);
        assert.equal((f.match(/"/g) || []).length % 2, 0, `kutip ganjil ${sel}`);
        // Label rekening tidak boleh pernah masuk ke dalam rumus: nama
        // ber-apostrof akan memecah string QUERY.
        for (const rek of susunan.rekening) {
          const nama = rek.split('|')[0];
          assert.ok(!f.includes(nama), `label rekening "${nama}" bocor ke rumus ${sel}`);
        }
        if (!pakaiKoma && f !== '=SUM(1,2)') {
          const tanpaString = f.replace(/"[^"]*"/g, '""');
          assert.ok(!tanpaString.includes(','), `koma pemisah lolos di ${sel}: ${tanpaString}`);
        }
      }

      // Pengelompokan bulan harus menangani tanggal bertipe tanggal MAUPUN teks.
      // Tanpa asersi ini, kembalinya ke LEFT saja akan lolos diam-diam — dan
      // LEFT pada tanggal hanya benar selama format tampilannya kebetulan
      // "yyyy-mm-dd".
      const berbulan = Object.values(h.rumus).filter((f) => /LEFT\(/.test(f) || /TEXT\(/.test(f));
      assert.ok(berbulan.length > 0, 'harus ada rumus yang mengambil bulan');
      for (const f of berbulan) {
        if (!/'Transaksi'!B2:B/.test(f)) continue;
        assert.ok(/ISNUMBER\(/.test(f) && /TEXT\(/.test(f),
          `rumus bulan harus punya cabang ISNUMBER/TEXT untuk tanggal bertipe tanggal: ${f.slice(0, 90)}`);
      }

      assert.equal(h.charts.length, 2, 'harus 2 grafik');
      assert.equal(h.props.versiDashboard, h.api.VERSI_DASHBOARD, 'versi harus tercatat');
      assert.ok(h.props.sidikDashboard, 'sidik data harus tercatat');
    });
  }
}
