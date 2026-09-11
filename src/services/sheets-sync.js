/**
 * Sinkron ke Google Sheets lewat Apps Script Web App (webhook).
 *
 * Prinsipnya sama dengan seluruh aplikasi ini: menyimpan ke pembukuan lokal
 * tidak boleh pernah tertunda atau terlihat macet gara-gara Sheets. Karena itu:
 *
 *   - `syncKeSheets` punya batas waktu sendiri (lihat BATAS_MS) sehingga
 *     panggilan `fetch` tidak pernah menggantung tanpa batas — URL webhook yang
 *     salah atau Apps Script yang lambat cold-start tidak boleh membuat layar
 *     Upload terlihat berhenti selamanya.
 *   - Pemanggilnya (`ingest.js`, `transaksi.js`, `kategori.js`) TIDAK menunggu
 *     `syncAtauAntri` selesai sebelum melanjutkan alur simpan; sinkron berjalan
 *     di latar belakang sepenuhnya.
 *   - Transaksi yang gagal terkirim (offline, URL salah, timeout) masuk
 *     antrean tersimpan (`KUNCI_SHEETS.ANTREAN`) dan otomatis dicoba lagi pada
 *     percobaan sinkron berikutnya — baik itu simpan baru, aplikasi dibuka
 *     kembali, atau koneksi pulih (lihat pantauKoneksiSheets di app.js).
 */
import * as pengaturanRepo from '../data/repo/settings.js';
import * as trxRepo from '../data/repo/transactions.js';
import * as akunRepo from '../data/repo/accounts.js';
import * as kategoriRepo from '../data/repo/categories.js';

export const KUNCI_SHEETS = {
  URL: 'sheetsWebhookUrl',
  AKTIF: 'sheetsAktif',
  ANTREAN: 'sheetsAntrean',
};

/** Berapa lama menunggu jawaban webhook sebelum dianggap gagal dan diantrekan. */
const BATAS_MS = 8000;

export async function bacaKonfigSheets() {
  const [url, aktif] = await Promise.all([
    pengaturanRepo.baca(KUNCI_SHEETS.URL, ''),
    pengaturanRepo.baca(KUNCI_SHEETS.AKTIF, false),
  ]);
  return { url: String(url || '').trim(), aktif: Boolean(aktif) };
}

/**
 * Validasi URL webhook. Fungsi murni (tanpa database) supaya bisa diuji
 * langsung — kesalahan yang paling sering terjadi (menempel URL Sheet biasa,
 * bukan URL Web App) baru ketahuan saat POST pertama gagal kalau tidak dicegah
 * di sini lebih dulu.
 * @returns {string} URL yang sudah dirapikan (boleh string kosong)
 */
export function validasiUrlWebhook(url) {
  const bersih = String(url || '').trim();
  if (!bersih) return bersih;
  if (!/^https:\/\//i.test(bersih)) throw new Error('URL webhook harus https://');
  if (/docs\.google\.com\/spreadsheets/i.test(bersih)) {
    throw new Error('Itu URL Sheet-nya, bukan URL Web App. Buka Extensions → Apps Script → Deploy → Web App → copy URL script.google.com/macros/s/.../exec');
  }
  if (!/script\.google/i.test(bersih) && !/googleusercontent/i.test(bersih)) {
    console.warn('URL bukan script.google.com — pastikan endpoint menerima JSON {rows:[...]}');
  }
  return bersih;
}

export async function simpanKonfigSheets({ url, aktif }) {
  const bersih = validasiUrlWebhook(url);
  await pengaturanRepo.tulis(KUNCI_SHEETS.URL, bersih);
  await pengaturanRepo.tulis(KUNCI_SHEETS.AKTIF, Boolean(aktif));
  return { url: bersih, aktif: Boolean(aktif) };
}

/* ==========================================================================
   Antrean retry offline
   ========================================================================== */

export async function bacaAntrean() {
  const ids = await pengaturanRepo.baca(KUNCI_SHEETS.ANTREAN, []);
  return Array.isArray(ids) ? ids : [];
}

async function tulisAntrean(ids) {
  await pengaturanRepo.tulis(KUNCI_SHEETS.ANTREAN, [...new Set(ids)].filter(Boolean));
}

export async function jumlahAntrean() {
  const ids = await bacaAntrean();
  return ids.length;
}

/* ==========================================================================
   Pembentukan baris & pengiriman mentah
   ========================================================================== */

export function barisUntukSheet(t, akunMap, kategoriMap) {
  const akun = akunMap?.get(t.accountId);
  return {
    hash: t.hash || '',
    tanggal: t.tanggal || '',
    deskripsi: t.deskripsi || '',
    nominal: Number(t.nominal) || 0,
    debit: Number(t.nominal) < 0 ? Math.abs(Number(t.nominal)) : 0,
    kredit: Number(t.nominal) > 0 ? Number(t.nominal) : 0,
    kategoriId: t.kategoriId || '',
    kategoriNama: kategoriMap?.get(t.kategoriId)?.nama || '',
    bank: akun?.bank || '',
    nomorRekening: akun?.nomorRekening || '',
    namaPemilik: akun?.namaPemilik || '',
    sumber: t.sumber || '',
    uploadedFileId: t.uploadedFileId || '',
    // Pindah dana antar rekening sendiri. Dikirim supaya Dashboard di Sheet
    // bisa mengecualikannya dari total gabungan — tanpa penanda ini satu
    // perpindahan terhitung dua kali (keluar di satu rekening, masuk di
    // rekening lain), persis yang sudah dihindari `tanpaTransferInternal`
    // di domain/analytics.js untuk tampilan di dalam aplikasi.
    transferInternal: Boolean(t.transferInternal),
  };
}

async function post(url, payload, batasMs = BATAS_MS) {
  const kontrol = new AbortController();
  const batas = setTimeout(() => kontrol.abort(), batasMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      // text/plain sengaja dipakai, bukan application/json: Apps Script Web App
      // tidak menjawab preflight OPTIONS, dan application/json memicu preflight
      // itu dari browser. text/plain adalah "simple request" yang tidak perlu preflight.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: kontrol.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Sheets tidak merespons dalam ${batasMs / 1000} detik`);
    throw e;
  } finally {
    clearTimeout(batas);
  }

  if (!res.ok) {
    const teks = await res.text().catch(() => '');
    throw new Error(`Sheets ${res.status} ${teks.slice(0, 200)}`);
  }
  // Apps Script biasanya balas JSON {ok:true}
  let j = null;
  try { j = await res.json(); } catch { /* text/plain ok */ }
  if (j && j.ok === false) throw new Error(j.error || 'Sheets menolak data');
  return j;
}

/**
 * Kirim transaksi ke webhook secara langsung, tanpa antrean.
 * Dipakai "Kirim semua sekarang" (backfill penuh) dan oleh `syncAtauAntri`.
 * Melempar error bila gagal — pemanggil yang memutuskan mau diantrekan atau tidak.
 *
 * @param {Array} transaksi daftar buatTransaksi()
 * @param {Map} akunMap peta id->akun
 * @param {Map} kategoriMap peta id->kategori (untuk kolom kategoriNama yang mudah dibaca)
 * @param {{batasMs?: number}} [opsi] `batasMs` menaikkan batas waktu bawaan
 *   (8 detik) — dipakai "Kirim semua sekarang" karena bisa mengirim ratusan
 *   baris sekaligus dan Apps Script butuh waktu lebih lama menuliskannya.
 */
export async function syncKeSheets(transaksi, akunMap, kategoriMap, opsi = {}) {
  const { url, aktif } = await bacaKonfigSheets();
  if (!aktif || !url || !transaksi?.length) return { skipped: true };
  const rows = transaksi.map((t) => barisUntukSheet(t, akunMap, kategoriMap));
  const payload = { rows, dikirimPada: new Date().toISOString(), jumlah: rows.length };
  await post(url, payload, opsi.batasMs);
  return { ok: true, jumlah: rows.length };
}

/**
 * Titik masuk yang dipakai alur simpan (upload, transaksi manual, koreksi
 * kategori): kirim transaksi baru SEKALIGUS antrean lama yang masih menunggu
 * (kalau ada), lalu bersihkan antrean bila seluruhnya terkonfirmasi sampai.
 * Gagal sebagian maupun total → antrean utuh disimpan lagi untuk dicoba nanti.
 *
 * Ini fungsi latar belakang: pemanggil TIDAK boleh menunggunya (`await`) di
 * jalur simpan utama. `akunMap` harus mencakup seluruh rekening yang mungkin
 * dipakai transaksi di antrean, bukan cuma rekening transaksi yang baru saja
 * disimpan — pakai `akunRepo.peta()` (seluruh rekening), bukan peta satu rekening.
 *
 * @param {Array} transaksiBaru transaksi yang baru saja tersimpan (boleh kosong)
 * @param {Map} akunMap peta id->akun, mencakup SELURUH rekening
 * @param {Map} kategoriMap peta id->kategori
 */
export async function syncAtauAntri(transaksiBaru, akunMap, kategoriMap) {
  const { url, aktif } = await bacaKonfigSheets();
  if (!aktif || !url) return { skipped: true };

  const antreanLama = await bacaAntrean();
  const idBaru = new Set((transaksiBaru || []).map((t) => t.id));
  const idGabung = [...new Set([...antreanLama, ...idBaru])];
  if (!idGabung.length) return { skipped: true };

  // Transaksi baru sudah di tangan pemanggil; sisanya (antrean lama) diambil
  // ulang dari database supaya datanya segar — bisa saja kategorinya sudah
  // berubah lagi sejak percobaan yang gagal sebelumnya.
  const idLama = idGabung.filter((id) => !idBaru.has(id));
  const daftarLama = idLama.length ? await trxRepo.beberapa(idLama) : [];
  const gabungan = [...(transaksiBaru || []), ...daftarLama];
  if (!gabungan.length) { await tulisAntrean([]); return { skipped: true }; }

  try {
    const hasil = await syncKeSheets(gabungan, akunMap, kategoriMap);
    // Seluruh batch terkonfirmasi sampai (atau memang sudah ada di Sheet
    // dari percobaan sebelumnya) — antrean boleh dikosongkan.
    await tulisAntrean([]);
    return hasil;
  } catch (e) {
    await tulisAntrean(idGabung);
    return { queued: true, jumlah: idGabung.length, error: e.message };
  }
}

/**
 * Memasang pemantauan supaya antrean retry offline otomatis dicoba lagi tanpa
 * campur tangan pengguna: sekali saat dipanggil (biasanya saat aplikasi
 * dibuka), dan setiap kali koneksi jaringan pulih. Aman dipanggil walau fitur
 * Sheets belum diaktifkan — `syncAtauAntri` sendiri yang memutuskan tidak ada
 * yang perlu dikerjakan bila nonaktif atau antreannya kosong.
 */
export function pantauKoneksiSheets() {
  const cobaFlush = () => {
    Promise.all([akunRepo.peta(), kategoriRepo.peta()])
      .then(([akunMap, kategoriMap]) => syncAtauAntri([], akunMap, kategoriMap))
      .catch(() => {});
  };
  cobaFlush();
  window.addEventListener('online', cobaFlush);
}

export async function testWebhook() {
  const { url } = await bacaKonfigSheets();
  if (!url) throw new Error('URL webhook belum diisi');
  await post(url, { ping: true, rows: [], dikirimPada: new Date().toISOString() });
  return true;
}
