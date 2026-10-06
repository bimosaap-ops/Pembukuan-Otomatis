/**
 * Code.gs — tempel di Extensions > Apps Script pada Google Sheet tujuan.
 * Deploy: Deploy > New deployment > Web App > Anyone with the link > Copy URL -> tempel di Pengaturan app.
 *
 * Tab data "Transaksi": header baris 1 wajib, urutan kolom lihat HEADER.
 * Upsert berdasarkan Hash (kolom A): hash yang sudah ada DITIMPA di baris yang
 * sama, supaya koreksi kategori dari aplikasi ikut sampai ke Sheet.
 *
 * Tab yang dikelola skrip:
 *   - Dibangun ulang dari nol bila versi/bentuk data berubah atau rusak (tidak
 *     boleh ada input manual): Dashboard, Dashboard Full, Kontrol Saldo.
 *   - Dibuat sekali, tidak pernah dibangun ulang (menyimpan input pengguna):
 *     Anggaran, Cari Transaksi, Statement, Konfigurasi Email.
 *   - Dibuat lazy saat doPost pertama: Akun, Kategori (upsert per ID).
 *   - Hanya ditambah baris: _EmailMasuk, Transaksi Email, Log Email, _Arsip.
 *
 * Angka GABUNGAN mengecualikan transfer internal (kolom O); angka PER REKENING
 * tetap menghitungnya.
 *
 * Tiga aturan yang dijaga di seluruh berkas:
 *   1. Tab laporan disisipkan di posisi TERAKHIR; sheet data dicari lewat nama.
 *   2. Pemisah argumen rumus mengikuti lokal spreadsheet (lihat pisahArgumen).
 *      Di lokal Indonesia pemisahnya ";" dan pemisah kolom array "\". Rumus
 *      yang salah pemisah jadi #ERROR!, yang tidak bisa ditangkap IFERROR.
 *   3. Grid dilebarkan/ditinggikan SEBELUM sel mana pun disentuh; sel di luar
 *      grid melempar dan membatalkan seluruh pembangunan. Label rekening tidak
 *      pernah disisipkan ke string QUERY (apostrof memecah rumus).
 */
const DATA_SHEET_NAME = 'Transaksi';
const DASHBOARD_SHEET_NAME = 'Dashboard';
/** Tab ranking kategori & anggaran, dibangun kode sejak versi 9 — lihat bangunDashboardFull(). */
const DASHBOARD_FULL_SHEET_NAME = 'Dashboard Full';
/** Tab tersembunyi berisi salinan baris yang pernah dihapus, lihat arsipkan(). */
const ARSIP_SHEET_NAME = '_Arsip';
/**
 * Tab input pengguna (target anggaran bulanan per kategori). Dibuat sekali,
 * tidak pernah dibangun ulang — lihat pastikanAnggaran().
 */
const ANGGARAN_SHEET_NAME = 'Anggaran';
/**
 * Tab pencarian transaksi, juga dibuat sekali dan tidak pernah dibangun ulang
 * — lihat pastikanCariTransaksi().
 */
const CARI_TRANSAKSI_SHEET_NAME = 'Cari Transaksi';
/**
 * Tab "Statement": satu baris per e-statement, berisi angka yang TERCETAK DI
 * BANK. Dikirim aplikasi, tapi create-once supaya saldo statement lama boleh
 * diketik tangan; baris tanpa ID Upload tetap ikut dihitung di Kontrol Saldo.
 */
const STATEMENT_SHEET_NAME = 'Statement';
const HEADER_STATEMENT = ['ID Upload', 'Bank', 'No. Rekening', 'Bulan', 'Periode Awal',
  'Periode Akhir', 'Saldo Awal Statement', 'Saldo Akhir Statement', 'Mutasi Debet',
  'Mutasi Kredit', 'Jumlah Transaksi', 'Nama File', 'Tanggal Upload'];
const KOLOM_STATEMENT = ['id', 'bank', 'nomorRekening', 'bulan', 'periodeAwal',
  'periodeAkhir', 'saldoAwalStatement', 'saldoAkhirStatement', 'mutasiDebetStatement',
  'mutasiKreditStatement', 'jumlahTransaksi', 'namaFile', 'tanggalUpload'];

/**
 * Tab "Kontrol Saldo": angka bank vs angka pembukuan, per rekening per bulan.
 * Saldo pembukuan DIHITUNG MAJU dari Saldo Awal (tab Akun) + mutasi, bukan
 * dari kolom Saldo tab data — kolom itu saldo cetakan bank, jadi
 * membandingkannya dengan bank selalu lolos walau ada baris hilang.
 */
const KONTROL_SHEET_NAME = 'Kontrol Saldo';
/**
 * Selisih sebesar ini atau kurang dianggap cocok: pembulatan sen dan konversi
 * valas menyisakan beda satuan terkecil yang bukan tanda baris hilang.
 */
const TOLERANSI_KONTROL = 1;
/** Cadangan baris tabel kontrol, menahan statement baru yang datang setelah dibangun. */
const CADANGAN_KONTROL = 12;

/**
 * Tab input pengguna: pola pengirim/subjek email transaksi bank. Create-once
 * dan sengaja kosong — pola pengirim asli tidak boleh ditebak kode.
 */
const KONFIGURASI_EMAIL_SHEET_NAME = 'Konfigurasi Email';
/**
 * Tab tersembunyi: email transaksi mentah yang lolos klasifikasi. Kolom A
 * (Gmail Message ID) adalah kunci idempotensi.
 */
const EMAIL_MASUK_SHEET_NAME = '_EmailMasuk';
const HEADER_EMAIL_MASUK = ['Gmail Message ID', 'Perkiraan Bank', 'Dari', 'Subjek', 'Diterima Pada', 'Isi Dipotong', 'Berhasil Diparse', 'Pesan Error', 'Dibuat Pada'];
/**
 * Tab transit hasil parse email, ditarik PWA lewat doPost{tarikTransaksiEmail}.
 * Rekonsiliasi dan kategorisasi berjalan di PWA, bukan di sini.
 */
const TRANSAKSI_EMAIL_SHEET_NAME = 'Transaksi Email';
const HEADER_TRANSAKSI_EMAIL = ['Gmail Message ID', 'Bank', 'Waktu Transaksi', 'Nominal', 'Arah', 'Merchant Mentah', 'Jenis Transaksi', 'Acquirer', 'Lokasi', 'RRN', 'Nomor Referensi', 'Versi Parser', 'Confidence', 'Dibuat Pada'];
/** Batas potong isi email mentah yang disimpan (karakter) — lihat PRD §12. */
const BATAS_ISI_EMAIL = 2000;
/** Label Gmail penanda "sudah diperiksa" — dasar idempotensi pollEmailTransaksi(). */
const LABEL_EMAIL_DIPROSES = 'Pembukuan/Diproses';
/**
 * Subjek yang pasti bukan notifikasi transaksi. Email ini dilabeli dan
 * dilewati, bukan disimpan sebagai "gagal diparse". Daftar disusun dari
 * subjek nyata di _EmailMasuk; jangan tambahkan kata yang bisa muncul di
 * subjek transaksi (mis. "TOP UP", "TRANSFER", "PAYMENT").
 */
const KATA_KECUALI_EMAIL = [
  'OTP', 'PROMO', 'PROMOSI', 'NEWSLETTER', 'IKLAN', 'ADVERTISEMENT',
  // Keamanan & akun
  'LOGIN', 'PASSWORD', 'VERIFIKASI', 'AKTIVASI', 'BIOMETRIK', 'PERANGKAT BARU', 'NEW DEVICE',
  'BCA ID', 'MOBILE PIN', 'NO. HP', 'PENIPUAN',
  // Informasi rekening & layanan
  'E-STATEMENT', 'SUKU BUNGA', 'BIAYA BULANAN', 'STATUS REKENING', 'PEMROSESAN REKENING',
  'VERSI TERBARU', 'IMPORT TRANSFER LIST',
  // Pemasaran
  'NIKMATI', 'HADIAH', 'CASHBACK', 'RAYAKAN',
];

/**
 * Notifikasi transaksi yang GAGAL tidak memindahkan uang, jadi tidak boleh
 * tercatat. Bank memakai template yang sama untuk transaksi berhasil maupun
 * gagal; bedanya hanya baris "Status".
 */
const POLA_STATUS_GAGAL = /Status(?:\s+Transaksi)?\s*:\s*(?:Gagal|Failed|Ditolak|Rejected)\b/i;
/** Jendela pencarian mundur tiap jalan — self-healing kalau ada run yang terlewat (PRD §9.5). */
const JENDELA_PENCARIAN_EMAIL_HARI = 3;
/** Batas jumlah thread diproses per jalan, menjaga kuota eksekusi Apps Script. */
const MAKS_THREAD_EMAIL_PER_JALAN = 50;
/** Tab audit: satu baris per jalan pollEmailTransaksi() yang melakukan sesuatu. */
const LOG_EMAIL_SHEET_NAME = 'Log Email';
const HEADER_LOG_EMAIL = ['Waktu', 'Thread Diperiksa', 'Email Diproses', 'Berhasil Diparse', 'Gagal Diparse', 'Diperbaiki Reparse', 'Catatan'];
/**
 * Naikkan setiap kali tata letak/rumus Dashboard, Dashboard Full, atau Kontrol
 * Saldo berubah; Sheet dengan versi lama dibangun ulang pada POST berikutnya.
 */
const VERSI_DASHBOARD = '10';   // 10: tab Kontrol Saldo + Dashboard dirapikan

/** Jeda minimum antar PEMERIKSAAN apakah Dashboard perlu dibangun ulang. */
const JEDA_PEMERIKSAAN_MS = 2 * 60 * 1000;
/** Jeda minimum antar pembangunan ulang yang dipicu sidik data / kerusakan. */
const JEDA_BANGUN_MS = 10 * 60 * 1000;

/**
 * Sel rumus cadangan untuk mendeteksi Dashboard rusak. Daftar sebenarnya
 * dicatat saat build ke ScriptProperties (tata letak dinamis).
 */
const SEL_RUMUS = ['A9', 'D10', 'G9', 'A45'];
/** Baris tetap tabel "Transaksi Tak Wajar" di Dashboard Full (lihat bangunDashboardFull). */
const TOP_ANOMALI = 25;
/** Baris tetap hasil pencarian di tab Cari Transaksi (lihat pastikanCariTransaksi). */
const MAKS_HASIL_CARI = 500;

/**
 * Kolom Q "ID Transaksi" & R "Diubah Pada" ditambah di UJUNG supaya rumus
 * Dashboard yang merujuk huruf kolom A..P tidak bergeser. Dipakai
 * tarikTransaksi() untuk pull dan resolusi konflik, bukan oleh upsert (tetap
 * berbasis Hash). Baris tanpa ID Transaksi dilewati saat pull.
 */
const HEADER = ['Hash','Tanggal','Deskripsi','Nominal','Debit','Kredit','ID Kategori','Bank','No. Rekening','Nama Pemilik','Sumber','ID Upload','Dikirim Pada','Kategori','Transfer Internal','Saldo','ID Transaksi','Diubah Pada'];
const LEBAR_KOLOM = [110, 95, 300, 120, 120, 120, 130, 90, 130, 150, 80, 110, 140, 150, 130, 130, 130, 140];
const KOLOM_RP = [4, 5, 6, 16];  // Nominal, Debit, Kredit, Saldo
const KOLOM_WAKTU = 13;          // Dikirim Pada
const KOLOM_SEMBUNYI = [1, 7, 12, 17]; // Hash, ID Kategori, ID Upload, ID Transaksi — dipakai mesin, bukan mata
/**
 * "ID Kategori" (tersembunyi, dibaca PWA) vs "Kategori" (nama, label untuk
 * manusia). onEdit() menyelaraskan ID bila kolom nama diedit manual.
 */
const KOLOM_KATEGORI_ID = HEADER.indexOf('ID Kategori') + 1;
const KOLOM_KATEGORI_NAMA = HEADER.indexOf('Kategori') + 1;
/** Kolom terakhir yang perlu dibaca saat menyelaraskan: I, "No. Rekening". */
const KOLOM_REKENING_AKHIR = 9;

const RP = '"Rp "#,##0;[RED]-"Rp "#,##0';
const FORMAT_WAKTU = 'dd/mm/yyyy HH:mm';

/**
 * Tab "Akun" & "Kategori": cadangan rekening dan kategori, upsert per ID
 * (kolom A) lewat doPost{entity}, ditarik utuh lewat doPost{tarikEntitas}.
 *
 * "Diubah Pada" dikirim klien apa adanya (dipakai last-updated-wins di
 * entitas-sync.js). "Dihapus Pada" distempel server sebagai tombstone (AD-008):
 * baris tidak pernah dibuang, supaya perangkat lain tidak menghidupkannya lagi.
 */
const AKUN_SHEET_NAME = 'Akun';
const HEADER_AKUN = ['ID', 'Bank', 'No. Rekening', 'Nama Pemilik', 'Mata Uang', 'Jenis', 'Saldo Awal', 'Saldo', 'Jumlah Transaksi', 'Warna', 'Catatan', 'Dibuat Pada', 'Diubah Pada', 'Dihapus Pada'];
const KOLOM_AKUN = ['id', 'bank', 'nomorRekening', 'namaPemilik', 'mataUang', 'jenis', 'saldoAwal', 'saldo', 'jumlahTransaksi', 'warna', 'catatan', 'dibuatPada', 'diubahPada', 'dihapusPada'];

const KATEGORI_SHEET_NAME = 'Kategori';
const HEADER_KATEGORI = ['ID', 'Nama', 'Tipe', 'Warna', 'Ikon', 'Kata Kunci', 'Prioritas', 'Bawaan', 'Urutan', 'Dibuat Pada', 'Diubah Pada', 'Dihapus Pada'];
const KOLOM_KATEGORI = ['id', 'nama', 'tipe', 'warna', 'ikon', 'polaKataKunci', 'prioritas', 'bawaan', 'urutan', 'dibuatPada', 'diubahPada', 'dihapusPada'];

/* Palet laporan keuangan: kepala tabel dan pita seksi biru tua berteks putih,
   angka surplus hijau, defisit merah. */
const BIRU_TUA = '#1f4e79';
const HIJAU = '#006600';
const MERAH = '#cc0000';

/** Menu di spreadsheet, supaya perbaikan tidak perlu buka editor Apps Script. */
function onOpen() {
  try { pastikanFilterMencakupHash(getSheet()); } catch (e) { console.warn('Cek filter gagal:', e); }
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
 * Simple trigger: dipanggil setiap kali MANUSIA mengedit sel (tidak terpicu
 * tulisan skrip). Menstempel "Diubah Pada" (dan "Dikirim Pada" di tab
 * Transaksi) supaya auto-pull PWA menangkap edit manual.
 *
 * Simple, bukan installable: cakupannya hanya spreadsheet aktif, dan tidak
 * perlu dipasang ulang setelah salin/deploy ulang.
 *
 * Hash TIDAK dihitung ulang saat Tanggal/Deskripsi/Nominal diedit. Aman: pull
 * mencocokkan lewat ID Transaksi, dan PWA tidak mem-push ulang baris yang
 * sudah tersinkron.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const nama = sh.getName();
  const baris = e.range.getRow();
  if (baris < 2) return; // header, atau bukan baris data

  const cfg = {
    [DATA_SHEET_NAME]: { idxDiubah: HEADER.indexOf('Diubah Pada') + 1, idxDikirim: KOLOM_WAKTU, lebar: HEADER.length },
    [AKUN_SHEET_NAME]: { idxDiubah: HEADER_AKUN.indexOf('Diubah Pada') + 1, idxDikirim: null, lebar: HEADER_AKUN.length },
    [KATEGORI_SHEET_NAME]: { idxDiubah: HEADER_KATEGORI.indexOf('Diubah Pada') + 1, idxDikirim: null, lebar: HEADER_KATEGORI.length },
  }[nama];
  if (!cfg) return; // tab lain (Dashboard, Anggaran, dst.) diabaikan total

  const kolom = e.range.getColumn();
  const kolomAkhir = e.range.getLastColumn();

  // Guard anti-reentrancy STRUKTURAL: kalau edit ini sendiri menyentuh salah
  // satu kolom timestamp yang mau kita tulis, jangan tulis lagi -- ini yang
  // memutus rantai onEdit memicu onEdit, tanpa perlu flag/lock lintas eksekusi.
  const kenaKolomWaktu = (kolom <= cfg.idxDiubah && cfg.idxDiubah <= kolomAkhir)
    || (cfg.idxDikirim && kolom <= cfg.idxDikirim && cfg.idxDikirim <= kolomAkhir);
  if (kenaKolomWaktu) return;

  const barisAkhir = e.range.getLastRow();

  // Baris Akun/Kategori tanpa ID dilewati diam-diam saat ditarik ke PWA, dan
  // kolom ID diproteksi dari edit UI. Begitu baris punya isian lain, skrip
  // yang mengisi ID-nya.
  if (nama === AKUN_SHEET_NAME || nama === KATEGORI_SHEET_NAME) {
    isiIdBaruJikaKosong(sh, nama, baris, barisAkhir, cfg.lebar);
  }

  // Kolom "Kategori" (nama) diedit langsung: selaraskan "ID Kategori", karena
  // hanya ID yang dibaca PWA.
  if (nama === DATA_SHEET_NAME
    && kolom <= KOLOM_KATEGORI_NAMA && KOLOM_KATEGORI_NAMA <= kolomAkhir) {
    selaraskanIdKategoriDariNama(sh, baris, barisAkhir);
  }

  const now = new Date();
  for (let r = baris; r <= barisAkhir; r++) {
    sh.getRange(r, cfg.idxDiubah).setValue(now);
    if (cfg.idxDikirim) sh.getRange(r, cfg.idxDikirim).setValue(now);
  }
}

/**
 * Isi kolom ID (kolom 1) untuk baris Akun/Kategori yang sudah punya isian lain
 * tapi ID-nya kosong. Baris yang seluruhnya kosong dibiarkan.
 */
function isiIdBaruJikaKosong(sh, nama, baris, barisAkhir, lebarHeader) {
  const prefix = nama === AKUN_SHEET_NAME ? 'acc' : 'kat';
  for (let r = baris; r <= barisAkhir; r++) {
    const idSel = sh.getRange(r, 1);
    if (idSel.getValue()) continue; // sudah ada ID, jangan disentuh

    const adaIsiLain = sh.getRange(r, 2, 1, lebarHeader - 1).getValues()[0]
      .some((v) => v !== '' && v !== null && v !== undefined);
    if (adaIsiLain) idSel.setValue(buatIdBaru(prefix));
  }
}

/** ID acak bergaya idBaru() PWA ("prefix_16hexchar"); cukup unik dan stabil. */
function buatIdBaru(prefix) {
  return `${prefix}_${Utilities.getUuid().replace(/-/g, '').slice(0, 16)}`;
}

/**
 * Tulis ID Kategori yang cocok dengan nama di kolom "Kategori". Nama yang tidak
 * dikenali dibiarkan (ID lama tidak ditimpa tebakan) dan dilaporkan lewat toast.
 */
function selaraskanIdKategoriDariNama(sh, baris, barisAkhir) {
  const peta = petaKategoriNamaKeId(sh.getParent());
  if (!peta.size) return;

  const rentangNama = sh.getRange(baris, KOLOM_KATEGORI_NAMA, barisAkhir - baris + 1, 1);
  const namaNilai = rentangNama.getValues();
  const tidakKetemu = [];

  namaNilai.forEach(([namaKategori], i) => {
    const kunci = String(namaKategori || '').trim().toLowerCase();
    if (!kunci) return;
    const id = peta.get(kunci);
    if (id) {
      sh.getRange(baris + i, KOLOM_KATEGORI_ID).setValue(id);
    } else {
      tidakKetemu.push(String(namaKategori));
    }
  });

  if (tidakKetemu.length) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      `Kategori tidak dikenali: ${tidakKetemu.join(', ')}. Baris itu TIDAK berubah kategorinya -- `
      + 'ejaan harus sama persis dengan kolom Nama di tab Kategori.',
      'Pembukuan', 8,
    );
  }
}

/** Peta nama kategori (huruf kecil) -> ID. Kategori ber-tombstone dilewati. */
function petaKategoriNamaKeId(ss) {
  const sh = ss.getSheetByName(KATEGORI_SHEET_NAME);
  const peta = new Map();
  if (!sh) return peta;
  const last = sh.getLastRow();
  if (last < 2) return peta;

  const idxNama = HEADER_KATEGORI.indexOf('Nama');
  const idxId = HEADER_KATEGORI.indexOf('ID');
  const idxDihapus = HEADER_KATEGORI.indexOf('Dihapus Pada');
  const nilai = sh.getRange(2, 1, last - 1, HEADER_KATEGORI.length).getValues();
  nilai.forEach((r) => {
    if (r[idxDihapus]) return;
    const namaBersih = String(r[idxNama] || '').trim().toLowerCase();
    if (namaBersih) peta.set(namaBersih, String(r[idxId] || ''));
  });
  return peta;
}

/** Sheet data selalu dicari dengan nama, tidak pernah dengan posisi tab. */
function sheetData(ss) {
  return ss.getSheetByName(DATA_SHEET_NAME) || ss.insertSheet(DATA_SHEET_NAME, 0);
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = sheetData(ss);
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

  // Dashboard sengaja tidak dibangun di sini: biayanya terlalu besar untuk
  // setiap permintaan. Hanya permintaan dengan `rapikan` yang membayarnya.
  return sh;
}

/** Kriteria tiap kolom sebuah filter, siap dipasang ulang ke filter baru. */
function bacaKriteriaFilter(filter, kolomAwal, kolomAkhir) {
  const kriteria = [];
  for (let k = kolomAwal; k <= kolomAkhir; k += 1) {
    const c = filter.getColumnFilterCriteria(k);
    if (c) kriteria.push({ k, c: c.copy().build() });
  }
  return kriteria;
}

/**
 * Jalankan `fn` dengan filter tab dicabut sementara, lalu pasang lagi dengan
 * kriteria yang sama (juga bila `fn` melempar).
 *
 * Baris yang sedang disembunyikan filter biasa tidak ikut terbuang oleh
 * deleteRow/deleteRows, padahal isinya sudah tersalin ke _Arsip: Sheet tetap
 * memuat baris yang menurut aplikasi sudah dihapus.
 */
function tanpaFilter(sh, fn) {
  const filter = sh.getFilter();
  if (!filter) return fn();
  const rng = filter.getRange();
  const barisAwal = rng.getRow();
  const kolomAwal = rng.getColumn();
  const kolomAkhir = rng.getLastColumn();
  const kriteria = bacaKriteriaFilter(filter, kolomAwal, kolomAkhir);
  filter.remove();
  try {
    return fn();
  } finally {
    const tinggi = Math.max(sh.getMaxRows() - barisAwal + 1, 1);
    const baru = sh.getRange(barisAwal, kolomAwal, tinggi, kolomAkhir - kolomAwal + 1).createFilter();
    kriteria.forEach(({ k, c }) => baru.setColumnFilterCriteria(k, c));
  }
}

/**
 * Pastikan filter tab data mencakup kolom A (Hash).
 *
 * Kolom Hash disembunyikan, jadi filter lewat UI mudah dimulai dari kolom B.
 * Mengurutkan dengan filter seperti itu memindahkan isi baris tapi
 * meninggalkan Hash, sehingga upsert dan hapus (berkunci Hash) mengenai baris
 * yang salah. Filter yang tidak mulai di kolom A dibuat ulang dari kolom A
 * dengan kriteria yang sama.
 *
 * @returns {boolean} true bila filter diperbaiki
 */
function pastikanFilterMencakupHash(sh) {
  const filter = sh.getFilter();
  if (!filter) return false;
  const rng = filter.getRange();
  if (rng.getColumn() === 1) return false;

  const kolomAwal = rng.getColumn();
  const kolomAkhir = rng.getLastColumn();
  const kriteria = bacaKriteriaFilter(filter, kolomAwal, kolomAkhir);
  filter.remove();
  const baru = sh.getRange(1, 1, sh.getMaxRows(), Math.max(kolomAkhir, sh.getLastColumn(), HEADER.length))
    .createFilter();
  kriteria.forEach(({ k, c }) => baru.setColumnFilterCriteria(k, c));
  return true;
}

/**
 * Rapikan tab data saat Sheet baru dibuat atau headernya diperbaiki, bukan
 * pada tiap doPost, supaya penyesuaian manual pengguna tidak ditimpa.
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
 * Pemisah argumen rumus mengikuti lokal spreadsheet. Dideteksi dengan rumus
 * dua argumen: di lokal berdesimal koma, "1,2" terbaca satu bilangan sehingga
 * hasilnya bukan 3. Dideteksi, bukan didaftar per lokal.
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
 * Tab laporan dianggap rusak (boleh dibangun ulang otomatis) hanya bila salah
 * satu sel rumusnya galat, atau A1 berisi header tab data. Sengaja sempit
 * supaya penyesuaian pengguna tidak ditimpa berulang. `jangkar` milik satu tab
 * saja, supaya kerusakan satu tab tidak tertutupi tab lain yang sehat.
 */
function dashboardRusak(d, jangkar) {
  const judul = String(d.getRange('A1').getValue()).trim().toLowerCase();
  if (judul === HEADER[0].toLowerCase() || judul === 'hash') return true;
  return jangkar.some((a) => String(d.getRange(a).getValue()).charAt(0) === '#');
}

/**
 * Sel rumus yang dipantau untuk satu tab: dicatat saat build ke
 * ScriptProperties dengan `kunci`, atau SEL_RUMUS untuk Dashboard lama.
 * Daftar dinamis ini membuat luapan QUERY (#REF!, tidak tertangkap IFERROR)
 * tersembuhkan lewat jalur "rusak".
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
 * Kolom maya yang dipakai bersama Dashboard dan Dashboard Full, dirakit sekali
 * supaya definisinya tidak menyimpang antar tab.
 *
 * Tanggal tersimpan sebagai TIPE TANGGAL. Bulan diambil lewat TEXT, bukan
 * LEFT(tanggal;7) yang bergantung format tampilan; cabang LEFT hanya untuk
 * baris yang tanggalnya masih teks.
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
 * Orkestrator semua tab laporan. statistikData dipanggil SEKALI di sini lalu
 * dibagikan. Anggaran dan Cari Transaksi tidak ikut throttle/versi Dashboard:
 * murah diperiksa, dan kategori baru harus segera muncul di Anggaran.
 */
function pastikanSemuaTab(ss, namaSheetData) {
  const prop = PropertiesService.getScriptProperties();
  const stat = statistikData(ss.getSheetByName(namaSheetData));

  pastikanAnggaran(ss, stat);
  pastikanCariTransaksi(ss);
  // Statement & Akun dipastikan ada SEBELUM Kontrol Saldo dibangun: seluruh
  // rumus di sana merujuk kedua tab itu, dan rujukan ke tab yang belum ada
  // menghasilkan #REF! yang tidak bisa ditangkap IFERROR.
  pastikanStatement(ss);
  pastikanTabEntitas(ss, AKUN_SHEET_NAME, HEADER_AKUN);
  pastikanKonfigurasiEmail(ss);
  pastikanEmailMasuk(ss);
  pastikanTransaksiEmail(ss);
  pastikanLogEmail(ss);

  const anggaranSh = ss.getSheetByName(ANGGARAN_SHEET_NAME);
  const anggaranBaris = anggaranSh ? Math.max(anggaranSh.getLastRow() - 1, 0) : 0;
  // Statement ikut jadi bahan sidik: tinggi tabel Kontrol Saldo bergantung
  // jumlah pasangan rekening+bulan di tab Statement.
  const statStatement = statistikStatement(ss);
  const sidik = sidikData(stat, anggaranBaris, statStatement);

  const adaDash = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  const adaFull = ss.getSheetByName(DASHBOARD_FULL_SHEET_NAME);
  const adaKontrol = ss.getSheetByName(KONTROL_SHEET_NAME);
  const versiBeda = prop.getProperty('versiDashboard') !== VERSI_DASHBOARD;

  // Pemeriksaan pun mahal (baca seluruh tab data + hitung ulang QUERY), dan
  // backfill mengirim banyak bongkah berturut-turut. Jeda ini mencegah ongkos
  // itu dibayar berulang. Dilewati bila salah satu tab belum ada.
  if (adaDash && adaFull && adaKontrol && !versiBeda) {
    const diperiksa = Number(prop.getProperty('pemeriksaanTerakhir') || 0);
    if (Date.now() - diperiksa < JEDA_PEMERIKSAAN_MS) return;
    prop.setProperty('pemeriksaanTerakhir', String(Date.now()));
  }

  const rusak = (adaDash && dashboardRusak(adaDash, jangkarRumus('selRumusDashboard')))
    || (adaFull && dashboardRusak(adaFull, jangkarRumus('selRumusDashboardFull')))
    || (adaKontrol && dashboardRusak(adaKontrol, jangkarRumus('selRumusKontrol')));

  if (adaDash && adaFull && adaKontrol) {
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
  if (adaKontrol) ss.deleteSheet(adaKontrol);

  const S = pisahArgumen(ss);           // pemisah argumen rumus
  const AS = S === ',' ? ',' : '\\';    // pemisah kolom di dalam array literal {}
  const kol = (huruf) => `'${namaSheetData}'!${huruf}2:${huruf}`;
  const maya = kolomMaya(kol, S);

  // Kontrol Saldo dibangun PALING DULU: kartu "STATUS KONTROL" di Dashboard
  // merujuk sel ringkasannya. Dibungkus try/catch karena ketiga tab sudah
  // dihapus di atas; tanpa itu satu exception di sini ikut menghilangkan
  // Dashboard. Tab separuh jadi dibuang, sisa laporan tetap dibangun.
  let hasilKontrol = null;
  try {
    hasilKontrol = bangunKontrol(ss, namaSheetData, stat, statStatement, S, AS, kol, maya);
  } catch (err) {
    console.warn(`bangunKontrol gagal: ${err && err.message}`);
    const separuh = ss.getSheetByName(KONTROL_SHEET_NAME);
    if (separuh) ss.deleteSheet(separuh);
  }

  const hasilDash = bangunDashboard(ss, namaSheetData, stat, S, AS, kol, maya);
  const hasilFull = bangunDashboardFull(ss, namaSheetData, stat, S, AS, kol, maya);

  // Dicatat paling akhir, setelah semuanya benar-benar terpasang: kalau
  // pembangunan gagal di tengah jalan, versi dan sidiknya tidak ikut tercatat
  // sehingga percobaan berikutnya mengulang, bukan menganggap sudah beres.
  prop.setProperty('selRumusDashboard', JSON.stringify(hasilDash.jangkar));
  prop.setProperty('rentangBlokDashboard', JSON.stringify(hasilDash.rentang));
  prop.setProperty('selRumusDashboardFull', JSON.stringify(hasilFull.jangkar));
  prop.setProperty('rentangBlokDashboardFull', JSON.stringify(hasilFull.rentang));
  prop.setProperty('selRumusKontrol', JSON.stringify(hasilKontrol ? hasilKontrol.jangkar : []));
  prop.setProperty('rentangBlokKontrol', JSON.stringify(hasilKontrol ? hasilKontrol.rentang : []));
  prop.setProperty('sidikDashboard', sidik);
  // Versi hanya dicatat kalau SEMUANYA jadi. Kontrol Saldo yang gagal
  // membuat versinya sengaja dibiarkan basi, supaya POST berikutnya mencoba
  // lagi dari nol — bukan menganggap tab yang tidak ada sebagai "sudah
  // dibangun" dan berhenti mencoba selamanya.
  if (hasilKontrol) prop.setProperty('versiDashboard', VERSI_DASHBOARD);
}

/**
 * Bangun tab "Dashboard": kartu ringkasan, perbandingan rekening, arus bulanan
 * per rekening dan gabungan, breakdown kategori, blok rinci per rekening, dan
 * grafik. Semuanya rumus yang merujuk balik ke tab data.
 */
function bangunDashboard(ss, namaSheetData, stat, S, AS, kol, maya) {
  const d = ss.insertSheet(DASHBOARD_SHEET_NAME, ss.getNumSheets());

  const nBulan = Math.max(stat.bulan.length, 1);
  const nRek = Math.max(stat.rekening.length, 1);
  const nKat = Math.max(stat.katKeluar, 1);

  /* ---------- Anggaran kolom dan baris ---------- */
  // Grid harus cukup besar SEBELUM sel mana pun disentuh (aturan 3). Lantai 12
  // kolom: enam kartu KPI (A..L) dan kartu mini rekening sampai kolom J harus
  // muat sebelum posisi grafik dihitung.
  const lebarRek = Math.max(1 + stat.rekening.length, 2);
  const lebarMaks = Math.max(12, lebarRek, 1 + nBulan);
  const kolomPerlu = Math.max(lebarMaks + 4, 26);
  if (d.getMaxColumns() < kolomPerlu) {
    d.insertColumnsAfter(d.getMaxColumns(), kolomPerlu - d.getMaxColumns());
  }
  const tinggiBlokBulan = nBulan + cadangan(nBulan);
  // 13, bukan 10: ada DUA baris kartu KPI sekarang (baris 4-6 dan 7-8) dan
  // kursor blok pertama mulai di baris 11.
  const barisPerlu = 13
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
  d.getRange('A2:I2').merge()
    .setValue('Angka gabungan tidak menghitung pindah dana antar rekening sendiri; angka per rekening menghitungnya.')
    .setFontStyle('italic').setFontColor('#5f6368').setFontSize(10);
  // Stempel waktu pembangunan, bukan =NOW(): yang perlu dijawab bukan "jam
  // berapa sekarang" melainkan "seberapa baru tata letak ini" — laporan yang
  // tidak bisa dipastikan umurnya adalah laporan yang selalu perlu
  // dikonfirmasi ulang sebelum dipakai.
  d.getRange('J2:L2').merge()
    .setValue(`Tata letak dibangun ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')} · versi ${VERSI_DASHBOARD}`)
    .setFontStyle('italic').setFontColor('#9aa0a6').setFontSize(9)
    .setHorizontalAlignment('right');

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
    d.getRange(`${k.kol}4:${akhir}6`)
      .setBorder(true, true, true, true, false, false, '#ffffff', SpreadsheetApp.BorderStyle.SOLID_THICK);
  });
  // Kartu Saldo Terkini & Runway gabungan (I,K) dirender BELAKANGAN, setelah
  // blok per rekening (butuh alamat Saldo Terkini tiap rekening) dan arus
  // bulanan gabungan (butuh rata-rata pengeluaran gabungan) selesai dibangun
  // — lihat akhir fungsi ini. Baris tingginya disamakan sekarang saja.
  d.setRowHeights(5, 2, 30);

  /* ---------- Baris kartu kedua: mutu arus kas & status kontrol ---------- */
  // Label dipasang sekarang, nilainya di akhir fungsi: alamat blok arus
  // bulanan gabungan baru pasti setelah blok itu dibangun.
  const KARTU2 = [
    { kol: 'A', label: 'RATA-RATA PENGELUARAN / BULAN', bg: '#f1f3f4', fg: '#3c4043', format: RP },
    { kol: 'C', label: 'SAVINGS RATE RATA-RATA', bg: '#e8f0fe', fg: BIRU_TUA, format: '0.0%' },
    { kol: 'E', label: 'NET BULAN TERAKHIR', bg: '#e8f0fe', fg: BIRU_TUA, format: RP },
    { kol: 'G', label: 'STATUS KONTROL SALDO', bg: '#fef7e0', fg: '#b45309', format: '@' },
    { kol: 'I', label: 'BULAN TANPA E-STATEMENT', bg: '#fef7e0', fg: '#b45309', format: '#,##0' },
  ];
  KARTU2.forEach((k) => {
    const akhir = String.fromCharCode(k.kol.charCodeAt(0) + 1);
    d.getRange(`${k.kol}7:${akhir}7`).merge().setValue(k.label)
      .setFontWeight('bold').setFontSize(9).setFontColor(k.fg).setBackground(k.bg)
      .setHorizontalAlignment('center');
    d.getRange(`${k.kol}8:${akhir}8`).merge()
      .setFontSize(13).setFontWeight('bold').setFontColor(k.fg).setBackground(k.bg)
      .setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setNumberFormat(k.format);
    d.getRange(`${k.kol}7:${akhir}8`)
      .setBorder(true, true, true, true, false, false, '#ffffff', SpreadsheetApp.BorderStyle.SOLID_THICK);
  });
  d.setRowHeight(8, 26);

  // Dua kartu kontrol tidak lewat pasangRumus (bukan jangkar kesehatan): bila
  // tab Kontrol Saldo hilang, rujukannya sah menjadi #REF! dan akan membuat
  // Dashboard dibangun ulang terus tanpa sembuh. IFERROR cukup untuk tampilan.
  d.getRange('G8').setFormula(`=IFERROR(IF('${KONTROL_SHEET_NAME}'!E5=0${S}"✅ Semua cocok"${S}`
    + `"⚠️ "&TEXT('${KONTROL_SHEET_NAME}'!E5${S}"0")&" bulan perlu diperiksa")${S}"—")`);
  d.getRange('I8').setFormula(`=IFERROR('${KONTROL_SHEET_NAME}'!I5${S}0)`);

  let r = 11;            // kursor baris berjalan; tidak ada jangkar hardcoded
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
  bandingTabel(d, `A${isiBanding}:F${akhirBanding}`);
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
  bandingTabel(d, `A${kepalaArus + 1}:${hurufKolom(lebarRek)}${akhirArus}`);
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
  bandingTabel(d, `A${isiArusGab}:E${akhirArusGab}`);
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
  bandingTabel(d, `A${kepalaKat + 1}:${hurufKolom(lebarRek)}${akhirKat}`);
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
    // Saldo Bank = saldo pada transaksi TERAKHIR MENURUT TANGGAL di bulan itu,
    // bukan baris terakhir (urutan baris = urutan kedatangan POST). Baris tanpa
    // saldo disaring. Ditulis per baris karena SORT/FILTER tidak bisa
    // divektorkan; Savings Rate (H) ikut dalam satu setFormulas.
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
    bandingTabel(d, `A${isiBulan}:H${akhirBulan}`);
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

  // Kartu baris kedua yang bergantung blok arus gabungan. Rata-ratanya
  // menghitung HANYA bulan yang benar-benar ada pengeluarannya: memasukkan
  // bulan kosong (cadangan baris yang belum terpakai) akan menurunkan
  // rata-rata sekehendak ukuran cadangan, bukan sekehendak datanya.
  const kolomKeluar = `C${isiArusGab}:C${akhirArusGab}`;
  pasangRumus('A8', `=IFERROR(AVERAGE(FILTER(${kolomKeluar}${S}${kolomKeluar}>0))${S}0)`);
  pasangRumus('C8', `=IFERROR(AVERAGE(FILTER(E${isiArusGab}:E${akhirArusGab}${S}`
    + `ISNUMBER(E${isiArusGab}:E${akhirArusGab})))${S}"")`);
  // Bulan TERAKHIR yang ada isinya, bukan baris terakhir tabel: baris di
  // bawahnya adalah cadangan yang masih kosong.
  pasangRumus('E8', `=IFERROR(INDEX(SORT(FILTER({D${isiArusGab}:D${akhirArusGab}${AS}`
    + `A${isiArusGab}:A${akhirArusGab}}${S}A${isiArusGab}:A${akhirArusGab}<>"")${S}2${S}FALSE)${S}1${S}1)${S}0)`);

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

  // Tren masuk/keluar gabungan. Dua rentang terpisah supaya kolom Net (D) dan
  // Savings Rate (E) tidak ikut tergambar: Savings Rate berskala persen dan
  // akan menempel di garis nol kalau dipaksa satu sumbu dengan rupiah.
  const tren = d.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(d.getRange(`A${kepalaArusGab}:A${akhirArusGab}`))
    .addRange(d.getRange(`B${kepalaArusGab}:C${akhirArusGab}`))
    .setPosition(40, kolomGrafik, 0, 0)
    .setOption('title', 'Tren Masuk vs Keluar (Gabungan)')
    .setOption('legend', { position: 'top' })
    .setOption('curveType', 'none')
    .setOption('width', 520).setOption('height', 320)
    .build();
  d.insertChart(tren);

  return { jangkar, rentang };
}

/**
 * Bangun tab "Dashboard Full": ranking kategori dengan ambang "tak wajar", tren
 * kategori per bulan (heatmap), daftar transaksi tak wajar, dan anggaran vs
 * realisasi bulan berjalan.
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
    .setValue('Ranking & ambang tak wajar per kategori, tren bulanan, transaksi tak wajar, dan anggaran vs realisasi. '
      + `Tata letak dibangun ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')} · versi ${VERSI_DASHBOARD}.`)
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
  bandingTabel(d, `A${isiRanking}:G${akhirRanking}`);
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
 * Tab target anggaran per kategori. Dibuat sekali, lalu HANYA ditambah baris
 * kategori baru; input pengguna dan urutan baris lama tidak pernah disentuh.
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
 * Tab pencarian transaksi, dibuat sekali (pembangunan ulang menghapus kata
 * kunci yang sedang diketik). Pakai FILTER dengan rujukan sel, bukan QUERY
 * dengan teks tersisip, supaya tanda kutip di kata kunci tidak memecah rumus.
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
 * Tab "Statement", create-once. Aman dipanggil berkali-kali (header diperbaiki
 * bila berbeda). Dipanggil dari pastikanSemuaTab() dan tanganiEntitas().
 */
function pastikanStatement(ss) {
  let sh = ss.getSheetByName(STATEMENT_SHEET_NAME);
  if (sh) {
    if (sh.getMaxColumns() < HEADER_STATEMENT.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), HEADER_STATEMENT.length - sh.getMaxColumns());
    }
    const h = sh.getRange(1, 1, 1, HEADER_STATEMENT.length).getValues()[0].map(String);
    if (h.join('|') !== HEADER_STATEMENT.join('|')) {
      sh.getRange(1, 1, 1, HEADER_STATEMENT.length).setValues([HEADER_STATEMENT]);
    }
    return sh;
  }

  sh = ss.insertSheet(STATEMENT_SHEET_NAME, ss.getNumSheets());
  sh.appendRow(HEADER_STATEMENT);
  sh.setFrozenRows(1);
  kepalaTabel(sh, `A1:${hurufKolom(HEADER_STATEMENT.length)}1`);
  sh.setTabColor('#0b8043');
  sh.setColumnWidth(1, 150);
  sh.setColumnWidth(2, 110);
  sh.setColumnWidth(3, 140);
  sh.setColumnWidth(4, 90);
  sh.setColumnWidths(5, 6, 150);
  sh.setColumnWidth(12, 240);
  sh.setColumnWidth(13, 150);

  const tinggi = Math.max(sh.getMaxRows() - 1, 1);
  // Bulan dipaksa TEKS: "2025-07" yang diketik tangan diubah Sheets jadi
  // tanggal, dan pencocokan teks "yyyy-mm" di Kontrol Saldo berhenti cocok.
  sh.getRange(2, 4, tinggi, 1).setNumberFormat('@');
  sh.getRange(2, 5, tinggi, 2).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, 7, tinggi, 4).setNumberFormat(RP);
  sh.getRange(2, 11, tinggi, 1).setNumberFormat('#,##0');
  sh.getRange(2, 13, tinggi, 1).setNumberFormat(FORMAT_WAKTU);
  return sh;
}

/** Ukur tab Statement sekali: jumlah pasangan rekening+bulan dan rekening. */
function statistikStatement(ss) {
  const sh = ss ? ss.getSheetByName(STATEMENT_SHEET_NAME) : null;
  const last = sh ? sh.getLastRow() : 0;
  if (!sh || last < 2) return { baris: 0, rekeningBulan: 0, rekening: 0 };

  const nilai = sh.getRange(2, 1, last - 1, HEADER_STATEMENT.length).getValues();
  const pasangan = {}, rekening = {};
  let baris = 0;
  nilai.forEach((r) => {
    const label = `${String(r[1] || '').trim()} ${String(r[2] || '').trim()}`.trim();
    if (!label) return;
    const bulan = r[3] instanceof Date
      ? Utilities.formatDate(r[3], Session.getScriptTimeZone(), 'yyyy-MM')
      : String(r[3] || '').slice(0, 7);
    baris += 1;
    rekening[label] = true;
    if (bulan) pasangan[`${label}::${bulan}`] = true;
  });

  return {
    baris,
    rekeningBulan: Object.keys(pasangan).length,
    rekening: Object.keys(rekening).length,
  };
}

/**
 * Bangun tab "Kontrol Saldo". Tiga blok:
 *   1. Kontrol per rekening per bulan (baris digerakkan tab Statement): saldo,
 *      mutasi, dan jumlah transaksi menurut bank vs pembukuan, plus selisih.
 *   2. Bulan pembukuan tanpa e-statement: statement yang lupa di-upload tidak
 *      akan pernah muncul sebagai selisih.
 *   3. Rekap per rekening.
 *
 * Seluruh hasil array dibatasi sebesar baris yang dialokasikan, jadi luapan
 * tidak bisa menabrak blok di bawahnya.
 */
function bangunKontrol(ss, namaSheetData, stat, statStatement, S, AS, kol, maya) {
  const d = ss.insertSheet(KONTROL_SHEET_NAME, ss.getNumSheets());

  /* ---------- Kolom maya: tab Statement & tab Akun ---------- */
  const kolS = (huruf) => `'${STATEMENT_SHEET_NAME}'!${huruf}2:${huruf}`;
  const kolA = (huruf) => `'${AKUN_SHEET_NAME}'!${huruf}2:${huruf}`;
  const S_REK = `ARRAYFORMULA(IF(${kolS('B')}=""${S}""${S}TRIM(${kolS('B')}&" "&${kolS('C')})))`;
  // Bulan dinormalkan seperti kolomMaya(): kolom D sudah diformat teks, tapi
  // baris yang terlanjur tersimpan sebagai tanggal (diketik sebelum format
  // itu ada) tetap harus ikut cocok.
  const S_BULAN = `ARRAYFORMULA(IF(ISNUMBER(${kolS('D')})${S}TEXT(${kolS('D')}${S}"yyyy-mm")${S}LEFT(${kolS('D')}&""${S}7)))`;
  const A_REK = `ARRAYFORMULA(IF(${kolA('B')}=""${S}""${S}TRIM(${kolA('B')}&" "&${kolA('C')})))`;
  const DEBET = `ARRAYFORMULA(N(${kol('E')}))`;
  const KREDIT = `ARRAYFORMULA(N(${kol('F')}))`;

  /* ---------- Ukuran grid, sebelum sel mana pun disentuh ---------- */
  const LEBAR = 17;                                   // A..Q
  const nKontrol = Math.max(statStatement.rekeningBulan, 1) + CADANGAN_KONTROL;
  // Blok 2 setinggi seluruh kombinasi rekening x bulan yang MUNGKIN ada di
  // pembukuan, dibatasi 400 baris: di atas itu tabelnya tidak lagi bisa
  // dibaca mata dan yang dicari (bulan tanpa statement) tetap terlihat dari
  // kartu hitungannya.
  const nLedger = Math.min(
    Math.max(stat.rekening.length, 1) * Math.max(stat.bulan.length, 1) + 4, 400,
  );
  const nRekap = Math.max(statStatement.rekening, 1) + 4;

  const kolomPerlu = Math.max(LEBAR + 2, 26);
  if (d.getMaxColumns() < kolomPerlu) {
    d.insertColumnsAfter(d.getMaxColumns(), kolomPerlu - d.getMaxColumns());
  }
  const barisPerlu = 10 + (nKontrol + 4) + (nLedger + 4) + (nRekap + 4) + 10;
  if (d.getMaxRows() < barisPerlu) {
    d.insertRowsAfter(d.getMaxRows(), barisPerlu - d.getMaxRows());
  }

  d.setHiddenGridlines(true);
  d.setTabColor('#b45309');
  d.setColumnWidth(1, 210);
  d.setColumnWidth(2, 85);
  d.setColumnWidths(3, LEBAR - 2, 135);

  const jangkar = [];
  const rentang = [];
  const pasangRumus = buatPasangRumus(d, jangkar);
  const kolomSelisih = [];

  /* ---------- Judul ---------- */
  // Tidak ada sel gabungan yang melintasi batas kolom B/C: tab ini membekukan
  // dua kolom pertama, dan Sheets melempar exception bila pembekuan memotong
  // sel gabungan, menjatuhkan seluruh pembangunan.
  const lebarHuruf = hurufKolom(LEBAR);
  const gabung = (a1) => d.getRange(a1).merge();
  gabung('A1:B1')
    .setValue('KONTROL SALDO')
    .setFontSize(14).setFontWeight('bold').setFontColor(BIRU_TUA)
    .setVerticalAlignment('middle');
  gabung(`C1:${lebarHuruf}1`)
    .setValue('ANGKA BANK vs ANGKA PEMBUKUAN')
    .setFontSize(14).setFontWeight('bold').setFontColor(BIRU_TUA)
    .setVerticalAlignment('middle');
  d.setRowHeight(1, 34);
  gabung(`C2:${lebarHuruf}2`)
    .setValue('Angka bank dibaca dari tab "Statement" (boleh diketik tangan untuk statement lama). '
      + 'Angka pembukuan dihitung dari Saldo Awal rekening di tab "Akun" ditambah seluruh mutasi di tab data — '
      + `bukan dari kolom Saldo cetakan bank. Selisih sampai Rp ${TOLERANSI_KONTROL} dianggap cocok. `
      + 'Bulan yang transaksi emailnya sudah masuk tapi e-statement-nya belum akan tampak selisih — itu memang tujuannya.')
    .setFontStyle('italic').setFontColor('#5f6368').setFontSize(10).setWrap(true);
  d.setRowHeight(2, 30);

  /* ---------- Kartu ringkasan ---------- */
  // Rumusnya dipasang BELAKANGAN (lihat akhir fungsi): semuanya menghitung
  // isi blok 1 & 2, yang alamatnya baru pasti setelah blok itu dibangun.
  const KARTU = [
    { kol: 'A', label: 'BULAN DIPERIKSA', bg: '#f1f3f4', fg: '#3c4043', format: '#,##0' },
    { kol: 'C', label: 'COCOK', bg: '#e6f4ea', fg: HIJAU, format: '#,##0' },
    { kol: 'E', label: 'PERLU DIPERIKSA', bg: '#fce8e6', fg: MERAH, format: '#,##0' },
    { kol: 'G', label: 'SELISIH TERBESAR', bg: '#fce8e6', fg: MERAH, format: RP },
    { kol: 'I', label: 'BULAN TANPA STATEMENT', bg: '#fef7e0', fg: '#b45309', format: '#,##0' },
  ];
  KARTU.forEach((k) => {
    const akhir = String.fromCharCode(k.kol.charCodeAt(0) + 1);
    d.getRange(`${k.kol}4:${akhir}4`).merge().setValue(k.label)
      .setFontWeight('bold').setFontSize(9).setFontColor(k.fg).setBackground(k.bg)
      .setHorizontalAlignment('center');
    d.getRange(`${k.kol}5:${akhir}6`).merge()
      .setFontSize(18).setFontWeight('bold').setFontColor(k.fg).setBackground(k.bg)
      .setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setNumberFormat(k.format);
  });
  d.setRowHeights(5, 2, 30);

  let r = 9;

  const judulSeksi = (teks) => {
    d.getRange(r, 1).setValue(teks).setFontWeight('bold').setFontSize(11).setFontColor(BIRU_TUA);
    r += 1;
  };

  /* ---------- Blok 1: kontrol per rekening per bulan ---------- */
  const mulai1 = r;
  judulSeksi('KONTROL PER REKENING PER BULAN');

  // Pita kelompok: memisahkan mana angka bank, mana angka pembukuan, mana
  // selisihnya. Tanpa pita ini, 17 kolom berjudul mirip-mirip ("Saldo Akhir
  // Statement" vs "Saldo Akhir Pembukuan") sangat mudah tertukar saat dibaca.
  pitaSeksi(d, `C${r}:G${r}`, 'ANGKA BANK (E-STATEMENT)', '#0b8043');
  pitaSeksi(d, `H${r}:L${r}`, 'ANGKA PEMBUKUAN (SHEET)', BIRU_TUA);
  pitaSeksi(d, `M${r}:P${r}`, 'SELISIH', '#b45309');
  d.getRange(`C${r}:P${r}`).setHorizontalAlignment('center').setFontSize(9);
  r += 1;

  const kepala1 = r;
  const isi1 = kepala1 + 1;
  const akhir1 = kepala1 + nKontrol;

  // Baris digerakkan pasangan rekening+bulan di tab Statement. Pakai
  // SORT(UNIQUE(FILTER())), bukan QUERY "group by" tanpa agregat (yang tidak
  // mengembalikan apa pun di Sheets sungguhan). ARRAY_CONSTRAIN memotong hasil
  // pas sejumlah baris yang dialokasikan.
  pasangRumus(`A${isi1}`,
    `=IFERROR(ARRAY_CONSTRAIN(SORT(UNIQUE(FILTER({${S_REK}${AS}${S_BULAN}}${S}`
    + `(${S_REK}<>"")*(${S_BULAN}<>"")))${S}1${S}TRUE${S}2${S}TRUE)${S}${nKontrol}${S}2)${S}`
    + `"Belum ada baris di tab Statement")`);

  // Header ditulis sendiri untuk SELURUH kolom: tanpa QUERY tidak ada lagi
  // klausa `label` yang menghasilkan baris header sendiri.
  [
    'Rekening', 'Bulan',
    'Saldo Awal', 'Saldo Akhir', 'Debet', 'Kredit', 'Jml Trx',
    'Saldo Awal', 'Saldo Akhir', 'Debet', 'Kredit', 'Jml Trx',
    'Saldo Awal', 'Saldo Akhir', 'Mutasi', 'Jml Trx', 'Status',
  ].forEach((teks, i) => d.getRange(kepala1, i + 1).setValue(teks));
  kepalaTabel(d, `A${kepala1}:${lebarHuruf}${kepala1}`);
  d.setFrozenRows(kepala1);
  // Dua kolom, dan angka ini terikat pada tata letak judul di atas: seluruh
  // sel gabungan di tab ini berhenti di kolom B atau mulai dari kolom C.
  // Menaikkannya tanpa memindahkan batas gabungan itu akan melempar
  // exception dan menjatuhkan pembangunan (lihat catatan di blok Judul).
  d.setFrozenColumns(2);

  const rumus1 = [];
  for (let b = isi1; b <= akhir1; b += 1) {
    const cocokStatement = `(${S_REK}=$A${b})*(${S_BULAN}=$B${b})`;
    const cocokLedger = `(${maya.REK}=$A${b})*(${maya.BULAN}=$B${b})`;

    // Saldo awal bank dari statement paling AWAL di bulan itu, saldo akhir dari
    // yang paling AKHIR (relevan bila satu bulan ter-upload dua kali). Kolom G/H
    // dipakai mentah: sel kosong harus tetap kosong, bukan nol.
    const saldoAwalBank = `IFERROR(INDEX(SORT(FILTER({${kolS('G')}${AS}${kolS('E')}}${S}`
      + `${cocokStatement}*(${kolS('G')}<>""))${S}2${S}TRUE)${S}1${S}1)${S}"")`;
    const saldoAkhirBank = `IFERROR(INDEX(SORT(FILTER({${kolS('H')}${AS}${kolS('F')}}${S}`
      + `${cocokStatement}*(${kolS('H')}<>""))${S}2${S}FALSE)${S}1${S}1)${S}"")`;
    // Mutasi & jumlah transaksi bank DIJUMLAHKAN: dua statement di satu bulan
    // memang dua potongan mutasi bulan yang sama. Dibedakan lebih dulu antara
    // "nol" dan "tidak disebutkan" — kalau tidak, statement yang tidak
    // mencetak blok MUTASI akan tampak seperti bulan tanpa transaksi.
    const jumlahBank = (huruf) => `IF(SUMPRODUCT(${cocokStatement}*(${kolS(huruf)}<>""))=0${S}""${S}`
      + `SUMPRODUCT(${cocokStatement}*ARRAYFORMULA(N(${kolS(huruf)}))))`;

    const saldoAwalBuku = `SUMPRODUCT((${A_REK}=$A${b})*(${kolA('N')}="")*ARRAYFORMULA(N(${kolA('G')})))`
      + `+SUMPRODUCT((${maya.REK}=$A${b})*(${maya.BULAN}<>"")*(${maya.BULAN}<$B${b})*${maya.NETTO})`;

    rumus1.push([
      `=IF($A${b}=""${S}""${S}${saldoAwalBank})`,                                  // C
      `=IF($A${b}=""${S}""${S}${saldoAkhirBank})`,                                 // D
      `=IF($A${b}=""${S}""${S}${jumlahBank('I')})`,                                // E
      `=IF($A${b}=""${S}""${S}${jumlahBank('J')})`,                                // F
      `=IF($A${b}=""${S}""${S}${jumlahBank('K')})`,                                // G
      `=IF($A${b}=""${S}""${S}${saldoAwalBuku})`,                                  // H
      `=IF($A${b}=""${S}""${S}$H${b}+$K${b}-$J${b})`,                              // I
      `=IF($A${b}=""${S}""${S}SUMPRODUCT(${cocokLedger}*${DEBET}))`,               // J
      `=IF($A${b}=""${S}""${S}SUMPRODUCT(${cocokLedger}*${KREDIT}))`,              // K
      `=IF($A${b}=""${S}""${S}SUMPRODUCT(${cocokLedger}*1))`,                      // L
      `=IF(OR($A${b}=""${S}$C${b}="")${S}""${S}$H${b}-$C${b})`,                    // M
      `=IF(OR($A${b}=""${S}$D${b}="")${S}""${S}$I${b}-$D${b})`,                    // N
      // Kontrol yang TIDAK bergantung Saldo Awal rekening: perubahan saldo
      // menurut bank harus sama dengan jumlah mutasi menurut pembukuan. Ini
      // pemeriksaan kelengkapan yang paling kuat di tabel ini — ia tetap
      // berlaku walau Saldo Awal di tab Akun belum pernah diisi.
      `=IF(OR($A${b}=""${S}$C${b}=""${S}$D${b}="")${S}""${S}($D${b}-$C${b})-($K${b}-$J${b}))`, // O
      `=IF(OR($A${b}=""${S}$G${b}="")${S}""${S}$L${b}-$G${b})`,                    // P
      `=IF($A${b}=""${S}""${S}`
        + `IF(AND($C${b}=""${S}$D${b}="")${S}"➖ Statement tanpa saldo"${S}`
        + `IF(AND(IF($M${b}=""${S}TRUE${S}ABS($M${b})<=${TOLERANSI_KONTROL})${S}`
        + `IF($N${b}=""${S}TRUE${S}ABS($N${b})<=${TOLERANSI_KONTROL})${S}`
        + `IF($O${b}=""${S}TRUE${S}ABS($O${b})<=${TOLERANSI_KONTROL}))${S}`
        + `IF(OR($P${b}=""${S}$P${b}=0)${S}"✅ Cocok"${S}"⚠️ Jumlah transaksi beda")${S}`
        + `"❌ Selisih saldo")))`,                                                  // Q
    ]);
  }
  d.getRange(isi1, 3, rumus1.length, 15).setFormulas(rumus1);
  // Rumus per baris tidak lewat pasangRumus (terlalu banyak). Baris pertama
  // dicatat sebagai jangkar; bentuk rumus baris lain sama.
  jangkar.push(`C${isi1}`, `H${isi1}`, `Q${isi1}`);

  d.getRange(`C${isi1}:F${akhir1}`).setNumberFormat(RP);
  d.getRange(`G${isi1}:G${akhir1}`).setNumberFormat('#,##0');
  d.getRange(`H${isi1}:K${akhir1}`).setNumberFormat(RP);
  d.getRange(`L${isi1}:L${akhir1}`).setNumberFormat('#,##0');
  d.getRange(`M${isi1}:O${akhir1}`).setNumberFormat(RP);
  d.getRange(`P${isi1}:P${akhir1}`).setNumberFormat('#,##0');
  d.getRange(`B${isi1}:B${akhir1}`).setHorizontalAlignment('center');
  d.getRange(`Q${isi1}:Q${akhir1}`).setHorizontalAlignment('center');
  kolomSelisih.push(d.getRange(`M${isi1}:P${akhir1}`));
  const statusKontrol = d.getRange(`Q${isi1}:Q${akhir1}`);
  bandingTabel(d, `A${isi1}:${lebarHuruf}${akhir1}`);
  rentang.push([mulai1, akhir1]);
  r = akhir1 + 2;

  /* ---------- Blok 2: bulan pembukuan tanpa e-statement ---------- */
  const mulai2 = r;
  judulSeksi('BULAN PEMBUKUAN TANPA E-STATEMENT');
  const kepala2 = r;
  const isi2 = kepala2 + 1;
  const akhir2 = kepala2 + nLedger;
  pasangRumus(`A${kepala2}`,
    `=IFERROR(QUERY({${maya.REK}${AS}${maya.BULAN}${AS}${DEBET}${AS}${KREDIT}}${S}`
    + `"select Col1, Col2, sum(Col3), sum(Col4), count(Col3) `
    + `where Col1 <> '' and Col2 <> '' group by Col1, Col2 `
    + `order by Col1 asc, Col2 asc limit ${nLedger} `
    + `label Col1 'Rekening', Col2 'Bulan', sum(Col3) 'Debet', sum(Col4) 'Kredit', count(Col3) 'Jml Trx'"${S}0)${S}`
    + `"Belum ada data")`);
  d.getRange(kepala2, 6).setValue('Statement');
  d.getRange(kepala2, 7).setValue('Status');
  kepalaTabel(d, `A${kepala2}:G${kepala2}`);

  const rumus2 = [];
  for (let b = isi2; b <= akhir2; b += 1) {
    rumus2.push([
      `=IF($A${b}=""${S}""${S}SUMPRODUCT((${S_REK}=$A${b})*(${S_BULAN}=$B${b})))`,
      `=IF($A${b}=""${S}""${S}IF($F${b}>0${S}"✅ Ada"${S}"⚠️ Belum ada"))`,
    ]);
  }
  d.getRange(isi2, 6, rumus2.length, 2).setFormulas(rumus2);
  jangkar.push(`F${isi2}`);
  d.getRange(`C${isi2}:D${akhir2}`).setNumberFormat(RP);
  d.getRange(`E${isi2}:F${akhir2}`).setNumberFormat('#,##0');
  d.getRange(`B${isi2}:B${akhir2}`).setHorizontalAlignment('center');
  d.getRange(`G${isi2}:G${akhir2}`).setHorizontalAlignment('center');
  const statusLedger = d.getRange(`G${isi2}:G${akhir2}`);
  bandingTabel(d, `A${isi2}:G${akhir2}`);
  rentang.push([mulai2, akhir2]);
  r = akhir2 + 2;

  /* ---------- Blok 3: rekap per rekening ---------- */
  const mulai3 = r;
  judulSeksi('REKAP KONTROL PER REKENING');
  const kepala3 = r;
  const isi3 = kepala3 + 1;
  const akhir3 = kepala3 + nRekap;
  // Sama seperti blok 1: tanpa QUERY, karena bentuk "group by tanpa agregat"
  // itulah yang gagal di Sheet sungguhan.
  pasangRumus(`A${isi3}`,
    `=IFERROR(ARRAY_CONSTRAIN(SORT(UNIQUE(FILTER(${S_REK}${S}${S_REK}<>"")))${S}${nRekap}${S}1)${S}`
    + `"Belum ada baris di tab Statement")`);
  ['Rekening', 'Bulan Diperiksa', 'Cocok', 'Perlu Diperiksa', 'Saldo Akhir Bank (terbaru)',
    'Saldo Akhir Pembukuan', 'Selisih'].forEach((teks, i) => d.getRange(kepala3, i + 1).setValue(teks));
  kepalaTabel(d, `A${kepala3}:G${kepala3}`);

  const rumus3 = [];
  for (let b = isi3; b <= akhir3; b += 1) {
    // Saldo akhir TERBARU: baris blok 1 milik rekening ini dengan bulan
    // terbesar. Diambil dari blok 1, bukan menyaring ulang tab Statement —
    // rekapnya harus konsisten dengan tabel di atasnya, termasuk kalau satu
    // bulan punya dua statement.
    const terbaru = (kolomNilai) => `IFERROR(INDEX(SORT(FILTER({$${kolomNilai}$${isi1}:$${kolomNilai}$${akhir1}${AS}`
      + `$B$${isi1}:$B$${akhir1}}${S}($A$${isi1}:$A$${akhir1}=$A${b})*($B$${isi1}:$B$${akhir1}<>""))${S}2${S}FALSE)${S}1${S}1)${S}"")`;
    rumus3.push([
      `=IF($A${b}=""${S}""${S}COUNTIFS($A$${isi1}:$A$${akhir1}${S}$A${b}))`,
      `=IF($A${b}=""${S}""${S}COUNTIFS($A$${isi1}:$A$${akhir1}${S}$A${b}${S}$Q$${isi1}:$Q$${akhir1}${S}"✅*"))`,
      `=IF($A${b}=""${S}""${S}$B${b}-$C${b})`,
      `=IF($A${b}=""${S}""${S}${terbaru('D')})`,
      `=IF($A${b}=""${S}""${S}${terbaru('I')})`,
      `=IF(OR($A${b}=""${S}$E${b}=""${S}$F${b}="")${S}""${S}$F${b}-$E${b})`,
    ]);
  }
  d.getRange(isi3, 2, rumus3.length, 6).setFormulas(rumus3);
  jangkar.push(`B${isi3}`, `E${isi3}`);
  d.getRange(`B${isi3}:D${akhir3}`).setNumberFormat('#,##0');
  d.getRange(`E${isi3}:G${akhir3}`).setNumberFormat(RP);
  kolomSelisih.push(d.getRange(`G${isi3}:G${akhir3}`));
  bandingTabel(d, `A${isi3}:G${akhir3}`);
  rentang.push([mulai3, akhir3]);

  /* ---------- Kartu ringkasan: rumusnya sekarang bisa dipasang ---------- */
  const sel = (a1, rumus) => { d.getRange(a1).setFormula(rumus); jangkar.push(a1); };
  sel('A5', `=COUNTIF($A$${isi1}:$A$${akhir1}${S}"?*")`);
  sel('C5', `=COUNTIF($Q$${isi1}:$Q$${akhir1}${S}"✅*")`);
  // "Perlu diperiksa" menghitung yang BUKAN cocok dan bukan baris kosong —
  // termasuk "➖ Statement tanpa saldo". Baris itu memang bukan selisih, tapi
  // juga belum terperiksa, dan menyembunyikannya di antara yang cocok
  // membuat kartu ini membesarkan hati tanpa alasan.
  sel('E5', `=A5-C5`);
  sel('G5', `=IFERROR(ARRAYFORMULA(MAX(ABS(IF($M$${isi1}:$P$${akhir1}=""${S}0${S}$M$${isi1}:$P$${akhir1}))))${S}0)`);
  sel('I5', `=COUNTIF($G$${isi2}:$G$${akhir2}${S}"⚠️*")`);

  /* ---------- Pewarnaan bersyarat ---------- */
  const aturan = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(TOLERANSI_KONTROL).setBackground('#fce8e6').setFontColor(MERAH).setBold(true)
      .setRanges(kolomSelisih).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(-TOLERANSI_KONTROL).setBackground('#fce8e6').setFontColor(MERAH).setBold(true)
      .setRanges(kolomSelisih).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('✅').setBackground('#e6f4ea').setFontColor(HIJAU).setBold(true)
      .setRanges([statusKontrol, statusLedger]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('❌').setBackground('#fce8e6').setFontColor(MERAH).setBold(true)
      .setRanges([statusKontrol]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('⚠️').setBackground('#fef7e0').setFontColor('#b45309').setBold(true)
      .setRanges([statusKontrol, statusLedger]).build(),
  ];
  d.setConditionalFormatRules(aturan);

  return { jangkar, rentang };
}

/** Tab Konfigurasi Email, create-once dan sengaja kosong (lihat konstantanya). */
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

/** Tab tersembunyi _EmailMasuk: dibuat sekali, hanya ditambah baris. */
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

/** Tab Transaksi Email: dibuat sekali, hanya ditulis skrip. */
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
  // RRN dan Nomor Referensi WAJIB teks: setValues mengubah nilai digit-murni
  // jadi Number, sementara yang berhuruf tetap string, dan pencocokan
  // referensi jadi tidak konsisten. Dipasang di luar blok "tab belum ada"
  // supaya tab lama ikut terformat, dan hanya sampai getLastRow() (bukan
  // getMaxRows()) supaya tidak memformat ribuan baris kosong.
  t.getRange(2, 10, Math.max(t.getLastRow() - 1, 1), 2).setNumberFormat('@');
  return t;
}

/** Tab Log Email: dibuat sekali, hanya ditambah baris. */
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

/** Buat tab Akun/Kategori bila belum ada, dan perbaiki headernya bila berubah. */
function pastikanTabEntitas(ss, nama, header) {
  let sh = ss.getSheetByName(nama);
  if (!sh) {
    sh = ss.insertSheet(nama, ss.getNumSheets());
    sh.appendRow(header);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length)
      .setFontWeight('bold').setFontColor('#ffffff').setBackground(BIRU_TUA)
      .setVerticalAlignment('middle');
    sh.setTabColor('#0b8043');
    return sh;
  }
  if (sh.getMaxColumns() < header.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), header.length - sh.getMaxColumns());
  }
  const h = sh.getRange(1, 1, 1, header.length).getValues()[0].map(String);
  if (h.join('|') !== header.join('|')) sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}

/**
 * Upsert/hapus baris Akun, Kategori, atau Statement berdasarkan ID (kolom A).
 * Tabelnya kecil, jadi ditulis langsung tanpa optimasi blok. Penghapusan
 * Akun/Kategori menstempel "Dihapus Pada" (tombstone, AD-008), bukan membuang
 * baris.
 */
function tanganiEntitas(data, header, kolom, namaTab) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Tab Statement punya format sendiri (kolom Bulan dipaksa teks, kolom saldo
  // ber-format rupiah) yang harus terpasang sejak pertama kali dibuat —
  // pastikanTabEntitas tidak tahu soal itu.
  const sh = namaTab === STATEMENT_SHEET_NAME
    ? pastikanStatement(ss)
    : pastikanTabEntitas(ss, namaTab, header);
  const lebar = header.length;
  const kolomDihapusPada = kolom.indexOf('dihapusPada') + 1; // 1-based untuk getRange (0 = tidak ada)
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const hapus = Array.isArray(data.hapus) ? data.hapus.map(String).filter(Boolean) : [];

  const last = sh.getLastRow();
  const lama = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  const nomorBaris = {};
  lama.forEach((r, i) => { const id = String(r[0] || ''); if (id) nomorBaris[id] = i + 2; });

  const ditombstone = {};
  hapus.forEach((id) => { if (nomorBaris[id]) ditombstone[nomorBaris[id]] = true; });

  // Payload tidak seharusnya pernah berisi ID ganda, tapi tetap dijaga di
  // sini seperti alur TRANSAKSI: kejadian terakhir yang dipakai.
  const dedup = new Map();
  rows.forEach((r) => { if (r && r.id) dedup.set(String(r.id), r); });

  const tambah = [];
  const perbarui = [];
  // Angka statement yang kosong di aplikasi berarti "tidak terbaca dari PDF",
  // bukan "hapus angkanya": banyak baris diisi tangan langsung di Sheet
  // (statement lama yang ringkasannya tidak terbaca). Tanpa ini, "Kirim semua
  // sekarang" mengosongkan seluruh angka yang diketik pengguna.
  const kolomPertahankan = namaTab === STATEMENT_SHEET_NAME
    ? ['saldoAwalStatement', 'saldoAkhirStatement', 'mutasiDebetStatement', 'mutasiKreditStatement']
      .map((k) => kolom.indexOf(k)).filter((i) => i !== -1)
    : [];
  const isiLama = kolomPertahankan.length && last > 1 ? sh.getRange(2, 1, last - 1, lebar).getValues() : [];
  for (const r of dedup.values()) {
    const id = String(r.id);
    const nilai = kolom.map((k) => {
      const v = r[k];
      return v === null || v === undefined ? '' : v;
    });
    const baris = nomorBaris[id];
    if (baris && kolomPertahankan.length) {
      const lamaBaris = isiLama[baris - 2] || [];
      kolomPertahankan.forEach((i) => {
        if (nilai[i] === '' && lamaBaris[i] !== '' && lamaBaris[i] !== null && lamaBaris[i] !== undefined) nilai[i] = lamaBaris[i];
      });
    }
    if (baris && !ditombstone[baris]) perbarui.push({ baris, nilai });
    else if (!baris) tambah.push(nilai);
  }

  perbarui.forEach((p) => sh.getRange(p.baris, 1, 1, lebar).setValues([p.nilai]));
  if (tambah.length) sh.getRange(sh.getLastRow() + 1, 1, tambah.length, lebar).setValues(tambah);

  const nomorTombstone = Object.keys(ditombstone).map(Number);
  const sekarang = new Date();
  if (kolomDihapusPada > 0) {
    nomorTombstone.forEach((n) => sh.getRange(n, kolomDihapusPada).setValue(sekarang));
  } else {
    // Statement tidak punya tombstone: tidak pernah ditarik balik ke perangkat,
    // dan baris yang tertinggal membuat Kontrol Saldo membandingkan dengan
    // statement yang sudah dibatalkan. Dihapus dari bawah ke atas.
    tanpaFilter(sh, () => nomorTombstone.sort((a, b) => b - a).forEach((n) => sh.deleteRow(n)));
  }

  return {
    ok: true,
    inserted: tambah.length,
    updated: perbarui.length,
    dihapus: nomorTombstone.length,
    spreadsheet: ss.getName(),
    sheet: sh.getName(),
  };
}

/**
 * Baca seluruh tab Akun/Kategori (termasuk tombstone) untuk doPost{tarikEntitas}.
 * Tanpa checkpoint `sejak`: tabelnya kecil, dan full pull menghindari soal
 * selisih jam klien vs server.
 */
function tarikEntitas(header, kolom, namaTab) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = pastikanTabEntitas(ss, namaTab, header);
  const last = sh.getLastRow();
  if (last < 2) return [];

  const nilai = sh.getRange(2, 1, last - 1, header.length).getValues();
  return nilai
    .filter((r) => String(r[0] || '')) // baris tanpa ID (kosong) dilewati
    .map((r) => {
      const obj = {};
      kolom.forEach((k, i) => {
        const v = r[i];
        // Date sungguhan (Diubah Pada/Dihapus Pada/Dibuat Pada) ditulis balik
        // sebagai ISO string, sama seperti bangunBarisTarikTransaksiEmail —
        // JSON.stringify sendiri akan mengubah objek Date jadi ISO, tapi
        // eksplisit di sini lebih jelas dan tidak bergantung pada perilaku itu.
        obj[k] = v instanceof Date ? v.toISOString() : v;
      });
      return obj;
    });
}

/**
 * Nama bulan ke indeks 0-11, singkatan Indonesia DAN Inggris: BCA dan Permata
 * memakai bahasa berbeda ("11 Sep 2026" vs "24 Aug 2026").
 */
const BULAN_MAP = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MEI: 4, MAY: 4, JUN: 5, JUL: 6,
  AGU: 7, AUG: 7, SEP: 8, OKT: 9, OCT: 9, NOV: 10, DES: 11, DEC: 11,
};

/**
 * Ambil nilai satu field "Label : Nilai" dari isi email. Regex per label,
 * dengan `\s*` di kedua sisi ":" supaya tahan perubahan spasi dari
 * getPlainBody(); nilai berhenti di akhir baris supaya "Jam : 10:13:35" utuh.
 * Fungsi murni.
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
  let hari;
  let bulan;
  let tahun;
  const angka = String(tgl || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); // "22/07/2026" (QR Pay)
  if (angka) {
    hari = Number(angka[1]); bulan = Number(angka[2]) - 1; tahun = Number(angka[3]);
  } else {
    const m = String(tgl || '').match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
    if (!m) return null;
    hari = Number(m[1]); bulan = BULAN_MAP[m[2].toUpperCase().slice(0, 3)]; tahun = Number(m[3]);
  }
  if (bulan === undefined || bulan < 0 || bulan > 11) return null;
  const j = String(jam || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const jj = j ? Number(j[1]) : 0;
  const mm = j ? Number(j[2]) : 0;
  const ss = j && j[3] ? Number(j[3]) : 0;
  return new Date(tahun, bulan, hari, jj, mm, ss);
}

/** Versi parser dicatat per hasil parse — lihat HEADER_TRANSAKSI_EMAIL. */
const PARSER_VERSION_BCA = 'bca-v2';
const PARSER_VERSION_PERMATA = 'permata-v2';

/**
 * Parser email BCA ("Internet Transaction Journal"), dari sampel asli. Dua
 * template, dibedakan field-nya:
 *   - "Jenis Transaksi" -> pembayaran (QRIS/kartu/VA, uang keluar).
 *   - "Jenis Transfer"  -> transfer ke sesama BCA.
 * Template lain menghasilkan parsedOk:false, bukan hasil tebakan. Fungsi murni.
 */
function parseEmailBCA(bodyText) {
  const body = String(bodyText || '');
  if (ekstrakField(body, 'Jenis Transaksi')) return parseEmailBCAPembayaran(body);
  if (ekstrakField(body, 'Jenis Transfer')) return parseEmailBCATransfer(body);
  return { parsedOk: false, error: 'Template email BCA tidak dikenali (bukan notifikasi pembayaran maupun transfer)' };
}

/**
 * Sub-template "Jenis Transaksi": pembayaran QRIS/kartu, Virtual Account,
 * Transfer QRIS, top up Flazz/e-Wallet, pulsa, SIGNAL. Nominal diambil dari
 * Total Bayar (sudah termasuk biaya admin) bila ada; lawan transaksi dari
 * field yang tersedia, atau jenis transaksinya sendiri (mis. "Top Up Flazz").
 */
function parseEmailBCAPembayaran(body) {
  const tanggalTransaksi = ekstrakField(body, 'Tanggal Transaksi');
  const jenisTransaksi = ekstrakField(body, 'Jenis Transaksi');
  const pembayaranKe = ekstrakField(body, 'Pembayaran Ke') || ekstrakField(body, 'Nama Perusahaan/Produk')
    || ekstrakField(body, 'Nama Penerima') || jenisTransaksi;
  const lokasiMerchant = ekstrakField(body, 'Lokasi Merchant');
  const pengakuisisi = ekstrakField(body, 'Pengakuisisi');
  const totalBayar = ekstrakField(body, 'Total Bayar');
  const rrn = ekstrakField(body, 'RRN');
  const nomorReferensi = ekstrakField(body, 'Nomor Referensi');

  const eventTime = parseTanggalJamGabungan(tanggalTransaksi);
  const amount = parseNominalIDR(totalBayar) || parseNominalIDR(ekstrakField(body, 'Nominal Top Up'))
    || parseNominalIDR(ekstrakField(body, 'Nominal'));

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

/**
 * Sub-template "Jenis Transfer": transfer ke sesama BCA ("Nominal Tujuan"),
 * ke bank lain ("Nominal"; biaya transfer muncul sebagai baris terpisah di
 * e-statement), dan tarik tunai tanpa kartu (lawan transaksi = jenisnya).
 */
function parseEmailBCATransfer(body) {
  const tanggalTransaksi = ekstrakField(body, 'Tanggal Transaksi');
  const jenisTransfer = ekstrakField(body, 'Jenis Transfer');
  const namaPenerima = ekstrakField(body, 'Nama Penerima') || jenisTransfer;
  const nomorReferensi = ekstrakField(body, 'Nomor Referensi');

  const eventTime = parseTanggalJamGabungan(tanggalTransaksi);
  const amount = parseNominalIDR(ekstrakField(body, 'Nominal Tujuan')) || parseNominalIDR(ekstrakField(body, 'Nominal'));

  if (!eventTime || !amount || !namaPenerima) {
    return { parsedOk: false, error: 'Field minimum (tanggal transaksi/nominal/penerima) tidak ditemukan di isi email' };
  }

  return {
    parsedOk: true,
    bank: 'BCA',
    eventTime,
    amount,
    direction: 'debit', // transfer keluar / tarik tunai
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
 * Parser email Permata, dari sampel asli: transfer keluar (BI-FAST), transfer
 * masuk, QR Pay ("Total Nominal", tanggal dd/mm/yyyy), top up e-wallet
 * ("Nominal Isi Ulang"), dan pembayaran Virtual Account ("Total Tagihan").
 * Fungsi murni.
 */
function parseEmailPermata(bodyText) {
  const body = String(bodyText || '');
  const tanggal = ekstrakField(body, 'Tanggal');
  const jam = ekstrakField(body, 'Jam');
  const kategori = ekstrakField(body, 'Kategori');
  const namaPenerima = ekstrakField(body, 'Nama Penerima') || ekstrakField(body, 'Nama Merchant')
    || ekstrakField(body, 'Tipe Pembayaran') || ekstrakField(body, 'Kategori Isi Ulang');
  // "Nominal" juga cocok dengan "Total Nominal" (QR Pay).
  const nominal = ekstrakField(body, 'Nominal') || ekstrakField(body, 'Nominal Isi Ulang')
    || ekstrakField(body, 'Total Tagihan');
  const nomorReferensi = ekstrakField(body, 'Nomor referensi transaksi')
    || ekstrakField(body, 'No. Referensi Transaksi');
  // Template "Incoming Transfer" (gaji, kiriman masuk) memakai Tanggal/Jam/
  // Nominal yang sama, tapi uangnya MASUK dan lawan transaksinya pengirim.
  const namaPengirim = ekstrakField(body, 'Nama Pengirim');
  const masuk = /transfer masuk|incoming transfer/i.test(body) || Boolean(namaPengirim);

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
    direction: masuk ? 'kredit' : 'debit',
    merchantRaw: (masuk ? namaPengirim : namaPenerima) || null,
    jenisTransaksi: kategori || (masuk ? 'Transfer Masuk' : null),
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
  if (POLA_STATUS_GAGAL.test(String(bodyText || ''))) {
    return { parsedOk: false, error: 'Transaksi berstatus gagal, tidak dicatat' };
  }
  if (bank === 'BCA') return parseEmailBCA(bodyText);
  if (bank === 'Permata') return parseEmailPermata(bodyText);
  return { parsedOk: false, error: `Parser untuk bank "${bank}" belum tersedia` };
}

/**
 * Klasifikasi satu email: transaction_email (cocok pola aktif), non_transaction
 * (subjek memuat kata kecuali), atau unknown. Unknown sengaja tidak dianggap
 * non_transaction (lihat pollEmailTransaksi). Fungsi murni.
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

/** Pola aktif dari tab Konfigurasi Email, siap dipakai klasifikasikanEmail(). */
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
 * Fragmen query Gmail "(from:a OR from:b ...)" dari pola pengirim aktif.
 *
 * Wajib, bukan optimisasi: tanpa pembatasan ini, email non-bank terklasifikasi
 * 'unknown', tidak pernah dilabeli, dan muncul lagi di setiap pencarian
 * sampai menghabiskan kuota thread per jalan tanpa kemajuan.
 *
 * Mengembalikan '' bila ada baris aktif dengan polaPengirim kosong (aturan
 * berbasis subjek saja), supaya jangkauan aturan itu tidak terpotong.
 */
function bangunQueryPengirimGmail(konfigurasi) {
  const aktif = (konfigurasi || []).filter((k) => k.aktif !== false);
  if (aktif.some((k) => !String(k.polaPengirim || '').trim())) return '';
  const pola = [...new Set(aktif.map((k) => String(k.polaPengirim).trim()))];
  if (!pola.length) return '';
  return `(${pola.map((p) => `from:${p}`).join(' OR ')})`;
}

/**
 * Poll Gmail untuk email transaksi baru (menu manual atau time-driven trigger).
 *
 * Idempotensi lewat label LABEL_EMAIL_DIPROSES. Thread dilabeli hanya bila
 * semua pesannya tuntas (transaksi tersimpan atau pasti bukan transaksi).
 * Pesan "unknown" tidak dilabeli, supaya ikut terjaring setelah pola baru
 * ditambahkan (dalam JENDELA_PENCARIAN_EMAIL_HARI).
 *
 * Email yang lolos diparse lalu ditulis ke _EmailMasuk (selalu, untuk audit)
 * dan Transaksi Email (hanya bila parse berhasil). reparseEmailGagal()
 * dipanggil di awal, jadi perbaikan parser menyembuhkan email lama tanpa
 * menyentuh Gmail lagi.
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
 * Klasifikasi + parsing + label satu kumpulan thread. Dipakai bersama
 * pollEmailTransaksi() dan jalankanBackfillEmail(), yang hanya beda query.
 * `idSudahAda` diubah di tempat.
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
 * Batas thread per jalan backfill: jauh di atas polling, tapi tetap di bawah
 * batas eksekusi Apps Script. Aman diulang; thread berlabel dilewati.
 */
const MAKS_THREAD_BACKFILL_PER_JALAN = 300;

/**
 * Menu "Tarik Email Lama (Backfill)": email transaksi yang sudah ada sebelum
 * pemantauan dipasang. Tidak pernah dipanggil trigger otomatis.
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
 * Inti backfill, dipisah dari menu supaya bisa diuji tanpa getUi().
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

/** Fungsi murni: satu baris log dari hasil pollEmailTransaksi(). */
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
 * Fungsi murni: apakah satu jalan pollEmailTransaksi() layak dicatat. Hanya
 * jalan yang melakukan sesuatu atau gagal dengan alasan jelas, supaya trigger
 * 5 menit tidak membanjiri tab dengan baris kosong.
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
 * Parse ulang baris _EmailMasuk yang gagal, dari teks yang sudah tersimpan
 * (tanpa Gmail). Baris yang berhasil ditimpa di tempat; baris Transaksi Email
 * baru hanya ditambahkan bila Gmail Message ID-nya belum ada.
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
 * Baris Transaksi Email sebagai objek datar untuk doPost{tarikTransaksiEmail},
 * hanya yang "Dibuat Pada"-nya sesudah `sejakValid` (null = semua).
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
 * Menu "Aktifkan Pemantauan Email Transaksi": pasang time-driven trigger.
 * Jalankan "Proses Email Transaksi Sekarang" dulu supaya otorisasi Gmail
 * pertama diberikan lewat jalur yang diawasi.
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
 * Ukur tab data sekali untuk tata letak Dashboard: rekening, bulan, kategori.
 * Label rekening = Bank + No. Rekening (accountId tidak dikirim ke Sheet).
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
 * Sidik BENTUK data. Jumlah kategori dibulatkan per 5 supaya pertumbuhan kecil
 * yang masih muat cadangan tidak memicu pembangunan ulang. `anggaranBaris`
 * tidak dibulatkan: blok Anggaran vs Realisasi disizekan pas tanpa cadangan.
 */
function sidikData(stat, anggaranBaris, statStatement) {
  return [
    stat.rekening.join('|'),
    stat.bulan.length,
    Math.ceil(stat.katKeluar / 5),
    Math.ceil(stat.katMasuk / 5),
    anggaranBaris || 0,
    // TIDAK dibulatkan, dengan alasan yang sama seperti anggaranBaris: satu
    // e-statement baru berarti satu baris kontrol baru yang harus segera
    // muncul, bukan menunggu sampai cadangan barisnya penuh.
    (statStatement && statStatement.rekeningBulan) || 0,
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

/**
 * Baris berselang pada badan tabel lebar (Kontrol Saldo 17 kolom) supaya mata
 * tidak pindah baris. Kegagalan (banding sudah ada) diserap.
 */
function bandingTabel(sh, a1) {
  try {
    sh.getRange(a1).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  } catch (e) {
    console.warn(`banding gagal di ${a1}: ${e && e.message}`);
  }
}

/** Pita pemisah seksi selebar tabel, seperti "PENGELUARAN (DEBIT)". */
function pitaSeksi(d, a1, teks, warna) {
  d.getRange(a1).merge()
    .setValue(teks)
    .setFontWeight('bold').setFontColor('#ffffff').setBackground(warna)
    .setVerticalAlignment('middle');
}

/**
 * Menu: hapus lalu bangun ulang tab laporan dari nol, sekaligus merapikan tab
 * data. Aman: sumber kebenaran ada di aplikasi, dan upsert berbasis hash.
 */
function bangunUlangDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = sheetData(ss);

  const lama = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  if (lama) ss.deleteSheet(lama);
  const lamaFull = ss.getSheetByName(DASHBOARD_FULL_SHEET_NAME);
  if (lamaFull) ss.deleteSheet(lamaFull);
  // Kontrol Saldo ikut dihapus supaya dibangun ulang bersama — tab Statement
  // TIDAK, karena bisa berisi angka yang diketik tangan.
  const lamaKontrol = ss.getSheetByName(KONTROL_SHEET_NAME);
  if (lamaKontrol) ss.deleteSheet(lamaKontrol);

  sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  rapikanTampilan(sh);
  pastikanSemuaTab(ss, sh.getName());

  const baru = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  if (baru) ss.setActiveSheet(baru);
  ss.toast('Selesai. Kalau ada baris yang hilang, tekan "Kirim semua sekarang" di Pengaturan aplikasi.', 'Dashboard dibangun ulang', 10);
}

/** Laporkan lokal, pemisah argumen, sheet data, dan isi sel rumus kunci. */
function diagnosaDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sh = sheetData(ss);
  const d = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  const dFull = ss.getSheetByName(DASHBOARD_FULL_SHEET_NAME);
  const anggaran = ss.getSheetByName(ANGGARAN_SHEET_NAME);
  const cari = ss.getSheetByName(CARI_TRANSAKSI_SHEET_NAME);
  const kontrol = ss.getSheetByName(KONTROL_SHEET_NAME);
  const statement = ss.getSheetByName(STATEMENT_SHEET_NAME);

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
    `Tab Statement      : ${statement ? `ada, ${Math.max(statement.getLastRow() - 1, 0)} e-statement` : 'belum ada'}`,
    `Tab Kontrol Saldo  : ${kontrol ? `ada, posisi ${kontrol.getIndex()}` : 'belum ada'}`,
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
  if (kontrol) {
    baris.push('', `[Kontrol Saldo] Dianggap rusak: ${dashboardRusak(kontrol, jangkarRumus('selRumusKontrol')) ? 'ya' : 'tidak'}`);
    // A5..I5 dulu: lima kartu ringkasan itu yang menjawab "apakah angka bank
    // dan angka pembukuan bertemu?" tanpa perlu membuka tabnya.
    ['A5', 'C5', 'E5', 'G5', 'I5'].concat(jangkarRumus('selRumusKontrol').slice(0, 4)).forEach((a) => {
      baris.push(`${a} = ${String(kontrol.getRange(a).getDisplayValue()).slice(0, 70)}`);
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

  // Ping dijawab SEBELUM kunci diambil: aplikasi memakainya tepat setelah
  // pengiriman putus, saat kunci kemungkinan masih dipegang. Ping hanya membaca.
  if (data.ping) {
    try {
      const ssPing = SpreadsheetApp.getActiveSpreadsheet();
      return json(Object.assign(tujuan(ssPing, getSheet()), {ok:true, ping:true}));
    } catch (err) {
      return json({ok:false, error: String(err && err.message || err)});
    }
  }

  // Murni baca, dijawab sebelum kunci. `sejak` adalah checkpoint dari respons
  // SEBELUMNYA (jam server), bukan jam perangkat; `sekarang` jadi checkpoint
  // berikutnya.
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

  // Tarik AKUN/KATEGORI juga murni baca — dijawab sebelum kunci diambil,
  // sama seperti ping/tarikTransaksiEmail. Dipakai restore & sync ke
  // perangkat lain (lihat services/entitas-sync.js).
  if (data.tarikEntitas === true && (data.entity === 'akun' || data.entity === 'kategori')) {
    try {
      const cfg = data.entity === 'akun'
        ? { header: HEADER_AKUN, kolom: KOLOM_AKUN, nama: AKUN_SHEET_NAME }
        : { header: HEADER_KATEGORI, kolom: KOLOM_KATEGORI, nama: KATEGORI_SHEET_NAME };
      const baris = tarikEntitas(cfg.header, cfg.kolom, cfg.nama);
      return json({ ok: true, baris });
    } catch (err) {
      return json({ ok: false, error: String(err && err.message || err) });
    }
  }

  // Tarik TRANSAKSI juga murni baca — checkpoint berdasarkan waktu SERVER
  // ("Dikirim Pada"/"Dihapus Pada", sama-sama distempel Code.gs), bukan jam
  // klien, dengan alasan yang sama seperti tarikTransaksiEmail.
  if (data.tarikTransaksi === true) {
    try {
      const sejak = data.sejak ? new Date(data.sejak) : null;
      const sejakValid = sejak && !isNaN(sejak.getTime()) ? sejak : null;
      const hasil = tarikTransaksi(sejakValid);
      return json({
        ok: true, baris: hasil.baris, dihapus: hasil.dihapus, dihapusHash: hasil.dihapusHash,
        sekarang: new Date().toISOString(),
      });
    } catch (err) {
      return json({ ok: false, error: String(err && err.message || err) });
    }
  }

  // AKUN/KATEGORI/STATEMENT: upsert/hapus berdasarkan ID, di tab
  // masing-masing — terpisah dari alur TRANSAKSI di bawah (yang berbasis hash
  // & mendukung rapikan/selaras). Tetap butuh kunci: sama-sama menulis ke
  // spreadsheet ini.
  if (data.entity === 'akun' || data.entity === 'kategori' || data.entity === 'statement') {
    const kunciEntitas = LockService.getScriptLock();
    try {
      kunciEntitas.waitLock(30000);
    } catch (err) {
      return json({ ok: false, error: 'Sheet sedang dipakai proses lain, coba lagi sebentar' });
    }
    try {
      const PETA_ENTITAS = {
        akun: { header: HEADER_AKUN, kolom: KOLOM_AKUN, nama: AKUN_SHEET_NAME },
        kategori: { header: HEADER_KATEGORI, kolom: KOLOM_KATEGORI, nama: KATEGORI_SHEET_NAME },
        statement: { header: HEADER_STATEMENT, kolom: KOLOM_STATEMENT, nama: STATEMENT_SHEET_NAME },
      };
      const cfg = PETA_ENTITAS[data.entity];
      return json(tanganiEntitas(data, cfg.header, cfg.kolom, cfg.nama));
    } catch (err) {
      return json({ ok: false, error: String(err && err.message || err) });
    } finally {
      lepasKunci(kunciEntitas);
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
    // Payload identitas (hash + label rekening saja) untuk menghitung baris
    // yatim. Barisnya tanpa tanggal/nominal, jadi jalur tulis dijaga eksplisit
    // oleh bendera ini.
    const hanyaSelaras = data.hanyaSelaras === true;

    // Penyelarasan (menghapus data) hanya bila SEMUA pengaman lolos:
    //   - `selaras` disebut eksplisit;
    //   - payload tidak kosong;
    //   - `jumlah` cocok dengan rows.length (JSON terpotong tampak sah tapi pendek).
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
    try {
      pastikanFilterMencakupHash(sh);
    } catch (e) {
      console.warn('Cek filter gagal:', e);
    }
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
    // ID Transaksi per baris, untuk memastikan Hash di kolom A masih milik
    // transaksi yang sama sebelum barisnya ditimpa (lihat konflik di bawah).
    // Hanya dibaca bila ada yang mungkin diperbarui.
    const kolomId = HEADER.indexOf('ID Transaksi') + 1;
    const perluId = !hanyaSelaras && rows.length > 0 && last > 1;
    const idPerBaris = perluId ? sh.getRange(2, kolomId, last - 1, 1).getValues().map((r) => String(r[0] || '')) : [];

    // Baris mana yang harus hilang dari Sheet — dicatat sebagai HASH, bukan
    // nomor baris. hapusBaris() membaca ulang kolom Hash tepat sebelum
    // menghapus, jadi baris yang bergeser sejak bacaan di atas tidak membuat
    // baris lain ikut terbuang.
    const hashDibuang = {};
    hapus.forEach((h) => { if (nomorBaris[h]) hashDibuang[h] = true; });
    let dipertahankan = 0;
    if (mintaSelaras) {
      lama.forEach((r) => {
        const h = String(r[0] || '');
        if (!h || dedup.has(h)) return;
        const label = `${String(r[7] || '').trim()} ${String(r[8] || '').trim()}`.trim();
        if (label && !rekeningPengirim[label]) { dipertahankan += 1; return; }
        hashDibuang[h] = true;
      });
    }
    // Penyelarasan juga membuang KEMBARAN: hash yang muncul di lebih dari satu
    // baris. Hash unik di aplikasi, jadi kembaran hanya bisa sisa kerusakan;
    // satu baris dipertahankan (yang dipetakan nomorBaris = kemunculan
    // terakhir) dan akan ditimpa upsert dengan isi yang benar.
    const buangKembar = mintaSelaras;
    const dibuang = tandaiBarisDibuang(lama.map((r) => String(r[0] || '')), hashDibuang, buangKembar);
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
    // Hash yang di Sheet menempel ke ID Transaksi LAIN: barisnya sudah
    // tergeser dari Hash-nya (mis. diurutkan lewat filter yang tidak mencakup
    // kolom A). Menimpanya berarti menghapus isi transaksi lain, jadi
    // dilewati dan dilaporkan, bukan ditulis.
    const konflik = [];
    // Payload identitas tidak memuat isi baris. Menuliskannya akan mengganti
    // tanggal, nominal, dan kategori yang sudah benar dengan sel kosong — jadi
    // jalur tulis dilewati seluruhnya, bukan sekadar "kebetulan tidak kena".
    for (const r of (hanyaSelaras ? [] : dedup.values())) {
      const hash = String(r.hash || '');
      // Saldo sengaja TIDAK dipaksa jadi 0 saat kosong: nol adalah saldo yang
      // sah, sedangkan kosong berarti bank tidak menyebutkannya (transaksi
      // manual). Dashboard membedakan keduanya saat memeriksa kelengkapan bulan.
      const saldo = r.saldo === '' || r.saldo === null || r.saldo === undefined ? '' : Number(r.saldo);
      const baru = [hash, r.tanggal||'', r.deskripsi||'', Number(r.nominal)||0, Number(r.debit)||0, Number(r.kredit)||0, r.kategoriId||'', r.bank||'', r.nomorRekening||'', r.namaPemilik||'', r.sumber||'', r.uploadedFileId||'', ts, r.kategoriNama||'', r.transferInternal === true, saldo, r.id||'', r.diubahPada||''];
      const baris = hash ? nomorBaris[hash] : null;
      const idSheet = baris ? idPerBaris[baris - 2] : '';
      if (baris && idSheet && r.id && idSheet !== String(r.id)) { konflik.push(hash); continue; }
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

    let jumlahTerhapus = 0;
    if (jumlahDibuang) jumlahTerhapus = hapusBaris(sh, hashDibuang, buangKembar);

    // Dashboard dibangun PALING AKHIR dan hanya bila diminta, supaya hiasan
    // tidak pernah ikut menentukan apakah transaksinya tersimpan — dan supaya
    // rentetan bongkah backfill tidak membayarnya berulang kali.
    if (mintaRapikan) rapikanDashboard(ss, sh);

    return json(Object.assign(tujuan(ss, sh), {
      ok: true,
      inserted: tambah.length,
      updated: perbarui.length,
      dihapus: jumlahTerhapus,
      dipertahankan: dipertahankan,
      konflik: konflik.length,
    }));
  } catch (err) {
    return json({ok:false, error: String(err && err.message || err)});
  } finally {
    lepasKunci(kunci);
  }
}

/**
 * Lepas kunci SESUDAH seluruh perubahan Sheet diterapkan. Apps Script menahan
 * penulisan di buffer sampai eksekusi berakhir; tanpa flush, permintaan
 * berikutnya membaca kolom Hash yang basi dan menghapus/menimpa baris lain.
 */
function lepasKunci(kunci) {
  try {
    SpreadsheetApp.flush();
  } finally {
    kunci.releaseLock();
  }
}

/**
 * Bangun/segarkan Dashboard tanpa pernah menggagalkan permintaan: galat
 * dicatat lalu dilupakan. Versi baru dicatat setelah build berhasil, jadi
 * permintaan `rapikan` berikutnya mencoba lagi.
 */
function rapikanDashboard(ss, sh) {
  try {
    pastikanSemuaTab(ss, sh.getName());
  } catch (e) {
    console.warn('Dashboard gagal dibangun, data tetap disimpan:', e);
  }
}

/** Di atas jumlah ini, menghapus baris satu per satu lebih mahal daripada
 *  menulis ulang seluruh blok yang tersisa sekali jalan. Cuma dipakai
 *  hapusBaris() -- tulisPembaruan() sengaja TIDAK lagi memakai ambang serupa,
 *  lihat catatan di situ. */
const AMBANG_TULIS_BORONG = 20;

/**
 * Nomor baris (2-based, kunci objek) yang harus dibuang dari kolom Hash.
 *
 * @param {string[]} hashKolom isi kolom Hash mulai baris 2
 * @param {Object<string, boolean>} hashDibuang hash yang seluruh barisnya dibuang
 * @param {boolean} buangKembar buang juga kemunculan ganda sebuah hash,
 *   sisakan kemunculan TERAKHIR (yang dipakai nomorBaris di doPost)
 */
function tandaiBarisDibuang(hashKolom, hashDibuang, buangKembar) {
  const terakhir = {};
  hashKolom.forEach((h, i) => { if (h) terakhir[h] = i; });
  const dibuang = {};
  hashKolom.forEach((h, i) => {
    if (!h) return;
    if (hashDibuang[h] || (buangKembar && terakhir[h] !== i)) dibuang[i + 2] = true;
  });
  return dibuang;
}

/**
 * Buang baris yang hash-nya ada di `hashDibuang` (dan kembarannya bila
 * diminta). Mengembalikan jumlah baris yang dibuang.
 *
 * Nomor baris ditentukan dari bacaan kolom Hash DI SINI, sesaat sebelum
 * menghapus, bukan dari bacaan awal doPost yang bisa basi. Di atas ambang,
 * seluruh blok dibaca sekali, disaring, ditulis balik, lalu ekornya dipangkas
 * dalam satu operasi.
 */
function hapusBaris(sh, hashDibuang, buangKembar) {
  const jumlah = tanpaFilter(sh, () => hapusBarisTanpaFilter(sh, hashDibuang, buangKembar));
  // Verifikasi: baris yang tertinggal berarti Sheet berbeda dari aplikasi.
  // Melempar membuat doPost membalas gagal, sehingga aplikasi menyimpan
  // permintaan hapus ini di antrean dan mencobanya lagi, alih-alih
  // menganggapnya berhasil.
  const last = sh.getLastRow();
  if (last >= 2) {
    const tersisa = sh.getRange(2, 1, last - 1, 1).getValues()
      .filter((r) => hashDibuang[String(r[0] || '')]).length;
    if (tersisa) throw new Error(`${tersisa} baris tidak terhapus dari tab data; akan dicoba lagi.`);
  }
  return jumlah;
}

function hapusBarisTanpaFilter(sh, hashDibuang, buangKembar) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const hashKolom = sh.getRange(2, 1, last - 1, 1).getValues().map((r) => String(r[0] || ''));
  const dibuang = tandaiBarisDibuang(hashKolom, hashDibuang, buangKembar === true);
  const nomor = Object.keys(dibuang).map(Number).sort((a, b) => a - b);
  if (!nomor.length) return 0;

  if (nomor.length <= AMBANG_TULIS_BORONG) {
    arsipkan(sh, nomor);
    // Menurun, supaya penghapusan satu baris tidak menggeser nomor berikutnya.
    for (let i = nomor.length - 1; i >= 0; i -= 1) sh.deleteRow(nomor[i]);
    return nomor.length;
  }

  const lebar = HEADER.length;
  const blok = sh.getRange(2, 1, last - 1, lebar).getValues();
  // Dipilih ulang dari isi blok yang akan ditulis balik, supaya arsip,
  // penyaringan, dan penulisan memakai satu sumber yang sama persis.
  const dibuangBlok = tandaiBarisDibuang(blok.map((r) => String(r[0] || '')), hashDibuang, buangKembar === true);
  const nomorBlok = Object.keys(dibuangBlok).map(Number).sort((a, b) => a - b);
  if (!nomorBlok.length) return 0;
  arsipkanIsi(sh, nomorBlok.map((n) => blok[n - 2]));

  const sisa = blok.filter((_, i) => !dibuangBlok[i + 2]);
  if (sisa.length) sh.getRange(2, 1, sisa.length, lebar).setValues(sisa);
  const ekor = (last - 1) - sisa.length;
  if (ekor > 0) sh.deleteRows(2 + sisa.length, ekor);
  return nomorBlok.length;
}

/**
 * Tulis baris hasil upsert satu per satu. Sengaja tidak baca-ubah-tulis satu
 * jendela lebar: jendela [baris terkecil, terbesar] bisa membentang ke seluruh
 * tab dan secara struktural mampu menyentuh baris yang tidak terkait. Lebih
 * lambat untuk pembaruan besar, tapi itu operasi latar belakang.
 */
function tulisPembaruan(sh, perbarui) {
  perbarui.forEach((p) => sh.getRange(p.baris, 1, 1, HEADER.length).setValues([p.nilai]));
}

/**
 * Salin baris yang akan dihapus ke tab arsip (tersembunyi) sebelum dibuang,
 * supaya penghapusan jarak jauh selalu punya jalan pulang.
 */
function arsipkan(sh, nomor) {
  try {
    const lebar = HEADER.length;
    if (!nomor.length) return;

    // Satu pembacaan untuk jendela baris terkecil..terbesar, bukan per baris.
    const awal = nomor[0];
    const akhir = nomor[nomor.length - 1];
    const jendela = sh.getRange(awal, 1, akhir - awal + 1, lebar).getValues();
    arsipkanIsi(sh, nomor.map((n) => jendela[n - awal]));
  } catch (e) {
    // Arsip adalah jaring pengaman, bukan syarat. Kegagalannya tidak boleh
    // membatalkan penghapusan yang sudah diminta dan sudah dikonfirmasi.
    console.warn('Gagal mengarsipkan baris:', e);
  }
}

/** Tulis isi baris yang akan dibuang ke tab arsip (lihat arsipkan()). */
function arsipkanIsi(sh, isi) {
  try {
    const ss = sh.getParent();
    const lebar = HEADER.length;
    if (!isi.length) return;

    const headerArsip = ['Dihapus Pada'].concat(HEADER);
    let arsip = ss.getSheetByName(ARSIP_SHEET_NAME);
    if (!arsip) {
      arsip = ss.insertSheet(ARSIP_SHEET_NAME, ss.getNumSheets());
      arsip.appendRow(headerArsip);
      arsip.setFrozenRows(1);
      arsip.hideSheet();
    } else if (arsip.getLastColumn() < headerArsip.length) {
      // Header _Arsip lama dilebarkan dulu ke lebar HEADER sekarang;
      // tarikTransaksi() mencari kolom lewat nama header.
      arsip.insertColumnsAfter(arsip.getLastColumn(), headerArsip.length - arsip.getLastColumn());
      arsip.getRange(1, 1, 1, headerArsip.length).setValues([headerArsip]);
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

/** Kolom Date -> ISO string; nilai lain (string/angka/kosong) dikembalikan apa adanya. */
function keIso(v) {
  return v instanceof Date ? v.toISOString() : v;
}

/**
 * Baca transaksi yang berubah dan yang dihapus sejak checkpoint, untuk
 * doPost{tarikTransaksi}. _Arsip berfungsi sebagai tombstone transaksi
 * (lengkap dengan "Dihapus Pada"). Kolom dicari lewat NAMA header; baris
 * arsip lama tanpa ID otomatis terlewati.
 */
function tarikTransaksi(sejak) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getSheet();
  const idxId = HEADER.indexOf('ID Transaksi');
  const idxDiubah = HEADER.indexOf('Diubah Pada');
  const idxDikirim = HEADER.indexOf('Dikirim Pada');

  const baris = [];
  const last = sh.getLastRow();
  if (last > 1) {
    const nilai = sh.getRange(2, 1, last - 1, HEADER.length).getValues();
    nilai.forEach((r) => {
      const dikirim = r[idxDikirim] instanceof Date ? r[idxDikirim] : new Date(r[idxDikirim]);
      if (sejak && !(dikirim > sejak)) return;
      const id = String(r[idxId] || '');
      if (!id) return; // baris dari sebelum migrasi -- belum bisa ditarik amannya, tunggu "Kirim semua sekarang"
      baris.push({
        id,
        hash: String(r[0] || ''),
        tanggal: r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[1] || ''),
        deskripsi: String(r[2] || ''),
        nominal: Number(r[3]) || 0,
        kategoriId: String(r[6] || ''),
        bank: String(r[7] || ''),
        nomorRekening: String(r[8] || ''),
        namaPemilik: String(r[9] || ''),
        sumber: String(r[10] || ''),
        transferInternal: r[14] === true,
        saldo: r[15] === '' || r[15] === null ? null : Number(r[15]),
        diubahPada: keIso(r[idxDiubah]) || '',
      });
    });
  }

  const dihapus = [];
  // Hash terarsip ikut dikirim: aplikasi hanya menghapus transaksi lokal bila
  // hash-nya sama, jadi baris yang Hash-nya sempat tergeser tidak ikut
  // menghapus transaksi yang benar.
  const dihapusHash = [];
  const arsip = ss.getSheetByName(ARSIP_SHEET_NAME);
  const lastArsip = arsip ? arsip.getLastRow() : 0;
  if (arsip && lastArsip > 1) {
    const headerArsip = arsip.getRange(1, 1, 1, arsip.getLastColumn()).getValues()[0].map(String);
    const idxDihapusPada = headerArsip.indexOf('Dihapus Pada');
    const idxIdArsip = headerArsip.indexOf('ID Transaksi');
    const idxHashArsip = headerArsip.indexOf('Hash');
    if (idxIdArsip !== -1) {
      const nilaiArsip = arsip.getRange(2, 1, lastArsip - 1, headerArsip.length).getValues();
      nilaiArsip.forEach((r) => {
        const dihapusPada = r[idxDihapusPada] instanceof Date ? r[idxDihapusPada] : new Date(r[idxDihapusPada]);
        if (sejak && !(dihapusPada > sejak)) return;
        const id = String(r[idxIdArsip] || '');
        if (!id) return;
        dihapus.push(id);
        dihapusHash.push(idxHashArsip === -1 ? '' : String(r[idxHashArsip] || ''));
      });
    }
  }

  return { baris, dihapus, dihapusHash };
}

/**
 * Identitas tujuan penulisan, disertakan di setiap balasan, supaya aplikasi
 * bisa membuktikan datanya mendarat di spreadsheet yang benar. `total` adalah
 * jumlah baris data SETELAH operasi.
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
