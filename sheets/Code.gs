/**
 * Code.gs — tempel di Extensions > Apps Script pada Google Sheet tujuan.
 * Deploy: Deploy > New deployment > Web App > Anyone with the link > Copy URL -> tempel di Pengaturan app.
 * Sheet header baris 1 wajib: hash | tanggal | deskripsi | nominal | debit | kredit | kategoriId | bank | nomorRekening | namaPemilik | sumber | uploadedFileId | dikirimPada
 *
 * Upsert berdasarkan hash (kolom A): hash yang sudah ada di Sheet DITIMPA di
 * baris yang sama, bukan dilewati. Ini penting karena kategori sebuah transaksi
 * bisa dikoreksi belakangan (lewat halaman Transaksi, atau "Kelompokkan ulang"
 * di halaman Kategori) — kalau cuma dedupe-skip seperti sebelumnya, koreksi itu
 * tidak akan pernah sampai ke Sheet walau tombol "Kirim semua sekarang" dipakai.
 */
const SHEET_NAME = ''; // kosong = sheet pertama
const HEADER = ['hash','tanggal','deskripsi','nominal','debit','kredit','kategoriId','bank','nomorRekening','namaPemilik','sumber','uploadedFileId','dikirimPada'];

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
  if (sh.getLastRow() === 0) sh.appendRow(HEADER);
  // header guard
  const h = sh.getRange(1,1,1,HEADER.length).getValues()[0].map(String);
  if (h.join('|') !== HEADER.join('|')) sh.getRange(1,1,1,HEADER.length).setValues([HEADER]);
  return sh;
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
      const baru = [hash, r.tanggal||'', r.deskripsi||'', Number(r.nominal)||0, Number(r.debit)||0, Number(r.kredit)||0, r.kategoriId||'', r.bank||'', r.nomorRekening||'', r.namaPemilik||'', r.sumber||'', r.uploadedFileId||'', ts];
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
