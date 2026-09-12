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
 * EMPAT tab dibuat otomatis oleh pastikanSemuaTab(), dua model berbeda:
 *
 *   - "Dashboard" (bangunDashboard) & "Dashboard Full" (bangunDashboardFull):
 *     laporan, DIBANGUN ULANG DARI NOL setiap kali bentuk data berubah atau
 *     rusak. "Dashboard" bergaya laporan keuangan per rekening: kartu
 *     gabungan (termasuk Saldo Terkini & Runway), perbandingan antar
 *     rekening, arus bulanan (per rekening DAN gabungan tanpa transfer
 *     internal), pengeluaran per kategori, lalu satu blok rinci (termasuk
 *     Savings Rate) untuk tiap rekening. "Dashboard Full" bergaya analisis
 *     kategori: ranking & ambang "tak wajar" per kategori, tren kategori
 *     per bulan (heatmap), daftar transaksi tak wajar, dan anggaran vs
 *     realisasi (membaca tab Anggaran). Semuanya rumus Sheets yang merujuk
 *     balik ke tab data, jadi ikut ter-update sendiri tiap ada transaksi
 *     baru — dan karena dibangun ulang dari nol, TIDAK ADA input pengguna
 *     yang boleh diketik langsung di kedua tab ini.
 *   - "Anggaran" (pastikanAnggaran) & "Cari Transaksi" (pastikanCariTransaksi):
 *     dibuat SEKALI, lalu TIDAK PERNAH dibangun ulang/dihapus otomatis —
 *     keduanya menyimpan sesuatu milik pengguna (target anggaran bulanan;
 *     kata kunci pencarian yang sedang diketik) yang harus selamat dari
 *     siklus bangun-ulang di atas. "Anggaran" hanya ditambah baris kategori
 *     baru yang belum ada, tidak pernah menimpa/menghapus baris lama.
 *
 * Angka GABUNGAN mengecualikan transfer internal (kolom O) supaya pindah dana
 * antar rekening sendiri tidak terhitung dua kali; angka PER REKENING tetap
 * menghitungnya, karena uangnya memang keluar/masuk di rekening itu.
 *
 * Dashboard & Dashboard Full dibangun ulang bersama (satu VERSI_DASHBOARD)
 * bila versinya berubah, bila bentuk data berubah (rekening baru, kategori
 * anggaran baru, data memanjang — lihat sidikData), atau bila salah satu
 * rusak. Menu "Pembukuan" berisi "Bangun ulang Dashboard" untuk memaksanya
 * sekarang juga, dan "Diagnosa" yang melaporkan lokal, pemisah argumen
 * terdeteksi, status tiap tab, dan isi sel rumus kunci.
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
/** Tab ranking kategori & anggaran, dibangun kode sejak versi 9 — lihat bangunDashboardFull(). */
const DASHBOARD_FULL_SHEET_NAME = 'Dashboard Full';
/** Tab tersembunyi berisi salinan baris yang pernah dihapus, lihat arsipkan(). */
const ARSIP_SHEET_NAME = '_Arsip';
/**
 * Tab input pengguna (target anggaran bulanan per kategori). Dibuat sekali,
 * lalu TIDAK PERNAH dibangun ulang/dihapus otomatis seperti Dashboard —
 * lihat pastikanAnggaran(). Angka yang diketik pengguna harus selamat dari
 * setiap pembangunan ulang Dashboard/Dashboard Full.
 */
const ANGGARAN_SHEET_NAME = 'Anggaran';
/**
 * Tab pencarian transaksi, juga dibuat sekali dan tidak pernah dibangun ulang
 * — lihat pastikanCariTransaksi().
 */
const CARI_TRANSAKSI_SHEET_NAME = 'Cari Transaksi';
/**
 * Tab input pengguna: pola pengirim/subjek email transaksi bank yang mau
 * dipantau. Dibuat sekali, tidak pernah dibangun ulang — lihat
 * pastikanKonfigurasiEmail(). Kosong secara sengaja saat pertama dibuat:
 * pola pengirim asli tidak boleh ditebak, harus diisi pengguna dari email
 * transaksi sungguhan yang mereka terima.
 */
const KONFIGURASI_EMAIL_SHEET_NAME = 'Konfigurasi Email';
/**
 * Tab tersembunyi berisi email transaksi mentah yang berhasil diklasifikasi
 * — lihat pastikanEmailMasuk()/pollEmailTransaksi(). Kunci idempotensi:
 * kolom A (Gmail Message ID) diperiksa dulu sebelum baris ditambahkan.
 */
const EMAIL_MASUK_SHEET_NAME = '_EmailMasuk';
const HEADER_EMAIL_MASUK = ['Gmail Message ID', 'Perkiraan Bank', 'Dari', 'Subjek', 'Diterima Pada', 'Isi Dipotong', 'Berhasil Diparse', 'Pesan Error', 'Dibuat Pada'];
/**
 * Tab transit hasil parse email transaksi — lihat pastikanTransaksiEmail()/
 * parseEmailBerdasarkanBank(). Ditarik PWA lewat doPost{tarikTransaksiEmail}
 * (fase berikutnya) lalu boleh diarsip/dipangkas berkala seperti _Arsip;
 * rekonsiliasi/kategorisasi berjalan di PWA, BUKAN di sini — lihat rencana
 * implementasi soal kenapa IndexedDB tetap satu-satunya source of truth.
 */
const TRANSAKSI_EMAIL_SHEET_NAME = 'Transaksi Email';
const HEADER_TRANSAKSI_EMAIL = ['Gmail Message ID', 'Bank', 'Waktu Transaksi', 'Nominal', 'Arah', 'Merchant Mentah', 'Jenis Transaksi', 'Acquirer', 'Lokasi', 'RRN', 'Nomor Referensi', 'Versi Parser', 'Confidence', 'Dibuat Pada'];
/** Batas potong isi email mentah yang disimpan (karakter) — lihat PRD §12. */
const BATAS_ISI_EMAIL = 2000;
/** Label Gmail penanda "sudah diperiksa" — dasar idempotensi pollEmailTransaksi(). */
const LABEL_EMAIL_DIPROSES = 'Pembukuan/Diproses';
/** Kata di subjek yang membuat email dilewati tanpa diperiksa lebih lanjut (PRD §10.2). */
const KATA_KECUALI_EMAIL = ['OTP', 'PROMO', 'PROMOSI', 'NEWSLETTER', 'IKLAN', 'ADVERTISEMENT'];
/** Jendela pencarian mundur tiap jalan — self-healing kalau ada run yang terlewat (PRD §9.5). */
const JENDELA_PENCARIAN_EMAIL_HARI = 3;
/** Batas jumlah thread diproses per jalan, menjaga kuota eksekusi Apps Script. */
const MAKS_THREAD_EMAIL_PER_JALAN = 50;
/**
 * Tab audit ringan: satu baris per jalan pollEmailTransaksi() yang BENAR-
 * BENAR melakukan sesuatu — lihat perluDicatatLogEmail(). Dibuat sekali,
 * hanya ditambah baris, sama seperti Transaksi Email.
 */
const LOG_EMAIL_SHEET_NAME = 'Log Email';
const HEADER_LOG_EMAIL = ['Waktu', 'Thread Diperiksa', 'Email Diproses', 'Berhasil Diparse', 'Gagal Diparse', 'Diperbaiki Reparse', 'Catatan'];
/**
 * Dinaikkan setiap kali tata letak/rumus Dashboard ATAU Dashboard Full
 * berubah — keduanya dibangun ulang bersama dalam satu versi. Sheet yang
 * dibangun versi lama otomatis dibangun ulang saat POST berikutnya — tanpa
 * ini, perbaikan rumus hanya berlaku untuk Sheet baru, sementara Sheet yang
 * sudah ada tetap memakai rumus lama sampai pengguna ingat membuka menu
 * "Pembukuan".
 */
const VERSI_DASHBOARD = '9';

/** Jeda minimum antar PEMERIKSAAN apakah Dashboard perlu dibangun ulang. */
const JEDA_PEMERIKSAAN_MS = 2 * 60 * 1000;
/** Jeda minimum antar pembangunan ulang yang dipicu sidik data / kerusakan. */
const JEDA_BANGUN_MS = 10 * 60 * 1000;

/**
 * Sel rumus yang dipantau untuk mendeteksi Dashboard rusak. Tata letaknya kini
 * dinamis (tinggi tiap blok bergantung jumlah rekening, bulan, dan kategori),
 * jadi daftar sebenarnya dicatat saat build ke ScriptProperties. Nilai ini cuma
 * cadangan untuk Dashboard yang dibangun versi lama — Dashboard Full tidak
 * punya cadangan serupa karena baru ada mulai versi 9.
 */
const SEL_RUMUS = ['A9', 'D10', 'G9', 'A45'];
/** Baris tetap tabel "Transaksi Tak Wajar" di Dashboard Full (lihat bangunDashboardFull). */
const TOP_ANOMALI = 25;
/** Baris tetap hasil pencarian di tab Cari Transaksi (lihat pastikanCariTransaksi). */
const MAKS_HASIL_CARI = 500;

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
    .addItem('Proses Email Transaksi Sekarang', 'prosesEmailSekarang')
    .addItem('Tarik Email Lama (Backfill)', 'backfillEmailTransaksi')
    .addItem('Aktifkan Pemantauan Email Transaksi', 'aktifkanPemantauanEmail')
    .addItem('Nonaktifkan Pemantauan Email', 'nonaktifkanPemantauanEmail')
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
  const bawaan = [
    DASHBOARD_SHEET_NAME, DASHBOARD_FULL_SHEET_NAME,
    ANGGARAN_SHEET_NAME, CARI_TRANSAKSI_SHEET_NAME, ARSIP_SHEET_NAME,
    KONFIGURASI_EMAIL_SHEET_NAME, EMAIL_MASUK_SHEET_NAME, TRANSAKSI_EMAIL_SHEET_NAME, LOG_EMAIL_SHEET_NAME,
  ];
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
 * Dashboard/Dashboard Full dianggap rusak (dan boleh dibangun ulang otomatis)
 * hanya pada dua keadaan yang tidak mungkin disengaja pengguna:
 *
 *   - salah satu sel rumusnya bernilai galat (#ERROR!, #REF!, dst.) — misalnya
 *     rumus dibuat versi lama dengan pemisah argumen yang salah untuk lokal ini;
 *   - A1 berisi label header tab data, tanda tab ini pernah tertulisi data
 *     transaksi oleh kode versi lama.
 *
 * Sengaja sesempit itu: kalau patokannya "tata letak tidak seperti bawaan",
 * penyesuaian yang pengguna buat sendiri akan ditimpa berulang kali.
 *
 * `jangkar` adalah daftar sel rumus milik TAB INI SAJA — dipanggil
 * sendiri-sendiri untuk `Dashboard` dan `Dashboard Full` supaya kerusakan di
 * satu tab tidak tertutupi oleh tab lain yang sehat.
 */
function dashboardRusak(d, jangkar) {
  const judul = String(d.getRange('A1').getValue()).trim().toLowerCase();
  if (judul === HEADER[0].toLowerCase() || judul === 'hash') return true;
  return jangkar.some((a) => String(d.getRange(a).getValue()).charAt(0) === '#');
}

/**
 * Sel rumus yang dipantau untuk satu tab: daftar yang dicatat saat build ke
 * ScriptProperties dengan `kunci` ('selRumusDashboard' atau
 * 'selRumusDashboardFull'), atau `SEL_RUMUS` bila belum ada dan kuncinya
 * milik Dashboard (Dashboard bawaan versi lama — Dashboard Full tidak punya
 * cadangan serupa karena baru ada mulai versi 9). Daftar dinamis ini yang
 * membuat luapan array — QUERY yang tumbuh melewati cadangan barisnya lalu
 * menghasilkan #REF!, galat yang TIDAK tertangkap IFERROR — bisa
 * tersembuhkan sendiri lewat jalur "rusak" yang sudah ada.
 */
function jangkarRumus(kunci) {
  try {
    const tersimpan = JSON.parse(PropertiesService.getScriptProperties().getProperty(kunci) || '[]');
    if (Array.isArray(tersimpan) && tersimpan.length) return tersimpan;
  } catch (e) { /* catatannya rusak — pakai cadangan */ }
  return kunci === 'selRumusDashboard' ? SEL_RUMUS : [];
}

/** Cadangan baris menahan tabrakan ketika QUERY tumbuh setelah dibangun. */
function cadangan(n) {
  return Math.max(4, Math.ceil(n * 0.3));
}

/**
 * Kolom maya yang dipakai bersama oleh Dashboard dan Dashboard Full, dirakit
 * sekali dan dibagikan ke kedua fungsi pembangun supaya definisinya tidak
 * bisa saling menyimpang antara dua tab.
 *
 * Tanggal tersimpan sebagai TIPE TANGGAL, bukan teks: setValues mengubah
 * string ISO jadi tanggal saat menulis. LEFT(tanggal;7) kebetulan masih benar
 * selama format tampilannya "yyyy-mm-dd" — tapi begitu format itu berubah
 * (ganti locale, kolom diformat ulang), hasilnya jadi potongan seperti
 * "01/12/2" dan SELURUH pengelompokan bulan rusak tanpa satu pun pesan galat.
 * TEXT tidak bergantung format tampilan; cabang LEFT dipertahankan untuk baris
 * yang tanggalnya memang masih berupa teks.
 */
function kolomMaya(kol, S) {
  const BULAN = `ARRAYFORMULA(IF(ISNUMBER(${kol('B')})${S}TEXT(${kol('B')}${S}"yyyy-mm")${S}LEFT(${kol('B')}${S}7)))`;
  const REK = `ARRAYFORMULA(IF(${kol('H')}=""${S}""${S}TRIM(${kol('H')}&" "&${kol('I')})))`;
  // Nama kategori dipakai kalau ada. Kalau kosong (baris yang terunggah sebelum
  // kolom Kategori ada), ID-nya dijadikan terbaca: "kat_transfer_keluar" ->
  // "Transfer Keluar". Kategori buatan sendiri ber-ID acak tetap tidak terbaca;
  // hanya "Kirim semua sekarang" yang bisa memberi nama aslinya.
  const KATEGORI = `ARRAYFORMULA(IF(${kol('N')}<>""${S}${kol('N')}${S}`
    + `IF(LEFT(${kol('G')}${S}4)="kat_"${S}PROPER(SUBSTITUTE(MID(${kol('G')}${S}5${S}100)${S}"_"${S}" "))${S}${kol('G')})))`;
  const NETTO = `ARRAYFORMULA(N(${kol('F')})-N(${kol('E')}))`;
  // Bendera 0/1, dipakai dalam klausa QUERY: QUERY tidak selalu bisa
  // membandingkan langsung dengan kolom boolean mentah (kolom O).
  const TRANSFER = `ARRAYFORMULA(IF(${kol('O')}=TRUE${S}1${S}0))`;
  return { BULAN, REK, KATEGORI, NETTO, TRANSFER };
}

/** Factory pasangRumus terikat ke satu sheet & satu daftar jangkar. */
function buatPasangRumus(d, jangkar) {
  return (a1, rumus) => { d.getRange(a1).setFormula(rumus); jangkar.push(a1); return a1; };
}

/**
 * Orkestrator: memastikan Dashboard, Dashboard Full, Anggaran, dan Cari
 * Transaksi semuanya ada dan sehat. statistikData dipanggil SEKALI di sini
 * dan dibagikan ke seluruh pemeriksaan/pembangunan di bawah — Dashboard dan
 * Dashboard Full menumpuk banyak blok yang ukurannya bergantung angka yang
 * sama, dan tab data bisa berisi ribuan baris.
 *
 * Anggaran dan Cari Transaksi TIDAK ikut throttle/versi Dashboard: keduanya
 * murah untuk diperiksa (create-once, tidak pernah dibangun ulang) dan tidak
 * boleh menunggu jeda yang sama — kategori baru di Transaksi harus segera
 * muncul di Anggaran, bukan menunggu jeda pemeriksaan Dashboard.
 */
function pastikanSemuaTab(ss, namaSheetData) {
  const prop = PropertiesService.getScriptProperties();
  const stat = statistikData(ss.getSheetByName(namaSheetData));

  pastikanAnggaran(ss, stat);
  pastikanCariTransaksi(ss);
  pastikanKonfigurasiEmail(ss);
  pastikanEmailMasuk(ss);
  pastikanTransaksiEmail(ss);
  pastikanLogEmail(ss);

  const anggaranSh = ss.getSheetByName(ANGGARAN_SHEET_NAME);
  const anggaranBaris = anggaranSh ? Math.max(anggaranSh.getLastRow() - 1, 0) : 0;
  const sidik = sidikData(stat, anggaranBaris);

  const adaDash = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  const adaFull = ss.getSheetByName(DASHBOARD_FULL_SHEET_NAME);
  const versiBeda = prop.getProperty('versiDashboard') !== VERSI_DASHBOARD;

  // MEMERIKSA saja sudah mahal: statistikData membaca seluruh tab data, dan
  // dashboardRusak memaksa Sheets menghitung ulang QUERY/ARRAYFORMULA di atas
  // ribuan baris — dua kali lipat sekarang karena ada dua tab. Backfill
  // mengirim datanya dalam banyak bongkah berturut-turut; tanpa jeda ini,
  // ongkos pemeriksaan itu dibayar berulang-ulang dalam hitungan detik untuk
  // data yang bentuknya jelas belum berubah. Bila salah satu tab belum ada
  // (migrasi dari versi lama yang cuma punya Dashboard), throttle ini
  // dilewati — itu sekali jalan dan memang harus segera membangun keduanya.
  if (adaDash && adaFull && !versiBeda) {
    const diperiksa = Number(prop.getProperty('pemeriksaanTerakhir') || 0);
    if (Date.now() - diperiksa < JEDA_PEMERIKSAAN_MS) return;
    prop.setProperty('pemeriksaanTerakhir', String(Date.now()));
  }

  const rusak = (adaDash && dashboardRusak(adaDash, jangkarRumus('selRumusDashboard')))
    || (adaFull && dashboardRusak(adaFull, jangkarRumus('selRumusDashboardFull')));

  if (adaDash && adaFull) {
    const sidikBeda = prop.getProperty('sidikDashboard') !== sidik;
    if (!versiBeda && !sidikBeda && !rusak) return;
    // Jalur versi berbeda tidak dibatasi: itu sekali jalan dan memang diminta.
    // Jalur sidik/rusak dibatasi supaya pembangunan ulang yang ternyata tidak
    // menyembuhkan tidak diulang tiap POST — mahal dan boros kuota.
    if (!versiBeda) {
      const terakhir = Number(prop.getProperty('pembangunanTerakhir') || 0);
      if (Date.now() - terakhir < JEDA_BANGUN_MS) return;
      prop.setProperty('pembangunanTerakhir', String(Date.now()));
    }
  }

  if (adaDash) ss.deleteSheet(adaDash);
  if (adaFull) ss.deleteSheet(adaFull);

  const S = pisahArgumen(ss);           // pemisah argumen rumus
  const AS = S === ',' ? ',' : '\\';    // pemisah kolom di dalam array literal {}
  const kol = (huruf) => `'${namaSheetData}'!${huruf}2:${huruf}`;
  const maya = kolomMaya(kol, S);

  const hasilDash = bangunDashboard(ss, namaSheetData, stat, S, AS, kol, maya);
  const hasilFull = bangunDashboardFull(ss, namaSheetData, stat, S, AS, kol, maya);

  // Dicatat paling akhir, setelah semuanya benar-benar terpasang: kalau
  // pembangunan gagal di tengah jalan, versi dan sidiknya tidak ikut tercatat
  // sehingga percobaan berikutnya mengulang, bukan menganggap sudah beres.
  prop.setProperty('selRumusDashboard', JSON.stringify(hasilDash.jangkar));
  prop.setProperty('rentangBlokDashboard', JSON.stringify(hasilDash.rentang));
  prop.setProperty('selRumusDashboardFull', JSON.stringify(hasilFull.jangkar));
  prop.setProperty('rentangBlokDashboardFull', JSON.stringify(hasilFull.rentang));
  prop.setProperty('sidikDashboard', sidik);
  prop.setProperty('versiDashboard', VERSI_DASHBOARD);
}

/**
 * Bangun tab "Dashboard": kartu ringkasan (termasuk Saldo Terkini & Runway
 * gabungan), perbandingan antar rekening, arus bulanan per rekening DAN
 * gabungan, breakdown kategori, lalu satu blok rinci per rekening (kini juga
 * memuat Savings Rate, Saldo Terkini, dan Runway), plus grafik donat &
 * kolom. Semuanya rumus (SUM/COUNTA/QUERY/ARRAYFORMULA) yang merujuk balik
 * ke tab data, sehingga ikut ter-update tiap ada transaksi baru.
 *
 * Posisi TERAKHIR, bukan pertama — lihat catatan (1) di kepala berkas.
 */
function bangunDashboard(ss, namaSheetData, stat, S, AS, kol, maya) {
  const d = ss.insertSheet(DASHBOARD_SHEET_NAME, ss.getNumSheets());

  const nBulan = Math.max(stat.bulan.length, 1);
  const nRek = Math.max(stat.rekening.length, 1);
  const nKat = Math.max(stat.katKeluar, 1);

  /* ---------- Anggaran kolom dan baris ---------- */
  // Grid harus cukup besar SEBELUM sel mana pun disentuh. Menyetel lebar kolom
  // atau mengakses sel di luar grid membuat Apps Script melempar "Kolom
  // tersebut melampaui batas" dan membatalkan seluruh pembangunan — dan blok
  // per rekening membuat tata letak ini bisa memanjang jauh ke bawah.
  // Lantai 12 (bukan 7): baris kartu KPI sekarang enam kartu (A..L), dan
  // baris kartu mini per rekening sekarang mencapai kolom J (Saldo Terkini,
  // Runway) — keduanya harus muat sebelum lebar dipakai menghitung posisi
  // grafik (kolomGrafik) supaya grafik tidak menimpa kartu.
  const lebarRek = Math.max(1 + stat.rekening.length, 2);
  const lebarMaks = Math.max(12, lebarRek, 1 + nBulan);
  const kolomPerlu = Math.max(lebarMaks + 4, 26);
  if (d.getMaxColumns() < kolomPerlu) {
    d.insertColumnsAfter(d.getMaxColumns(), kolomPerlu - d.getMaxColumns());
  }
  const tinggiBlokBulan = nBulan + cadangan(nBulan);
  const barisPerlu = 10
    + (nRek + cadangan(nRek) + 4)
    + (tinggiBlokBulan + 4)  // arus bulanan per rekening
    + (tinggiBlokBulan + 4)  // arus bulanan gabungan (baru)
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
  const pasangRumus = buatPasangRumus(d, jangkar);

  /* ---------- Judul ---------- */
  d.getRange('A1:L1').merge()
    .setValue('LAPORAN KEUANGAN PER REKENING')
    .setFontSize(14).setFontWeight('bold').setFontColor(BIRU_TUA)
    .setVerticalAlignment('middle');
  d.setRowHeight(1, 34);
  d.getRange('A2:L2').merge()
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
  // Kartu Saldo Terkini & Runway gabungan (I,K) dirender BELAKANGAN, setelah
  // blok per rekening (butuh alamat Saldo Terkini tiap rekening) dan arus
  // bulanan gabungan (butuh rata-rata pengeluaran gabungan) selesai dibangun
  // — lihat akhir fungsi ini. Baris tingginya disamakan sekarang saja.
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
    `=IFERROR(QUERY({${maya.REK}${AS}${kol('F')}${AS}${kol('E')}${AS}${kol('A')}}${S}`
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
    `=IFERROR(QUERY({${maya.BULAN}${AS}${maya.REK}${AS}${maya.NETTO}}${S}`
    + `"select Col1, sum(Col3) where Col1 <> '' and Col2 <> '' group by Col1 pivot Col2"${S}0)${S}"Belum ada data")`);
  kepalaTabel(d, `A${kepalaArus}:${hurufKolom(lebarRek)}${kepalaArus}`);
  const akhirArus = kepalaArus + nBulan + cadangan(nBulan);
  d.getRange(`B${kepalaArus + 1}:${hurufKolom(lebarRek)}${akhirArus}`).setNumberFormat(RP);
  rentang.push([mulaiArus, akhirArus]);
  r = akhirArus + 2;

  /* ---------- Arus bulanan gabungan, tanpa transfer internal ---------- */
  // Beda dari blok di atas: ini SATU kolom Masuk/Keluar tergabung seluruh
  // rekening (bukan dipivot per rekening), dan transfer internal disaring
  // keluar — dasar untuk kartu & rumus Savings Rate/Runway gabungan.
  const mulaiArusGab = r;
  judulSeksi('ARUS BULANAN GABUNGAN (TANPA TRANSFER INTERNAL)');
  const kepalaArusGab = r;
  pasangRumus(`A${r}`,
    `=IFERROR(QUERY({${maya.BULAN}${AS}${kol('F')}${AS}${kol('E')}${AS}${maya.TRANSFER}}${S}`
    + `"select Col1, sum(Col2), sum(Col3) where Col4 = 0 and Col1 <> '' group by Col1 order by Col1 asc `
    + `label Col1 'Bulan', sum(Col2) 'Masuk', sum(Col3) 'Keluar'"${S}0)${S}"Belum ada data")`);
  d.getRange(kepalaArusGab, 4).setValue('Net');
  d.getRange(kepalaArusGab, 5).setValue('Savings Rate');
  const isiArusGab = kepalaArusGab + 1;
  const akhirArusGab = kepalaArusGab + nBulan + cadangan(nBulan);
  pasangRumus(`D${isiArusGab}`,
    `=IFERROR(ARRAYFORMULA(IF(A${isiArusGab}:A${akhirArusGab}=""${S}""${S}`
    + `B${isiArusGab}:B${akhirArusGab}-C${isiArusGab}:C${akhirArusGab}))${S}"")`);
  pasangRumus(`E${isiArusGab}`,
    `=IFERROR(ARRAYFORMULA(IF((A${isiArusGab}:A${akhirArusGab}="")+(B${isiArusGab}:B${akhirArusGab}=0)>0${S}""${S}`
    + `D${isiArusGab}:D${akhirArusGab}/B${isiArusGab}:B${akhirArusGab}))${S}"")`);
  kepalaTabel(d, `A${kepalaArusGab}:E${kepalaArusGab}`);
  d.getRange(`B${isiArusGab}:D${akhirArusGab}`).setNumberFormat(RP);
  d.getRange(`E${isiArusGab}:E${akhirArusGab}`).setNumberFormat('0.0%');
  rentangNet.push(d.getRange(`D${isiArusGab}:D${akhirArusGab}`));
  rentang.push([mulaiArusGab, akhirArusGab]);
  r = akhirArusGab + 2;

  /* ---------- Pengeluaran per kategori per rekening ---------- */
  const mulaiKat = r;
  judulSeksi('PENGELUARAN PER KATEGORI PER REKENING');
  const kepalaKat = r;
  pasangRumus(`A${r}`,
    `=IFERROR(QUERY({${maya.KATEGORI}${AS}${maya.REK}${AS}${kol('E')}}${S}`
    + `"select Col1, sum(Col3) where Col3 > 0 and Col1 <> '' and Col2 <> '' group by Col1 pivot Col2"${S}0)${S}"Belum ada data")`);
  kepalaTabel(d, `A${kepalaKat}:${hurufKolom(lebarRek)}${kepalaKat}`);
  const akhirKat = kepalaKat + nKat + cadangan(nKat);
  d.getRange(`B${kepalaKat + 1}:${hurufKolom(lebarRek)}${akhirKat}`).setNumberFormat(RP);
  rentang.push([mulaiKat, akhirKat]);
  r = akhirKat + 2;

  /* ---------- Blok tiap rekening ---------- */
  const daftarSaldoTerkini = []; // alamat sel Saldo Terkini tiap rekening, dijumlah utk kartu gabungan
  stat.rekening.forEach((label) => {
    const mulaiBlok = r;

    // Label ditulis apa adanya ke sel pita, TIDAK disisipkan ke dalam string
    // QUERY: nama bank ber-apostrof akan memecah rumusnya. Penyaringan memakai
    // kolom bendera yang membandingkan kolom maya rekening dengan sel ini.
    const selLabel = `$A$${r}`;
    pitaSeksi(d, `A${r}:G${r}`, label, BIRU_TUA);
    r += 1;

    const bendera = `ARRAYFORMULA(IF(${maya.REK}=${selLabel}${S}1${S}0))`;

    const barisKepalaKartu = r;
    const barisNilaiKartu = r + 1;
    r += 3;

    const kepalaTabelBulan = r;
    pasangRumus(`A${r}`,
      `=IFERROR(QUERY({${maya.BULAN}${AS}${kol('F')}${AS}${kol('E')}${AS}${bendera}}${S}`
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
    // Savings Rate (H) ikut ditulis di sini sekalian — satu setFormulas untuk
    // tiga kolom, bukan tiga panggilan terpisah.
    d.getRange(kepalaTabelBulan, 6).setValue('Saldo Bank');
    d.getRange(kepalaTabelBulan, 7).setValue('Selisih');
    d.getRange(kepalaTabelBulan, 8).setValue('Savings Rate');
    const rumusSaldo = [];
    for (let baris = isiBulan; baris <= akhirBulan; baris += 1) {
      const saldoBulan = `IFERROR(INDEX(SORT(FILTER({${kol('P')}${AS}${kol('B')}}${S}`
        + `(${maya.BULAN}=A${baris})*(${maya.REK}=${selLabel})*(${kol('P')}<>""))${S}2${S}FALSE)${S}1${S}1)${S}"")`;
      // Selisih memakai Saldo Bank bulan sebelumnya dari baris di ATASNYA:
      // tabelnya sudah urut naik, jadi tidak perlu pencarian kedua. Identitas
      // "perubahan saldo = jumlah mutasi" tetap berlaku walau ada bulan bolong.
      const selisih = baris === isiBulan
        ? '=""'
        : `=IF(OR(A${baris}=""${S}F${baris}=""${S}F${baris - 1}="")${S}""${S}F${baris}-F${baris - 1}-D${baris})`;
      const savingsRate = `=IF(OR(A${baris}=""${S}B${baris}=0)${S}""${S}D${baris}/B${baris})`;
      rumusSaldo.push([`=IF(A${baris}=""${S}""${S}${saldoBulan})`, selisih, savingsRate]);
    }
    d.getRange(isiBulan, 6, rumusSaldo.length, 3).setFormulas(rumusSaldo);

    kepalaTabel(d, `A${kepalaTabelBulan}:H${kepalaTabelBulan}`);
    d.getRange(`B${isiBulan}:D${akhirBulan}`).setNumberFormat(RP);
    d.getRange(`F${isiBulan}:G${akhirBulan}`).setNumberFormat(RP);
    d.getRange(`H${isiBulan}:H${akhirBulan}`).setNumberFormat('0.0%');
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

    // Saldo Terkini: sama seperti Saldo Bank di atas tapi TANPA penyaringan
    // bulan — saldo berjalan pada transaksi terakhir menurut tanggal untuk
    // rekening ini. Alamatnya dikumpulkan untuk kartu gabungan di akhir fungsi.
    d.getRange(`G${barisKepalaKartu}:H${barisKepalaKartu}`).merge().setValue('Saldo Terkini')
      .setFontWeight('bold').setFontSize(9).setFontColor(BIRU_TUA).setBackground('#e8f0fe')
      .setHorizontalAlignment('center');
    const selSaldoTerkini = `G${barisNilaiKartu}`;
    d.getRange(`${selSaldoTerkini}:H${barisNilaiKartu}`).merge()
      .setFormula(`=IFERROR(INDEX(SORT(FILTER({${kol('P')}${AS}${kol('B')}}${S}`
        + `(${maya.REK}=${selLabel})*(${kol('P')}<>""))${S}2${S}FALSE)${S}1${S}1)${S}"")`)
      .setFontSize(14).setFontWeight('bold').setFontColor(BIRU_TUA).setBackground('#e8f0fe')
      .setHorizontalAlignment('center').setNumberFormat(RP);
    daftarSaldoTerkini.push(selSaldoTerkini);

    // Runway: Saldo Terkini dibagi rata-rata pengeluaran bulanan rekening ini.
    // Rata-rata dihitung dari tabel bulanan di atas (kolom C, hanya bulan yang
    // benar-benar ada pengeluaran) supaya konsisten dengan tabelnya sendiri,
    // bukan menyaring ulang tab data.
    d.getRange(`I${barisKepalaKartu}:J${barisKepalaKartu}`).merge().setValue('Runway')
      .setFontWeight('bold').setFontSize(9).setFontColor('#3c4043').setBackground('#f1f3f4')
      .setHorizontalAlignment('center');
    d.getRange(`I${barisNilaiKartu}:J${barisNilaiKartu}`).merge()
      .setFormula(`=IFERROR(IF(AVERAGE(FILTER(C${isiBulan}:C${akhirBulan}${S}C${isiBulan}:C${akhirBulan}>0))=0${S}""${S}`
        + `${selSaldoTerkini}/AVERAGE(FILTER(C${isiBulan}:C${akhirBulan}${S}C${isiBulan}:C${akhirBulan}>0)))${S}"")`)
      .setFontSize(14).setFontWeight('bold').setFontColor('#3c4043').setBackground('#f1f3f4')
      .setHorizontalAlignment('center').setNumberFormat('0.0" bln"');

    rentang.push([mulaiBlok, akhirBulan]);
    r = akhirBulan + 2;
  });

  // Kartu Saldo Terkini & Runway gabungan: dirender di sini, BUKAN bersama
  // KARTU di atas, karena keduanya baru bisa dihitung setelah alamat Saldo
  // Terkini tiap rekening (dikumpulkan dalam loop blok rekening) dan arus
  // bulanan gabungan (rata-rata pengeluaran) selesai dibangun.
  const selSaldoGabungan = daftarSaldoTerkini.length ? `=SUM(${daftarSaldoTerkini.join(S)})` : '=0';
  d.getRange('I4:J4').merge().setValue('SALDO TERKINI (GABUNGAN)')
    .setFontWeight('bold').setFontSize(9).setFontColor(BIRU_TUA).setBackground('#e8f0fe')
    .setHorizontalAlignment('center');
  d.getRange('I5:J6').merge().setFormula(selSaldoGabungan)
    .setFontSize(18).setFontWeight('bold').setFontColor(BIRU_TUA).setBackground('#e8f0fe')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat(RP);

  d.getRange('K4:L4').merge().setValue('RUNWAY (BULAN)')
    .setFontWeight('bold').setFontSize(9).setFontColor('#3c4043').setBackground('#f1f3f4')
    .setHorizontalAlignment('center');
  d.getRange('K5:L6').merge()
    .setFormula(`=IFERROR(IF(AVERAGE(FILTER(C${isiArusGab}:C${akhirArusGab}${S}C${isiArusGab}:C${akhirArusGab}>0))=0${S}""${S}`
      + `I5/AVERAGE(FILTER(C${isiArusGab}:C${akhirArusGab}${S}C${isiArusGab}:C${akhirArusGab}>0)))${S}"")`)
    .setFontSize(18).setFontWeight('bold').setFontColor('#3c4043').setBackground('#f1f3f4')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat('0.0" bln"');

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

  return { jangkar, rentang };
}

/**
 * Bangun tab "Dashboard Full": ranking kategori pengeluaran (dengan ambang
 * "tak wajar" per kategori), tren kategori per bulan sebagai heatmap,
 * daftar transaksi tak wajar, dan anggaran vs realisasi bulan berjalan
 * (dibaca dari tab Anggaran — lihat pastikanAnggaran). Menggantikan sheet
 * hand-built lama dengan nama yang sama, yang rusak karena rumus
 * koma-nya tidak lolos di lokal Indonesia (lihat catatan (2) di kepala
 * berkas) — di sini rumusnya lewat `pasangRumus`/`S` seperti Dashboard,
 * jadi ikut kebal locale dan ikut disembuhkan otomatis lewat dashboardRusak.
 */
function bangunDashboardFull(ss, namaSheetData, stat, S, AS, kol, maya) {
  const nBulan = Math.max(stat.bulan.length, 1);
  const nKat = Math.max(stat.katKeluar, 1);
  const anggaranSh = ss.getSheetByName(ANGGARAN_SHEET_NAME);
  const nAnggaran = anggaranSh ? Math.max(anggaranSh.getLastRow() - 1, 0) : 0;

  const lebarHeatmap = 1 + nBulan;
  const lebarMaks = Math.max(7, lebarHeatmap);
  const kolomPerlu = Math.max(lebarMaks + 4, 26);

  const d = ss.insertSheet(DASHBOARD_FULL_SHEET_NAME, ss.getNumSheets());
  if (d.getMaxColumns() < kolomPerlu) {
    d.insertColumnsAfter(d.getMaxColumns(), kolomPerlu - d.getMaxColumns());
  }
  const barisPerlu = 6
    + (nKat + cadangan(nKat) + 4)  // ranking (+ ambang tak wajar)
    + (nKat + cadangan(nKat) + 4)  // heatmap tren kategori
    + (TOP_ANOMALI + 4)            // transaksi tak wajar — TETAP, tidak perlu cadangan
    + (Math.max(nAnggaran, 1) + 6) // anggaran vs realisasi
    + 20;
  if (d.getMaxRows() < barisPerlu) {
    d.insertRowsAfter(d.getMaxRows(), barisPerlu - d.getMaxRows());
  }
  const kolomGrafik = Math.min(lebarMaks + 2, d.getMaxColumns());

  d.setHiddenGridlines(true);
  d.setTabColor(BIRU_TUA);
  d.setColumnWidth(1, 200);
  d.setColumnWidths(2, d.getMaxColumns() - 1, 130);

  const jangkar = [];
  const pasangRumus = buatPasangRumus(d, jangkar);
  const rentang = [];
  const rentangHeatmap = [];
  const rentangNetFull = []; // kolom Selisih anggaran: hijau surplus, merah defisit

  let r = 4;
  const judulSeksi = (teks) => {
    d.getRange(r, 1).setValue(teks).setFontWeight('bold').setFontSize(11).setFontColor(BIRU_TUA);
    r += 1;
  };

  const lebarJudul = hurufKolom(Math.min(9, d.getMaxColumns()));
  d.getRange(`A1:${lebarJudul}1`).merge()
    .setValue('DASHBOARD FULL — ANALISIS KATEGORI & ANGGARAN')
    .setFontSize(14).setFontWeight('bold').setFontColor(BIRU_TUA)
    .setVerticalAlignment('middle');
  d.setRowHeight(1, 34);
  d.getRange(`A2:${lebarJudul}2`).merge()
    .setValue('Ranking & ambang tak wajar per kategori, tren bulanan, transaksi tak wajar, dan anggaran vs realisasi.')
    .setFontStyle('italic').setFontColor('#5f6368').setFontSize(10);

  /* ---------- 1. Profil & ranking pengeluaran per kategori ---------- */
  const mulaiRanking = r;
  judulSeksi('1. PROFIL & RANKING PENGELUARAN PER KATEGORI');
  const kepalaRanking = r;
  pasangRumus(`A${r}`,
    `=IFERROR(QUERY({${maya.KATEGORI}${AS}${kol('E')}}${S}`
    + `"select Col1, sum(Col2), count(Col2), avg(Col2) where Col2 > 0 and Col1 <> '' group by Col1 `
    + `order by sum(Col2) desc `
    + `label Col1 'Kategori', sum(Col2) 'Total Keluar', count(Col2) 'Jml Transaksi', avg(Col2) 'Rata-rata'"${S}0)${S}"Belum ada data")`);
  d.getRange(kepalaRanking, 5).setValue('% dari Total');
  d.getRange(kepalaRanking, 6).setValue('Std Dev');
  d.getRange(kepalaRanking, 7).setValue('Ambang Tak Wajar');
  const isiRanking = kepalaRanking + 1;
  const akhirRanking = kepalaRanking + nKat + cadangan(nKat);
  // % dari Total merujuk balik ke kartu TOTAL PENGELUARAN di Dashboard (C5)
  // supaya dua tab tidak pernah menghitung total yang berbeda. Kalau tata
  // letak kartu itu berubah, baris ini harus ikut disesuaikan.
  pasangRumus(`E${isiRanking}`,
    `=IFERROR(ARRAYFORMULA(IF(A${isiRanking}:A${akhirRanking}=""${S}""${S}`
    + `B${isiRanking}:B${akhirRanking}/'${DASHBOARD_SHEET_NAME}'!$C$5))${S}"")`);
  // Std Dev & Ambang per kategori, dipakai lagi oleh daftar Transaksi Tak
  // Wajar di bawah lewat VLOOKUP ke tabel ini. Per baris, tidak divektorkan
  // (SUMPRODUCT butuh sel pembanding tunggal) — sama seperti Saldo Bank di
  // Dashboard; sengaja TIDAK dijangkar satu-satu, IFERROR sudah cukup.
  const rumusSD = [];
  for (let baris = isiRanking; baris <= akhirRanking; baris += 1) {
    const sd = `=IF(A${baris}=""${S}""${S}IFERROR(SQRT(SUMPRODUCT((${maya.KATEGORI}=A${baris})*(${kol('E')}>0)*`
      + `(${kol('E')}-D${baris})^2)/MAX(C${baris}-1${S}1))${S}0))`;
    const ambang = `=IF(A${baris}=""${S}""${S}D${baris}+2*F${baris})`;
    rumusSD.push([sd, ambang]);
  }
  d.getRange(isiRanking, 6, rumusSD.length, 2).setFormulas(rumusSD);
  kepalaTabel(d, `A${kepalaRanking}:G${kepalaRanking}`);
  d.getRange(`B${isiRanking}:B${akhirRanking}`).setNumberFormat(RP);
  d.getRange(`D${isiRanking}:D${akhirRanking}`).setNumberFormat(RP);
  d.getRange(`E${isiRanking}:E${akhirRanking}`).setNumberFormat('0.0%');
  d.getRange(`F${isiRanking}:G${akhirRanking}`).setNumberFormat(RP);
  rentang.push([mulaiRanking, akhirRanking]);
  r = akhirRanking + 2;

  /* ---------- 2. Tren kategori pengeluaran per bulan (heatmap) ---------- */
  const mulaiHeatmap = r;
  judulSeksi('2. TREN KATEGORI PENGELUARAN PER BULAN');
  const kepalaHeatmap = r;
  pasangRumus(`A${r}`,
    `=IFERROR(QUERY({${maya.KATEGORI}${AS}${maya.BULAN}${AS}${kol('E')}}${S}`
    + `"select Col1, sum(Col3) where Col3 > 0 and Col1 <> '' and Col2 <> '' group by Col1 pivot Col2"${S}0)${S}"Belum ada data")`);
  kepalaTabel(d, `A${kepalaHeatmap}:${hurufKolom(lebarHeatmap)}${kepalaHeatmap}`);
  const akhirHeatmap = kepalaHeatmap + nKat + cadangan(nKat);
  const rentangNilaiHeatmap = d.getRange(`B${kepalaHeatmap + 1}:${hurufKolom(lebarHeatmap)}${akhirHeatmap}`);
  rentangNilaiHeatmap.setNumberFormat(RP);
  rentangHeatmap.push(rentangNilaiHeatmap);
  rentang.push([mulaiHeatmap, akhirHeatmap]);
  r = akhirHeatmap + 2;

  /* ---------- 3. Transaksi tak wajar ---------- */
  // Ambang per transaksi: VLOOKUP ke tabel ranking di atas (kolom G), bukan
  // tabel bantu terpisah — tabel ranking sudah memuat rata-rata & ambang per
  // kategori, jadi tidak perlu menghitungnya dua kali.
  const mulaiAnomali = r;
  judulSeksi(`3. TRANSAKSI TAK WAJAR (TOP ${TOP_ANOMALI}, DIURUTKAN DARI PALING JAUH DI ATAS AMBANG KATEGORINYA)`);
  const kepalaAnomali = r;
  const AMBANG = `ARRAYFORMULA(IFERROR(VLOOKUP(${maya.KATEGORI}${S}$A$${isiRanking}:$G$${akhirRanking}${S}7${S}FALSE)${S}""))`;
  pasangRumus(`A${r}`,
    `=IFERROR(QUERY({${kol('B')}${AS}${kol('C')}${AS}${maya.REK}${AS}${maya.KATEGORI}${AS}${kol('E')}${AS}${AMBANG}${AS}${kol('E')}-${AMBANG}}${S}`
    + `"select Col1, Col2, Col3, Col4, Col5, Col6, Col7 where Col5 > 0 and Col5 > Col6 `
    + `order by Col7 desc limit ${TOP_ANOMALI} `
    + `label Col1 'Tanggal', Col2 'Deskripsi', Col3 'Rekening', Col4 'Kategori', Col5 'Nominal', `
    + `Col6 'Ambang Kategori', Col7 'Selisih dari Ambang'"${S}0)${S}"Tidak ada transaksi tak wajar")`);
  const isiAnomali = kepalaAnomali + 1;
  const akhirAnomali = kepalaAnomali + TOP_ANOMALI; // tetap: QUERY membatasi sendiri lewat "limit"
  d.getRange(`A${isiAnomali}:A${akhirAnomali}`).setNumberFormat('yyyy-mm-dd');
  d.getRange(`E${isiAnomali}:G${akhirAnomali}`).setNumberFormat(RP);
  rentang.push([mulaiAnomali, akhirAnomali]);
  r = akhirAnomali + 2;

  /* ---------- 4. Anggaran vs realisasi bulan berjalan ---------- */
  const mulaiBudget = r;
  judulSeksi('4. ANGGARAN VS REALISASI BULAN BERJALAN');
  // Bulan berjalan = bulan TERAKHIR yang benar-benar ada datanya, bukan
  // bulan kalender sekarang — konsisten dengan cara Dashboard/Dashboard Full
  // mendeteksi bulan lain (kolom maya BULAN), bukan Date sekarang.
  d.getRange(`A${r}`).setValue('Bulan berjalan:').setFontStyle('italic').setFontColor('#5f6368');
  const selBulanTerkini = `B${r}`;
  pasangRumus(selBulanTerkini,
    `=IFERROR(ARRAYFORMULA(TEXT(MAX(IF(ISNUMBER(${kol('B')})${S}${kol('B')}))${S}"yyyy-mm"))${S}"")`);
  r += 2;
  const kepalaBudget = r;
  ['Kategori', 'Target Bulanan', 'Aktual Bulan Ini', 'Selisih', '% Terpakai', 'Status']
    .forEach((teks, i) => d.getRange(kepalaBudget, i + 1).setValue(teks));
  kepalaTabel(d, `A${kepalaBudget}:F${kepalaBudget}`);
  const isiBudget = kepalaBudget + 1;
  let akhirBudget = isiBudget;
  if (nAnggaran > 0) {
    const rumusBudget = [];
    for (let i = 0; i < nAnggaran; i += 1) {
      const row = isiBudget + i;
      const srcRow = i + 2; // +2: header baris 1 di Anggaran, data mulai baris 2
      const a = `='${ANGGARAN_SHEET_NAME}'!A${srcRow}`;
      const b = `='${ANGGARAN_SHEET_NAME}'!B${srcRow}`;
      const c = `=IFERROR(SUMPRODUCT((${maya.KATEGORI}=A${row})*(${maya.BULAN}=${selBulanTerkini})*(${kol('E')}))${S}0)`;
      const selisih = `=IF(B${row}=""${S}""${S}B${row}-C${row})`;
      const persen = `=IF(OR(B${row}=""${S}B${row}=0)${S}""${S}C${row}/B${row})`;
      const status = `=IF(B${row}=""${S}""${S}IF(C${row}<=B${row}${S}"✅ Sesuai anggaran"${S}"⚠️ Melebihi anggaran"))`;
      rumusBudget.push([a, b, c, selisih, persen, status]);
    }
    d.getRange(isiBudget, 1, rumusBudget.length, 6).setFormulas(rumusBudget);
    akhirBudget = isiBudget + nAnggaran - 1;
    d.getRange(`B${isiBudget}:D${akhirBudget}`).setNumberFormat(RP);
    d.getRange(`E${isiBudget}:E${akhirBudget}`).setNumberFormat('0.0%');
    rentangNetFull.push(d.getRange(`D${isiBudget}:D${akhirBudget}`));
  } else {
    d.getRange(isiBudget, 1).setValue('Belum ada kategori pengeluaran — isi Target Bulanan di tab Anggaran.');
  }
  rentang.push([mulaiBudget, akhirBudget]);
  r = akhirBudget + 2;

  d.setFrozenRows(1);

  /* ---------- Heatmap (gradien) + Selisih anggaran (hijau/merah) ---------- */
  const aturanFull = [
    SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint('#ffffff').setGradientMaxpoint(MERAH)
      .setRanges(rentangHeatmap).build(),
  ];
  if (rentangNetFull.length) {
    aturanFull.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThan(0).setFontColor(HIJAU).setBold(true).setRanges(rentangNetFull).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThan(0).setFontColor(MERAH).setBold(true).setRanges(rentangNetFull).build(),
    );
  }
  d.setConditionalFormatRules(aturanFull);

  /* ---------- Grafik: top kategori pengeluaran ---------- */
  const grafikKategori = d.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(d.getRange(`A${isiRanking}:A${akhirRanking}`))
    .addRange(d.getRange(`B${isiRanking}:B${akhirRanking}`))
    .setPosition(4, kolomGrafik, 0, 0)
    .setOption('title', 'Top Kategori Pengeluaran')
    .setOption('legend', { position: 'none' })
    .setOption('width', 520).setOption('height', 320)
    .build();
  d.insertChart(grafikKategori);

  return { jangkar, rentang };
}

/**
 * Tab input pengguna untuk target anggaran bulanan per kategori. Dibuat
 * sekali, lalu HANYA ditambah baris kategori baru yang belum ada — kolom
 * Target Bulanan/Catatan yang diketik pengguna tidak pernah disentuh, dan
 * baris yang sudah ada tidak pernah diurutkan ulang atau dihapus. Mengikuti
 * pola penjaga yang sama seperti arsipkan()/ARSIP_SHEET_NAME: tab yang
 * menyimpan sesuatu milik pengguna tidak boleh ikut siklus bangun-ulang
 * Dashboard/Dashboard Full.
 */
function pastikanAnggaran(ss, stat) {
  let a = ss.getSheetByName(ANGGARAN_SHEET_NAME);
  if (!a) {
    a = ss.insertSheet(ANGGARAN_SHEET_NAME, ss.getNumSheets());
    a.appendRow(['Kategori', 'Target Bulanan', 'Catatan']);
    a.setFrozenRows(1);
    a.getRange(1, 1, 1, 3)
      .setFontWeight('bold').setFontColor('#ffffff').setBackground(BIRU_TUA)
      .setVerticalAlignment('middle');
    a.setColumnWidth(1, 220);
    a.setColumnWidth(2, 150);
    a.setColumnWidth(3, 280);
    // Sheet baru berukuran default (biasanya 1000 baris) — memformat sampai
    // baris 1001 melempar "Kolom/baris tersebut melampaui batas" seperti yang
    // dijaga di seluruh berkas ini. Diformat sampai baris TERAKHIR yang
    // sungguh ada, bukan angka tetap.
    a.getRange(2, 2, Math.max(a.getMaxRows() - 1, 1), 1).setNumberFormat(RP);
    a.setTabColor('#e69138');
  }

  const last = a.getLastRow();
  const adaKategori = last > 1
    ? a.getRange(2, 1, last - 1, 1).getValues().map((row) => String(row[0] || '').trim())
    : [];
  const sudahAda = new Set(adaKategori.filter(Boolean));
  const baru = (stat.kategoriKeluarNama || []).filter((k) => !sudahAda.has(k));
  if (baru.length) {
    a.getRange(a.getLastRow() + 1, 1, baru.length, 1).setValues(baru.map((k) => [k]));
  }
}

/**
 * Tab pencarian transaksi, dibuat sekali dan TIDAK PERNAH dibangun ulang
 * otomatis — mengulang pembangunan akan menghapus kata kunci yang sedang
 * diketik pengguna di sel input. Hasilnya lewat FILTER, bukan QUERY: kata
 * kunci pengguna dibandingkan lewat rujukan SEL ($B$2, dst.), bukan
 * disisipkan ke dalam teks rumus — menghindari kelas bug yang sama dengan
 * label rekening ber-apostrof (lihat catatan (3) di kepala berkas): kata
 * kunci berisi tanda kutip pun tidak akan memecah rumusnya.
 */
function pastikanCariTransaksi(ss) {
  if (ss.getSheetByName(CARI_TRANSAKSI_SHEET_NAME)) return;

  const S = pisahArgumen(ss);
  const AS = S === ',' ? ',' : '\\';
  const kol = (huruf) => `'${DATA_SHEET_NAME}'!${huruf}2:${huruf}`;
  const maya = kolomMaya(kol, S);

  const c = ss.insertSheet(CARI_TRANSAKSI_SHEET_NAME, ss.getNumSheets());
  c.setColumnWidth(1, 220);
  c.setColumnWidths(2, 6, 150);
  c.setTabColor('#673ab7');

  c.getRange('A1:C1').merge().setValue('CARI TRANSAKSI')
    .setFontSize(14).setFontWeight('bold').setFontColor(BIRU_TUA)
    .setVerticalAlignment('middle');
  c.setRowHeight(1, 34);

  const label = (baris, teks) => c.getRange(baris, 1).setValue(teks).setFontWeight('bold');
  label(2, 'Kata kunci deskripsi:');
  label(3, 'Kategori (kosongkan = semua):');
  label(4, 'Rekening (kosongkan = semua):');
  label(5, 'Dari tanggal (kosongkan = semua):');
  label(6, 'Sampai tanggal (kosongkan = semua):');
  c.getRange('B5').setNumberFormat('yyyy-mm-dd');
  c.getRange('B6').setNumberFormat('yyyy-mm-dd');
  c.getRange('B2:B6').setBackground('#fff3e0');

  const headerRow = 8;
  ['Tanggal', 'Deskripsi', 'Kategori', 'Rekening', 'Nominal', 'Debit', 'Kredit']
    .forEach((teks, i) => c.getRange(headerRow, i + 1).setValue(teks));
  kepalaTabel(c, `A${headerRow}:G${headerRow}`);
  c.setFrozenRows(headerRow);

  const isi = headerRow + 1;
  const akhir = isi + MAKS_HASIL_CARI - 1;
  // Tiga filter opsional (kategori/rekening/tanggal) dipenuhi lewat pola
  // "kosong ATAU cocok": ($sel="")+(kolom=$sel)>0. Kata kunci deskripsi tidak
  // perlu pola itu — SEARCH dengan jarum kosong otomatis cocok di posisi 1
  // pada teks apa pun, jadi $B$2="" sudah otomatis meloloskan semua baris.
  c.getRange(`A${isi}`).setFormula(
    `=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER({${kol('B')}${AS}${kol('C')}${AS}${maya.KATEGORI}${AS}${maya.REK}${AS}${kol('D')}${AS}${kol('E')}${AS}${kol('F')}}${S}`
    + `ISNUMBER(SEARCH($B$2${S}${kol('C')}))`
    + `*((($B$3="")+(${maya.KATEGORI}=$B$3))>0)`
    + `*((($B$4="")+(${maya.REK}=$B$4))>0)`
    + `*((($B$5="")+(${kol('B')}>=$B$5))>0)`
    + `*((($B$6="")+(${kol('B')}<=$B$6))>0))${S}1${S}FALSE)${S}${MAKS_HASIL_CARI}${S}7)${S}`
    + `"Tidak ada transaksi cocok")`);
  c.getRange(`A${isi}:A${akhir}`).setNumberFormat('yyyy-mm-dd');
  c.getRange(`E${isi}:G${akhir}`).setNumberFormat(RP);
}

/**
 * Tab input pengguna: pola pengirim/subjek email transaksi bank. Dibuat
 * sekali, tidak pernah dibangun ulang/dihapus — sama seperti Anggaran.
 * Sengaja dibuat KOSONG: pola pengirim asli (mis. alamat noreply BCA/
 * Permata) tidak boleh ditebak lewat kode, harus diisi pengguna dari email
 * transaksi sungguhan yang mereka terima sendiri.
 */
function pastikanKonfigurasiEmail(ss) {
  if (ss.getSheetByName(KONFIGURASI_EMAIL_SHEET_NAME)) return;

  const k = ss.insertSheet(KONFIGURASI_EMAIL_SHEET_NAME, ss.getNumSheets());
  k.appendRow(['Pola Pengirim', 'Pola Subjek', 'Bank', 'Aktif']);
  k.setFrozenRows(1);
  k.getRange(1, 1, 1, 4)
    .setFontWeight('bold').setFontColor('#ffffff').setBackground(BIRU_TUA)
    .setVerticalAlignment('middle');
  k.setColumnWidths(1, 2, 220);
  k.setColumnWidth(3, 100);
  k.setColumnWidth(4, 80);
  k.getRange('A2').setValue('(isi pola pengirim/subjek email transaksi bank Anda di sini, lalu jalankan menu "Proses Email Transaksi Sekarang")');
  k.getRange('A2:D2').setFontStyle('italic').setFontColor('#999999');
  k.setTabColor('#0b8043');
}

/**
 * Tab tersembunyi berisi email transaksi mentah yang lolos klasifikasi
 * (lihat klasifikasikanEmail/pollEmailTransaksi). Mengikuti pola penjaga
 * arsipkan()/_Arsip: dibuat sekali, disembunyikan, hanya ditambah baris.
 */
function pastikanEmailMasuk(ss) {
  let m = ss.getSheetByName(EMAIL_MASUK_SHEET_NAME);
  if (!m) {
    m = ss.insertSheet(EMAIL_MASUK_SHEET_NAME, ss.getNumSheets());
    m.appendRow(HEADER_EMAIL_MASUK);
    m.setFrozenRows(1);
    m.hideSheet();
  }
  return m;
}

/**
 * Tab transit hasil parse email transaksi. Dibuat sekali; ditulis terus
 * lewat pollEmailTransaksi(), tidak ada kolom yang diketik manual pengguna
 * di sini (beda dari Anggaran/Konfigurasi Email) jadi tidak perlu penjaga
 * non-destruktif — cukup create-once seperti _EmailMasuk.
 */
function pastikanTransaksiEmail(ss) {
  let t = ss.getSheetByName(TRANSAKSI_EMAIL_SHEET_NAME);
  if (!t) {
    t = ss.insertSheet(TRANSAKSI_EMAIL_SHEET_NAME, ss.getNumSheets());
    t.appendRow(HEADER_TRANSAKSI_EMAIL);
    t.setFrozenRows(1);
    t.getRange(1, 1, 1, HEADER_TRANSAKSI_EMAIL.length)
      .setFontWeight('bold').setFontColor('#ffffff').setBackground(BIRU_TUA)
      .setVerticalAlignment('middle');
    t.setTabColor('#0b8043');
  }
  // RRN dan Nomor Referensi WAJIB teks, bukan Number: ditemukan lewat data
  // produksi nyata bahwa Google Sheets diam-diam mengubah nilai digit-murni
  // (mis. "255515732408") jadi Number begitu ditulis lewat setValues,
  // sementara yang memuat huruf (mis. "...QRS1141733407") tetap string --
  // inkonsistensi yang bisa memutus pencocokan referensi di fase
  // rekonsiliasi nanti. Persis kelas bug yang sama yang sudah diperbaiki
  // untuk kolom "No. Rekening" tab Transaksi (lihat getSheet()).
  //
  // SENGAJA DI LUAR blok "tab belum ada" di atas: tab ini sudah lebih dulu
  // dibuat pengguna sebelum perbaikan ini ada, dan format yang cuma
  // dipasang saat pembuatan TIDAK PERNAH sampai ke tab yang sudah telanjur
  // ada -- persis kesalahan yang sama yang pernah terjadi pada bendera
  // migrasi kata kunci kategori (lihat migrasiKataKunciBawaanV2 di
  // src/data/migrasi.js).
  //
  // Rentangnya dibatasi ke BARIS TERISI SEKARANG (getLastRow), BUKAN
  // getMaxRows() -- percobaan pertama memakai getMaxRows() dan langsung
  // memformat ~1000 baris kosong tiap kali fungsi ini dipanggil, yang
  // artinya tab ini tampak berisi ~1000 baris begitu dibuka padahal
  // datanya cuma segelintir. Baris yang baru ditambahkan SETELAH
  // pemanggilan ini (dalam siklus poll yang sama) baru ikut diformat pada
  // pemanggilan berikutnya -- jeda kosmetik satu putaran, bukan soal
  // kebenaran data (terbukti dari data produksi: nilai yang sempat jadi
  // Number kembali jadi teks begitu putaran berikutnya berjalan).
  t.getRange(2, 10, Math.max(t.getLastRow() - 1, 1), 2).setNumberFormat('@');
  return t;
}

/**
 * Tab audit ringan untuk pollEmailTransaksi() -- lihat catatLogEmail()/
 * perluDicatatLogEmail(). Dibuat sekali, hanya ditambah baris, tidak ada
 * kolom yang diketik manual pengguna -- sama seperti Transaksi Email.
 */
function pastikanLogEmail(ss) {
  let t = ss.getSheetByName(LOG_EMAIL_SHEET_NAME);
  if (!t) {
    t = ss.insertSheet(LOG_EMAIL_SHEET_NAME, ss.getNumSheets());
    t.appendRow(HEADER_LOG_EMAIL);
    t.setFrozenRows(1);
    t.getRange(1, 1, 1, HEADER_LOG_EMAIL.length)
      .setFontWeight('bold').setFontColor('#ffffff').setBackground(BIRU_TUA)
      .setVerticalAlignment('middle');
    t.setTabColor('#0b8043');
  }
  return t;
}

/**
 * Peta nama bulan ke indeks 0-11 — memuat SINGKATAN INDONESIA dan INGGRIS
 * sekaligus (mis. "Agu"/"Aug", "Okt"/"Oct", "Des"/"Dec") karena sample email
 * BCA dan Permata yang jadi acuan parser ini masing-masing memakai singkatan
 * yang berbeda ("11 Sep 2026" vs "24 Aug 2026") — tidak bisa diasumsikan
 * satu bank selalu satu bahasa.
 */
const BULAN_MAP = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MEI: 4, MAY: 4, JUN: 5, JUL: 6,
  AGU: 7, AUG: 7, SEP: 8, OKT: 9, OCT: 9, NOV: 10, DES: 11, DEC: 11,
};

/**
 * Ambil nilai satu field "Label : Nilai" dari isi email. Dicari lewat
 * regex per-label (bukan pemisahan baris generik) supaya tahan terhadap
 * spasi/perataan yang mungkin berubah saat HTML email dikonversi jadi teks
 * polos oleh getPlainBody() — hal yang tidak bisa dipastikan persis dari
 * tangkapan layar saja. `\s*` sengaja dipakai di kedua sisi ":" (bukan satu
 * spasi tetap), dan value cuma berhenti di batas baris supaya "Jam : 10:13:35"
 * (nilai yang sendiri memuat ":") tidak ikut terpotong di titik dua pertama.
 *
 * FUNGSI MURNI — string masuk, string keluar, tidak menyentuh GmailApp.
 */
function ekstrakField(body, label) {
  const labelAman = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(labelAman + '\\s*:\\s*([^\\r\\n]*)', 'i');
  const m = String(body || '').match(re);
  return m ? m[1].trim() : '';
}

/** "IDR 99,000.00" / "IDR 11,000,000" -> 99000 / 11000000 (integer rupiah). */
function parseNominalIDR(teks) {
  const bersih = String(teks || '').replace(/[^0-9.,]/g, '').replace(/,/g, '');
  if (!bersih) return null;
  const angka = parseFloat(bersih);
  return isNaN(angka) ? null : Math.round(angka);
}

/** "11 Sep 2026 13:53:28" (tanggal+jam dalam satu field) -> Date, atau null. */
function parseTanggalJamGabungan(teks) {
  const m = String(teks || '').match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const bulan = BULAN_MAP[m[2].toUpperCase().slice(0, 3)];
  if (bulan === undefined) return null;
  return new Date(Number(m[3]), bulan, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
}

/** Tanggal ("24 Aug 2026") dan jam ("10:13:35") di field terpisah -> Date, atau null. */
function parseTanggalJamTerpisah(tgl, jam) {
  const m = String(tgl || '').match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (!m) return null;
  const bulan = BULAN_MAP[m[2].toUpperCase().slice(0, 3)];
  if (bulan === undefined) return null;
  const j = String(jam || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const jj = j ? Number(j[1]) : 0;
  const mm = j ? Number(j[2]) : 0;
  const ss = j && j[3] ? Number(j[3]) : 0;
  return new Date(Number(m[3]), bulan, Number(m[1]), jj, mm, ss);
}

/** Versi parser dicatat per hasil parse — lihat HEADER_TRANSAKSI_EMAIL. */
const PARSER_VERSION_BCA = 'bca-v1';
const PARSER_VERSION_PERMATA = 'permata-v1';

/**
 * Parser email BCA ("Internet Transaction Journal"). Dibangun dari SAMPLE
 * ASLI pengguna, bukan tebakan format — dua template sejauh ini, dibedakan
 * lewat field pembeda yang ada di masing-masing:
 *   - "Jenis Transaksi" -> notifikasi pembayaran (QRIS/kartu, uang keluar).
 *   - "Jenis Transfer" -> transfer ke sesama rekening BCA (ditemukan lewat
 *     verifikasi produksi pengguna, bukan sample yang diminta duluan --
 *     teks aslinya tertangkap apa adanya di _EmailMasuk sebelum parser ini
 *     ada, jadi dipakai langsung, bukan ditebak).
 * Template BCA lain (transfer masuk, dsb.) belum tentu berbagi field yang
 * sama dan akan gagal parse sampai sample/teks aslinya tersedia
 * (parsedOk:false, bukan hasil yang salah tebak).
 *
 * FUNGSI MURNI.
 */
function parseEmailBCA(bodyText) {
  const body = String(bodyText || '');
  if (ekstrakField(body, 'Jenis Transaksi')) return parseEmailBCAPembayaran(body);
  if (ekstrakField(body, 'Jenis Transfer')) return parseEmailBCATransferSesamaBCA(body);
  return { parsedOk: false, error: 'Template email BCA tidak dikenali (bukan notifikasi pembayaran maupun transfer sesama BCA)' };
}

/** Sub-template: notifikasi pembayaran myBCA (QRIS/kartu). */
function parseEmailBCAPembayaran(body) {
  const tanggalTransaksi = ekstrakField(body, 'Tanggal Transaksi');
  const jenisTransaksi = ekstrakField(body, 'Jenis Transaksi');
  // "Pembayaran Ke" dipakai template QRIS/kartu; template Transfer ke BCA
  // Virtual Account (mis. top-up GoPay) tidak punya field itu sama sekali,
  // tapi punya "Nama Perusahaan/Produk" yang secara konsep sama -- siapa
  // yang menerima dana. Ditemukan lewat verifikasi produksi (email VA
  // GoPay Topup gagal parse karena "Pembayaran Ke" memang tidak ada).
  const pembayaranKe = ekstrakField(body, 'Pembayaran Ke') || ekstrakField(body, 'Nama Perusahaan/Produk');
  const lokasiMerchant = ekstrakField(body, 'Lokasi Merchant');
  const pengakuisisi = ekstrakField(body, 'Pengakuisisi');
  const totalBayar = ekstrakField(body, 'Total Bayar');
  const rrn = ekstrakField(body, 'RRN');
  const nomorReferensi = ekstrakField(body, 'Nomor Referensi');

  const eventTime = parseTanggalJamGabungan(tanggalTransaksi);
  const amount = parseNominalIDR(totalBayar);

  // PRD §11.6: jangan hasilkan transaksi "valid" kalau field minimumnya
  // sendiri tidak ketemu -- lebih baik parsedOk:false yang jelas daripada
  // baris setengah terisi yang terlihat sah.
  if (!eventTime || !amount || !pembayaranKe) {
    return { parsedOk: false, error: 'Field minimum (tanggal transaksi/nominal/merchant) tidak ditemukan di isi email' };
  }

  return {
    parsedOk: true,
    bank: 'BCA',
    eventTime,
    amount,
    direction: 'debit', // template ini khusus notifikasi pembayaran (uang keluar)
    merchantRaw: pembayaranKe.replace(/,\s*$/, ''),
    jenisTransaksi: jenisTransaksi || null,
    acquirer: pengakuisisi || null,
    location: lokasiMerchant || null,
    rrn: rrn || null,
    refNo: nomorReferensi || null,
    parserVersion: PARSER_VERSION_BCA,
    confidence: 'high',
  };
}

/** Sub-template: transfer ke sesama rekening BCA (bukan pembayaran merchant). */
function parseEmailBCATransferSesamaBCA(body) {
  const tanggalTransaksi = ekstrakField(body, 'Tanggal Transaksi');
  const jenisTransfer = ekstrakField(body, 'Jenis Transfer');
  const namaPenerima = ekstrakField(body, 'Nama Penerima');
  const nominalTujuan = ekstrakField(body, 'Nominal Tujuan');
  const nomorReferensi = ekstrakField(body, 'Nomor Referensi');

  const eventTime = parseTanggalJamGabungan(tanggalTransaksi);
  const amount = parseNominalIDR(nominalTujuan);

  if (!eventTime || !amount || !namaPenerima) {
    return { parsedOk: false, error: 'Field minimum (tanggal transaksi/nominal tujuan/nama penerima) tidak ditemukan di isi email' };
  }

  return {
    parsedOk: true,
    bank: 'BCA',
    eventTime,
    amount,
    direction: 'debit', // transfer KELUAR ke rekening BCA lain
    merchantRaw: namaPenerima,
    jenisTransaksi: jenisTransfer || null,
    acquirer: null,
    location: null,
    rrn: null, // template ini tidak menyertakan RRN
    refNo: nomorReferensi || null,
    parserVersion: PARSER_VERSION_BCA,
    confidence: 'high',
  };
}

/**
 * Parser email "Transfer - Other Bank BI-FAST" Permata ME. Dibangun dari
 * SAMPLE ASLI pengguna. Cakupan MVP: template transfer KELUAR antar bank
 * lewat BI-FAST sesuai contoh -- template Permata lain (transfer sesama
 * bank, notifikasi masuk, dsb.) belum tentu berbagi field yang sama.
 *
 * FUNGSI MURNI.
 */
function parseEmailPermata(bodyText) {
  const body = String(bodyText || '');
  const tanggal = ekstrakField(body, 'Tanggal');
  const jam = ekstrakField(body, 'Jam');
  const kategori = ekstrakField(body, 'Kategori');
  const namaPenerima = ekstrakField(body, 'Nama Penerima');
  const nominal = ekstrakField(body, 'Nominal');
  const nomorReferensi = ekstrakField(body, 'Nomor referensi transaksi');

  const eventTime = parseTanggalJamTerpisah(tanggal, jam);
  const amount = parseNominalIDR(nominal);

  if (!eventTime || !amount) {
    return { parsedOk: false, error: 'Field minimum (tanggal/jam/nominal) tidak ditemukan di isi email' };
  }

  return {
    parsedOk: true,
    bank: 'Permata',
    eventTime,
    amount,
    direction: 'debit', // template ini khusus transfer KELUAR (Rekening Asal -> Rekening Tujuan)
    merchantRaw: namaPenerima || null,
    jenisTransaksi: kategori || null,
    acquirer: null,
    location: null,
    rrn: null,
    refNo: nomorReferensi || null,
    parserVersion: PARSER_VERSION_PERMATA,
    confidence: 'high',
  };
}

/** Dispatch parser berdasarkan nama bank dari Konfigurasi Email. */
function parseEmailBerdasarkanBank(bank, bodyText) {
  if (bank === 'BCA') return parseEmailBCA(bodyText);
  if (bank === 'Permata') return parseEmailPermata(bodyText);
  return { parsedOk: false, error: `Parser untuk bank "${bank}" belum tersedia` };
}

/**
 * Klasifikasi satu email: transaction_email (cocok pola aktif di
 * Konfigurasi Email), non_transaction (subjek memuat kata kecuali — PRD
 * §10.2), atau unknown (tidak cocok pola mana pun, mungkin format bank yang
 * belum dikenal — sengaja TIDAK dianggap non_transaction, lihat
 * pollEmailTransaksi soal kenapa ini penting untuk idempotensi).
 *
 * FUNGSI MURNI — tidak menyentuh GmailApp/Sheets sama sekali, supaya bisa
 * diuji tanpa email sungguhan (mengikuti disiplin pure/impure split yang
 * sudah dipakai di seluruh berkas ini, mis. tujuan()/statistikData()).
 *
 * @param {string} dari header "From" email
 * @param {string} subjek header "Subject" email
 * @param {Array<{polaPengirim:string, polaSubjek:string, bank:string, aktif:boolean}>} konfigurasi
 * @returns {{outcome:'transaction_email'|'non_transaction'|'unknown', bank:?string}}
 */
function klasifikasikanEmail(dari, subjek, konfigurasi) {
  const dariU = String(dari || '').toUpperCase();
  const subjekU = String(subjek || '').toUpperCase();

  if (KATA_KECUALI_EMAIL.some((kw) => subjekU.indexOf(kw) !== -1)) {
    return { outcome: 'non_transaction', bank: null };
  }

  const cocok = (konfigurasi || []).find((baris) => {
    if (baris.aktif === false) return false;
    const polaPengirim = String(baris.polaPengirim || '').trim();
    const polaSubjek = String(baris.polaSubjek || '').trim();
    if (!polaPengirim && !polaSubjek) return false;
    const pengirimCocok = !polaPengirim || dariU.indexOf(polaPengirim.toUpperCase()) !== -1;
    const subjekCocok = !polaSubjek || subjekU.indexOf(polaSubjek.toUpperCase()) !== -1;
    return pengirimCocok && subjekCocok;
  });

  if (cocok) return { outcome: 'transaction_email', bank: cocok.bank || null };
  return { outcome: 'unknown', bank: null };
}

/**
 * Ambil pola aktif dari tab Konfigurasi Email sebagai array biasa, siap
 * dipakai klasifikasikanEmail(). Terpisah dari pollEmailTransaksi() supaya
 * pemanggilan Sheets (impure) tidak bercampur dengan logika klasifikasi
 * (murni) di satu fungsi yang sama.
 */
function bacaKonfigurasiEmail(ss) {
  const sh = ss.getSheetByName(KONFIGURASI_EMAIL_SHEET_NAME);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last <= 1) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues()
    .filter((r) => String(r[0] || '').trim() || String(r[1] || '').trim())
    .map((r) => ({ polaPengirim: r[0], polaSubjek: r[1], bank: r[2], aktif: r[3] !== false }));
}

/**
 * Fragmen query Gmail "(from:a OR from:b OR ...)" dari pola pengirim aktif
 * di Konfigurasi Email -- BUKAN sekadar optimisasi, ini root fix untuk
 * pollEmailTransaksi()/jalankanBackfillEmail() yang bisa mandek total.
 *
 * Tanpa pembatasan ini, GmailApp.search menyisir SELURUH kotak masuk
 * pengguna, dan email non-bank apa pun (pribadi, notifikasi lain, dst.)
 * diklasifikasi 'unknown' oleh klasifikasikanEmail() -- thread 'unknown'
 * SENGAJA tidak pernah diberi label (lihat prosesThreadEmailTransaksi,
 * `semuaTuntas = false`) supaya bisa sembuh sendiri kalau pola dilengkapi.
 * Konsekuensi yang tidak disadari: thread itu terus muncul lagi di setiap
 * pencarian berikutnya dan memakan kuota MAKS_THREAD_.../PER_JALAN tanpa
 * membuat kemajuan sama sekali -- persis penyebab backfill yang mentok di
 * tengah jalan (ditemukan lewat verifikasi produksi: 300 thread diperiksa
 * tapi cuma segelintir email baru, tiga jalan berturut-turut, karena
 * hampir seluruh kuota terpakai memeriksa ulang email pribadi pengguna
 * yang sama yang tidak pernah bisa berlabel).
 *
 * Kalau ADA baris aktif dengan polaPengirim KOSONG (aturan yang sengaja
 * mencocokkan pengirim apa pun berdasar pola subjek saja), fungsi ini
 * mengembalikan '' (tanpa pembatasan sama sekali) -- membatasi pengirim di
 * sisi Gmail akan diam-diam mematahkan jangkauan aturan semacam itu.
 */
function bangunQueryPengirimGmail(konfigurasi) {
  const aktif = (konfigurasi || []).filter((k) => k.aktif !== false);
  if (aktif.some((k) => !String(k.polaPengirim || '').trim())) return '';
  const pola = [...new Set(aktif.map((k) => String(k.polaPengirim).trim()))];
  if (!pola.length) return '';
  return `(${pola.map((p) => `from:${p}`).join(' OR ')})`;
}

/**
 * Poll Gmail untuk email transaksi baru. Dipanggil manual lewat menu
 * "Proses Email Transaksi Sekarang" (verifikasi sebelum trigger otomatis
 * dipasang — lihat rencana implementasi) atau lewat time-driven trigger
 * setelah tahap itu lulus.
 *
 * Idempotensi lewat label Gmail LABEL_EMAIL_DIPROSES, BUKAN history_id/
 * cursor — Apps Script time-driven trigger tidak punya "watch expiration"
 * ala Pub/Sub, jadi seluruh mekanisme renewal di PRD §9.4 tidak relevan di
 * sini. Thread HANYA dilabeli kalau SEMUA pesan di dalamnya tuntas
 * diklasifikasi (transaction_email tersimpan, atau non_transaction
 * dipastikan bukan transaksi) — pesan berstatus "unknown" (format belum
 * dikenal) sengaja TIDAK menahan label, supaya begitu pengguna menambah
 * pola baru di Konfigurasi Email, email lama yang sebelumnya tak dikenal
 * ikut terjaring run berikutnya (dibatasi JENDELA_PENCARIAN_EMAIL_HARI,
 * bukan retensi tanpa batas).
 *
 * Sejak Fase 2, email yang lolos klasifikasi juga langsung diparse
 * (parseEmailBerdasarkanBank) dan hasilnya ditulis ke dua tempat: baris
 * mentah + status parse di "_EmailMasuk" (audit trail, PRD §11.6 — email
 * TETAP tersimpan walau parsing gagal), dan baris terstruktur di
 * "Transaksi Email" HANYA kalau parsing berhasil.
 *
 * Dipanggil di awal fungsi ini: reparseEmailGagal() — begitu parser
 * diperbaiki (mis. sub-template BCA baru), email lama yang sempat gagal
 * langsung "sembuh" tanpa perlu Gmail dijamah lagi. Baris yang GAGAL
 * diparse SENGAJA tidak menahan label thread di Gmail (beda dari versi
 * awal fungsi ini) supaya jelas: perbaikannya lewat reparseEmailGagal()
 * yang membaca ulang teks yang sudah tersimpan, bukan lewat unlabel/
 * refetch dari Gmail yang jauh lebih rumit untuk manfaat yang sama.
 *
 * @returns {{diproses:number, ditemukan:number, diparsing:number, diperbaiki:number, alasan:?string}}
 */
function pollEmailTransaksi() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  pastikanKonfigurasiEmail(ss);
  const emailMasuk = pastikanEmailMasuk(ss);
  const transaksiEmail = pastikanTransaksiEmail(ss);

  const diperbaiki = reparseEmailGagal().diperbaiki;

  const konfigurasi = bacaKonfigurasiEmail(ss);
  if (!konfigurasi.length) {
    const hasilKosong = { diproses: 0, ditemukan: 0, diparsing: 0, diperbaiki, alasan: 'Konfigurasi Email masih kosong — isi pola pengirim/subjek dulu.' };
    catatLogEmail(ss, hasilKosong);
    return hasilKosong;
  }

  let label = GmailApp.getUserLabelByName(LABEL_EMAIL_DIPROSES);
  if (!label) label = GmailApp.createLabel(LABEL_EMAIL_DIPROSES);

  const idSudahAda = new Set(
    emailMasuk.getLastRow() > 1
      ? emailMasuk.getRange(2, 1, emailMasuk.getLastRow() - 1, 1).getValues().map((r) => String(r[0]))
      : [],
  );

  const queryPengirim = bangunQueryPengirimGmail(konfigurasi);
  const query = `${queryPengirim} -label:"${LABEL_EMAIL_DIPROSES}" newer_than:${JENDELA_PENCARIAN_EMAIL_HARI}d`.trim();
  const threads = GmailApp.search(query, 0, MAKS_THREAD_EMAIL_PER_JALAN);

  const { barisEmailMasuk, barisTransaksiEmail, diproses, diparsing } =
    prosesThreadEmailTransaksi(threads, konfigurasi, idSudahAda, label);

  tulisHasilEmailTransaksi(emailMasuk, transaksiEmail, barisEmailMasuk, barisTransaksiEmail);

  const hasil = { diproses, ditemukan: threads.length, diparsing, diperbaiki, alasan: null };
  catatLogEmail(ss, hasil);
  return hasil;
}

/**
 * Inti klasifikasi+parsing satu kumpulan thread Gmail -- diekstrak dari
 * pollEmailTransaksi() supaya dipakai ulang APA ADANYA oleh
 * jalankanBackfillEmail() (menu "Tarik Email Lama"), bukan disalin. Kedua
 * pemanggil beda cuma pada QUERY pencarian Gmail-nya (jendela mundur
 * beberapa hari vs "sejak tanggal X"), bukan pada cara mengklasifikasi/
 * memparsing/melabeli -- jadi logikanya sendiri sengaja satu tempat.
 *
 * `idSudahAda` diubah DI TEMPAT (menambah id yang baru diproses) --
 * pemanggil sudah tahu ini karena harus membangunnya lebih dulu dari
 * _EmailMasuk yang ada.
 *
 * @returns {{barisEmailMasuk:Array, barisTransaksiEmail:Array, diproses:number, diparsing:number}}
 */
function prosesThreadEmailTransaksi(threads, konfigurasi, idSudahAda, label) {
  const barisEmailMasuk = [];
  const barisTransaksiEmail = [];
  let diproses = 0;
  let diparsing = 0;

  threads.forEach((thread) => {
    let semuaTuntas = true;
    thread.getMessages().forEach((msg) => {
      const id = msg.getId();
      if (idSudahAda.has(id)) return;

      const hasil = klasifikasikanEmail(msg.getFrom(), msg.getSubject(), konfigurasi);
      if (hasil.outcome === 'transaction_email') {
        const isiPenuh = msg.getPlainBody();
        const isiDipotong = isiPenuh.slice(0, BATAS_ISI_EMAIL);
        const parsed = parseEmailBerdasarkanBank(hasil.bank, isiPenuh);

        barisEmailMasuk.push([
          id, hasil.bank || '', msg.getFrom(), msg.getSubject(), msg.getDate(), isiDipotong,
          parsed.parsedOk, parsed.parsedOk ? '' : (parsed.error || 'Gagal diparse'), new Date(),
        ]);
        idSudahAda.add(id);
        diproses += 1;

        if (parsed.parsedOk) {
          barisTransaksiEmail.push([
            id, parsed.bank, parsed.eventTime, parsed.amount, parsed.direction,
            parsed.merchantRaw || '', parsed.jenisTransaksi || '', parsed.acquirer || '',
            parsed.location || '', parsed.rrn || '', parsed.refNo || '',
            parsed.parserVersion || '', parsed.confidence || '', new Date(),
          ]);
          diparsing += 1;
        }
      } else if (hasil.outcome === 'unknown') {
        semuaTuntas = false;
      }
      // non_transaction: dianggap tuntas, tidak menahan label thread.
    });
    if (semuaTuntas) thread.addLabel(label);
  });

  return { barisEmailMasuk, barisTransaksiEmail, diproses, diparsing };
}

/** Tulis hasil prosesThreadEmailTransaksi() ke kedua tab -- dipakai ulang oleh backfill. */
function tulisHasilEmailTransaksi(emailMasuk, transaksiEmail, barisEmailMasuk, barisTransaksiEmail) {
  if (barisEmailMasuk.length) {
    emailMasuk.getRange(emailMasuk.getLastRow() + 1, 1, barisEmailMasuk.length, HEADER_EMAIL_MASUK.length)
      .setValues(barisEmailMasuk);
  }
  if (barisTransaksiEmail.length) {
    transaksiEmail.getRange(transaksiEmail.getLastRow() + 1, 1, barisTransaksiEmail.length, HEADER_TRANSAKSI_EMAIL.length)
      .setValues(barisTransaksiEmail);
  }
}

/**
 * Batas thread per jalan BACKFILL -- jauh lebih besar dari
 * MAKS_THREAD_EMAIL_PER_JALAN karena ini dipanggil manual sesekali (bukan
 * tiap 5 menit oleh trigger), tapi tetap dibatasi supaya satu klik menu
 * tidak melebihi batas eksekusi Apps Script (~6 menit di akun pribadi).
 * Kalau riwayat Gmail-nya lebih banyak dari ini, pengguna cukup menekan
 * menu yang sama lagi -- thread yang sudah diberi label dilewati otomatis
 * lewat query `-label:...`, jadi aman diulang.
 */
const MAKS_THREAD_BACKFILL_PER_JALAN = 300;

/**
 * Menu "Tarik Email Lama (Backfill)" -- untuk email transaksi yang SUDAH
 * ADA di Gmail sebelum pemantauan otomatis dipasang (mis. transaksi dari
 * awal tahun). Beda dari pollEmailTransaksi() yang sengaja membatasi
 * pencarian ke JENDELA_PENCARIAN_EMAIL_HARI hari terakhir supaya polling
 * tiap 5 menit tetap murah -- riwayat lama butuh sekali jalan yang jauh
 * lebih luas, jadi dipisah jadi fungsi sendiri dan TIDAK pernah dipanggil
 * trigger otomatis.
 */
function backfillEmailTransaksi() {
  const ui = SpreadsheetApp.getUi();
  const jawab = ui.prompt(
    'Tarik Email Lama (Backfill)',
    'Tarik email transaksi sejak tanggal berapa? Format: YYYY-MM-DD (mis. 2026-01-01)',
    ui.ButtonSet.OK_CANCEL,
  );
  if (jawab.getSelectedButton() !== ui.Button.OK) return;

  const sejakTanggal = jawab.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sejakTanggal)) {
    ui.alert('Format tanggal salah. Gunakan YYYY-MM-DD, misalnya 2026-01-01.');
    return;
  }

  const hasil = jalankanBackfillEmail(sejakTanggal);
  if (hasil.alasan) {
    ui.alert('Tarik Email Lama (Backfill)', hasil.alasan, ui.ButtonSet.OK);
    return;
  }

  const lanjutan = hasil.masihAda
    ? ` Masih ada thread yang belum diperiksa (batas ${MAKS_THREAD_BACKFILL_PER_JALAN} per jalan) -- `
      + 'jalankan menu ini sekali lagi dengan tanggal yang SAMA untuk melanjutkan; '
      + 'thread yang sudah diberi label dilewati otomatis, jadi aman diulang.'
    : ' Seluruh thread sejak tanggal itu sudah diperiksa.';
  ui.alert(
    'Tarik Email Lama (Backfill)',
    `${hasil.diproses} email transaksi baru disimpan (dari ${hasil.ditemukan} thread diperiksa sejak ${sejakTanggal}), `
      + `${hasil.diparsing} berhasil diparse.${lanjutan}`,
    ui.ButtonSet.OK,
  );
}

/**
 * Inti backfill, dipisah dari menu-nya (backfillEmailTransaksi) supaya bisa
 * diuji lewat harness Code.gs tanpa SpreadsheetApp.getUi() sungguhan.
 *
 * @param {string} sejakTanggal format 'YYYY-MM-DD'
 * @returns {{diproses:number, ditemukan:number, diparsing:number, masihAda:boolean, alasan:?string}}
 */
function jalankanBackfillEmail(sejakTanggal) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  pastikanKonfigurasiEmail(ss);
  const emailMasuk = pastikanEmailMasuk(ss);
  const transaksiEmail = pastikanTransaksiEmail(ss);

  const konfigurasi = bacaKonfigurasiEmail(ss);
  if (!konfigurasi.length) {
    const hasilKosong = {
      diproses: 0, ditemukan: 0, diparsing: 0, masihAda: false,
      alasan: 'Konfigurasi Email masih kosong — isi pola pengirim/subjek dulu.',
    };
    return hasilKosong;
  }

  let label = GmailApp.getUserLabelByName(LABEL_EMAIL_DIPROSES);
  if (!label) label = GmailApp.createLabel(LABEL_EMAIL_DIPROSES);

  const idSudahAda = new Set(
    emailMasuk.getLastRow() > 1
      ? emailMasuk.getRange(2, 1, emailMasuk.getLastRow() - 1, 1).getValues().map((r) => String(r[0]))
      : [],
  );

  // Gmail menerima format tanggal YYYY/MM/DD pada operator "after:", bukan
  // YYYY-MM-DD yang diminta lewat prompt (lebih akrab utk pengguna Indonesia).
  const queryPengirim = bangunQueryPengirimGmail(konfigurasi);
  const query = `${queryPengirim} -label:"${LABEL_EMAIL_DIPROSES}" after:${sejakTanggal.replace(/-/g, '/')}`.trim();
  const threads = GmailApp.search(query, 0, MAKS_THREAD_BACKFILL_PER_JALAN);

  const { barisEmailMasuk, barisTransaksiEmail, diproses, diparsing } =
    prosesThreadEmailTransaksi(threads, konfigurasi, idSudahAda, label);

  tulisHasilEmailTransaksi(emailMasuk, transaksiEmail, barisEmailMasuk, barisTransaksiEmail);

  const masihAda = threads.length === MAKS_THREAD_BACKFILL_PER_JALAN;
  catatLogEmail(ss, {
    diproses, ditemukan: threads.length, diparsing, diperbaiki: 0,
    alasan: `Backfill sejak ${sejakTanggal}${masihAda ? ' (masih berlanjut)' : ' (selesai)'}`,
  });

  return { diproses, ditemukan: threads.length, diparsing, masihAda, alasan: null };
}

/**
 * Fungsi murni: satu baris log dari hasil pollEmailTransaksi() (lihat bentuk
 * di komentar fungsi itu). Dipisah dari catatLogEmail() supaya bisa diuji
 * tanpa Sheets sungguhan -- termasuk perhitungan "Gagal Diparse" (diproses
 * dikurangi diparsing) yang tidak dihitung eksplisit oleh pollEmailTransaksi.
 */
function bangunBarisLogEmail(hasil) {
  const gagal = Math.max((hasil.diproses || 0) - (hasil.diparsing || 0), 0);
  return [
    new Date(),
    hasil.ditemukan || 0,
    hasil.diproses || 0,
    hasil.diparsing || 0,
    gagal,
    hasil.diperbaiki || 0,
    hasil.alasan || '',
  ];
}

/**
 * Fungsi murni: apakah satu jalan pollEmailTransaksi() layak dicatat.
 *
 * Trigger otomatis jalan tiap 5 menit (JEDA_PEMANTAUAN_EMAIL_MENIT) --
 * mencatat SETIAP jalan, termasuk yang tidak menemukan email baru sama
 * sekali, akan membanjiri tab ini dengan puluhan ribu baris kosong per
 * tahun tanpa nilai audit apa pun. Hanya jalan yang benar-benar melakukan
 * sesuatu (email baru diproses, perbaikan reparse, atau gagal dengan
 * alasan jelas seperti Konfigurasi Email kosong) yang layak satu baris.
 */
function perluDicatatLogEmail(hasil) {
  return Boolean(hasil.diproses || hasil.diperbaiki || hasil.alasan);
}

/** Impure: tulis satu baris log kalau layak (lihat perluDicatatLogEmail). */
function catatLogEmail(ss, hasil) {
  if (!perluDicatatLogEmail(hasil)) return;
  pastikanLogEmail(ss).appendRow(bangunBarisLogEmail(hasil));
}

/**
 * Coba parse ulang baris "_EmailMasuk" yang sebelumnya gagal (Berhasil
 * Diparse = FALSE), memakai teks yang SUDAH TERSIMPAN — tidak menyentuh
 * Gmail sama sekali. Ini jalan pulang begitu parseEmailBerdasarkanBank()
 * diperbaiki (mis. sub-template baru ditambahkan): email lama yang sempat
 * gagal ikut "sembuh" pada Proses Email Transaksi Sekarang berikutnya,
 * tanpa perlu mekanisme unlabel/refetch dari Gmail yang jauh lebih rumit
 * untuk manfaat yang sama.
 *
 * Baris yang berhasil di-reparse ditimpa DI TEMPAT (kolom Berhasil
 * Diparse/Pesan Error), bukan digandakan — dan baris "Transaksi Email"
 * baru hanya ditambahkan kalau Gmail Message ID itu belum pernah tercatat
 * di sana (jaga-jaga dipanggil dua kali).
 *
 * @returns {{diperbaiki:number}}
 */
function reparseEmailGagal() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const emailMasuk = pastikanEmailMasuk(ss);
  const transaksiEmail = pastikanTransaksiEmail(ss);

  const lastEmailMasuk = emailMasuk.getLastRow();
  if (lastEmailMasuk <= 1) return { diperbaiki: 0 };

  const data = emailMasuk.getRange(2, 1, lastEmailMasuk - 1, HEADER_EMAIL_MASUK.length).getValues();
  const idSudahDiTransaksiEmail = new Set(
    transaksiEmail.getLastRow() > 1
      ? transaksiEmail.getRange(2, 1, transaksiEmail.getLastRow() - 1, 1).getValues().map((r) => String(r[0]))
      : [],
  );

  let diperbaiki = 0;
  const barisTransaksiEmailBaru = [];
  data.forEach((row, i) => {
    const [id, bank, , , , isi, ok] = row;
    if (ok === true) return; // sudah pernah berhasil -- tidak perlu diulang
    if (idSudahDiTransaksiEmail.has(String(id))) return; // jaga dobel kalau dipanggil ulang

    const parsed = parseEmailBerdasarkanBank(bank, isi);
    if (!parsed.parsedOk) return; // masih gagal dengan parser yang berlaku sekarang, biarkan untuk lain kali

    emailMasuk.getRange(i + 2, 7, 1, 2).setValues([[true, '']]); // Berhasil Diparse, Pesan Error
    barisTransaksiEmailBaru.push([
      id, parsed.bank, parsed.eventTime, parsed.amount, parsed.direction,
      parsed.merchantRaw || '', parsed.jenisTransaksi || '', parsed.acquirer || '',
      parsed.location || '', parsed.rrn || '', parsed.refNo || '',
      parsed.parserVersion || '', parsed.confidence || '', new Date(),
    ]);
    diperbaiki += 1;
  });

  if (barisTransaksiEmailBaru.length) {
    transaksiEmail.getRange(transaksiEmail.getLastRow() + 1, 1, barisTransaksiEmailBaru.length, HEADER_TRANSAKSI_EMAIL.length)
      .setValues(barisTransaksiEmailBaru);
  }

  return { diperbaiki };
}

/**
 * Susun baris "Transaksi Email" jadi objek datar siap-JSON untuk
 * doPost{tarikTransaksiEmail}, menyaring yang "Dibuat Pada"-nya sesudah
 * `sejakValid` (null berarti tarik semua -- dipakai PWA pada pull pertama).
 *
 * Dipisah dari doPost supaya bisa diuji lewat tiruan Sheets tanpa perlu
 * mensimulasikan payload HTTP/JSON.parse sekaligus.
 *
 * @param {Sheet} t hasil pastikanTransaksiEmail(ss)
 * @param {?Date} sejakValid
 * @returns {Array<Object>}
 */
function bangunBarisTarikTransaksiEmail(t, sejakValid) {
  const last = t.getLastRow();
  const baris = [];
  if (last <= 1) return baris;

  const nilai = t.getRange(2, 1, last - 1, HEADER_TRANSAKSI_EMAIL.length).getValues();
  nilai.forEach((r) => {
    if (!r[0]) return; // baris kosong (mis. bekas rentang format tanpa data)
    const dibuatPada = r[13];
    if (sejakValid && dibuatPada instanceof Date && dibuatPada <= sejakValid) return;

    baris.push({
      gmailMessageId: String(r[0]),
      bank: r[1] || '',
      waktuTransaksi: r[2] instanceof Date ? r[2].toISOString() : r[2],
      nominal: Number(r[3]) || 0,
      arah: r[4] || '',
      merchantMentah: r[5] || '',
      jenisTransaksi: r[6] || '',
      acquirer: r[7] || '',
      lokasi: r[8] || '',
      rrn: r[9] ? String(r[9]) : null,
      nomorReferensi: r[10] ? String(r[10]) : null,
      versiParser: r[11] || '',
      confidence: r[12] || '',
      dibuatPada: dibuatPada instanceof Date ? dibuatPada.toISOString() : dibuatPada,
    });
  });
  return baris;
}

/** Menit antar pemeriksaan email otomatis. Apps Script cuma menerima 1/5/10/15/30. */
const JEDA_PEMANTAUAN_EMAIL_MENIT = 5;

/** Hapus trigger pollEmailTransaksi yang mungkin sudah terpasang -- mencegah dobel kalau menu ditekan berkali-kali. */
function hapusTriggerEmail() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'pollEmailTransaksi')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/**
 * Menu "Aktifkan Pemantauan Email Transaksi" — memasang time-driven trigger.
 * Baru aman dipasang SETELAH "Proses Email Transaksi Sekarang" manual
 * terbukti jalan benar (lihat rencana implementasi Fase 1) — otorisasi
 * Gmail pertama kali sebaiknya lewat jalur manual yang bisa diawasi
 * langsung, bukan lewat trigger yang jalan sendiri di latar belakang.
 */
function aktifkanPemantauanEmail() {
  hapusTriggerEmail();
  ScriptApp.newTrigger('pollEmailTransaksi').timeBased().everyMinutes(JEDA_PEMANTAUAN_EMAIL_MENIT).create();
  SpreadsheetApp.getUi().alert(
    'Pemantauan Email Transaksi',
    `Trigger otomatis terpasang -- email transaksi akan diperiksa tiap ${JEDA_PEMANTAUAN_EMAIL_MENIT} menit.`,
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}

/** Menu "Nonaktifkan Pemantauan Email". */
function nonaktifkanPemantauanEmail() {
  hapusTriggerEmail();
  SpreadsheetApp.getUi().alert('Pemantauan Email Transaksi', 'Trigger otomatis dihentikan.', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Menu "Proses Email Transaksi Sekarang" — jalan manual, laporkan hasilnya. */
function prosesEmailSekarang() {
  const hasil = pollEmailTransaksi();
  const ui = SpreadsheetApp.getUi();
  const perbaikanTeks = hasil.diperbaiki ? ` ${hasil.diperbaiki} email lama yang sempat gagal kini berhasil diparse ulang.` : '';
  const pesan = hasil.alasan
    ? hasil.alasan + perbaikanTeks
    : `${hasil.diproses} email transaksi baru disimpan ke tab "_EmailMasuk" (dari ${hasil.ditemukan} thread diperiksa), `
      + `${hasil.diparsing} berhasil diparse ke tab "Transaksi Email".${perbaikanTeks}`;
  ui.alert('Proses Email Transaksi', pesan, ui.ButtonSet.OK);
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
  const kosong = {
    bulan: [], rekening: [], katKeluar: 0, katMasuk: 0, bulanTerbanyak: 0, kategoriKeluarNama: [],
  };
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
    // Nama kategori (bukan cuma hitungannya) — dipakai pastikanAnggaran untuk
    // menyeeed tab Anggaran dengan kategori yang benar-benar dipakai.
    kategoriKeluarNama: Object.keys(katKeluar).sort(),
  };
}

/**
 * Sidik bentuk data — bukan isinya. Dashboard/Dashboard Full membangun blok
 * per rekening/kategori saat build, jadi jadi basi kalau ada rekening baru,
 * kategori anggaran baru, atau data memanjang melewati cadangan baris. Jumlah
 * kategori sengaja dibulatkan per 5 supaya pertumbuhan kecil yang masih muat
 * di cadangan tidak memicu pembangunan ulang terus-menerus. `anggaranBaris`
 * TIDAK dibulatkan — blok Anggaran vs Realisasi di Dashboard Full disizekan
 * PAS sejumlah baris Anggaran (tanpa cadangan), jadi satu kategori anggaran
 * baru pun harus segera memicu pembangunan ulang.
 */
function sidikData(stat, anggaranBaris) {
  return [
    stat.rekening.join('|'),
    stat.bulan.length,
    Math.ceil(stat.katKeluar / 5),
    Math.ceil(stat.katMasuk / 5),
    anggaranBaris || 0,
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
  const lamaFull = ss.getSheetByName(DASHBOARD_FULL_SHEET_NAME);
  if (lamaFull) ss.deleteSheet(lamaFull);

  sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  rapikanTampilan(sh);
  pastikanSemuaTab(ss, sh.getName());

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
  const dFull = ss.getSheetByName(DASHBOARD_FULL_SHEET_NAME);
  const anggaran = ss.getSheetByName(ANGGARAN_SHEET_NAME);
  const cari = ss.getSheetByName(CARI_TRANSAKSI_SHEET_NAME);

  const baris = [
    // Nama dan ID ditampilkan supaya bisa dicocokkan dengan spreadsheet yang
    // sedang dibuka: URL webhook yang menunjuk deployment lama bisa menulis ke
    // salinan spreadsheet yang berbeda, dan itu tampak persis seperti sukses.
    `Spreadsheet        : ${ss.getName()}`,
    `ID                 : ${ss.getId()}`,
    `Lokal spreadsheet  : ${ss.getSpreadsheetLocale()}`,
    `Pemisah argumen    : "${pisahArgumen(ss)}"`,
    `Sheet data         : ${sh ? `${sh.getName()} (posisi ${sh.getIndex()}, ${Math.max(sh.getLastRow() - 1, 0)} baris)` : '(tidak ketemu)'}`,
    `Tab Dashboard      : ${d ? `ada, posisi ${d.getIndex()}` : 'belum ada'}`,
    `Tab Dashboard Full : ${dFull ? `ada, posisi ${dFull.getIndex()}` : 'belum ada'}`,
    `Tab Anggaran       : ${anggaran ? `ada, ${Math.max(anggaran.getLastRow() - 1, 0)} kategori` : 'belum ada'}`,
    `Tab Cari Transaksi : ${cari ? 'ada' : 'belum ada'}`,
  ];
  if (d) {
    baris.push('', `[Dashboard] Dianggap rusak: ${dashboardRusak(d, jangkarRumus('selRumusDashboard')) ? 'ya' : 'tidak'}`);
    ['A1'].concat(jangkarRumus('selRumusDashboard').slice(0, 8)).forEach((a) => {
      baris.push(`${a} = ${String(d.getRange(a).getDisplayValue()).slice(0, 70)}`);
    });
  }
  if (dFull) {
    baris.push('', `[Dashboard Full] Dianggap rusak: ${dashboardRusak(dFull, jangkarRumus('selRumusDashboardFull')) ? 'ya' : 'tidak'}`);
    ['A1'].concat(jangkarRumus('selRumusDashboardFull').slice(0, 8)).forEach((a) => {
      baris.push(`${a} = ${String(dFull.getRange(a).getDisplayValue()).slice(0, 70)}`);
    });
  }
  ui.alert('Diagnosa Pembukuan', baris.join('\n'), ui.ButtonSet.OK);
}

function doPost(e) {
  const body = e.postData ? e.postData.contents : '';
  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch (err) {
    return json({ok:false, error:'Payload bukan JSON yang sah'});
  }

  // Ping dijawab SEBELUM kunci diambil, dan itu bukan kebetulan: aplikasi
  // memakainya untuk menjawab "sebenarnya berapa yang sudah mendarat?" tepat
  // setelah pengiriman putus — saat kemungkinan besar masih ada permintaan
  // panjang yang memegang kunci. Menunggu kunci di sini berarti satu-satunya
  // saat pertanyaan itu ditanyakan adalah saat ia paling mungkin tak terjawab.
  // Aman: ping hanya membaca.
  if (data.ping) {
    try {
      const ssPing = SpreadsheetApp.getActiveSpreadsheet();
      return json(Object.assign(tujuan(ssPing, getSheet()), {ok:true, ping:true}));
    } catch (err) {
      return json({ok:false, error: String(err && err.message || err)});
    }
  }

  // Tarik transaksi email juga dijawab SEBELUM kunci diambil -- sama seperti
  // ping, ini murni baca. PWA memanggilnya dengan `sejak` (checkpoint waktu
  // dari respons SEBELUMNYA, bukan jam lokal PWA sendiri, supaya tidak
  // meleset kalau jam perangkat dan jam server Apps Script berbeda) dan
  // mendapat balik baris "Transaksi Email" yang lebih baru dari itu, plus
  // `sekarang` untuk dipakai sebagai checkpoint pemanggilan berikutnya.
  if (data.tarikTransaksiEmail === true) {
    try {
      const ssTarik = SpreadsheetApp.getActiveSpreadsheet();
      const t = pastikanTransaksiEmail(ssTarik);
      const sejak = data.sejak ? new Date(data.sejak) : null;
      const sejakValid = sejak && !isNaN(sejak.getTime()) ? sejak : null;
      const baris = bangunBarisTarikTransaksiEmail(t, sejakValid);
      return json({ ok: true, baris, sekarang: new Date().toISOString() });
    } catch (err) {
      return json({ ok: false, error: String(err && err.message || err) });
    }
  }

  // Dua perangkat yang menyinkron bersamaan sama-sama melakukan baca-ubah-tulis
  // di sheet yang sama; tanpa kunci, yang satu bisa menimpa hasil yang lain.
  const kunci = LockService.getScriptLock();
  try {
    kunci.waitLock(30000);
  } catch (err) {
    return json({ok:false, error:'Sheet sedang dipakai proses lain, coba lagi sebentar'});
  }

  try {
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
    pastikanSemuaTab(ss, sh.getName());
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
    if (!nomor.length) return;

    // Satu pembacaan untuk jendela baris terkecil..terbesar, bukan satu
    // pembacaan per baris. Penyelarasan bisa membuang ratusan baris sekaligus,
    // dan `getRange` per baris berarti ratusan perjalanan bolak-balik ke Sheets
    // di dalam permintaan yang waktunya terbatas — persis pola yang membuat
    // pengiriman dulu tidak pernah selesai.
    const awal = nomor[0];
    const akhir = nomor[nomor.length - 1];
    const jendela = sh.getRange(awal, 1, akhir - awal + 1, lebar).getValues();
    const isi = nomor.map((n) => jendela[n - awal]);
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
