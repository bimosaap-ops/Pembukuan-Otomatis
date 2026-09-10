/**
 * Sinkron ke Google Sheets lewat Apps Script Web App (webhook).
 * Offline-first: simpan tetap jalan walau Sheets gagal — hanya toast.
 * ponytail: fire-and-forget, tanpa antrean offline; tambah queue IndexedDB bila perlu retry
 */
import * as pengaturanRepo from '../data/repo/settings.js';

export const KUNCI_SHEETS = {
  URL: 'sheetsWebhookUrl',
  AKTIF: 'sheetsAktif',
};

export async function bacaKonfigSheets() {
  const [url, aktif] = await Promise.all([
    pengaturanRepo.baca(KUNCI_SHEETS.URL, ''),
    pengaturanRepo.baca(KUNCI_SHEETS.AKTIF, false),
  ]);
  return { url: String(url || '').trim(), aktif: Boolean(aktif) };
}

export async function simpanKonfigSheets({ url, aktif }) {
  const bersih = String(url || '').trim();
  if (bersih && !/^https:\/\//i.test(bersih)) throw new Error('URL webhook harus https://');
  if (bersih && /docs\.google\.com\/spreadsheets/i.test(bersih)) {
    throw new Error('Itu URL Sheet-nya, bukan URL Web App. Buka Extensions → Apps Script → Deploy → Web App → copy URL script.google.com/macros/s/.../exec');
  }
  if (bersih && !/script\.google/i.test(bersih) && !/googleusercontent/i.test(bersih)) {
    console.warn('URL bukan script.google.com — pastikan endpoint menerima JSON {rows:[...]}');
  }
  await pengaturanRepo.tulis(KUNCI_SHEETS.URL, bersih);
  await pengaturanRepo.tulis(KUNCI_SHEETS.AKTIF, Boolean(aktif));
  return { url: bersih, aktif: Boolean(aktif) };
}

function barisUntukSheet(t, akunMap) {
  const akun = akunMap?.get(t.accountId);
  return {
    hash: t.hash || '',
    tanggal: t.tanggal || '',
    deskripsi: t.deskripsi || '',
    nominal: Number(t.nominal) || 0,
    debit: Number(t.nominal) < 0 ? Math.abs(Number(t.nominal)) : 0,
    kredit: Number(t.nominal) > 0 ? Number(t.nominal) : 0,
    kategoriId: t.kategoriId || '',
    bank: akun?.bank || '',
    nomorRekening: akun?.nomorRekening || '',
    namaPemilik: akun?.namaPemilik || '',
    sumber: t.sumber || '',
    uploadedFileId: t.uploadedFileId || '',
  };
}

/**
 * Kirim transaksi ke webhook. Dipanggil setelah simpanDraft sukses.
 * @param {Array} transaksi daftar buatTransaksi()
 * @param {Map} akunMap peta id->akun
 */
export async function syncKeSheets(transaksi, akunMap) {
  const { url, aktif } = await bacaKonfigSheets();
  if (!aktif || !url || !transaksi?.length) return { skipped: true };
  const rows = transaksi.map((t) => barisUntukSheet(t, akunMap));
  const payload = { rows, dikirimPada: new Date().toISOString(), jumlah: rows.length };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const teks = await res.text().catch(() => '');
    throw new Error(`Sheets ${res.status} ${teks.slice(0, 200)}`);
  }
  // Apps Script biasanya balas JSON {ok:true}
  let j = null;
  try { j = await res.json(); } catch { /* text/plain ok */ }
  if (j && j.ok === false) throw new Error(j.error || 'Sheets menolak data');
  return { ok: true, jumlah: rows.length };
}

export async function testWebhook() {
  const { url } = await bacaKonfigSheets();
  if (!url) throw new Error('URL webhook belum diisi');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ping: true, rows: [], dikirimPada: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Test gagal ${res.status}`);
  return true;
}
