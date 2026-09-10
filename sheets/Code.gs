/**
 * Code.gs — tempel di Extensions > Apps Script pada Google Sheet tujuan.
 * Deploy: Deploy > New deployment > Web App > Anyone with the link > Copy URL -> tempel di Pengaturan app.
 * Sheet data (nama baku "Transaksi") header baris 1 wajib:
 * hash | tanggal | deskripsi | nominal | debit | kredit | kategoriId | bank | nomorRekening | namaPemilik | sumber | uploadedFileId | dikirimPada | kategoriNama
 *
 * Upsert berdasarkan hash (kolom A): hash yang sudah ada di Sheet DITIMPA di
 * baris yang sama, bukan dilewati. Ini penting karena kategori sebuah transaksi
 * bisa dikoreksi belakangan (lewat halaman Transaksi, atau "Kelompokkan ulang"
 * di halaman Kategori) — kalau cuma dedupe-skip seperti sebelumnya, koreksi itu
 * tidak akan pernah sampai ke Sheet walau tombol "Kirim semua sekarang" dipakai.
 *
 * kategoriNama ditambahkan DI AKHIR (bukan menyisip setelah kategoriId) supaya
 * Sheet pengguna yang sudah terisi dari versi sebelumnya tidak kacau urutan
 * kolomnya — kolom A (hash) yang dipakai upsert tetap di posisi yang sama.
 *
 * Tab "Dashboard" dibuat otomatis sekali (lihat pastikanDashboard) berisi
 * ringkasan pemasukan/pengeluaran, breakdown per kategori, dan tren bulanan —
 * semuanya rumus Sheets biasa yang merujuk balik ke tab data, jadi otomatis
 * ter-update setiap ada transaksi baru tanpa perlu Apps Script jalan ulang.
 * Sekali dibuat, tab ini TIDAK ditimpa ulang lagi supaya penyesuaian manual
 * pengguna (lebar kolom, urutan, dst.) aman.
 */
const SHEET_NAME = ''; // kosong = deteksi/migrasi otomatis (lihat getSheet)
const DATA_SHEET_NAME = 'Transaksi';
const DASHBOARD_SHEET_NAME = 'Dashboard';
const HEADER = ['hash','tanggal','deskripsi','nominal','debit','kredit','kategoriId','bank','nomorRekening','namaPemilik','sumber','uploadedFileId','dikirimPada','kategoriNama'];
const KOLOM_NOMINAL = [4, 5, 6]; // nominal, debit, kredit — format angka ribuan
const LEBAR_KOLOM = { hash: 90, tanggal: 90, deskripsi: 280, nominal: 110, debit: 110, kredit: 110, kategoriId: 110, bank: 70, nomorRekening: 130, namaPemilik: 140, sumber: 70, uploadedFileId: 90, dikirimPada: 150, kategoriNama: 140 };

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = SHEET_NAME
    ? ss.getSheetByName(SHEET_NAME)
    : (ss.getSheetByName(DATA_SHEET_NAME) || ss.getSheets().find((s) => s.getName() !== DASHBOARD_SHEET_NAME));
  // Migrasi dari versi lama: sheet data apa pun namanya dibakukan jadi
  // "Transaksi" supaya rumus di tab Dashboard bisa merujuknya dengan pasti,
  // dan supaya Dashboard (yang disisipkan di posisi pertama) tidak tertukar
  // dengan sheet data saat auto-deteksi "sheet pertama" dipakai.
  if (!SHEET_NAME && sh.getName() !== DATA_SHEET_NAME) sh.setName(DATA_SHEET_NAME);

  const baru = sh.getLastRow() === 0;
  if (baru) sh.appendRow(HEADER);
  // header guard
  const h = sh.getRange(1,1,1,HEADER.length).getValues()[0].map(String);
  const perluPerbaikanHeader = h.join('|') !== HEADER.join('|');
  if (perluPerbaikanHeader) sh.getRange(1,1,1,HEADER.length).setValues([HEADER]);
  if (baru || perluPerbaikanHeader) rapikanTampilan(sh);

  pastikanDashboard(ss, sh.getName());
  return sh;
}

/**
 * Rapikan tampilan sekali saat Sheet baru dibuat atau headernya baru
 * diperbaiki — bukan pada tiap doPost, supaya penyesuaian manual pengguna
 * (lebar kolom, dst.) tidak ditimpa ulang tiap ada transaksi masuk.
 */
function rapikanTampilan(sh) {
  sh.setFrozenRows(1);
  const header = sh.getRange(1, 1, 1, HEADER.length);
  header.setFontWeight('bold').setBackground('#f1f3f4');
  HEADER.forEach((nama, i) => sh.setColumnWidth(i + 1, LEBAR_KOLOM[nama] || 100));
  KOLOM_NOMINAL.forEach((kolom) => {
    sh.getRange(2, kolom, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('#,##0');
  });
}

/**
 * Bangun tab "Dashboard" sekali saja (kalau belum ada) — kartu ringkasan,
 * breakdown pengeluaran per kategori, tren bulanan pemasukan vs pengeluaran,
 * plus grafik pie & kolom. Semuanya rumus (QUERY/SUM/ARRAYFORMULA) yang
 * merujuk balik ke tab data, sehingga tampilannya otomatis ikut ter-update
 * tiap ada transaksi baru — tidak perlu dijalankan ulang oleh doPost.
 */
function pastikanDashboard(ss, namaSheetData) {
  if (ss.getSheetByName(DASHBOARD_SHEET_NAME)) return;

  const d = ss.insertSheet(DASHBOARD_SHEET_NAME, 0);
  const data = `'${namaSheetData}'!A2:N`;
  const kol = (huruf) => `'${namaSheetData}'!${huruf}2:${huruf}`;

  d.setHiddenGridlines(true);
  d.setColumnWidths(1, 8, 130);
  d.setColumnWidth(9, 20);
  d.setColumnWidths(10, 6, 90);

  d.getRange('A1:H1').merge()
    .setValue('📊 Dashboard Keuangan')
    .setFontSize(20).setFontWeight('bold').setFontColor('#ffffff')
    .setBackground('#1a73e8').setVerticalAlignment('middle');
  d.setRowHeight(1, 46);

  d.getRange('A2:H2').merge()
    .setValue(`Dihitung otomatis dari sheet "${namaSheetData}" — cukup buka tab ini, tidak perlu diperbarui manual.`)
    .setFontStyle('italic').setFontColor('#5f6368').setFontSize(10);

  const RP = '"Rp "#,##0;[RED]-"Rp "#,##0';
  const KARTU = [
    { kol: 'A', label: 'Total Pemasukan', formula: `=SUM(${kol('F')})`, bg: '#e6f4ea', fg: '#1e7e34', format: RP },
    { kol: 'C', label: 'Total Pengeluaran', formula: `=SUM(${kol('E')})`, bg: '#fce8e6', fg: '#c5221f', format: RP },
    { kol: 'E', label: 'Saldo Bersih', formula: '=A5-C5', bg: '#e8f0fe', fg: '#1967d2', format: RP },
    { kol: 'G', label: 'Jumlah Transaksi', formula: `=COUNTA(${kol('A')})`, bg: '#f1f3f4', fg: '#3c4043', format: '#,##0' },
  ];
  KARTU.forEach((k) => {
    const akhir = String.fromCharCode(k.kol.charCodeAt(0) + 1);
    d.getRange(`${k.kol}4:${akhir}4`).merge().setValue(k.label)
      .setFontWeight('bold').setFontSize(10).setFontColor(k.fg).setBackground(k.bg)
      .setHorizontalAlignment('center');
    d.getRange(`${k.kol}5:${akhir}6`).merge().setFormula(k.formula)
      .setFontSize(22).setFontWeight('bold').setFontColor(k.fg).setBackground(k.bg)
      .setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setNumberFormat(k.format);
  });
  d.setRowHeights(5, 2, 34);

  // Pengeluaran per kategori — QUERY menghasilkan header sendiri di baris 9
  // ("Kategori"/"Total"), data mulai baris 10. Kolom % dihitung terpisah
  // (ARRAYFORMULA satu sel di C10) supaya bisa dibagi ke total pengeluaran
  // di kartu KPI ($C$5), sesuatu yang tidak bisa dilakukan QUERY sendirian.
  d.getRange('A8').setValue('Pengeluaran per Kategori').setFontWeight('bold').setFontSize(12);
  d.getRange('A9').setFormula(
    `=IFERROR(QUERY(${data},"select N, sum(E) where E > 0 and N <> '' group by N order by sum(E) desc label N 'Kategori', sum(E) 'Total'",0),"Belum ada data pengeluaran")`,
  );
  d.getRange('C9').setValue('% Pengeluaran').setFontWeight('bold');
  d.getRange('C10').setFormula('=ARRAYFORMULA(IF(B10:B100="","",B10:B100/$C$5))');
  d.getRange('A9:C9').setFontWeight('bold').setBackground('#f1f3f4');
  d.getRange('B10:B100').setNumberFormat(RP);
  d.getRange('C10:C100').setNumberFormat('0.0%');

  // Tren bulanan — "bulan" dibentuk dari LEFT(tanggal,7) karena tanggal
  // tersimpan sebagai teks ISO ("2025-07-01"), bukan tipe Date, jadi fungsi
  // month()/year() bawaan QUERY tidak bisa dipakai langsung.
  d.getRange('F8').setValue('Tren Bulanan: Pemasukan vs Pengeluaran').setFontWeight('bold').setFontSize(12);
  d.getRange('F9').setFormula(
    `=IFERROR(QUERY({ARRAYFORMULA(LEFT(${kol('B')},7)),${kol('F')},${kol('E')}},"select Col1, sum(Col2), sum(Col3) where Col1 <> '' group by Col1 order by Col1 asc label Col1 'Bulan', sum(Col2) 'Pemasukan', sum(Col3) 'Pengeluaran'",0),"Belum ada data")`,
  );
  d.getRange('F9:H9').setFontWeight('bold').setBackground('#f1f3f4');
  d.getRange('G10:H100').setNumberFormat(RP);

  d.setFrozenRows(2);

  const pie = d.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(d.getRange('A9:B100'))
    .setPosition(4, 10, 0, 0)
    .setOption('title', 'Pengeluaran per Kategori')
    .setOption('pieHole', 0.4)
    .setOption('width', 520)
    .setOption('height', 340)
    .build();
  d.insertChart(pie);

  const tren = d.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(d.getRange('F9:H100'))
    .setPosition(24, 10, 0, 0)
    .setOption('title', 'Tren Bulanan')
    .setOption('width', 520)
    .setOption('height', 340)
    .setOption('series.0.color', '#1e7e34')
    .setOption('series.1.color', '#c5221f')
    .build();
  d.insertChart(tren);
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

    const ts = data.dikirimPada || new Date().toISOString();
    const tambah = [];
    let diupdate = 0;
    for (const r of dedup.values()) {
      const hash = String(r.hash || '');
      const baru = [hash, r.tanggal||'', r.deskripsi||'', Number(r.nominal)||0, Number(r.debit)||0, Number(r.kredit)||0, r.kategoriId||'', r.bank||'', r.nomorRekening||'', r.namaPemilik||'', r.sumber||'', r.uploadedFileId||'', ts, r.kategoriNama||''];
      const baris = hash ? nomorBaris[hash] : null;
      if (baris) {
        sh.getRange(baris, 1, 1, HEADER.length).setValues([baru]);
        diupdate += 1;
      } else {
        tambah.push(baru);
      }
    }
    if (tambah.length) sh.getRange(last+1,1,tambah.length, HEADER.length).setValues(tambah);
    return json({ok:true, inserted: tambah.length, updated: diupdate});
  } catch (err) {
    return json({ok:false, error: String(err && err.message || err)});
  }
}

function doGet() { return json({ok:true, usage:'POST {rows:[...]}'}); }

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
