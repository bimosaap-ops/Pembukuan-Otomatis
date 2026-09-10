/**
 * Code.gs — tempel di Extensions > Apps Script pada Google Sheet tujuan.
 * Deploy: Deploy > New deployment > Web App > Anyone with the link > Copy URL -> tempel di Pengaturan app.
 * Sheet header baris 1 wajib: hash | tanggal | deskripsi | nominal | debit | kredit | kategoriId | bank | nomorRekening | namaPemilik | sumber | uploadedFileId | dikirimPada | kategoriNama
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
 */
const SHEET_NAME = ''; // kosong = sheet pertama
const HEADER = ['hash','tanggal','deskripsi','nominal','debit','kredit','kategoriId','bank','nomorRekening','namaPemilik','sumber','uploadedFileId','dikirimPada','kategoriNama'];
const KOLOM_NOMINAL = [4, 5, 6]; // nominal, debit, kredit — format angka ribuan
const LEBAR_KOLOM = { hash: 90, tanggal: 90, deskripsi: 280, nominal: 110, debit: 110, kredit: 110, kategoriId: 110, bank: 70, nomorRekening: 130, namaPemilik: 140, sumber: 70, uploadedFileId: 90, dikirimPada: 150, kategoriNama: 140 };

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
  const baru = sh.getLastRow() === 0;
  if (baru) sh.appendRow(HEADER);
  // header guard
  const h = sh.getRange(1,1,1,HEADER.length).getValues()[0].map(String);
  const perluPerbaikanHeader = h.join('|') !== HEADER.join('|');
  if (perluPerbaikanHeader) sh.getRange(1,1,1,HEADER.length).setValues([HEADER]);
  if (baru || perluPerbaikanHeader) rapikanTampilan(sh);
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
