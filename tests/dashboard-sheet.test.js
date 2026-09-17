/**
 * Menjalankan pastikanSemuaTab di atas tiruan API Apps Script.
 *
 * Tiruan ini sengaja MEMODELKAN BATAS GRID dan MENCATAT RENTANG BARIS tiap blok:
 * dua bug yang sudah pernah lolos ke pengguna adalah lebar kolom di luar grid
 * ("Kolom tersebut melampaui batas") dan blok yang saling tindih. Keduanya
 * tidak mungkin tertangkap oleh pemeriksaan sintaks semata.
 *
 * Sejak Dashboard Full/Anggaran/Cari Transaksi ikut dibangun kode, tiruan sel
 * di sini juga BENAR-BENAR MENYIMPAN NILAI (bukan cuma mencatat rumus) —
 * pastikanAnggaran membaca balik apa yang pernah ditulis untuk memutuskan
 * kategori mana yang belum ada, dan itu mustahil diuji kalau setValues cuma
 * stub kosong.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../sheets/Code.gs', import.meta.url), 'utf8');
const nomorKolom = (huruf) => [...huruf].reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0);
/** Kebalikannya — dipakai mencatat rumus yang ditulis lewat getRange(baris, kolom, ...). */
const hurufKolomUji = (n) => {
  let hasil = '';
  let sisa = n;
  while (sisa > 0) { hasil = String.fromCharCode(65 + ((sisa - 1) % 26)) + hasil; sisa = Math.floor((sisa - 1) / 26); }
  return hasil;
};
const alamatA1 = (baris, kolom) => `${hurufKolomUji(kolom)}${baris}`;

function jalankan({ pakaiKoma, rekening, bulan, kategori }) {
  const rumus = {}, charts = [], props = {}, pelanggaran = [], condFormatRules = [];
  const dibuat = [];

  // Baris data tiruan: kolom sesuai HEADER (16 kolom).
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
    // Isi sungguhan per (baris,kolom). Dibutuhkan supaya pastikanAnggaran
    // (baca lalu tambah, bukan bangun-ulang) bisa diuji: tanpa ini getValues
    // tidak pernah melihat apa yang baru ditulis appendRow/setValues sebelumnya.
    const isi = [];
    const tulisSel = (baris, kolom, nilai) => {
      if (!isi[baris - 1]) isi[baris - 1] = [];
      isi[baris - 1][kolom - 1] = nilai;
    };
    const bacaSel = (baris, kolom) => {
      const v = isi[baris - 1] ? isi[baris - 1][kolom - 1] : undefined;
      return v === undefined ? '' : v;
    };
    let barisTerisi = 0;

    const cekA1 = (a1) => {
      for (const m of String(a1).matchAll(/\$?([A-Z]+)\$?(\d+)/g)) {
        const k = nomorKolom(m[1]), b = Number(m[2]);
        if (k > maxKolom) pelanggaran.push(`${nama}: "${a1}" kolom ${m[1]}(${k}) > ${maxKolom}`);
        if (b > maxBaris) pelanggaran.push(`${nama}: "${a1}" baris ${b} > ${maxBaris}`);
      }
    };
    const posisiA1 = (a1) => {
      const m = String(a1).match(/^\$?([A-Z]+)\$?(\d+)/);
      return m ? { baris: Number(m[2]), kolom: nomorKolom(m[1]) } : { baris: 1, kolom: 1 };
    };

    function buatRange(a1, posisi, ukuran = { tb: 1, tk: 1 }) {
      let proxy;
      const t = {
        setFormula(f) {
          rumus[`${nama}!${a1}`] = f;
          tulisSel(posisi.baris, posisi.kolom, f);
          barisTerisi = Math.max(barisTerisi, posisi.baris);
          return proxy;
        },
        // setFormulas (jamak) dipakai blok saldo per rekening & ranking
        // Dashboard Full. Tanpa dicatat di sini, rumus-rumus itu lolos dari
        // SELURUH pemeriksaan di bawah — termasuk pemeriksaan pemisah
        // argumen lokal Indonesia.
        setFormulas(matriks) {
          matriks.forEach((barisArr, i) => barisArr.forEach((f, j) => {
            if (f) rumus[`${nama}!${a1}#${i}_${j}`] = f;
            // Dicatat JUGA dengan alamat A1-nya: Kontrol Saldo mencatat
            // sebagian sel yang ditulis lewat setFormulas sebagai jangkar
            // (alamat A1), dan tanpa kunci ini pemeriksaan "tiap jangkar
            // berisi rumus" tidak bisa melihatnya sama sekali.
            if (f) rumus[`${nama}!${alamatA1(posisi.baris + i, posisi.kolom + j)}`] = f;
            tulisSel(posisi.baris + i, posisi.kolom + j, f);
          }));
          if (matriks.length) barisTerisi = Math.max(barisTerisi, posisi.baris + matriks.length - 1);
          return proxy;
        },
        setValue(v) {
          tulisSel(posisi.baris, posisi.kolom, v);
          barisTerisi = Math.max(barisTerisi, posisi.baris);
          return proxy;
        },
        setValues(matriks) {
          matriks.forEach((barisArr, i) => barisArr.forEach((v, j) => tulisSel(posisi.baris + i, posisi.kolom + j, v)));
          if (matriks.length) barisTerisi = Math.max(barisTerisi, posisi.baris + matriks.length - 1);
          return proxy;
        },
        getValue: () => (pakaiKoma ? 3 : (bacaSel(posisi.baris, posisi.kolom) || 1.2)),
        getValues: () => {
          if (nama === 'Transaksi') return barisData.map((r) => r.slice());
          const out = [];
          for (let r = 0; r < ukuran.tb; r += 1) {
            out.push(Array.from({ length: ukuran.tk }, (_, c) => bacaSel(posisi.baris + r, posisi.kolom + c)));
          }
          return out;
        },
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
      getLastRow: () => (nama === 'Transaksi' ? barisData.length + 1 : barisTerisi),
      getBandings: () => [],
      insertColumnsAfter: (after, n) => { maxKolom += n; },
      insertRowsAfter: (after, n) => { maxBaris += n; },
      appendRow: (baris) => {
        barisTerisi += 1;
        baris.forEach((v, i) => tulisSel(barisTerisi, i + 1, v));
      },
      setColumnWidth: (k) => { if (k > maxKolom) pelanggaran.push(`${nama}: setColumnWidth(${k}) > ${maxKolom}`); },
      setColumnWidths: (m, j) => { if (m + j - 1 > maxKolom) pelanggaran.push(`${nama}: setColumnWidths(${m},${j}) -> ${m + j - 1} > ${maxKolom}`); },
      setRowHeight: (b) => { if (b > maxBaris) pelanggaran.push(`${nama}: setRowHeight(${b}) > ${maxBaris}`); },
      setRowHeights: (m, j) => { if (m + j - 1 > maxBaris) pelanggaran.push(`${nama}: setRowHeights(${m},${j}) > ${maxBaris}`); },
      getRange: (...a) => {
        if (typeof a[0] === 'string') { cekA1(a[0]); return buatRange(a[0], posisiA1(a[0])); }
        const [b, k, tb = 1, tk = 1] = a;
        if (k + tk - 1 > maxKolom) pelanggaran.push(`${nama}: getRange(${a}) kolom ${k + tk - 1} > ${maxKolom}`);
        if (b + tb - 1 > maxBaris) pelanggaran.push(`${nama}: getRange(${a}) baris ${b + tb - 1} > ${maxBaris}`);
        return buatRange(`R${b}C${k}`, { baris: b, kolom: k }, { tb, tk });
      },
      newChart() {
        const b = new Proxy({ build: () => ({}) }, { get: (t, k) => (k in t ? t[k] : () => b) });
        return b;
      },
      insertChart: (c) => charts.push(c),
    };
    return new Proxy(sh, { get: (o, k) => (k in o ? o[k] : () => o) });
  }

  // 18, bukan 16: HEADER Code.gs sejak kolom "ID Transaksi"/"Diubah Pada"
  // ditambah di ujung (lihat kepala berkas Code.gs) -- Dashboard sendiri
  // tidak menyentuh dua kolom itu, tapi grid tiruan harus cukup lebar
  // supaya getRange(2,1,n,HEADER.length) tidak dianggap melampaui batas.
  const lembar = { Transaksi: buatSheet('Transaksi', 18, 5000) };
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
      BorderStyle: { SOLID_THICK: 'SOLID_THICK' },
      // Mencatat method builder apa saja yang dipanggil per aturan (mis.
      // 'setGradientMinpoint','setRanges') supaya aturan heatmap gradien bisa
      // diuji keberadaannya — proxy lama menelan semuanya tanpa jejak.
      newConditionalFormatRule() {
        const dipanggil = [];
        const b = new Proxy({ build: () => { condFormatRules.push(dipanggil); return {}; } }, {
          get: (t, k) => {
            if (k in t) return t[k];
            return (...args) => { dipanggil.push(String(k)); return b; };
          },
        });
        return b;
      },
      getUi: () => new Proxy({}, { get: () => () => ({}) }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    Charts: { ChartType: { PIE: 'PIE', COLUMN: 'COLUMN', LINE: 'LINE' } },
    Utilities: { formatDate: (dt, _tz, pola) => (pola === 'yyyy-MM' || pola === 'yyyy-MM-dd' ? `${dt.getFullYear()}-01` : `01/01/${dt.getFullYear()} 00:00`) },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    ContentService: { createTextOutput: () => ({ setMimeType: () => ({}) }), MimeType: { JSON: 'json' } },
    console: { warn: () => {}, log: () => {} },
  };

  const api = new Function(...Object.keys(sandbox),
    `${src}\n; return { pastikanSemuaTab, statistikData, hurufKolom, VERSI_DASHBOARD };`)(...Object.values(sandbox));
  api.pastikanSemuaTab(ss, 'Transaksi');
  return {
    rumus, charts, props, pelanggaran, dibuat, api, lembar, condFormatRules,
    // Dipakai tes idempoten: rerun pastikanSemuaTab di atas STATE yang sama
    // (props/lembar sama), supaya bisa diperiksa apa yang berubah dan apa
    // yang sengaja tidak disentuh.
    ulangi: () => api.pastikanSemuaTab(ss, 'Transaksi'),
  };
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

    test(`Dashboard & Dashboard Full terbangun utuh: ${label}`, () => {
      const h = jalankan({ pakaiKoma, ...susunan });

      assert.deepEqual(h.pelanggaran, [], `melampaui batas grid:\n  ${h.pelanggaran.join('\n  ')}`);

      assert.ok(h.dibuat.includes(DASHBOARD_FULL_NAMA), 'Dashboard Full harus dibuat');
      assert.ok(h.dibuat.includes(ANGGARAN_NAMA), 'Anggaran harus dibuat');
      assert.ok(h.dibuat.includes(CARI_NAMA), 'Cari Transaksi harus dibuat');
      assert.ok(h.dibuat.includes(STATEMENT_NAMA), 'Statement harus dibuat');
      assert.ok(h.dibuat.includes(KONTROL_NAMA), 'Kontrol Saldo harus dibuat');

      // Invarian terpenting untuk tata letak bertumpuk: blok tidak saling
      // tindih — diperiksa untuk Dashboard DAN Dashboard Full secara
      // independen (dua sheet berbeda, dua daftar rentang berbeda).
      for (const [kunciRentang, kunciJangkar, namaTab] of [
        ['rentangBlokDashboard', 'selRumusDashboard', 'Dashboard'],
        ['rentangBlokDashboardFull', 'selRumusDashboardFull', 'Dashboard Full'],
        ['rentangBlokKontrol', 'selRumusKontrol', 'Kontrol Saldo'],
      ]) {
        const rentang = JSON.parse(h.props[kunciRentang] || '[]');
        assert.ok(rentang.length >= 2, `[${namaTab}] rentang blok harus tercatat`);
        const urut = rentang.slice().sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < urut.length; i += 1) {
          assert.ok(urut[i][0] > urut[i - 1][1], `[${namaTab}] blok bertabrakan: [${urut[i - 1]}] dan [${urut[i]}]`);
        }

        const jangkar = JSON.parse(h.props[kunciJangkar] || '[]');
        assert.ok(jangkar.length > 0, `[${namaTab}] jangkar rumus harus tercatat`);
        for (const sel of jangkar) {
          assert.ok(h.rumus[`${namaTab}!${sel}`], `[${namaTab}] jangkar ${sel} tidak berisi rumus`);
        }
      }

      // Blok anomali TETAP TOP_ANOMALI+1 baris berapa pun ukuran fixture-nya
      // (dibatasi lewat QUERY "limit", bukan cadangan) — dan blok anggaran
      // vs realisasi PAS sejumlah kategori (disizekan dari Anggaran, bukan
      // cadangan QUERY).
      const rentangFull = JSON.parse(h.props.rentangBlokDashboardFull || '[]').sort((a, b) => a[0] - b[0]);
      // Rentang tercatat mulai dari baris JUDUL SEKSI (sebelum kepalaTabel),
      // sama seperti seluruh blok lain di file ini — makanya +1 lagi di atas
      // TOP_ANOMALI (baris header) untuk baris judul itu sendiri.
      const tinggiAnomali = rentangFull[rentangFull.length - 2][1] - rentangFull[rentangFull.length - 2][0];
      assert.equal(tinggiAnomali, TOP_ANOMALI_NILAI + 1, 'blok Transaksi Tak Wajar harus tetap TOP_ANOMALI+1 baris (+1 judul seksi)');
      // +3 tetap: baris judul seksi, baris "Bulan berjalan", dan baris header
      // tabel — semuanya di atas baris data pertama, sebelum blok ini sizekan
      // PAS sejumlah kategori (tanpa cadangan QUERY).
      const tinggiBudget = rentangFull[rentangFull.length - 1][1] - rentangFull[rentangFull.length - 1][0];
      assert.equal(tinggiBudget, susunan.kategori + 3, 'blok Anggaran vs Realisasi harus pas sejumlah kategori (+3 baris judul/bulan/header)');

      // Anggaran harus terseed pas sejumlah kategori pengeluaran fixture,
      // tanpa duplikat.
      const anggaran = h.lembar.Anggaran;
      const isiAnggaran = anggaran.getRange(2, 1, Math.max(anggaran.getLastRow() - 1, 0), 1)
        .getValues().map((row) => row[0]);
      assert.equal(isiAnggaran.length, susunan.kategori, 'Anggaran harus terseed sejumlah kategori pengeluaran');
      assert.equal(new Set(isiAnggaran).size, isiAnggaran.length, 'Anggaran tidak boleh punya kategori duplikat');

      // Aturan gradien untuk heatmap tren kategori harus terpasang.
      assert.ok(h.condFormatRules.some((c) => c.includes('setGradientMinpoint')),
        'harus ada aturan gradien untuk heatmap tren kategori');

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
      // Dibatasi ke rumus yang benar-benar MENGEKSTRAK bulan sebagai teks
      // ("yyyy-mm") — bukan sembarang rumus yang kebetulan merujuk B2:B, mis.
      // daftar Transaksi Tak Wajar (menampilkan tanggal mentah) atau Cari
      // Transaksi (menyaring rentang tanggal mentah) yang sengaja tidak
      // butuh cabang ISNUMBER/TEXT sama sekali.
      const berbulan = Object.values(h.rumus)
        .filter((f) => (/LEFT\(/.test(f) || /TEXT\(/.test(f)) && /"yyyy-mm"/.test(f));
      assert.ok(berbulan.length > 0, 'harus ada rumus yang mengambil bulan');
      for (const f of berbulan) {
        if (!/'Transaksi'!B2:B/.test(f)) continue;
        assert.ok(/ISNUMBER\(/.test(f) && /TEXT\(/.test(f),
          `rumus bulan harus punya cabang ISNUMBER/TEXT untuk tanggal bertipe tanggal: ${f.slice(0, 90)}`);
      }

      // 3 grafik di Dashboard (donat + kolom + tren) + 1 di Dashboard Full
      // (top kategori). Kontrol Saldo sengaja tanpa grafik: barisnya
      // rekening x bulan, dan yang perlu dilihat di sana angka selisihnya
      // sendiri, bukan bentuk kurvanya.
      assert.equal(h.charts.length, 4, 'harus 4 grafik (3 di Dashboard, 1 di Dashboard Full)');
      assert.equal(h.props.versiDashboard, h.api.VERSI_DASHBOARD, 'versi harus tercatat');
      assert.ok(h.props.sidikDashboard, 'sidik data harus tercatat');
    });
  }
}

// Konstanta yang dicerminkan dari Code.gs, dipakai asersi di atas — dites
// tersendiri di bawah supaya kalau nilainya berubah di Code.gs, tesnya
// gagal dengan jelas ("nilai tercermin salah") bukan diam-diam memeriksa
// angka yang sudah basi.
const DASHBOARD_FULL_NAMA = 'Dashboard Full';
const ANGGARAN_NAMA = 'Anggaran';
const CARI_NAMA = 'Cari Transaksi';
const STATEMENT_NAMA = 'Statement';
const KONTROL_NAMA = 'Kontrol Saldo';
const TOP_ANOMALI_NILAI = 25;

test('konstanta nama tab & TOP_ANOMALI di tes ini masih cocok dengan Code.gs', () => {
  const h = jalankan({ pakaiKoma: false, rekening: ['BCA|111'], bulan: 2, kategori: 2 });
  assert.ok(h.lembar[DASHBOARD_FULL_NAMA], `sheet bernama "${DASHBOARD_FULL_NAMA}" harus ada`);
  assert.ok(h.lembar[ANGGARAN_NAMA], `sheet bernama "${ANGGARAN_NAMA}" harus ada`);
  assert.ok(h.lembar[CARI_NAMA], `sheet bernama "${CARI_NAMA}" harus ada`);
  assert.ok(h.lembar[STATEMENT_NAMA], `sheet bernama "${STATEMENT_NAMA}" harus ada`);
  assert.ok(h.lembar[KONTROL_NAMA], `sheet bernama "${KONTROL_NAMA}" harus ada`);
  const rentangFull = JSON.parse(h.props.rentangBlokDashboardFull || '[]').sort((a, b) => a[0] - b[0]);
  const tinggiAnomali = rentangFull[rentangFull.length - 2][1] - rentangFull[rentangFull.length - 2][0];
  assert.equal(tinggiAnomali, TOP_ANOMALI_NILAI + 1, 'TOP_ANOMALI_NILAI di tes ini harus cocok dengan TOP_ANOMALI di Code.gs');
});

test('pastikanAnggaran tidak menimpa nilai yang sudah diketik pengguna, dan tidak menduplikasi kategori', () => {
  const h = jalankan({ pakaiKoma: false, rekening: ['BCA|111'], bulan: 2, kategori: 3 });
  const anggaran = h.lembar.Anggaran;
  const jumlahAwal = anggaran.getLastRow() - 1;
  assert.equal(jumlahAwal, 3, 'seed awal harus pas 3 kategori');

  // Simulasikan pengguna mengetik target anggaran di baris kategori pertama.
  anggaran.getRange(2, 2).setValue(500000);
  anggaran.getRange(2, 3).setValue('Dikira-kira dari rata-rata 3 bulan terakhir');

  h.ulangi();

  assert.equal(anggaran.getRange(2, 2).getValues()[0][0], 500000,
    'Target Bulanan yang diketik pengguna tidak boleh tertimpa oleh sinkron berikutnya');
  assert.equal(anggaran.getRange(2, 3).getValues()[0][0], 'Dikira-kira dari rata-rata 3 bulan terakhir',
    'Catatan yang diketik pengguna tidak boleh tertimpa');
  assert.equal(anggaran.getLastRow() - 1, jumlahAwal,
    'tidak boleh ada baris kategori yang terduplikasi pada sinkron berikutnya');
});

test('Cari Transaksi hanya dibuat sekali — sinkron berikutnya tidak menyentuhnya lagi', () => {
  const h = jalankan({ pakaiKoma: false, rekening: ['BCA|111'], bulan: 2, kategori: 2 });
  const cari = h.lembar['Cari Transaksi'];
  // Simulasikan pengguna sedang mengetik kata kunci pencarian.
  cari.getRange('B2').setValue('kopi');

  const dibuatSebelum = h.dibuat.filter((n) => n === 'Cari Transaksi').length;
  h.ulangi();
  const dibuatSesudah = h.dibuat.filter((n) => n === 'Cari Transaksi').length;

  assert.equal(dibuatSesudah, dibuatSebelum, 'Cari Transaksi tidak boleh dibuat ulang');
  assert.equal(cari.getRange('B2').getValues()[0][0], 'kopi',
    'kata kunci yang sedang diketik pengguna tidak boleh terhapus oleh sinkron berikutnya');
});

/* ==========================================================================
   Kontrol Saldo

   Yang dijaga di sini: tabel kontrol IKUT MEMANJANG ketika tab Statement
   berisi baris (pada susunan fixture di atas tab itu masih kosong, jadi
   seluruh pemeriksaan di atas cuma menguji keadaan nol), rumusnya benar-benar
   membandingkan tab Statement dengan tab data, dan tab Statement sendiri
   tidak pernah tertimpa — kolom saldonya boleh diketik tangan.
   ========================================================================== */

/** Isi tab Statement seperti yang dikirim aplikasi (13 kolom, lihat HEADER_STATEMENT). */
function isiStatement(sheet, baris) {
  baris.forEach((b, i) => {
    sheet.getRange(2 + i, 1, 1, 13).setValues([[
      b.id, b.bank, b.nomor, b.bulan, `${b.bulan}-01`, `${b.bulan}-28`,
      b.saldoAwal, b.saldoAkhir, b.debet, b.kredit, b.jml, 'statement.pdf', new Date(),
    ]]);
  });
}

test('Kontrol Saldo memanjang mengikuti isi tab Statement, dan blok tetap tidak bertabrakan', () => {
  const h = jalankan({ pakaiKoma: false, rekening: ['BCA|111'], bulan: 3, kategori: 2 });
  const rentangAwal = JSON.parse(h.props.rentangBlokKontrol || '[]');
  assert.ok(rentangAwal.length >= 3, 'Kontrol Saldo harus punya 3 blok (kontrol, tanpa statement, rekap)');

  isiStatement(h.lembar.Statement, [
    { id: 'upl1', bank: 'BCA', nomor: '111', bulan: '2025-01', saldoAwal: 1000000, saldoAkhir: 1200000, debet: 50000, kredit: 250000, jml: 4 },
    { id: 'upl2', bank: 'BCA', nomor: '111', bulan: '2025-02', saldoAwal: 1200000, saldoAkhir: 1150000, debet: 80000, kredit: 30000, jml: 3 },
    { id: 'upl3', bank: 'BCA', nomor: '111', bulan: '2025-03', saldoAwal: 1150000, saldoAkhir: 1400000, debet: 20000, kredit: 270000, jml: 5 },
  ]);

  h.ulangi();

  assert.deepEqual(h.pelanggaran, [], `melampaui batas grid:\n  ${h.pelanggaran.join('\n  ')}`);

  const rentang = JSON.parse(h.props.rentangBlokKontrol || '[]').sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < rentang.length; i += 1) {
    assert.ok(rentang[i][0] > rentang[i - 1][1], `blok Kontrol Saldo bertabrakan: [${rentang[i - 1]}] dan [${rentang[i]}]`);
  }
  // Tiga statement menambah tiga baris kontrol dibanding keadaan nol (yang
  // menyisakan satu baris minimum) — buktinya tinggi blok pertama bertambah.
  const tinggiAwal = rentangAwal.sort((a, b) => a[0] - b[0])[0];
  assert.equal(rentang[0][1] - rentang[0][0], (tinggiAwal[1] - tinggiAwal[0]) + 2,
    'blok kontrol harus tumbuh sebanyak pasangan rekening+bulan baru di tab Statement');

  const semuaRumus = Object.values(h.rumus).join('\n');
  assert.ok(semuaRumus.includes("'Statement'!G2:G"), 'kontrol harus membaca Saldo Awal Statement');
  assert.ok(semuaRumus.includes("'Statement'!H2:H"), 'kontrol harus membaca Saldo Akhir Statement');
  assert.ok(semuaRumus.includes("'Akun'!G2:G"),
    'saldo pembukuan harus dihitung maju dari Saldo Awal di tab Akun, bukan dari kolom Saldo cetakan bank');
  // Inti kontrolnya: saldo pembukuan TIDAK BOLEH diambil dari kolom Saldo
  // (P) tab data. Kalau itu yang dipakai, yang dibandingkan adalah angka bank
  // dengan angka bank, dan pemeriksaannya selalu lolos walau ada baris hilang.
  const kontrolSaja = Object.entries(h.rumus)
    .filter(([sel]) => sel.startsWith('Kontrol Saldo!'))
    .map(([, f]) => f);
  assert.ok(kontrolSaja.length > 0, 'harus ada rumus kontrol yang merujuk tab Statement');
  for (const f of kontrolSaja) {
    assert.ok(!f.includes("'Transaksi'!P2:P"),
      `rumus kontrol tidak boleh memakai kolom Saldo cetakan bank: ${f.slice(0, 120)}`);
  }
});

test('tab Statement dibuat sekali dan angka yang diketik tangan tidak pernah tertimpa', () => {
  const h = jalankan({ pakaiKoma: false, rekening: ['BCA|111'], bulan: 2, kategori: 2 });
  const statement = h.lembar.Statement;

  // Statement lama yang ringkasannya tidak pernah terekam aplikasi: dua angka
  // ini diketik tangan dari PDF aslinya, tanpa ID Upload.
  isiStatement(statement, [
    { id: '', bank: 'BCA', nomor: '111', bulan: '2024-12', saldoAwal: 900000, saldoAkhir: 950000, debet: '', kredit: '', jml: '' },
  ]);

  const dibuatSebelum = h.dibuat.filter((n) => n === 'Statement').length;
  h.ulangi();

  assert.equal(h.dibuat.filter((n) => n === 'Statement').length, dibuatSebelum,
    'tab Statement tidak boleh dibuat ulang');
  assert.equal(statement.getRange(2, 7).getValues()[0][0], 900000,
    'Saldo Awal yang diketik tangan tidak boleh tertimpa');
  assert.equal(statement.getRange(2, 8).getValues()[0][0], 950000,
    'Saldo Akhir yang diketik tangan tidak boleh tertimpa');
  assert.equal(statement.getRange(1, 1).getValues()[0][0], 'ID Upload',
    'header tab Statement harus tetap utuh');
});

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
function jalankanDoPost({
  barisAda = 0, payload, kunciMacet = false, gridTambahan = [], arsipGrid = null,
  statementGrid = null,
}) {
  const grid = [HEADER_UJI.slice()];
  for (let i = 0; i < barisAda; i += 1) {
    const b = barisPenuh(i);
    grid.push([b.hash, b.tanggal, b.deskripsi, b.nominal, b.debit, b.kredit, b.kategoriId,
      b.bank, b.nomorRekening, b.namaPemilik, b.sumber, b.uploadedFileId, new Date(),
      b.kategoriNama, false, b.saldo]);
  }
  // Baris tambahan mentah (18 kolom, termasuk ID Transaksi/Diubah Pada) —
  // dipakai tes tarikTransaksi yang butuh kontrol penuh atas isi baris,
  // beda dari barisPenuh() yang cuma 16 kolom (bentuk payload dikirim, bukan
  // isi Sheet yang sudah lengkap dengan kolom pull).
  gridTambahan.forEach((r) => grid.push(r));

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
      getLastColumn: () => (isi[0] ? isi[0].length : 0),
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
  if (arsipGrid) lembar._Arsip = buatSheet('_Arsip', arsipGrid);
  if (statementGrid) lembar.Statement = buatSheet('Statement', statementGrid);
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
      BorderStyle: { SOLID_THICK: 'SOLID_THICK' },
      newConditionalFormatRule() {
        const b = new Proxy({ build: () => ({}) }, { get: (t, k) => (k in t ? t[k] : () => b) });
        return b;
      },
      getUi: () => new Proxy({}, { get: () => () => ({}) }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { if (kunciMacet) throw new Error('timeout'); },
        releaseLock: () => {},
      }),
    },
    Charts: { ChartType: { PIE: 'PIE', COLUMN: 'COLUMN', LINE: 'LINE' } },
    Utilities: { formatDate: (dt, _tz, pola) => (pola === 'yyyy-MM' || pola === 'yyyy-MM-dd' ? `${dt.getFullYear()}-01` : `01/01/${dt.getFullYear()} 00:00`) },
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

test('arsipkan melebarkan header _Arsip lama (17 kolom) saat ada baris baru dibuang', () => {
  // _Arsip yang sudah ada dari sebelum kolom ID Transaksi/Diubah Pada
  // ditambah -- headernya harus diperbaiki, bukan dibiarkan lebih sempit
  // dari baris yang baru ditulis di bawahnya (lihat catatan arsipkan()).
  const headerLama = ['Dihapus Pada'].concat(HEADER_UJI);
  const rows = Array.from({ length: 60 }, (_, i) => identitas(i));
  const h = jalankanDoPost({
    barisAda: 100,
    arsipGrid: [headerLama],
    payload: { selaras: true, hanyaSelaras: true, rows, jumlah: rows.length },
  });

  assert.equal(h.balasan.dihapus, 40);
  const headerBaru = h.lembar._Arsip.getRange(1, 1, 1, h.lembar._Arsip.getLastColumn()).getValues()[0];
  assert.deepEqual(headerBaru, HEADER_ARSIP_UJI, 'header _Arsip harus diperbaiki jadi 19 kolom');
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
  // 18, bukan 16: HEADER.length sejak kolom "ID Transaksi"/"Diubah Pada" ditambah.
  const tulisLebar = h.tulisan.filter((t) => t.sheet === 'Transaksi' && t.lebar === 18 && t.tinggi > 1);
  assert.equal(tulisLebar.length, 1, 'satu penulisan borong');
  assert.equal(tulisLebar[0].tinggi, 250, `menulis ${tulisLebar[0].tinggi} baris untuk 250 perubahan`);
});

test('arsip membaca satu jendela, bukan satu panggilan per baris yang dihapus', () => {
  // Menghapus 300 baris dengan satu getRange per baris berarti 300 perjalanan
  // bolak-balik ke Sheets di dalam permintaan yang waktunya terbatas — pola
  // yang sama persis dengan yang membuat pengiriman dulu tidak pernah selesai.
  const rows = Array.from({ length: 700 }, (_, i) => identitas(i));
  const h = jalankanDoPost({
    barisAda: 1000,
    payload: { selaras: true, hanyaSelaras: true, rows, jumlah: rows.length },
  });

  assert.equal(h.balasan.dihapus, 300);
  const bacaSatuBaris = h.bacaan.filter((b) => b.sheet === 'Transaksi' && b.baris >= 2 && b.tinggi === 1);
  assert.ok(bacaSatuBaris.length < 10,
    `${bacaSatuBaris.length} pembacaan per baris — seharusnya satu jendela`);
});

test('ping tetap menjawab walau kunci skrip sedang dipegang proses lain', () => {
  // Aplikasi memakai ping untuk menjawab "berapa yang sudah mendarat?" tepat
  // sesudah pengiriman putus — yaitu saat kemungkinan besar masih ada
  // permintaan panjang yang memegang kunci. Kalau ping ikut antre, satu-satunya
  // saat pertanyaan itu ditanyakan adalah saat ia paling mungkin tak terjawab.
  const h = jalankanDoPost({ barisAda: 1250, payload: { ping: true }, kunciMacet: true });
  assert.equal(h.balasan.ok, true);
  assert.equal(h.balasan.total, 1250);
});

test('permintaan yang membawa data tetap menghormati kunci', () => {
  // Kebalikannya harus tetap berlaku: dua perangkat yang menulis bersamaan
  // masih harus diserialkan, kalau tidak yang satu menimpa hasil yang lain.
  const rows = Array.from({ length: 10 }, (_, i) => barisPenuh(9000 + i));
  const h = jalankanDoPost({ barisAda: 10, payload: { rows, jumlah: rows.length }, kunciMacet: true });
  assert.equal(h.balasan.ok, false);
  assert.match(h.balasan.error, /sedang dipakai proses lain/);
});

/* ==========================================================================
   tarikTransaksi — pull checkpoint-based dari tab Transaksi + _Arsip
   ========================================================================== */

/** Satu baris mentah 18 kolom persis seperti isi tab Transaksi sungguhan. */
function barisTransaksiMentah({
  hash, tanggal = '2025-07-01', nominal = -1000, kategoriId = 'kat1', dikirim, id, diubahPada,
}) {
  return [hash, tanggal, `Desc ${hash}`, nominal, Math.abs(nominal), 0, kategoriId,
    'BCA', '111', 'Budi', 'pdf', '', dikirim, 'KategoriA', false, 5000, id, diubahPada];
}

const HEADER_ARSIP_UJI = ['Dihapus Pada'].concat(HEADER_UJI, ['ID Transaksi', 'Diubah Pada']);

test('tarikTransaksi hanya mengembalikan baris lebih baru dari sejak, dan melewati baris tanpa ID Transaksi', () => {
  const sejak = new Date('2026-01-01T00:00:00.000Z');
  const gridTambahan = [
    // Lebih baru dari sejak, punya ID -> harus ikut.
    barisTransaksiMentah({
      hash: 'hA', dikirim: new Date('2026-01-02T00:00:00.000Z'), id: 'trxA', diubahPada: '2026-01-02T00:00:00.000Z',
    }),
    // Tanpa ID Transaksi (baris lama sebelum migrasi) -> harus dilewati walau baru.
    barisTransaksiMentah({
      hash: 'hB', dikirim: new Date('2026-01-02T00:00:00.000Z'), id: '', diubahPada: '',
    }),
    // Punya ID, tapi LEBIH LAMA dari sejak -> harus dilewati.
    barisTransaksiMentah({
      hash: 'hC', dikirim: new Date('2025-01-01T00:00:00.000Z'), id: 'trxC', diubahPada: '2025-01-01T00:00:00.000Z',
    }),
  ];

  const h = jalankanDoPost({ gridTambahan, payload: { tarikTransaksi: true, sejak: sejak.toISOString() } });

  assert.equal(h.balasan.ok, true);
  assert.deepEqual(h.balasan.baris.map((b) => b.id), ['trxA']);
  assert.equal(h.balasan.baris[0].hash, 'hA');
  assert.equal(h.balasan.baris[0].diubahPada, '2026-01-02T00:00:00.000Z');
});

test('tarikTransaksi tanpa sejak (null) mengembalikan seluruh baris yang punya ID Transaksi', () => {
  const gridTambahan = [
    barisTransaksiMentah({ hash: 'hA', dikirim: new Date('2020-01-01'), id: 'trxA', diubahPada: '2020-01-01T00:00:00.000Z' }),
    barisTransaksiMentah({ hash: 'hB', dikirim: new Date('2024-01-01'), id: 'trxB', diubahPada: '2024-01-01T00:00:00.000Z' }),
  ];
  const h = jalankanDoPost({ gridTambahan, payload: { tarikTransaksi: true, sejak: null } });
  assert.deepEqual(h.balasan.baris.map((b) => b.id).sort(), ['trxA', 'trxB']);
});

test('tarikTransaksi membaca _Arsip untuk baris yang sudah dihapus sejak checkpoint', () => {
  const sejak = new Date('2026-01-01T00:00:00.000Z');
  const arsipGrid = [
    HEADER_ARSIP_UJI,
    // Dihapus SETELAH sejak -> harus dilaporkan.
    [new Date('2026-01-05T00:00:00.000Z')].concat(barisTransaksiMentah({
      hash: 'hD', dikirim: new Date('2025-06-01'), id: 'trxD', diubahPada: '2025-06-01T00:00:00.000Z',
    })),
    // Dihapus SEBELUM sejak -> tidak boleh ikut (sudah pernah dilaporkan di pull sebelumnya).
    [new Date('2025-01-01T00:00:00.000Z')].concat(barisTransaksiMentah({
      hash: 'hE', dikirim: new Date('2024-01-01'), id: 'trxE', diubahPada: '2024-01-01T00:00:00.000Z',
    })),
  ];

  const h = jalankanDoPost({
    gridTambahan: [], arsipGrid, payload: { tarikTransaksi: true, sejak: sejak.toISOString() },
  });

  assert.deepEqual(h.balasan.dihapus, ['trxD']);
});

test('tarikTransaksi mengabaikan _Arsip lama yang belum bermigrasi (tanpa kolom ID Transaksi)', () => {
  // _Arsip dari sebelum kolom ID Transaksi/Diubah Pada ada -- headernya masih
  // 17 kolom lama. tarikTransaksi harus diam-diam melewati baris seperti ini,
  // bukan salah baca kolom lain sebagai id.
  const headerLama = ['Dihapus Pada'].concat(HEADER_UJI);
  const arsipGrid = [
    headerLama,
    [new Date('2026-01-05T00:00:00.000Z'), 'hF', '2025-01-01', 'Desc', -100, 100, 0, 'kat1',
      'BCA', '111', 'Budi', 'pdf', '', new Date('2024-01-01'), 'KategoriA', false, 100],
  ];

  const h = jalankanDoPost({
    gridTambahan: [], arsipGrid,
    payload: { tarikTransaksi: true, sejak: new Date('2020-01-01').toISOString() },
  });

  assert.deepEqual(h.balasan.dihapus, []);
});

/* Header tab Statement, dicerminkan dari HEADER_STATEMENT di Code.gs. */
const HEADER_STATEMENT_UJI = ['ID Upload', 'Bank', 'No. Rekening', 'Bulan', 'Periode Awal',
  'Periode Akhir', 'Saldo Awal Statement', 'Saldo Akhir Statement', 'Mutasi Debet',
  'Mutasi Kredit', 'Jumlah Transaksi', 'Nama File', 'Tanggal Upload'];

const barisStatement = (id, bulan, saldoAwal, saldoAkhir) => [
  id, 'BCA', '1234567890', bulan, `${bulan}-01`, `${bulan}-31`,
  saldoAwal, saldoAkhir, 1000, 2000, 5, 'e-statement.pdf', new Date(),
];

test('entity statement: upsert per ID Upload, bukan menambah baris kedua', () => {
  const h = jalankanDoPost({
    statementGrid: [HEADER_STATEMENT_UJI.slice(), barisStatement('upl1', '2025-07', 100, 200)],
    payload: {
      entity: 'statement',
      rows: [{
        id: 'upl1', bank: 'BCA', nomorRekening: '1234567890', bulan: '2025-07',
        periodeAwal: '2025-07-01', periodeAkhir: '2025-07-31',
        saldoAwalStatement: 5000, saldoAkhirStatement: 7000,
        mutasiDebetStatement: 1000, mutasiKreditStatement: 3000,
        jumlahTransaksi: 9, namaFile: 'baru.pdf', tanggalUpload: '2025-08-01T00:00:00.000Z',
      }],
    },
  });

  assert.equal(h.balasan.ok, true);
  assert.equal(h.balasan.inserted, 0, 'ID yang sudah ada tidak boleh disisipkan sebagai baris baru');
  assert.equal(h.balasan.updated, 1, 'baris dengan ID sama harus ditimpa di tempatnya');
  const sh = h.lembar.Statement;
  assert.equal(sh.getLastRow(), 2, 'tetap satu baris data');
  assert.equal(sh.getRange(2, 7, 1, 2).getValues()[0][0], 5000, 'Saldo Awal harus terbarui');
  assert.equal(sh.getRange(2, 7, 1, 2).getValues()[0][1], 7000, 'Saldo Akhir harus terbarui');
});

test('entity statement: hapus membuang barisnya, bukan menandainya tombstone', () => {
  // Tab Statement tidak punya kolom "Dihapus Pada" dan tidak pernah ditarik
  // balik ke perangkat lain, jadi tombstone tidak ada gunanya di sini —
  // sebaliknya, baris yang tertinggal membuat kontrol saldo membandingkan
  // bulan itu dengan e-statement yang upload-nya sudah dibatalkan.
  const h = jalankanDoPost({
    statementGrid: [
      HEADER_STATEMENT_UJI.slice(),
      barisStatement('upl1', '2025-06', 100, 200),
      barisStatement('upl2', '2025-07', 200, 300),
      barisStatement('upl3', '2025-08', 300, 400),
    ],
    payload: { entity: 'statement', hapus: ['upl1', 'upl3'] },
  });

  assert.equal(h.balasan.ok, true);
  assert.equal(h.balasan.dihapus, 2);
  const sh = h.lembar.Statement;
  assert.equal(sh.getLastRow(), 2, 'dua baris terbuang, sisa header + satu baris');
  assert.equal(sh.getRange(2, 1).getValues()[0][0], 'upl2',
    'baris yang tersisa harus upl2 — penghapusan dari bawah ke atas supaya nomor baris tidak bergeser');
});
