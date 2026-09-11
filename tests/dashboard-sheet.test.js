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

/* ==========================================================================
   doPost di atas tiruan Apps Script

   Yang diuji di sini bukan tata letak, melainkan tiga hal yang kalau salah
   merusak data atau membuat permintaan melewati batas waktu:
     - payload identitas (`hanyaSelaras`) TIDAK BOLEH menulis isi baris;
     - permintaan yang membawa data tidak boleh ikut membangun Dashboard;
     - blok data tidak dibaca lebih lebar / lebih panjang dari yang dipakai.
   ========================================================================== */

const HEADER_UJI = ['Hash', 'Tanggal', 'Deskripsi', 'Nominal', 'Debit', 'Kredit', 'ID Kategori',
  'Bank', 'No. Rekening', 'Nama Pemilik', 'Sumber', 'ID Upload', 'Dikirim Pada', 'Kategori',
  'Transfer Internal', 'Saldo'];

/** Satu baris data yang utuh, seperti yang dikirim aplikasi. */
function barisPenuh(i) {
  return {
    hash: `h${i}`, tanggal: '2025-07-01', deskripsi: `Transaksi ${i}`, nominal: -1000,
    debit: 1000, kredit: 0, kategoriId: 'kat_belanja', kategoriNama: 'Belanja',
    bank: 'BCA', nomorRekening: '1234567890', namaPemilik: 'BUDI', sumber: 'pdf',
    uploadedFileId: 'upl1', transferInternal: false, saldo: 5000,
  };
}

/**
 * Tiruan sepetak grid yang benar-benar menyimpan isinya, sehingga getValues
 * mengembalikan RENTANG YANG DIMINTA — bukan seluruh tab. Tanpa itu, tes tidak
 * mungkin membedakan pembacaan 1 kolom dari pembacaan 16 kolom, dan justru itu
 * yang sedang dijaga di sini.
 */
function jalankanDoPost({ barisAda = 0, payload }) {
  const grid = [HEADER_UJI.slice()];
  for (let i = 0; i < barisAda; i += 1) {
    const b = barisPenuh(i);
    grid.push([b.hash, b.tanggal, b.deskripsi, b.nominal, b.debit, b.kredit, b.kategoriId,
      b.bank, b.nomorRekening, b.namaPemilik, b.sumber, b.uploadedFileId, new Date(),
      b.kategoriNama, false, b.saldo]);
  }

  const bacaan = [];   // {baris, kolom, tinggi, lebar}
  const tulisan = [];  // {baris, kolom, tinggi, lebar, nilai}
  const dibuatSheet = [];
  const dihapusBaris = [];
  const props = {};

  function buatSheet(nama, isi) {
    let maxKolom = Math.max(16, isi[0] ? isi[0].length : 16);
    const sh = {
      getName: () => nama,
      setName: () => sh,
      getIndex: () => 1,
      getParent: () => ss,
      getMaxColumns: () => maxKolom,
      getMaxRows: () => Math.max(isi.length, 1000),
      getLastRow: () => isi.length,
      getBandings: () => [],
      insertColumnsAfter: (_a, n) => { maxKolom += n; },
      appendRow: (baris) => { isi.push(baris.slice()); },
      deleteRow: (n) => { dihapusBaris.push(n); isi.splice(n - 1, 1); },
      deleteRows: (n, jml) => { for (let i = 0; i < jml; i += 1) dihapusBaris.push(n + i); isi.splice(n - 1, jml); },
      // Range dibungkus Proxy: doPost juga memanggil setNumberFormat,
      // setHorizontalAlignment, merge, dan kawan-kawannya, dan yang sedang
      // diuji di sini bukan itu — cukup jangan sampai melempar.
      getRange: (baris, kolom, tinggi = 1, lebar = 1) => rangeProxy({
        getValues() {
          bacaan.push({ sheet: nama, baris, kolom, tinggi, lebar });
          const out = [];
          for (let r = 0; r < tinggi; r += 1) {
            const sumber = isi[baris - 1 + r] || [];
            out.push(Array.from({ length: lebar }, (_, c) => sumber[kolom - 1 + c] ?? ''));
          }
          return out;
        },
        setValues(nilai) {
          tulisan.push({ sheet: nama, baris, kolom, tinggi, lebar, nilai });
          nilai.forEach((baris2, r) => {
            const target = isi[baris - 1 + r] || (isi[baris - 1 + r] = []);
            baris2.forEach((v, c) => { target[kolom - 1 + c] = v; });
          });
          return this;
        },
      }),
    };
    return new Proxy(sh, { get: (o, k) => (k in o ? o[k] : () => o) });
  }

  function rangeProxy(t) {
    const p = new Proxy(t, { get: (o, k) => (k in o ? o[k] : () => p) });
    return p;
  }

  const lembar = { Transaksi: buatSheet('Transaksi', grid) };
  const ss = {
    getName: () => 'catatan keuangan',
    getId: () => 'ID_UJI',
    getSheetByName: (n) => lembar[n] || null,
    insertSheet: (n) => { dibuatSheet.push(n); lembar[n] = buatSheet(n, [[]]); return lembar[n]; },
    deleteSheet: (s) => { delete lembar[s.getName()]; },
    getNumSheets: () => Object.keys(lembar).length,
    getSheets: () => Object.values(lembar),
    getSpreadsheetLocale: () => 'in_ID',
  };

  let balasan = null;
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
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Charts: { ChartType: { PIE: 'PIE', COLUMN: 'COLUMN' } },
    Utilities: { formatDate: (dt) => `${dt.getFullYear()}-01` },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    ContentService: {
      createTextOutput: (t) => { balasan = JSON.parse(t); return { setMimeType: () => balasan }; },
      MimeType: { JSON: 'json' },
    },
    console: { warn: () => {}, log: () => {} },
  };

  const api = new Function(...Object.keys(sandbox),
    `${src}\n; return { doPost };`)(...Object.values(sandbox));
  api.doPost({ postData: { contents: JSON.stringify(payload) } });

  return { balasan, bacaan, tulisan, dibuatSheet, dihapusBaris, grid, lembar };
}

/** Identitas saja: bentuk yang dikirim permintaan penyelarasan. */
const identitas = (i) => ({ hash: `h${i}`, bank: 'BCA', nomorRekening: '1234567890' });

test('hanyaSelaras TIDAK menulis isi baris — payload identitas tidak boleh menimpa data', () => {
  // Baris identitas tidak punya tanggal, nominal, maupun kategori. Kalau
  // dituliskan, seluruh pembukuan di Sheet berubah jadi baris kosong berhash.
  const rows = Array.from({ length: 100 }, (_, i) => identitas(i));
  const h = jalankanDoPost({
    barisAda: 100,
    payload: { selaras: true, hanyaSelaras: true, rows, jumlah: rows.length },
  });

  assert.equal(h.balasan.ok, true);
  assert.equal(h.balasan.inserted, 0, 'tidak ada yang disisipkan');
  assert.equal(h.balasan.updated, 0, 'tidak ada yang diperbarui');
  assert.equal(h.balasan.dihapus, 0, 'seluruh baris masih dikenali, jadi tidak ada yang yatim');

  const keTabData = h.tulisan.filter((t) => t.sheet === 'Transaksi' && t.baris > 1);
  assert.deepEqual(keTabData, [], `tab data tidak boleh disentuh sama sekali:\n${JSON.stringify(keTabData.slice(0, 2))}`);

  // Dan isinya memang masih utuh, bukan sekadar "tidak ada panggilan tulis".
  assert.equal(h.grid[1][1], '2025-07-01', 'tanggal baris pertama harus tetap ada');
  assert.equal(h.grid[1][3], -1000, 'nominal baris pertama harus tetap ada');
});

test('hanyaSelaras tetap membuang baris yatim, dan mengarsipkannya dulu', () => {
  // 100 baris di Sheet, aplikasi hanya mengaku punya 60 -> 40 yatim.
  const rows = Array.from({ length: 60 }, (_, i) => identitas(i));
  const h = jalankanDoPost({
    barisAda: 100,
    payload: { selaras: true, hanyaSelaras: true, rows, jumlah: rows.length },
  });

  assert.equal(h.balasan.dihapus, 40);
  assert.ok(h.dibuatSheet.includes('_Arsip'), 'baris yang dibuang harus disalin ke arsip lebih dulu');
  assert.equal(h.balasan.inserted, 0);
  assert.equal(h.balasan.updated, 0);
});

test('permintaan yang membawa data tidak membangun Dashboard', () => {
  // Membangun Dashboard berarti membaca seluruh tab data dan menghitung ulang
  // QUERY di atasnya. Selama itu menumpang permintaan yang membawa transaksi,
  // hiasan ikut menentukan apakah datanya terlihat tersimpan — dan itulah yang
  // membuat "Kirim semua sekarang" kehabisan waktu.
  const rows = Array.from({ length: 250 }, (_, i) => barisPenuh(1000 + i));
  const h = jalankanDoPost({ barisAda: 500, payload: { rows, jumlah: rows.length } });

  assert.equal(h.balasan.inserted, 250);
  assert.ok(!h.dibuatSheet.includes('Dashboard'), 'Dashboard tidak boleh dibangun di jalur data');
  assert.ok(!h.lembar.Dashboard, 'tab Dashboard tidak boleh muncul');
});

test('permintaan rapikan membangun Dashboard walau tidak membawa satu baris pun', () => {
  const h = jalankanDoPost({ barisAda: 500, payload: { rapikan: true, rows: [] } });
  assert.equal(h.balasan.ok, true);
  assert.ok(h.lembar.Dashboard, 'permintaan rapikan memang tugasnya membangun Dashboard');
  assert.equal(h.balasan.spreadsheet, 'catatan keuangan', 'balasan tetap menyebut tujuannya');
});

test('ping menyebut spreadsheet tujuan dan jumlah baris yang benar-benar ada', () => {
  // Dipakai aplikasi saat pengiriman putus: AbortController hanya memutus sisi
  // browser, jadi "tidak merespons" sama sekali bukan berarti tidak ada yang masuk.
  const h = jalankanDoPost({ barisAda: 1250, payload: { ping: true } });
  assert.equal(h.balasan.ok, true);
  assert.equal(h.balasan.total, 1250);
  assert.equal(h.balasan.spreadsheet, 'catatan keuangan');
  assert.equal(h.balasan.spreadsheetId, 'ID_UJI');
});

/** Pembacaan blok data (baris >= 2, lebih dari satu baris sekaligus). */
const bacaBlok = (h) => h.bacaan.filter((b) => b.sheet === 'Transaksi' && b.baris >= 2 && b.tinggi > 1);

test('penyisipan hanya membaca kolom Hash, bukan seluruh 16 kolom', () => {
  // 16x lipat sel per permintaan, tanpa satu pun dipakai.
  const rows = Array.from({ length: 250 }, (_, i) => barisPenuh(5000 + i));
  const h = jalankanDoPost({ barisAda: 2000, payload: { rows, jumlah: rows.length } });

  assert.equal(h.balasan.inserted, 250);
  const lebarMaks = bacaBlok(h).reduce((m, b) => Math.max(m, b.lebar), 0);
  assert.equal(lebarMaks, 1, `blok data dibaca ${lebarMaks} kolom, seharusnya cukup 1 (Hash)`);
});

test('penyelarasan membaca sampai kolom No. Rekening, tidak lebih', () => {
  const rows = Array.from({ length: 2000 }, (_, i) => identitas(i));
  const h = jalankanDoPost({
    barisAda: 2000,
    payload: { selaras: true, hanyaSelaras: true, rows, jumlah: rows.length },
  });
  const lebarMaks = bacaBlok(h).reduce((m, b) => Math.max(m, b.lebar), 0);
  assert.equal(lebarMaks, 9, 'butuh Hash..No. Rekening (A..I), tidak sampai P');
});

test('pembaruan borong hanya menyentuh jendela baris yang berubah, bukan seluruh tab', () => {
  // Inti pemecahan bongkah: satu bongkah 250 baris di pembukuan 2.000 baris
  // harus menyentuh 250 baris. Kalau tiap bongkah menulis ulang seluruh tab,
  // memecah kiriman justru membuat backfill LEBIH berat, bukan lebih ringan.
  const rows = Array.from({ length: 250 }, (_, i) => barisPenuh(i));
  const h = jalankanDoPost({ barisAda: 2000, payload: { rows, jumlah: rows.length } });

  assert.equal(h.balasan.updated, 250, 'semuanya sudah ada, jadi diperbarui');
  const tulisLebar = h.tulisan.filter((t) => t.sheet === 'Transaksi' && t.lebar === 16 && t.tinggi > 1);
  assert.equal(tulisLebar.length, 1, 'satu penulisan borong');
  assert.equal(tulisLebar[0].tinggi, 250, `menulis ${tulisLebar[0].tinggi} baris untuk 250 perubahan`);
});
