/**
 * Code.gs — tempel di Extensions > Apps Script pada Google Sheet tujuan.
 * Deploy: Deploy > New deployment > Web App > Anyone with the link > Copy URL -> tempel di Pengaturan app.
 * Sheet header baris 1 wajib: hash | tanggal | deskripsi | nominal | debit | kredit | kategoriId | bank | nomorRekening | namaPemilik | sumber | uploadedFileId | dikirimPada
 * ponytail: dedupe by hash (kolom A), tanpa library
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
    if (!rows.length) return json({ok:true, inserted:0});
    const sh = getSheet();
    const last = sh.getLastRow();
    const existing = last > 1 ? new Set(sh.getRange(2,1,last-1,1).getValues().flat().map(String)) : new Set();
    const out = [];
    const ts = data.dikirimPada || new Date().toISOString();
    for (const r of rows) {
      const hash = String(r.hash || '');
      if (hash && existing.has(hash)) continue;
      out.push([hash, r.tanggal||'', r.deskripsi||'', Number(r.nominal)||0, Number(r.debit)||0, Number(r.kredit)||0, r.kategoriId||'', r.bank||'', r.nomorRekening||'', r.namaPemilik||'', r.sumber||'', r.uploadedFileId||'', ts]);
      if (hash) existing.add(hash);
    }
    if (out.length) sh.getRange(last+1,1,out.length, HEADER.length).setValues(out);
    return json({ok:true, inserted: out.length, skipped: rows.length - out.length});
  } catch (err) {
    return json({ok:false, error: String(err && err.message || err)});
  }
}

function doGet() { return json({ok:true, usage:'POST {rows:[...]}'}); }

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
