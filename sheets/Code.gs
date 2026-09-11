/**
 * Code.gs — tempel di Extensions > Apps Script pada Google Sheet tujuan.
 * Deploy: Deploy > New deployment > Web App > Anyone with the link > Copy URL -> tempel di Pengaturan app.
 *
 * Sheet data (nama baku "Transaksi") header baris 1 wajib, berurutan A..P:
 * Hash | Tanggal | Deskripsi | Nominal | Debit | Kredit | ID Kategori | Bank |
 * No. Rekening | Nama Pemilik | Sumber | ID Upload | Dikirim Pada | Kategori |
 * Transfer Internal | Saldo
 *
 * Upsert berdasarkan hash (kolom A): hash yang sudah ada di Sheet DITIMPA di
 * baris yang sama, bukan dilewati. Ini penting karena kategori sebuah transaksi
 * bisa dikoreksi belakangan (lewat halaman Transaksi, atau "Kelompokkan ulang"
 * di halaman Kategori) — kalau cuma dedupe-skip, koreksi itu tidak akan pernah
 * sampai ke Sheet walau tombol "Kirim semua sekarang" dipakai.
 *
 * Tab "Dashboard" dibuat otomatis, bergaya laporan keuangan dan DIPISAH PER
 * REKENING: kartu gabungan, perbandingan antar rekening, arus bulanan dan
 * pengeluaran per kategori dalam matriks berkolom rekening, lalu satu blok
 * rinci untuk tiap rekening. Semuanya rumus Sheets yang merujuk balik ke tab
 * data, jadi ikut ter-update sendiri tiap ada transaksi baru.
 *
 * Angka GABUNGAN mengecualikan transfer internal (kolom O) supaya pindah dana
 * antar rekening sendiri tidak terhitung dua kali; angka PER REKENING tetap
 * menghitungnya, karena uangnya memang keluar/masuk di rekening itu.
 *
 * Dashboard dibangun ulang sendiri bila VERSI_DASHBOARD berubah, bila bentuk
 * data berubah (rekening baru, data memanjang — lihat sidikData), atau bila
 * rusak. Menu "Pembukuan" berisi "Bangun ulang Dashboard" untuk memaksanya
 * sekarang juga, dan "Diagnosa" yang melaporkan lokal, pemisah argumen
 * terdeteksi, dan isi sel rumus kunci.
 *
 * Tiga hal yang pernah bikin kacau dan sengaja dijaga di sini:
 *
 *   1. Dashboard disisipkan di posisi TERAKHIR, bukan pertama. Kode versi lama
 *      (yang mungkin masih terpasang di deployment lain) mencari sheet data
 *      dengan "sheet pertama" — kalau Dashboard ada di posisi pertama, data
 *      transaksi ikut tertulis ke sana dan tab Dashboard jadi berantakan.
 *   2. Pemisah argumen rumus mengikuti lokal spreadsheet (lihat pisahArgumen).
 *      Di lokal Indonesia pemisahnya ";" dan pemisah kolom array literal "\",
 *      bukan ",". Rumus bertanda koma di sheet berlokal Indonesia gagal parse
 *      jadi #ERROR! — dan #ERROR! tidak bisa ditangkap IFERROR.
 *   3. Grid dilebarkan/ditinggikan SEBELUM sel mana pun disentuh. Mengakses sel
 *      di luar grid melempar "Kolom tersebut melampaui batas" dan membatalkan
 *      seluruh pembangunan. Label rekening juga tidak pernah disisipkan ke dalam
 *      string QUERY — nama ber-apostrof akan memecah rumusnya; penyaringan
 *      memakai kolom bendera yang membandingkan dengan sel judul blok.
 */
const SHEET_NAME = ''; // kosong = deteksi/migrasi otomatis (lihat sheetData)
const DATA_SHEET_NAME = 'Transaksi';
const DASHBOARD_SHEET_NAME = 'Dashboard';
/** Tab tersembunyi berisi salinan baris yang pernah dihapus, lihat arsipkan(). */
const ARSIP_SHEET_NAME = '_Arsip';
/**
 * Dinaikkan setiap kali tata letak/rumus Dashboard berubah. Dashboard yang
 * dibangun versi lama otomatis dibangun ulang saat POST berikutnya — tanpa ini,
 * perbaikan rumus hanya berlaku untuk Sheet baru, sementara Sheet yang sudah
 * ada tetap memakai rumus lama sampai pengguna ingat membuka menu "Pembukuan".
 */
const VERSI_DASHBOARD = '8';

/** Jeda minimum antar PEMERIKSAAN apakah Dashboard perlu dibangun ulang. */
const JEDA_PEMERIKSAAN_MS = 2 * 60 * 1000;
/** Jeda minimum antar pembangunan ulang yang dipicu sidik data / kerusakan. */
const JEDA_BANGUN_MS = 10 * 60 * 1000;

/**
 * Sel rumus yang dipantau untuk mendeteksi Dashboard rusak. Tata letaknya kini
 * dinamis (tinggi tiap blok bergantung jumlah rekening, bulan, dan kategori),
 * jadi daftar sebenarnya dicatat saat build ke ScriptProperties. Nilai ini cuma
 * cadangan untuk Dashboard yang dibangun versi lama.
 */
const SEL_RUMUS = ['A9', 'D10', 'G9', 'A45'];

const HEADER = ['Hash','Tanggal','Deskripsi','Nominal','Debit','Kredit','ID Kategori','Bank','No. Rekening','Nama Pemilik','Sumber','ID Upload','Dikirim Pada','Kategori','Transfer Internal','Saldo'];
const LEBAR_KOLOM = [110, 95, 300, 120, 120, 120, 130, 90, 130, 150, 80, 110, 140, 150, 130, 130];
const KOLOM_RP = [4, 5, 6, 16];  // Nominal, Debit, Kredit, Saldo
const KOLOM_WAKTU = 13;          // Dikirim Pada
const KOLOM_SEMBUNYI = [1, 7, 12]; // Hash, ID Kategori, ID Upload — dipakai mesin, bukan mata
/** Kolom terakhir yang perlu dibaca saat menyelaraskan: I, "No. Rekening". */
const KOLOM_REKENING_AKHIR = 9;

const RP = '"Rp "#,##0;[RED]-"Rp "#,##0';
const FORMAT_WAKTU = 'dd/mm/yyyy HH:mm';

/* Palet laporan keuangan: kepala tabel dan pita seksi biru tua berteks putih,
   angka surplus hijau, defisit merah. */
const BIRU_TUA = '#1f4e79';
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
  // Tab bawaan skrip tidak boleh ikut terpilih sebagai sheet data — Dashboard
  // maupun arsip berisi hal lain sama sekali, dan menuliskan transaksi ke sana
  // adalah persis kekacauan yang pernah terjadi.
  const bawaan = [DASHBOARD_SHEET_NAME, ARSIP_SHEET_NAME];
  const lain = ss.getSheets().filter((s) => bawaan.indexOf(s.getName()) === -1);
  return lain.length ? lain[0] : ss.insertSheet(DATA_SHEET_NAME, 0);
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = sheetData(ss);
  if (!SHEET_NAME && sh.getName() !== DATA_SHEET_NAME) sh.setName(DATA_SHEET_NAME);

  // Grid harus cukup lebar SEBELUM header ditulis: sheet yang lebih sempit dari
  // HEADER membuat getRange melempar "Kolom tersebut melampaui batas".
  if (sh.getMaxColumns() < HEADER.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), HEADER.length - sh.getMaxColumns());
  }

  const baru = sh.getLastRow() === 0;
  if (baru) sh.appendRow(HEADER);
  // header guard
  const h = sh.getRange(1, 1, 1, HEADER.length).getValues()[0].map(String);
  const perluPerbaikanHeader = h.join('|') !== HEADER.join('|');
  if (perluPerbaikanHeader) sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  if (baru || perluPerbaikanHeader) rapikanTampilan(sh);

  // Dashboard SENGAJA tidak dibangun di sini. Membangunnya berarti membaca
  // seluruh tab data dan memaksa Sheets menghitung ulang QUERY di atas ribuan
  // baris — pekerjaan yang tidak ada hubungannya dengan menyimpan transaksi,
  // tapi ikut ditanggung setiap permintaan sampai akhirnya melewati batas waktu
  // dan permintaannya terlihat gagal. Sekarang hanya permintaan yang secara
  // eksplisit meminta `rapikan` yang membayarnya (lihat doPost).
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
  // Tanggal dikirim sebagai teks ISO, tapi setValues mengubahnya jadi TIPE
  // TANGGAL. Formatnya dipaku di sini supaya tampilannya konsisten; rumus bulan
  // di Dashboard sengaja tidak lagi bergantung pada format ini (lihat BULAN).
  sh.getRange(2, 2, isi, 1).setNumberFormat('yyyy-mm-dd').setHorizontalAlignment('center');
  // No. Rekening dipaksa teks: setValues mengubah "4997913646" jadi bilangan,
  // dan nomor berawalan nol akan kehilangan nolnya sehingga label rekening tidak
  // lagi cocok dengan nomor aslinya. Baris lama tidak dimigrasi — nol yang sudah
  // hilang tidak bisa dikembalikan, dan penggabungan string tetap sama hasilnya.
  sh.getRange(2, 9, isi, 1).setNumberFormat('@');
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
  return jangkarRumus().some((a) => String(d.getRange(a).getValue()).charAt(0) === '#');
}

/**
 * Sel rumus yang dipantau: daftar yang dicatat saat build, atau `SEL_RUMUS`
 * bila belum ada (Dashboard bawaan versi lama). Daftar dinamis ini yang membuat
 * luapan array — QUERY yang tumbuh melewati cadangan barisnya lalu menghasilkan
 * #REF!, galat yang TIDAK tertangkap IFERROR — bisa tersembuhkan sendiri lewat
 * jalur "rusak" yang sudah ada.
 */
function jangkarRumus() {
  try {
    const tersimpan = JSON.parse(
      PropertiesService.getScriptProperties().getProperty('selRumusDashboard') || '[]',
    );
    if (Array.isArray(tersimpan) && tersimpan.length) return tersimpan;
  } catch (e) { /* catatannya rusak — pakai cadangan */ }
  return SEL_RUMUS;
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
  const versiBeda = prop.getProperty('versiDashboard') !== VERSI_DASHBOARD;

  // MEMERIKSA saja sudah mahal: statistikData membaca seluruh tab data, dan
  // dashboardRusak memaksa Sheets menghitung ulang QUERY/ARRAYFORMULA di atas
  // ribuan baris. Backfill mengirim datanya dalam banyak bongkah berturut-turut;
  // tanpa jeda ini, ongkos pemeriksaan itu dibayar berulang-ulang dalam hitungan
  // detik untuk data yang bentuknya jelas belum berubah.
  if (ada && !versiBeda) {
    const diperiksa = Number(prop.getProperty('pemeriksaanTerakhir') || 0);
    if (Date.now() - diperiksa < JEDA_PEMERIKSAAN_MS) return;
    prop.setProperty('pemeriksaanTerakhir', String(Date.now()));
  }

  const stat = statistikData(ss.getSheetByName(namaSheetData));
  const sidik = sidikData(stat);

  if (ada) {
    const sidikBeda = prop.getProperty('sidikDashboard') !== sidik;
    if (!versiBeda && !sidikBeda && !dashboardRusak(ada)) return;
    // Jalur versi berbeda tidak dibatasi: itu sekali jalan dan memang diminta.
    // Jalur sidik/rusak dibatasi supaya pembangunan ulang yang ternyata tidak
    // menyembuhkan tidak diulang tiap POST — mahal dan boros kuota.
    if (!versiBeda) {
      const terakhir = Number(prop.getProperty('pembangunanTerakhir') || 0);
      if (Date.now() - terakhir < JEDA_BANGUN_MS) return;
      prop.setProperty('pembangunanTerakhir', String(Date.now()));
    }
    ss.deleteSheet(ada);
  }

  // Posisi TERAKHIR, bukan pertama — lihat catatan (1) di kepala berkas.
  const S = pisahArgumen(ss);           // pemisah argumen rumus
  const AS = S === ',' ? ',' : '\\';    // pemisah kolom di dalam array literal {}
  const d = ss.insertSheet(DASHBOARD_SHEET_NAME, ss.getNumSheets());
  const kol = (huruf) => `'${namaSheetData}'!${huruf}2:${huruf}`;

  /* ---------- Kolom maya, dirakit sekali ---------- */
  // Tanggal tersimpan sebagai TIPE TANGGAL, bukan teks: setValues mengubah
  // string ISO jadi tanggal saat menulis. LEFT(tanggal;7) kebetulan masih benar
  // selama format tampilannya "yyyy-mm-dd" — tapi begitu format itu berubah
  // (ganti locale, kolom diformat ulang), hasilnya jadi potongan seperti
  // "01/12/2" dan SELURUH pengelompokan bulan rusak tanpa satu pun pesan galat.
  // TEXT tidak bergantung format tampilan; cabang LEFT dipertahankan untuk baris
  // yang tanggalnya memang masih berupa teks.
  const BULAN = `ARRAYFORMULA(IF(ISNUMBER(${kol('B')})${S}TEXT(${kol('B')}${S}"yyyy-mm")${S}LEFT(${kol('B')}${S}7)))`;
  const REK = `ARRAYFORMULA(IF(${kol('H')}=""${S}""${S}TRIM(${kol('H')}&" "&${kol('I')})))`;
  // Nama kategori dipakai kalau ada. Kalau kosong (baris yang terunggah sebelum
  // kolom Kategori ada), ID-nya dijadikan terbaca: "kat_transfer_keluar" ->
  // "Transfer Keluar". Kategori buatan sendiri ber-ID acak tetap tidak terbaca;
  // hanya "Kirim semua sekarang" yang bisa memberi nama aslinya.
  const KATEGORI = `ARRAYFORMULA(IF(${kol('N')}<>""${S}${kol('N')}${S}`
    + `IF(LEFT(${kol('G')}${S}4)="kat_"${S}PROPER(SUBSTITUTE(MID(${kol('G')}${S}5${S}100)${S}"_"${S}" "))${S}${kol('G')})))`;
  const NETTO = `ARRAYFORMULA(N(${kol('F')})-N(${kol('E')}))`;

  // Cadangan baris menahan tabrakan ketika QUERY tumbuh setelah dibangun.
  const cadangan = (n) => Math.max(4, Math.ceil(n * 0.3));
  const nBulan = Math.max(stat.bulan.length, 1);
  const nRek = Math.max(stat.rekening.length, 1);
  const nKat = Math.max(stat.katKeluar, 1);

  /* ---------- Anggaran kolom dan baris ---------- */
  // Grid harus cukup besar SEBELUM sel mana pun disentuh. Menyetel lebar kolom
  // atau mengakses sel di luar grid membuat Apps Script melempar "Kolom
  // tersebut melampaui batas" dan membatalkan seluruh pembangunan — dan blok
  // per rekening membuat tata letak ini bisa memanjang jauh ke bawah.
  const lebarRek = Math.max(1 + stat.rekening.length, 2);
  const lebarMaks = Math.max(7, lebarRek, 1 + nBulan);
  const kolomPerlu = Math.max(lebarMaks + 4, 26);
  if (d.getMaxColumns() < kolomPerlu) {
    d.insertColumnsAfter(d.getMaxColumns(), kolomPerlu - d.getMaxColumns());
  }
  const tinggiBlokBulan = nBulan + cadangan(nBulan);
  const barisPerlu = 10
    + (nRek + cadangan(nRek) + 4)
    + (tinggiBlokBulan + 4)
    + (nKat + cadangan(nKat) + 4)
    + stat.rekening.length * (tinggiBlokBulan + 8)
    + 20;
  if (d.getMaxRows() < barisPerlu) {
    d.insertRowsAfter(d.getMaxRows(), barisPerlu - d.getMaxRows());
  }
  const kolomGrafik = Math.min(lebarMaks + 2, d.getMaxColumns());

  d.setHiddenGridlines(true);
  d.setTabColor(BIRU_TUA);
  d.setColumnWidth(1, 190);
  d.setColumnWidths(2, d.getMaxColumns() - 1, 120);

  // Jangkar sel rumus dicatat selagi dibangun lalu disimpan: tata letaknya
  // dinamis, jadi daftar sel yang dipantau dashboardRusak tidak bisa tetap.
  const jangkar = [];
  const pasangRumus = (a1, rumus) => { d.getRange(a1).setFormula(rumus); jangkar.push(a1); };

  /* ---------- Judul ---------- */
  d.getRange('A1:I1').merge()
    .setValue('LAPORAN KEUANGAN PER REKENING')
    .setFontSize(14).setFontWeight('bold').setFontColor(BIRU_TUA)
    .setVerticalAlignment('middle');
  d.setRowHeight(1, 34);
  d.getRange('A2:I2').merge()
    .setValue('Angka gabungan tidak menghitung pindah dana antar rekening sendiri; angka per rekening menghitungnya.')
    .setFontStyle('italic').setFontColor('#5f6368').setFontSize(10);

  /* ---------- Kartu gabungan (tanpa transfer internal) ---------- */
  // SUMIF berkriteria FALSE tidak cocok dengan sel kosong milik baris lama,
  // jadi transfer internal dikurangkan, bukan disaring.
  const tanpaTransfer = (huruf) => `=SUM(${kol(huruf)})-SUMIF(${kol('O')}${S}TRUE${S}${kol(huruf)})`;
  const KARTU = [
    { kol: 'A', label: 'TOTAL PEMASUKAN', formula: tanpaTransfer('F'), bg: '#e6f4ea', fg: HIJAU, format: RP },
    { kol: 'C', label: 'TOTAL PENGELUARAN', formula: tanpaTransfer('E'), bg: '#fce8e6', fg: MERAH, format: RP },
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

  let r = 8;             // kursor baris berjalan; tidak ada jangkar hardcoded
  const rentang = [];    // rentang baris tiap blok, dipakai menguji tabrakan
  const rentangNet = [];     // kolom Net, untuk pewarnaan bersyarat
  const rentangSelisih = []; // kolom Selisih, ditandai merah bila bukan nol

  const judulSeksi = (teks) => {
    d.getRange(r, 1).setValue(teks).setFontWeight('bold').setFontSize(11).setFontColor(BIRU_TUA);
    r += 1;
  };

  /* ---------- Perbandingan antar rekening ---------- */
  const mulaiBanding = r;
  judulSeksi('PERBANDINGAN ANTAR REKENING');
  const kepalaBanding = r;
  pasangRumus(`A${r}`,
    `=IFERROR(QUERY({${REK}${AS}${kol('F')}${AS}${kol('E')}${AS}${kol('A')}}${S}`
    + `"select Col1, sum(Col2), sum(Col3), count(Col4) where Col1 <> '' group by Col1 order by Col1 asc `
    + `label Col1 'Rekening', sum(Col2) 'Total Masuk', sum(Col3) 'Total Keluar', count(Col4) 'Jml Transaksi'"${S}0)${S}"Belum ada data")`);
  d.getRange(kepalaBanding, 5).setValue('Net Cash Flow');
  d.getRange(kepalaBanding, 6).setValue('Status');
  const isiBanding = kepalaBanding + 1;
  const akhirBanding = kepalaBanding + nRek + cadangan(nRek);
  pasangRumus(`E${isiBanding}`,
    `=IFERROR(ARRAYFORMULA(IF(A${isiBanding}:A${akhirBanding}=""${S}""${S}`
    + `B${isiBanding}:B${akhirBanding}-C${isiBanding}:C${akhirBanding}))${S}"")`);
  pasangRumus(`F${isiBanding}`,
    `=IFERROR(ARRAYFORMULA(IF(A${isiBanding}:A${akhirBanding}=""${S}""${S}`
    + `IF(B${isiBanding}:B${akhirBanding}-C${isiBanding}:C${akhirBanding}>=0${S}"✅ Surplus"${S}"⚠️ Defisit")))${S}"")`);
  kepalaTabel(d, `A${kepalaBanding}:F${kepalaBanding}`);
  d.getRange(`B${isiBanding}:C${akhirBanding}`).setNumberFormat(RP);
  d.getRange(`E${isiBanding}:E${akhirBanding}`).setNumberFormat(RP);
  d.getRange(`F${isiBanding}:F${akhirBanding}`).setHorizontalAlignment('center');
  rentangNet.push(d.getRange(`E${isiBanding}:E${akhirBanding}`));
  rentang.push([mulaiBanding, akhirBanding]);
  r = akhirBanding + 2;

  /* ---------- Arus bulanan per rekening ---------- */
  const mulaiArus = r;
  judulSeksi('ARUS BULANAN PER REKENING (NET)');
  const kepalaArus = r;
  pasangRumus(`A${r}`,
    `=IFERROR(QUERY({${BULAN}${AS}${REK}${AS}${NETTO}}${S}`
    + `"select Col1, sum(Col3) where Col1 <> '' and Col2 <> '' group by Col1 pivot Col2"${S}0)${S}"Belum ada data")`);
  kepalaTabel(d, `A${kepalaArus}:${hurufKolom(lebarRek)}${kepalaArus}`);
  const akhirArus = kepalaArus + nBulan + cadangan(nBulan);
  d.getRange(`B${kepalaArus + 1}:${hurufKolom(lebarRek)}${akhirArus}`).setNumberFormat(RP);
  rentang.push([mulaiArus, akhirArus]);
  r = akhirArus + 2;

  /* ---------- Pengeluaran per kategori per rekening ---------- */
  const mulaiKat = r;
  judulSeksi('PENGELUARAN PER KATEGORI PER REKENING');
  const kepalaKat = r;
  pasangRumus(`A${r}`,
    `=IFERROR(QUERY({${KATEGORI}${AS}${REK}${AS}${kol('E')}}${S}`
    + `"select Col1, sum(Col3) where Col3 > 0 and Col1 <> '' and Col2 <> '' group by Col1 pivot Col2"${S}0)${S}"Belum ada data")`);
  kepalaTabel(d, `A${kepalaKat}:${hurufKolom(lebarRek)}${kepalaKat}`);
  const akhirKat = kepalaKat + nKat + cadangan(nKat);
  d.getRange(`B${kepalaKat + 1}:${hurufKolom(lebarRek)}${akhirKat}`).setNumberFormat(RP);
  rentang.push([mulaiKat, akhirKat]);
  r = akhirKat + 2;

  /* ---------- Blok tiap rekening ---------- */
  stat.rekening.forEach((label) => {
    const mulaiBlok = r;

    // Label ditulis apa adanya ke sel pita, TIDAK disisipkan ke dalam string
    // QUERY: nama bank ber-apostrof akan memecah rumusnya. Penyaringan memakai
    // kolom bendera yang membandingkan kolom maya rekening dengan sel ini.
    const selLabel = `$A$${r}`;
    pitaSeksi(d, `A${r}:G${r}`, label, BIRU_TUA);
    r += 1;

    const bendera = `ARRAYFORMULA(IF(${REK}=${selLabel}${S}1${S}0))`;

    const barisKepalaKartu = r;
    const barisNilaiKartu = r + 1;
    r += 3;

    const kepalaTabelBulan = r;
    pasangRumus(`A${r}`,
      `=IFERROR(QUERY({${BULAN}${AS}${kol('F')}${AS}${kol('E')}${AS}${bendera}}${S}`
      + `"select Col1, sum(Col2), sum(Col3) where Col4 = 1 and Col1 <> '' group by Col1 order by Col1 asc `
      + `label Col1 'Bulan', sum(Col2) 'Masuk', sum(Col3) 'Keluar'"${S}0)${S}"Belum ada data")`);
    d.getRange(kepalaTabelBulan, 4).setValue('Net Cash Flow');
    d.getRange(kepalaTabelBulan, 5).setValue('Status');
    const isiBulan = kepalaTabelBulan + 1;
    const akhirBulan = kepalaTabelBulan + nBulan + cadangan(nBulan);
    pasangRumus(`D${isiBulan}`,
      `=IFERROR(ARRAYFORMULA(IF(A${isiBulan}:A${akhirBulan}=""${S}""${S}`
      + `B${isiBulan}:B${akhirBulan}-C${isiBulan}:C${akhirBulan}))${S}"")`);
    pasangRumus(`E${isiBulan}`,
      `=IFERROR(ARRAYFORMULA(IF(A${isiBulan}:A${akhirBulan}=""${S}""${S}`
      + `IF(B${isiBulan}:B${akhirBulan}-C${isiBulan}:C${akhirBulan}>=0${S}"✅ Surplus"${S}"⚠️ Defisit")))${S}"")`);
    // Saldo Bank = saldo berjalan pada transaksi TERAKHIR MENURUT TANGGAL di
    // bulan itu. Bukan "baris terakhir di tab data": urutan baris di sana adalah
    // urutan kedatangan POST, yang teracak oleh antrean retry, upload yang tidak
    // urut, dan penyelarasan penuh — mengambil yang terakhir menurut posisi akan
    // memberi saldo yang salah tanpa tanda apa pun. Baris tanpa saldo (transaksi
    // manual) disaring keluar supaya tidak menang sebagai "terakhir".
    // Ditulis per baris, bukan ARRAYFORMULA: SORT/FILTER tidak bisa divektorkan.
    d.getRange(kepalaTabelBulan, 6).setValue('Saldo Bank');
    d.getRange(kepalaTabelBulan, 7).setValue('Selisih');
    const rumusSaldo = [];
    for (let baris = isiBulan; baris <= akhirBulan; baris += 1) {
      const saldoBulan = `IFERROR(INDEX(SORT(FILTER({${kol('P')}${AS}${kol('B')}}${S}`
        + `(${BULAN}=A${baris})*(${REK}=${selLabel})*(${kol('P')}<>""))${S}2${S}FALSE)${S}1${S}1)${S}"")`;
      // Selisih memakai Saldo Bank bulan sebelumnya dari baris di ATASNYA:
      // tabelnya sudah urut naik, jadi tidak perlu pencarian kedua. Identitas
      // "perubahan saldo = jumlah mutasi" tetap berlaku walau ada bulan bolong.
      const selisih = baris === isiBulan
        ? '=""'
        : `=IF(OR(A${baris}=""${S}F${baris}=""${S}F${baris - 1}="")${S}""${S}F${baris}-F${baris - 1}-D${baris})`;
      rumusSaldo.push([`=IF(A${baris}=""${S}""${S}${saldoBulan})`, selisih]);
    }
    d.getRange(isiBulan, 6, rumusSaldo.length, 2).setFormulas(rumusSaldo);

    kepalaTabel(d, `A${kepalaTabelBulan}:G${kepalaTabelBulan}`);
    d.getRange(`B${isiBulan}:D${akhirBulan}`).setNumberFormat(RP);
    d.getRange(`F${isiBulan}:G${akhirBulan}`).setNumberFormat(RP);
    d.getRange(`A${isiBulan}:A${akhirBulan}`).setHorizontalAlignment('center');
    d.getRange(`E${isiBulan}:E${akhirBulan}`).setHorizontalAlignment('center');
    rentangNet.push(d.getRange(`D${isiBulan}:D${akhirBulan}`));
    // Selisih bukan-nol berarti bulan itu kehilangan atau kelebihan baris.
    rentangSelisih.push(d.getRange(`G${isiBulan}:G${akhirBulan}`));

    // Kartu mini menjumlah tabel bulanan di bawahnya, bukan menyaring ulang tab
    // data: hasilnya dijamin konsisten dengan tabelnya sendiri, dan tidak perlu
    // mencocokkan label rekening untuk kedua kalinya.
    const KARTU_BLOK = [
      { kol: 'A', label: 'Masuk', sumber: 'B', fg: HIJAU, bg: '#e6f4ea' },
      { kol: 'C', label: 'Keluar', sumber: 'C', fg: MERAH, bg: '#fce8e6' },
    ];
    KARTU_BLOK.forEach((k) => {
      const akhirKol = String.fromCharCode(k.kol.charCodeAt(0) + 1);
      d.getRange(`${k.kol}${barisKepalaKartu}:${akhirKol}${barisKepalaKartu}`).merge().setValue(k.label)
        .setFontWeight('bold').setFontSize(9).setFontColor(k.fg).setBackground(k.bg)
        .setHorizontalAlignment('center');
      d.getRange(`${k.kol}${barisNilaiKartu}:${akhirKol}${barisNilaiKartu}`).merge()
        .setFormula(`=SUM(${k.sumber}${isiBulan}:${k.sumber}${akhirBulan})`)
        .setFontSize(14).setFontWeight('bold').setFontColor(k.fg).setBackground(k.bg)
        .setHorizontalAlignment('center').setNumberFormat(RP);
    });
    d.getRange(`E${barisKepalaKartu}:F${barisKepalaKartu}`).merge().setValue('Net')
      .setFontWeight('bold').setFontSize(9).setFontColor(BIRU_TUA).setBackground('#e8f0fe')
      .setHorizontalAlignment('center');
    d.getRange(`E${barisNilaiKartu}:F${barisNilaiKartu}`).merge()
      .setFormula(`=A${barisNilaiKartu}-C${barisNilaiKartu}`)
      .setFontSize(14).setFontWeight('bold').setFontColor(BIRU_TUA).setBackground('#e8f0fe')
      .setHorizontalAlignment('center').setNumberFormat(RP);

    rentang.push([mulaiBlok, akhirBulan]);
    r = akhirBulan + 2;
  });

  d.setFrozenRows(2);

  /* ---------- Net: hijau kalau surplus, merah kalau defisit ---------- */
  const aturan = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0).setFontColor(HIJAU).setBold(true).setRanges(rentangNet).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(0).setFontColor(MERAH).setBold(true).setRanges(rentangNet).build(),
  ];
  // Selisih bukan nol = bulan itu kehilangan atau kelebihan transaksi. Ditandai
  // mencolok karena justru itu gunanya kolom ini ada.
  if (rentangSelisih.length) {
    aturan.push(SpreadsheetApp.newConditionalFormatRule()
      .whenNumberNotEqualTo(0).setBackground('#fce8e6').setFontColor(MERAH).setBold(true)
      .setRanges(rentangSelisih).build());
  }
  d.setConditionalFormatRules(aturan);

  /* ---------- Grafik (jumlahnya tetap, tidak ikut bertambah per rekening) ---------- */
  // Dua rentang terpisah: label rekening (A) dan total keluar (C). Kolom B
  // sengaja dilewati supaya donatnya hanya menggambar pengeluaran.
  const donat = d.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(d.getRange(`A${kepalaBanding}:A${akhirBanding}`))
    .addRange(d.getRange(`C${kepalaBanding}:C${akhirBanding}`))
    .setPosition(4, kolomGrafik, 0, 0)
    .setOption('title', 'Pengeluaran per Rekening')
    .setOption('pieHole', 0.45)
    .setOption('legend', { position: 'right' })
    .setOption('width', 520).setOption('height', 320)
    .build();
  d.insertChart(donat);

  const batang = d.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(d.getRange(`A${kepalaArus}:${hurufKolom(lebarRek)}${akhirArus}`))
    .setPosition(22, kolomGrafik, 0, 0)
    .setOption('title', 'Net Bulanan per Rekening')
    .setOption('legend', { position: 'top' })
    .setOption('width', 520).setOption('height', 320)
    .build();
  d.insertChart(batang);

  // Dicatat paling akhir, setelah semuanya benar-benar terpasang: kalau
  // pembangunan gagal di tengah jalan, versi dan sidiknya tidak ikut tercatat
  // sehingga percobaan berikutnya mengulang, bukan menganggap sudah beres.
  prop.setProperty('selRumusDashboard', JSON.stringify(jangkar));
  prop.setProperty('rentangBlokDashboard', JSON.stringify(rentang));
  prop.setProperty('sidikDashboard', sidik);
  prop.setProperty('versiDashboard', VERSI_DASHBOARD);
}

/**
 * Ukur tab data satu kali untuk seluruh kebutuhan tata letak Dashboard: daftar
 * rekening, jumlah bulan, dan jumlah kategori. Dibaca sekali dalam satu range
 * — Dashboard menumpuk banyak blok yang tingginya bergantung angka-angka ini,
 * dan membacanya berulang kali per blok jauh lebih mahal.
 *
 * Label rekening dirangkai dari Bank + No. Rekening, sama seperti label yang
 * dipakai aplikasi. Itu wakil terbaik yang tersedia: accountId tidak ikut
 * dikirim ke Sheet.
 */
function statistikData(sh) {
  const kosong = { bulan: [], rekening: [], katKeluar: 0, katMasuk: 0, bulanTerbanyak: 0 };
  const last = sh ? sh.getLastRow() : 0;
  if (last < 2) return kosong;

  const nilai = sh.getRange(2, 1, last - 1, HEADER.length).getValues();
  const bulan = {}, rekening = {}, katKeluar = {}, katMasuk = {}, bulanPerRekening = {};

  nilai.forEach((r) => {
    const tgl = r[1];
    const b = tgl instanceof Date
      ? Utilities.formatDate(tgl, Session.getScriptTimeZone(), 'yyyy-MM')
      : String(tgl || '').slice(0, 7);
    const label = `${String(r[7] || '').trim()} ${String(r[8] || '').trim()}`.trim();
    const kategori = String(r[13] || r[6] || '').trim();

    if (b) bulan[b] = true;
    if (label) {
      rekening[label] = true;
      if (b) {
        if (!bulanPerRekening[label]) bulanPerRekening[label] = {};
        bulanPerRekening[label][b] = true;
      }
    }
    if (kategori) {
      if (Number(r[4]) > 0) katKeluar[kategori] = true;
      if (Number(r[5]) > 0) katMasuk[kategori] = true;
    }
  });

  const daftarRekening = Object.keys(rekening).sort();
  const terbanyak = daftarRekening.reduce(
    (maks, label) => Math.max(maks, Object.keys(bulanPerRekening[label] || {}).length), 0,
  );

  return {
    bulan: Object.keys(bulan).sort(),
    rekening: daftarRekening,
    katKeluar: Object.keys(katKeluar).length,
    katMasuk: Object.keys(katMasuk).length,
    bulanTerbanyak: terbanyak,
  };
}

/**
 * Sidik bentuk data — bukan isinya. Dashboard membangun blok per rekening saat
 * build, jadi ia jadi basi kalau ada rekening baru atau data memanjang melewati
 * cadangan baris. Jumlah kategori sengaja dibulatkan per 5 supaya pertumbuhan
 * kecil yang masih muat di cadangan tidak memicu pembangunan ulang terus-menerus.
 */
function sidikData(stat) {
  return [
    stat.rekening.join('|'),
    stat.bulan.length,
    Math.ceil(stat.katKeluar / 5),
    Math.ceil(stat.katMasuk / 5),
  ].join('::');
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
    // Nama dan ID ditampilkan supaya bisa dicocokkan dengan spreadsheet yang
    // sedang dibuka: URL webhook yang menunjuk deployment lama bisa menulis ke
    // salinan spreadsheet yang berbeda, dan itu tampak persis seperti sukses.
    `Spreadsheet       : ${ss.getName()}`,
    `ID                : ${ss.getId()}`,
    `Lokal spreadsheet : ${ss.getSpreadsheetLocale()}`,
    `Pemisah argumen   : "${pisahArgumen(ss)}"`,
    `Sheet data        : ${sh ? `${sh.getName()} (posisi ${sh.getIndex()}, ${Math.max(sh.getLastRow() - 1, 0)} baris)` : '(tidak ketemu)'}`,
    `Tab Dashboard     : ${d ? `ada, posisi ${d.getIndex()}` : 'belum ada'}`,
  ];
  if (d) {
    baris.push(`Dianggap rusak    : ${dashboardRusak(d) ? 'ya' : 'tidak'}`, '');
    ['A1'].concat(jangkarRumus().slice(0, 8)).forEach((a) => {
      baris.push(`${a} = ${String(d.getRange(a).getDisplayValue()).slice(0, 70)}`);
    });
  }
  ui.alert('Diagnosa Pembukuan', baris.join('\n'), ui.ButtonSet.OK);
}

function doPost(e) {
  // Dua perangkat yang menyinkron bersamaan sama-sama melakukan baca-ubah-tulis
  // di sheet yang sama; tanpa kunci, yang satu bisa menimpa hasil yang lain.
  const kunci = LockService.getScriptLock();
  try {
    kunci.waitLock(30000);
  } catch (err) {
    return json({ok:false, error:'Sheet sedang dipakai proses lain, coba lagi sebentar'});
  }

  try {
    const body = e.postData ? e.postData.contents : '';
    const data = body ? JSON.parse(body) : {};
    // Ping ikut melaporkan identitas dan jumlah baris. Aplikasi memakainya untuk
    // menjawab pertanyaan yang muncul tiap kali pengiriman putus di tengah:
    // "sebenarnya berapa yang sudah mendarat?" — AbortController hanya memutus
    // sisi browser, Apps Script di sini terus jalan sampai selesai.
    if (data.ping) {
      const ssPing = SpreadsheetApp.getActiveSpreadsheet();
      return json(Object.assign(tujuan(ssPing, getSheet()), {ok:true, ping:true}));
    }

    const rows = Array.isArray(data.rows) ? data.rows : [];
    const hapus = Array.isArray(data.hapus) ? data.hapus.map(String).filter(Boolean) : [];
    const mintaRapikan = data.rapikan === true;
    // Payload identitas: hanya hash + label rekening, dipakai untuk menghitung
    // baris yatim tanpa perlu mengirim ulang seluruh isi pembukuan. Barisnya
    // TIDAK punya tanggal/nominal, jadi menuliskannya berarti mengosongkan data
    // asli — karena itu jalur tulis di bawah dijaga eksplisit oleh bendera ini,
    // bukan disimpulkan dari bentuk payload.
    const hanyaSelaras = data.hanyaSelaras === true;

    // Penyelarasan hanya berlaku bila SEMUA pengaman lolos. Ini operasi yang
    // menghapus data pengguna, jadi kecurigaan sekecil apa pun -> jangan hapus.
    //   - `selaras` harus disebut eksplisit; payload biasa tidak pernah menghapus.
    //   - payload kosong tidak pernah berarti "kosongkan Sheet".
    //   - `jumlah` dari pengirim harus cocok dengan rows.length: JSON yang
    //     terpotong di tengah jalan akan tampak seperti daftar yang sah tapi
    //     pendek, dan itu berarti menghapus baris yang sebenarnya masih ada.
    const mintaSelaras = data.selaras === true
      && rows.length > 0
      && Number(data.jumlah) === rows.length;

    if (!rows.length && !hapus.length && !mintaSelaras) {
      if (mintaRapikan) {
        const ssKosong = SpreadsheetApp.getActiveSpreadsheet();
        const shKosong = getSheet();
        rapikanDashboard(ssKosong, shKosong);
        return json(Object.assign(tujuan(ssKosong, shKosong), {ok:true, inserted:0, updated:0, dihapus:0}));
      }
      return json({ok:true, inserted:0, updated:0, dihapus:0});
    }

    // Payload tidak seharusnya pernah berisi hash ganda (hash unik di database
    // aplikasi), tapi tetap dijaga di sini: kejadian terakhir yang dipakai.
    const dedup = new Map();
    let anon = 0;
    rows.forEach((r) => { dedup.set(r.hash ? String(r.hash) : `__anon${anon++}`, r); });

    // Rekening yang diketahui pengirim. Penyelarasan hanya boleh menyentuh
    // rekening ini: data aplikasi tersimpan per perangkat, jadi perangkat lain
    // bisa memiliki rekening yang tidak dikenal payload ini — barisnya harus
    // dipertahankan, bukan dianggap yatim.
    const rekeningPengirim = {};
    rows.forEach((r) => {
      const label = `${String(r.bank || '').trim()} ${String(r.nomorRekening || '').trim()}`.trim();
      if (label) rekeningPengirim[label] = true;
    });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = getSheet();
    const last = sh.getLastRow();
    const lebar = HEADER.length;
    // Dari blok data lama yang dibutuhkan hanyalah kolom Hash — dan, saat
    // menyelaraskan, kolom Bank & No. Rekening. Membaca ke-16 kolomnya berarti
    // menarik ~16x lebih banyak sel tiap permintaan tanpa satu pun dipakai.
    const lebarBaca = mintaSelaras ? KOLOM_REKENING_AKHIR : 1;
    const lama = last > 1 ? sh.getRange(2, 1, last - 1, lebarBaca).getValues() : [];

    const nomorBaris = {};
    lama.forEach((r, i) => {
      const h = String(r[0] || '');
      if (h) nomorBaris[h] = i + 2; // +2: baris 1 header, array mulai dari 0
    });

    // Baris mana yang harus hilang dari Sheet.
    const dibuang = {};
    hapus.forEach((h) => { if (nomorBaris[h]) dibuang[nomorBaris[h]] = true; });
    let dipertahankan = 0;
    if (mintaSelaras) {
      lama.forEach((r, i) => {
        const h = String(r[0] || '');
        if (!h || dedup.has(h)) return;
        const label = `${String(r[7] || '').trim()} ${String(r[8] || '').trim()}`.trim();
        if (label && !rekeningPengirim[label]) { dipertahankan += 1; return; }
        dibuang[i + 2] = true;
      });
    }
    const jumlahDibuang = Object.keys(dibuang).length;

    // Pratinjau: hanya melapor, tidak menyentuh apa pun. Dipakai dialog
    // konfirmasi supaya pengguna melihat angka sebenarnya sebelum menghapus.
    if (data.praTinjau === true) {
      return json(Object.assign(tujuan(ss, sh), {
        ok: true, praTinjau: true,
        akanDihapus: jumlahDibuang, dipertahankan: dipertahankan, total: last > 1 ? last - 1 : 0,
      }));
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
    // Payload identitas tidak memuat isi baris. Menuliskannya akan mengganti
    // tanggal, nominal, dan kategori yang sudah benar dengan sel kosong — jadi
    // jalur tulis dilewati seluruhnya, bukan sekadar "kebetulan tidak kena".
    for (const r of (hanyaSelaras ? [] : dedup.values())) {
      const hash = String(r.hash || '');
      // Saldo sengaja TIDAK dipaksa jadi 0 saat kosong: nol adalah saldo yang
      // sah, sedangkan kosong berarti bank tidak menyebutkannya (transaksi
      // manual). Dashboard membedakan keduanya saat memeriksa kelengkapan bulan.
      const saldo = r.saldo === '' || r.saldo === null || r.saldo === undefined ? '' : Number(r.saldo);
      const baru = [hash, r.tanggal||'', r.deskripsi||'', Number(r.nominal)||0, Number(r.debit)||0, Number(r.kredit)||0, r.kategoriId||'', r.bank||'', r.nomorRekening||'', r.namaPemilik||'', r.sumber||'', r.uploadedFileId||'', ts, r.kategoriNama||'', r.transferInternal === true, saldo];
      const baris = hash ? nomorBaris[hash] : null;
      if (baris && !dibuang[baris]) perbarui.push({ baris, nilai: baru });
      else if (!baris) tambah.push(baru);
    }

    if (perbarui.length) tulisPembaruan(sh, perbarui);

    if (tambah.length) {
      sh.getRange(last+1, 1, tambah.length, lebar).setValues(tambah);
      // Baris yang menambah tinggi grid tidak mewarisi format kolom di atasnya,
      // jadi formatnya dipasang langsung di sini — tanpa ini transaksi baru
      // tampil "56000" sementara yang lama "Rp 56.000". Baris hasil upsert tidak
      // perlu diperlakukan begini: menimpa nilai tidak menghapus format selnya.
      KOLOM_RP.forEach((k) => sh.getRange(last+1, k, tambah.length, 1).setNumberFormat(RP));
      sh.getRange(last+1, KOLOM_WAKTU, tambah.length, 1).setNumberFormat(FORMAT_WAKTU);
    }

    if (jumlahDibuang) hapusBaris(sh, dibuang);

    // Dashboard dibangun PALING AKHIR dan hanya bila diminta, supaya hiasan
    // tidak pernah ikut menentukan apakah transaksinya tersimpan — dan supaya
    // rentetan bongkah backfill tidak membayarnya berulang kali.
    if (mintaRapikan) rapikanDashboard(ss, sh);

    return json(Object.assign(tujuan(ss, sh), {
      ok: true,
      inserted: tambah.length,
      updated: perbarui.length,
      dihapus: jumlahDibuang,
      dipertahankan: dipertahankan,
    }));
  } catch (err) {
    return json({ok:false, error: String(err && err.message || err)});
  } finally {
    kunci.releaseLock();
  }
}

/**
 * Bangun/segarkan Dashboard tanpa pernah menggagalkan permintaannya.
 *
 * Dashboard adalah hiasan; menyimpan transaksi adalah tugas utamanya. Galat di
 * sini pernah membatalkan seluruh doPost sehingga transaksinya pun tidak
 * tersimpan — itu tidak boleh terulang, jadi kegagalannya dicatat lalu
 * dilupakan. Versinya baru dicatat setelah pembangunan berhasil, sehingga
 * permintaan `rapikan` berikutnya akan mencoba lagi sendiri.
 */
function rapikanDashboard(ss, sh) {
  try {
    pastikanDashboard(ss, sh.getName());
  } catch (e) {
    console.warn('Dashboard gagal dibangun, data tetap disimpan:', e);
  }
}

/**
 * Buang baris-baris yang nomornya ada di `dibuang`.
 *
 * Sama seperti `tulisPembaruan`: untuk jumlah kecil, operasi per baris paling
 * murah — tapi penyelarasan bisa membuang ratusan baris sekaligus, dan
 * `deleteRow` satu per satu jauh lebih mahal daripada penulisan biasa. Di atas
 * ambang, seluruh blok yang tersisa ditulis ulang sekali lalu ekornya dipangkas
 * dalam satu operasi.
 */
function hapusBaris(sh, dibuang) {
  const last = sh.getLastRow();
  if (last < 2) return;
  const nomor = Object.keys(dibuang).map(Number).sort((a, b) => a - b);
  if (!nomor.length) return;

  arsipkan(sh, nomor);

  if (nomor.length <= AMBANG_TULIS_BORONG) {
    // Menurun, supaya penghapusan satu baris tidak menggeser nomor berikutnya.
    for (let i = nomor.length - 1; i >= 0; i -= 1) sh.deleteRow(nomor[i]);
    return;
  }

  const lebar = HEADER.length;
  const rng = sh.getRange(2, 1, last - 1, lebar);
  const sisa = rng.getValues().filter((_, i) => !dibuang[i + 2]);
  if (sisa.length) sh.getRange(2, 1, sisa.length, lebar).setValues(sisa);
  const ekor = (last - 1) - sisa.length;
  if (ekor > 0) sh.deleteRows(2 + sisa.length, ekor);
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
 * batas waktu permintaan jauh sebelum selesai. Di atas ambang, bloknya dibaca
 * sekali, diubah di memori, lalu ditulis balik sekali.
 *
 * Yang dibaca-tulis hanya JENDELA dari baris terkecil sampai terbesar yang
 * benar-benar berubah, bukan seluruh tab. Sejak pengiriman dipecah per bongkah,
 * bedanya besar: satu bongkah 250 baris di pembukuan 2.000 baris menyentuh 250
 * baris, bukan 2.000 — dan tanpa pembatasan ini backfill justru jadi lebih berat
 * setelah dipecah, karena tiap bongkah menulis ulang seluruh tab.
 *
 * Konsekuensinya: sel yang berisi rumus di dalam jendela itu akan berubah jadi
 * nilai statis. Tab data ini memang murni tulisan skrip, jadi tidak ada rumus
 * yang hilang; kolom di luar A..P tidak tersentuh.
 */
function tulisPembaruan(sh, perbarui) {
  if (perbarui.length <= AMBANG_TULIS_BORONG) {
    perbarui.forEach((p) => sh.getRange(p.baris, 1, 1, HEADER.length).setValues([p.nilai]));
    return;
  }
  let awal = perbarui[0].baris;
  let akhir = perbarui[0].baris;
  perbarui.forEach((p) => {
    if (p.baris < awal) awal = p.baris;
    if (p.baris > akhir) akhir = p.baris;
  });

  const rng = sh.getRange(awal, 1, akhir - awal + 1, HEADER.length);
  const nilai = rng.getValues();
  perbarui.forEach((p) => { nilai[p.baris - awal] = p.nilai; });
  rng.setValues(nilai);
}

/**
 * Salin baris yang akan dihapus ke tab arsip sebelum dibuang.
 *
 * Penghapusan di sini dipicu dari jarak jauh oleh aplikasi, dan riwayat versi
 * Google Sheet bukan jaring pengaman yang nyaman untuk memulihkan seratusan
 * baris tertentu. Satu penulisan blok ke tab arsip hampir tidak menambah biaya
 * dibanding penghapusannya sendiri, dan membuat operasi yang merusak selalu
 * punya jalan pulang. Tab-nya disembunyikan supaya tidak mengganggu.
 */
function arsipkan(sh, nomor) {
  try {
    const ss = sh.getParent();
    const lebar = HEADER.length;
    const isi = nomor.map((n) => sh.getRange(n, 1, 1, lebar).getValues()[0]);
    if (!isi.length) return;

    let arsip = ss.getSheetByName(ARSIP_SHEET_NAME);
    if (!arsip) {
      arsip = ss.insertSheet(ARSIP_SHEET_NAME, ss.getNumSheets());
      arsip.appendRow(['Dihapus Pada'].concat(HEADER));
      arsip.setFrozenRows(1);
      arsip.hideSheet();
    }
    const cap = new Date();
    const baris = isi.map((r) => [cap].concat(r));
    arsip.getRange(arsip.getLastRow() + 1, 1, baris.length, lebar + 1).setValues(baris);
  } catch (e) {
    // Arsip adalah jaring pengaman, bukan syarat. Kegagalannya tidak boleh
    // membatalkan penghapusan yang sudah diminta dan sudah dikonfirmasi.
    console.warn('Gagal mengarsipkan baris:', e);
  }
}

/**
 * Identitas tujuan penulisan, disertakan di setiap balasan.
 *
 * Tanpa ini, aplikasi tidak punya cara membuktikan datanya mendarat di mana —
 * dan URL webhook yang menunjuk deployment lama (yang bisa saja terikat ke
 * salinan spreadsheet yang berbeda) tampak persis seperti pengiriman yang
 * berhasil. `total` adalah jumlah baris data SETELAH operasi, jadi aplikasi
 * bisa membandingkannya dengan yang baru saja dikirim.
 */
function tujuan(ss, sh) {
  const last = sh.getLastRow();
  return {
    spreadsheet: ss.getName(),
    spreadsheetId: ss.getId(),
    sheet: sh.getName(),
    total: last > 1 ? last - 1 : 0,
  };
}

function doGet() { return json({ok:true, usage:'POST {rows:[...]}'}); }

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
