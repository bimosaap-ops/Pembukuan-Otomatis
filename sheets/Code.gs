/**
 * Code.gs — tempel di Extensions > Apps Script pada Google Sheet tujuan.
 * Deploy: Deploy > New deployment > Web App > Anyone with the link > Copy URL -> tempel di Pengaturan app.
 *
 * Sheet data (nama baku "Transaksi") header baris 1 wajib, berurutan A..N:
 * Hash | Tanggal | Deskripsi | Nominal | Debit | Kredit | ID Kategori | Bank |
 * No. Rekening | Nama Pemilik | Sumber | ID Upload | Dikirim Pada | Kategori
 *
 * Upsert berdasarkan hash (kolom A): hash yang sudah ada di Sheet DITIMPA di
 * baris yang sama, bukan dilewati. Ini penting karena kategori sebuah transaksi
 * bisa dikoreksi belakangan (lewat halaman Transaksi, atau "Kelompokkan ulang"
 * di halaman Kategori) — kalau cuma dedupe-skip, koreksi itu tidak akan pernah
 * sampai ke Sheet walau tombol "Kirim semua sekarang" dipakai.
 *
 * Tab "Dashboard" dibuat otomatis sekali, bergaya laporan keuangan: kartu
 * ringkasan, tabel bulanan dengan Net Cash Flow dan status surplus/defisit,
 * pengeluaran per kategori, serta matriks rincian kategori x bulan yang dipisah
 * seksi Pengeluaran dan Pemasukan — semuanya rumus Sheets yang merujuk balik ke
 * tab data, jadi ikut ter-update sendiri tiap ada transaksi baru. Sekali dibuat tab
 * itu tidak ditimpa lagi, KECUALI kalau rusak (rumusnya bernilai galat, atau
 * tabnya tertulisi data transaksi) — keadaan itu disembuhkan sendiri pada POST
 * berikutnya, lihat pastikanDashboard. Menu "Pembukuan" di spreadsheet berisi
 * "Bangun ulang Dashboard" untuk memaksanya sekarang juga, dan "Diagnosa" yang
 * melaporkan lokal, pemisah argumen terdeteksi, dan isi sel rumus kunci.
 *
 * Dua hal yang pernah bikin kacau dan sengaja dijaga di sini:
 *
 *   1. Dashboard disisipkan di posisi TERAKHIR, bukan pertama. Kode versi lama
 *      (yang mungkin masih terpasang di deployment lain) mencari sheet data
 *      dengan "sheet pertama" — kalau Dashboard ada di posisi pertama, data
 *      transaksi ikut tertulis ke sana dan tab Dashboard jadi berantakan.
 *   2. Pemisah argumen rumus mengikuti lokal spreadsheet (lihat pisahArgumen).
 *      Di lokal Indonesia pemisahnya ";" dan pemisah kolom array literal "\",
 *      bukan ",". Rumus bertanda koma di sheet berlokal Indonesia gagal parse
 *      jadi #ERROR! — dan #ERROR! tidak bisa ditangkap IFERROR.
 */
const SHEET_NAME = ''; // kosong = deteksi/migrasi otomatis (lihat sheetData)
const DATA_SHEET_NAME = 'Transaksi';
const DASHBOARD_SHEET_NAME = 'Dashboard';
/**
 * Dinaikkan setiap kali tata letak/rumus Dashboard berubah. Dashboard yang
 * dibangun versi lama otomatis dibangun ulang saat POST berikutnya — tanpa ini,
 * perbaikan rumus hanya berlaku untuk Sheet baru, sementara Sheet yang sudah
 * ada tetap memakai rumus lama sampai pengguna ingat membuka menu "Pembukuan".
 */
const VERSI_DASHBOARD = '5';

/** Sel rumus kunci di Dashboard — dipantau untuk mendeteksi kerusakan. */
const SEL_RUMUS = ['A9', 'D10', 'G9', 'A45'];

const HEADER = ['Hash','Tanggal','Deskripsi','Nominal','Debit','Kredit','ID Kategori','Bank','No. Rekening','Nama Pemilik','Sumber','ID Upload','Dikirim Pada','Kategori'];
const LEBAR_KOLOM = [110, 95, 300, 120, 120, 120, 130, 90, 130, 150, 80, 110, 140, 150];
const KOLOM_RP = [4, 5, 6];      // Nominal, Debit, Kredit
const KOLOM_WAKTU = 13;          // Dikirim Pada
const KOLOM_SEMBUNYI = [1, 7, 12]; // Hash, ID Kategori, ID Upload — dipakai mesin, bukan mata

const RP = '"Rp "#,##0;[RED]-"Rp "#,##0';
const FORMAT_WAKTU = 'dd/mm/yyyy HH:mm';

/* Palet laporan keuangan: kepala tabel biru tua berteks putih, angka surplus
   hijau, defisit merah, pita seksi pengeluaran merah tua. */
const BIRU_TUA = '#1f4e79';
const MERAH_TUA = '#922b21';
const HIJAU = '#006600';
const MERAH = '#cc0000';

/** Menu di spreadsheet, supaya perbaikan tidak perlu buka editor Apps Script. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Pembukuan')
    .addItem('Bangun ulang Dashboard & rapikan data', 'bangunUlangDashboard')
    .addItem('Diagnosa', 'diagnosaDashboard')
    .addToUi();
}

/**
 * Sheet data selalu dicari dengan nama, TIDAK PERNAH dengan "sheet pertama" —
 * lihat catatan (1) di kepala berkas. Sheet bernama Dashboard tidak akan pernah
 * dianggap sebagai sheet data.
 */
function sheetData(ss) {
  if (SHEET_NAME) return ss.getSheetByName(SHEET_NAME);
  const adaNama = ss.getSheetByName(DATA_SHEET_NAME);
  if (adaNama) return adaNama;
  const lain = ss.getSheets().filter((s) => s.getName() !== DASHBOARD_SHEET_NAME);
  return lain.length ? lain[0] : ss.insertSheet(DATA_SHEET_NAME, 0);
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = sheetData(ss);
  if (!SHEET_NAME && sh.getName() !== DATA_SHEET_NAME) sh.setName(DATA_SHEET_NAME);

  const baru = sh.getLastRow() === 0;
  if (baru) sh.appendRow(HEADER);
  // header guard
  const h = sh.getRange(1, 1, 1, HEADER.length).getValues()[0].map(String);
  const perluPerbaikanHeader = h.join('|') !== HEADER.join('|');
  if (perluPerbaikanHeader) sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  if (baru || perluPerbaikanHeader) rapikanTampilan(sh);

  // Dashboard adalah hiasan; menyimpan transaksi adalah tugas utamanya. Kalau
  // pembangunan Dashboard gagal, doPost TIDAK boleh ikut gagal — sebelumnya
  // galat di sini membatalkan seluruh permintaan sehingga transaksinya pun
  // tidak tersimpan. Versinya baru dicatat setelah berhasil, jadi percobaan
  // berikutnya akan mengulang sendiri.
  try {
    pastikanDashboard(ss, sh.getName());
  } catch (e) {
    console.warn('Dashboard gagal dibangun, data tetap disimpan:', e);
  }
  return sh;
}

/**
 * Rapikan tab data sekali saat Sheet baru dibuat atau headernya baru diperbaiki
 * — bukan pada tiap doPost, supaya penyesuaian manual pengguna (lebar kolom,
 * dst.) tidak ditimpa ulang tiap ada transaksi masuk. Bisa dipanggil ulang
 * kapan saja lewat menu "Pembukuan".
 */
function rapikanTampilan(sh) {
  const kolom = HEADER.length;
  const isi = Math.max(sh.getMaxRows() - 1, 1);

  sh.setFrozenRows(1);
  sh.setRowHeight(1, 34);
  sh.getRange(1, 1, 1, kolom)
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1a73e8')
    .setVerticalAlignment('middle').setWrap(false);

  LEBAR_KOLOM.forEach((lebar, i) => sh.setColumnWidth(i + 1, lebar));

  KOLOM_RP.forEach((k) => sh.getRange(2, k, isi, 1).setNumberFormat(RP));
  sh.getRange(2, KOLOM_WAKTU, isi, 1).setNumberFormat(FORMAT_WAKTU);
  // Tanggal sengaja dibiarkan teks ISO ("2025-07-01"): urutannya sudah benar
  // secara leksikal, dan tabel Tren Bulanan mengambil bulannya lewat LEFT(B,7)
  // yang hanya bekerja pada teks.
  sh.getRange(2, 2, isi, 1).setHorizontalAlignment('center');
  normalkanWaktu(sh);

  // Kolom teknis tetap ditulis dan tetap dipakai upsert, hanya disembunyikan
  // supaya yang terbaca cuma kolom yang berarti buat manusia.
  KOLOM_SEMBUNYI.forEach((k) => sh.hideColumns(k));

  // Banding lama dibuang dulu: applyRowBanding menolak range yang bertumpang
  // tindih dengan banding yang sudah ada.
  sh.getBandings().forEach((b) => b.remove());
  sh.getRange(2, 1, isi, kolom)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

  sh.setTabColor('#5f6368');
}

/**
 * Ubah "Dikirim Pada" yang masih teks ISO menjadi Date sungguhan, sekali jalan.
 * Baris yang ditulis versi lama menyimpannya sebagai teks, sedangkan baris baru
 * sudah berupa Date — tanpa ini satu kolom akan tampil separuh "2026-09-10T18:17:16.925Z"
 * dan separuh "10/09/2026 18:17".
 */
function normalkanWaktu(sh) {
  const last = sh.getLastRow();
  if (last < 2) return;
  const rng = sh.getRange(2, KOLOM_WAKTU, last - 1, 1);
  const nilai = rng.getValues();
  let berubah = false;
  const hasil = nilai.map(([v]) => {
    if (typeof v === 'string' && v) {
      const t = new Date(v);
      if (!isNaN(t.getTime())) { berubah = true; return [t]; }
    }
    return [v];
  });
  if (berubah) rng.setValues(hasil);
}

/**
 * Pemisah argumen rumus mengikuti lokal spreadsheet — lihat catatan (2) di
 * kepala berkas. Dideteksi dengan mencoba rumus dua argumen: di lokal yang
 * memakai koma sebagai pemisah argumen hasilnya 3, di lokal yang memakai koma
 * sebagai pemisah desimal (Indonesia, Jerman, dst.) "1,2" terbaca satu bilangan
 * sehingga hasilnya bukan 3. Dideteksi, bukan didaftar, supaya tidak perlu
 * memelihara daftar lokal.
 */
function pisahArgumen(ss) {
  // Dicoba di sheet sementara, bukan di sel kosong sheet yang dipakai: sheet
  // pengguna tidak boleh disentuh sama sekali oleh alat ukur.
  const tmp = ss.insertSheet(`__uji${Date.now()}`);
  let pakaiKoma = false;
  try {
    const sel = tmp.getRange('A1');
    sel.setFormula('=SUM(1,2)');
    pakaiKoma = sel.getValue() === 3;
  } finally {
    ss.deleteSheet(tmp);
  }
  return pakaiKoma ? ',' : ';';
}

/**
 * Dashboard dianggap rusak (dan boleh dibangun ulang otomatis) hanya pada dua
 * keadaan yang tidak mungkin disengaja pengguna:
 *
 *   - salah satu sel rumusnya bernilai galat (#ERROR!, #REF!, dst.) — misalnya
 *     rumus dibuat versi lama dengan pemisah argumen yang salah untuk lokal ini;
 *   - A1 berisi label header tab data, tanda tab ini pernah tertulisi data
 *     transaksi oleh kode versi lama.
 *
 * Sengaja sesempit itu: kalau patokannya "tata letak tidak seperti bawaan",
 * penyesuaian yang pengguna buat sendiri akan ditimpa berulang kali.
 */
function dashboardRusak(d) {
  const judul = String(d.getRange('A1').getValue()).trim().toLowerCase();
  if (judul === HEADER[0].toLowerCase() || judul === 'hash') return true;
  return SEL_RUMUS.some((a) => String(d.getRange(a).getValue()).charAt(0) === '#');
}

/**
 * Bangun tab "Dashboard": kartu ringkasan, breakdown pengeluaran per kategori,
 * tren bulanan pemasukan vs pengeluaran, plus grafik donat & kolom. Semuanya
 * rumus (SUM/COUNTA/QUERY/ARRAYFORMULA) yang merujuk balik ke tab data,
 * sehingga ikut ter-update tiap ada transaksi baru.
 *
 * Dibangun sekali saat belum ada, lalu dibiarkan supaya penyesuaian pengguna
 * aman — kecuali kalau rusak (lihat dashboardRusak), yang dibangun ulang
 * sendiri paling sering sekali per jam. Tanpa penyembuhan otomatis ini,
 * Dashboard yang terlanjur rusak baru pulih kalau pengguna ingat membuka menu
 * "Pembukuan", dan itu terlalu bergantung pada ritual yang tidak kelihatan.
 */
function pastikanDashboard(ss, namaSheetData) {
  const prop = PropertiesService.getScriptProperties();
  const ada = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  if (ada) {
    const perluUpgrade = prop.getProperty('versiDashboard') !== VERSI_DASHBOARD;
    if (!perluUpgrade && !dashboardRusak(ada)) return;
    if (!perluUpgrade) {
      // Jalur "rusak" dibatasi sekali per jam: kalau pembangunan ulang ternyata
      // tidak menyembuhkan, jangan diulang tiap POST — mahal dan boros kuota.
      // Jalur upgrade versi tidak dibatasi: itu sekali jalan dan memang diminta.
      const terakhir = Number(prop.getProperty('perbaikanTerakhir') || 0);
      if (Date.now() - terakhir < 60 * 60 * 1000) return;
      prop.setProperty('perbaikanTerakhir', String(Date.now()));
    }
    ss.deleteSheet(ada);
  }

  // Posisi TERAKHIR, bukan pertama — lihat catatan (1) di kepala berkas.
  const S = pisahArgumen(ss);           // pemisah argumen rumus
  const AS = S === ',' ? ',' : '\\';    // pemisah kolom di dalam array literal {}
  const d = ss.insertSheet(DASHBOARD_SHEET_NAME, ss.getNumSheets());
  const kol = (huruf) => `'${namaSheetData}'!${huruf}2:${huruf}`;

  const BULAN = `ARRAYFORMULA(LEFT(${kol('B')}${S}7))`;
  // Nama kategori dipakai kalau ada. Kalau kosong (baris yang terunggah sebelum
  // kolom Kategori ada), ID-nya dijadikan terbaca: "kat_transfer_keluar" ->
  // "Transfer Keluar". Kategori buatan sendiri ber-ID acak tetap tidak terbaca;
  // hanya "Kirim semua sekarang" yang bisa memberi nama aslinya.
  const KATEGORI = `ARRAYFORMULA(IF(${kol('N')}<>""${S}${kol('N')}${S}`
    + `IF(LEFT(${kol('G')}${S}4)="kat_"${S}PROPER(SUBSTITUTE(MID(${kol('G')}${S}5${S}100)${S}"_"${S}" "))${S}${kol('G')})))`;

  // Matriks kategori x bulan selebar 1 + jumlah bulan. Sheet baru hanya punya
  // 26 kolom, jadi grid-nya dilebarkan dulu bila perlu — menyetel lebar kolom
  // yang belum ada membuat Apps Script melempar "Kolom tersebut melampaui batas"
  // dan membatalkan seluruh pembangunan.
  const kolomPivot = Math.max(jumlahBulan(ss.getSheetByName(namaSheetData)) + 1, 3);
  const kolomPerlu = Math.max(kolomPivot + 2, 26);
  if (d.getMaxColumns() < kolomPerlu) {
    d.insertColumnsAfter(d.getMaxColumns(), kolomPerlu - d.getMaxColumns());
  }
  const AKHIR = hurufKolom(kolomPivot);

  d.setHiddenGridlines(true);
  d.setTabColor(BIRU_TUA);
  // Lebar seragam, tanpa kolom penyela sempit: kolom yang di bagian atas cuma
  // jarak antar tabel, di bagian pivot adalah kolom bulan yang harus terbaca.
  d.setColumnWidth(1, 170);
  d.setColumnWidths(2, d.getMaxColumns() - 1, 120);

  /* ---------- Judul ---------- */
  d.getRange('A1:I1').merge()
    .setValue('LAPORAN KEUANGAN — RINGKASAN OTOMATIS')
    .setFontSize(14).setFontWeight('bold').setFontColor(BIRU_TUA)
    .setVerticalAlignment('middle');
  d.setRowHeight(1, 34);
  d.getRange('A2:I2').merge()
    .setValue(`Dihitung otomatis dari sheet "${namaSheetData}" — tidak perlu diperbarui manual.`)
    .setFontStyle('italic').setFontColor('#5f6368').setFontSize(10);

  /* ---------- Kartu ringkasan ---------- */
  const KARTU = [
    { kol: 'A', label: 'TOTAL PEMASUKAN', formula: `=SUM(${kol('F')})`, bg: '#e6f4ea', fg: HIJAU, format: RP },
    { kol: 'C', label: 'TOTAL PENGELUARAN', formula: `=SUM(${kol('E')})`, bg: '#fce8e6', fg: MERAH, format: RP },
    { kol: 'E', label: 'SALDO BERSIH', formula: '=A5-C5', bg: '#e8f0fe', fg: BIRU_TUA, format: RP },
    { kol: 'G', label: 'JUMLAH TRANSAKSI', formula: `=COUNTA(${kol('A')})`, bg: '#f1f3f4', fg: '#3c4043', format: '#,##0' },
  ];
  KARTU.forEach((k) => {
    const akhir = String.fromCharCode(k.kol.charCodeAt(0) + 1);
    d.getRange(`${k.kol}4:${akhir}4`).merge().setValue(k.label)
      .setFontWeight('bold').setFontSize(9).setFontColor(k.fg).setBackground(k.bg)
      .setHorizontalAlignment('center');
    d.getRange(`${k.kol}5:${akhir}6`).merge().setFormula(k.formula)
      .setFontSize(18).setFontWeight('bold').setFontColor(k.fg).setBackground(k.bg)
      .setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setNumberFormat(k.format);
  });
  d.setRowHeights(5, 2, 30);

  /* ---------- Ringkasan bulanan (A8:E40) ---------- */
  d.getRange('A8').setValue('RINGKASAN BULANAN').setFontWeight('bold').setFontSize(11).setFontColor(BIRU_TUA);
  d.getRange('A9').setFormula(
    `=IFERROR(QUERY({${BULAN}${AS}${kol('F')}${AS}${kol('E')}}${S}`
    + `"select Col1, sum(Col2), sum(Col3) where Col1 <> '' group by Col1 order by Col1 asc `
    + `label Col1 'Bulan', sum(Col2) 'Total Masuk', sum(Col3) 'Total Keluar'"${S}0)${S}"Belum ada data")`,
  );
  d.getRange('D9').setValue('Net Cash Flow');
  d.getRange('E9').setValue('Status');
  d.getRange('D10').setFormula(
    `=IFERROR(ARRAYFORMULA(IF(A10:A40=""${S}""${S}B10:B40-C10:C40))${S}"")`,
  );
  d.getRange('E10').setFormula(
    `=IFERROR(ARRAYFORMULA(IF(A10:A40=""${S}""${S}IF(B10:B40-C10:C40>=0${S}"✅ Surplus"${S}"⚠️ Defisit")))${S}"")`,
  );
  kepalaTabel(d, 'A9:E9');
  d.getRange('B10:D40').setNumberFormat(RP);
  d.getRange('A10:A40').setHorizontalAlignment('center');
  d.getRange('E10:E40').setHorizontalAlignment('center');

  /* ---------- Pengeluaran per kategori (G8:I40) ---------- */
  d.getRange('G8').setValue('PENGELUARAN PER KATEGORI').setFontWeight('bold').setFontSize(11).setFontColor(BIRU_TUA);
  d.getRange('G9').setFormula(
    `=IFERROR(QUERY({${KATEGORI}${AS}${kol('E')}}${S}`
    + `"select Col1, sum(Col2) where Col2 > 0 and Col1 <> '' group by Col1 order by sum(Col2) desc `
    + `label Col1 'Kategori', sum(Col2) 'Total'"${S}0)${S}"Belum ada data pengeluaran")`,
  );
  d.getRange('I9').setValue('% Pengeluaran');
  d.getRange('I10').setFormula(
    `=IFERROR(ARRAYFORMULA(IF(H10:H40=""${S}""${S}H10:H40/$C$5))${S}"")`,
  );
  kepalaTabel(d, 'G9:I9');
  d.getRange('H10:H40').setNumberFormat(RP);
  d.getRange('I10:I40').setNumberFormat('0.0%');

  /* ---------- Rincian kategori per bulan ---------- */
  d.getRange('A43').setValue('RINCIAN PER KATEGORI DAN BULAN')
    .setFontWeight('bold').setFontSize(11).setFontColor(BIRU_TUA);

  pitaSeksi(d, `A44:${AKHIR}44`, 'PENGELUARAN (DEBIT)', MERAH_TUA);
  d.getRange('A45').setFormula(
    `=IFERROR(QUERY({${KATEGORI}${AS}${BULAN}${AS}${kol('E')}}${S}`
    + `"select Col1, sum(Col3) where Col3 > 0 and Col1 <> '' group by Col1 pivot Col2"${S}0)${S}"Belum ada data")`,
  );
  kepalaTabel(d, `A45:${AKHIR}45`);
  d.getRange(`B46:${AKHIR}78`).setNumberFormat(RP);

  pitaSeksi(d, `A80:${AKHIR}80`, 'PEMASUKAN (KREDIT)', BIRU_TUA);
  d.getRange('A81').setFormula(
    `=IFERROR(QUERY({${KATEGORI}${AS}${BULAN}${AS}${kol('F')}}${S}`
    + `"select Col1, sum(Col3) where Col3 > 0 and Col1 <> '' group by Col1 pivot Col2"${S}0)${S}"Belum ada data")`,
  );
  kepalaTabel(d, `A81:${AKHIR}81`);
  d.getRange(`B82:${AKHIR}110`).setNumberFormat(RP);

  d.setFrozenRows(2);

  /* ---------- Net Cash Flow: hijau kalau surplus, merah kalau defisit ---------- */
  const rentangNet = [d.getRange('D10:D40')];
  d.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0).setFontColor(HIJAU).setBold(true).setRanges(rentangNet).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(0).setFontColor(MERAH).setBold(true).setRanges(rentangNet).build(),
  ]);

  /* ---------- Grafik ---------- */
  const donat = d.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(d.getRange('G9:H40'))
    .setPosition(4, 11, 0, 0)
    .setOption('title', 'Pengeluaran per Kategori')
    .setOption('pieHole', 0.45)
    .setOption('legend', { position: 'right' })
    .setOption('width', 560).setOption('height', 340)
    .build();
  d.insertChart(donat);

  const tren = d.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(d.getRange('A9:C40'))
    .setPosition(23, 11, 0, 0)
    .setOption('title', 'Pemasukan vs Pengeluaran per Bulan')
    .setOption('legend', { position: 'top' })
    .setOption('width', 560).setOption('height', 340)
    .setOption('colors', [HIJAU, MERAH])
    .build();
  d.insertChart(tren);

  // Dicatat paling akhir, setelah semuanya benar-benar terpasang: kalau
  // pembangunan gagal di tengah jalan, versinya tidak ikut tercatat sehingga
  // POST berikutnya mencoba lagi, bukan menganggap sudah beres.
  prop.setProperty('versiDashboard', VERSI_DASHBOARD);
}

/**
 * Berapa bulan berbeda yang ada di tab data. Dipakai menentukan lebar matriks
 * kategori x bulan: pita seksi dan baris kepalanya harus berhenti tepat di ujung
 * data, bukan memanjang melintasi kolom kosong.
 */
function jumlahBulan(sh) {
  const last = sh ? sh.getLastRow() : 0;
  if (last < 2) return 0;
  const unik = {};
  sh.getRange(2, 2, last - 1, 1).getValues().forEach(([v]) => {
    const bulan = v instanceof Date
      ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM')
      : String(v || '').slice(0, 7);
    if (bulan) unik[bulan] = true;
  });
  return Object.keys(unik).length;
}

/** Nomor kolom (1) -> huruf kolom ("A"), termasuk untuk kolom di atas Z. */
function hurufKolom(n) {
  let hasil = '';
  let sisa = n;
  while (sisa > 0) {
    const mod = (sisa - 1) % 26;
    hasil = String.fromCharCode(65 + mod) + hasil;
    sisa = Math.floor((sisa - 1) / 26);
  }
  return hasil;
}

/** Baris kepala tabel: teks putih tebal di atas biru tua. */
function kepalaTabel(d, a1) {
  d.getRange(a1)
    .setFontWeight('bold').setFontColor('#ffffff').setBackground(BIRU_TUA)
    .setVerticalAlignment('middle').setHorizontalAlignment('center');
}

/** Pita pemisah seksi selebar tabel, seperti "PENGELUARAN (DEBIT)". */
function pitaSeksi(d, a1, teks, warna) {
  d.getRange(a1).merge()
    .setValue(teks)
    .setFontWeight('bold').setFontColor('#ffffff').setBackground(warna)
    .setVerticalAlignment('middle');
}

/**
 * Hapus tab Dashboard lalu bangun ulang dari nol, sekaligus merapikan ulang tab
 * data. Dipakai lewat menu "Pembukuan" — perlu ketika Dashboard sudah terlanjur
 * kacau (misalnya pernah tertulisi data transaksi oleh deployment versi lama)
 * atau ketika tata letaknya diperbarui di versi Code.gs yang baru.
 *
 * Baris transaksi yang terlanjur nyasar ke tab Dashboard ikut terhapus. Itu
 * aman: sumber kebenarannya ada di aplikasi, tinggal tekan "Kirim semua
 * sekarang" di Pengaturan untuk mengisi ulang — upsert-nya berbasis hash, jadi
 * tidak akan menggandakan baris yang sudah ada.
 */
function bangunUlangDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = sheetData(ss);
  if (!SHEET_NAME && sh.getName() !== DATA_SHEET_NAME) sh.setName(DATA_SHEET_NAME);

  const lama = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  if (lama) ss.deleteSheet(lama);

  sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  rapikanTampilan(sh);
  pastikanDashboard(ss, sh.getName());

  const baru = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  if (baru) ss.setActiveSheet(baru);
  ss.toast('Selesai. Kalau ada baris yang hilang, tekan "Kirim semua sekarang" di Pengaturan aplikasi.', 'Dashboard dibangun ulang', 10);
}

/**
 * Laporkan apa yang sebenarnya terbaca oleh skrip: lokal, pemisah argumen yang
 * terdeteksi, sheet mana yang dianggap data, dan isi sel rumus kunci. Satu klik
 * ini menggantikan satu putaran tebak-tebakan ketika Dashboard masih salah.
 */
function diagnosaDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sh = sheetData(ss);
  const d = ss.getSheetByName(DASHBOARD_SHEET_NAME);

  const baris = [
    `Lokal spreadsheet : ${ss.getSpreadsheetLocale()}`,
    `Pemisah argumen   : "${pisahArgumen(ss)}"`,
    `Sheet data        : ${sh ? `${sh.getName()} (posisi ${sh.getIndex()}, ${Math.max(sh.getLastRow() - 1, 0)} baris)` : '(tidak ketemu)'}`,
    `Tab Dashboard     : ${d ? `ada, posisi ${d.getIndex()}` : 'belum ada'}`,
  ];
  if (d) {
    baris.push(`Dianggap rusak    : ${dashboardRusak(d) ? 'ya' : 'tidak'}`, '');
    ['A1'].concat(SEL_RUMUS).forEach((a) => {
      baris.push(`${a} = ${String(d.getRange(a).getDisplayValue()).slice(0, 70)}`);
    });
  }
  ui.alert('Diagnosa Pembukuan', baris.join('\n'), ui.ButtonSet.OK);
}

function doPost(e) {
  try {
    const body = e.postData ? e.postData.contents : '';
    const data = body ? JSON.parse(body) : {};
    if (data.ping) return json({ok:true, ping:true});
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) return json({ok:true, inserted:0, updated:0});

    // Payload tidak seharusnya pernah berisi hash ganda (hash unik di database
    // aplikasi), tapi tetap dijaga di sini: kejadian terakhir yang dipakai.
    const dedup = new Map();
    let anon = 0;
    rows.forEach((r) => { dedup.set(r.hash ? String(r.hash) : `__anon${anon++}`, r); });

    const sh = getSheet();
    const last = sh.getLastRow();
    // hash (kolom A) -> nomor baris tersimpan, dipakai menentukan upsert-nya
    // menimpa baris yang mana.
    const nomorBaris = {};
    if (last > 1) {
      sh.getRange(2,1,last-1,1).getValues().forEach((r, i) => {
        const h = String(r[0] || '');
        if (h) nomorBaris[h] = i + 2; // +2: baris 1 header, array mulai dari 0
      });
    }

    // Ditulis sebagai Date sungguhan, bukan teks ISO, supaya tampil sebagai
    // "10/09/2026 18:17" mengikuti format kolomnya dan bisa diurutkan.
    let ts = new Date();
    if (data.dikirimPada) {
      const t = new Date(data.dikirimPada);
      if (!isNaN(t.getTime())) ts = t;
    }
    const tambah = [];
    const perbarui = [];
    for (const r of dedup.values()) {
      const hash = String(r.hash || '');
      const baru = [hash, r.tanggal||'', r.deskripsi||'', Number(r.nominal)||0, Number(r.debit)||0, Number(r.kredit)||0, r.kategoriId||'', r.bank||'', r.nomorRekening||'', r.namaPemilik||'', r.sumber||'', r.uploadedFileId||'', ts, r.kategoriNama||''];
      const baris = hash ? nomorBaris[hash] : null;
      if (baris) perbarui.push({ baris, nilai: baru });
      else tambah.push(baru);
    }
    if (perbarui.length) tulisPembaruan(sh, perbarui, last);
    if (tambah.length) {
      sh.getRange(last+1, 1, tambah.length, HEADER.length).setValues(tambah);
      // Baris yang menambah tinggi grid tidak mewarisi format kolom di atasnya,
      // jadi formatnya dipasang langsung di sini — tanpa ini transaksi baru
      // tampil "56000" sementara yang lama "Rp 56.000". Baris hasil upsert tidak
      // perlu diperlakukan begini: menimpa nilai tidak menghapus format selnya.
      KOLOM_RP.forEach((k) => sh.getRange(last+1, k, tambah.length, 1).setNumberFormat(RP));
      sh.getRange(last+1, KOLOM_WAKTU, tambah.length, 1).setNumberFormat(FORMAT_WAKTU);
    }
    return json({ok:true, inserted: tambah.length, updated: perbarui.length});
  } catch (err) {
    return json({ok:false, error: String(err && err.message || err)});
  }
}

/** Di atas jumlah ini, menulis baris satu per satu lebih mahal daripada
 *  membaca-mengubah-menulis seluruh blok data sekaligus. */
const AMBANG_TULIS_BORONG = 20;

/**
 * Tuliskan baris hasil upsert. Baris yang diperbarui tersebar posisinya, jadi
 * tidak bisa ditulis sebagai satu blok begitu saja.
 *
 * Untuk pembaruan yang sedikit, menulis per baris paling murah. Tapi "Kirim
 * semua sekarang" memperbarui SELURUH transaksi sekaligus — pada pembukuan
 * dengan ribuan baris itu berarti ribuan penulisan terpisah, yang melewati
 * batas waktu permintaan jauh sebelum selesai. Di atas ambang, seluruh blok
 * data dibaca sekali, diubah di memori, lalu ditulis balik sekali.
 *
 * Konsekuensinya: sel yang berisi rumus di kolom A..N akan berubah jadi nilai
 * statis. Tab data ini memang murni tulisan skrip, jadi tidak ada rumus yang
 * hilang; kolom tambahan pengguna di luar A..N tidak tersentuh.
 */
function tulisPembaruan(sh, perbarui, last) {
  if (perbarui.length <= AMBANG_TULIS_BORONG) {
    perbarui.forEach((p) => sh.getRange(p.baris, 1, 1, HEADER.length).setValues([p.nilai]));
    return;
  }
  const rng = sh.getRange(2, 1, last - 1, HEADER.length);
  const nilai = rng.getValues();
  perbarui.forEach((p) => { nilai[p.baris - 2] = p.nilai; });
  rng.setValues(nilai);
}

function doGet() { return json({ok:true, usage:'POST {rows:[...]}'}); }

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
