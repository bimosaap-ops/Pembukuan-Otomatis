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
  ANTREAN_HAPUS: 'sheetsAntreanHapus',
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

/**
 * Antrean hapus menyimpan HASH, bukan ID seperti antrean kirim. Antrean kirim
 * bisa menyimpan ID karena isinya dibaca ulang dari database saat dikirim —
 * untuk penghapusan itu mustahil, barisnya sudah tidak ada di database.
 */
export async function bacaAntreanHapus() {
  const hashes = await pengaturanRepo.baca(KUNCI_SHEETS.ANTREAN_HAPUS, []);
  return Array.isArray(hashes) ? hashes : [];
}

async function tulisAntreanHapus(hashes) {
  await pengaturanRepo.tulis(KUNCI_SHEETS.ANTREAN_HAPUS, [...new Set(hashes)].filter(Boolean));
}

export async function jumlahAntrean() {
  const [ids, hapus] = await Promise.all([bacaAntrean(), bacaAntreanHapus()]);
  return ids.length + hapus.length;
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
    // Saldo berjalan menurut e-statement. Kosong untuk transaksi manual — biarkan
    // kosong, jangan dipaksa nol: nol adalah saldo yang sah, sedangkan kosong
    // berarti "bank tidak menyebutkan", dan Dashboard membedakan keduanya untuk
    // memeriksa kelengkapan data tiap bulan.
    saldo: t.saldo === null || t.saldo === undefined || t.saldo === '' ? '' : Number(t.saldo),
  };
}

/**
 * Diekspor supaya bisa diuji langsung: fungsi ini satu-satunya yang menilai
 * apakah webhook benar-benar menerima data, dan salah menilainya pernah membuat
 * aplikasi melaporkan "Terkirim" padahal tidak ada yang sampai. Tidak menyentuh
 * database, jadi bisa diuji hanya dengan memalsukan `fetch`.
 */
export async function post(url, payload, batasMs = BATAS_MS) {
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
  // Balasan WAJIB berupa JSON {ok:true}. Sebelumnya balasan yang tidak bisa
  // diurai dibiarkan lolos sebagai sukses — dan justru itu yang menyembunyikan
  // kegagalan paling membingungkan: aplikasi melaporkan "Terkirim" padahal
  // tidak ada satu baris pun yang sampai. Web App yang tidak dapat diakses
  // publik, atau URL yang menunjuk sesuatu selain Apps Script, membalas HTML
  // dengan status 200 dan akan terbaca sebagai sukses kalau tidak dijaga.
  const teks = await res.text().catch(() => '');
  let j = null;
  try { j = JSON.parse(teks); } catch { /* ditangani di bawah */ }

  if (!j || typeof j !== 'object') {
    throw new Error(
      'Webhook tidak membalas JSON. Biasanya berarti URL-nya bukan Web App Apps Script, '
      + 'atau deployment-nya tidak disetel "Anyone with the link".',
    );
  }
  if (j.ok !== true) throw new Error(j.error || 'Sheets menolak data');
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
  const payload = {
    rows,
    dikirimPada: new Date().toISOString(),
    // `jumlah` dibandingkan dengan rows.length di sisi Apps Script untuk
    // mendeteksi JSON yang terpotong di tengah jalan — penting justru pada mode
    // selaras, karena payload cacat di sana berarti penghapusan yang salah.
    jumlah: rows.length,
    selaras: opsi.selaras === true,
  };
  const jawab = await post(url, payload, opsi.batasMs);
  // Yang dilaporkan adalah apa yang DIKERJAKAN server, bukan berapa yang kita
  // kirim. Keduanya bisa berbeda jauh — dan kalau berbeda, justru itu yang perlu
  // dilihat pengguna, bukan disembunyikan di balik hitungan lokal yang optimis.
  return {
    ok: true,
    dikirim: rows.length,
    baru: Number(jawab.inserted) || 0,
    diperbarui: Number(jawab.updated) || 0,
    dihapus: Number(jawab.dihapus) || 0,
    total: Number(jawab.total) || 0,
    spreadsheet: jawab.spreadsheet || '',
    sheet: jawab.sheet || '',
  };
}

/**
 * Hitung berapa baris yatim yang AKAN dihapus penyelarasan, tanpa mengubah
 * apa pun. Dipakai untuk menyebut angka sebenarnya di dialog konfirmasi:
 * menghapus data pengguna tanpa memberitahu berapa banyak bukan pilihan.
 */
export async function praTinjauSelaras(transaksi, akunMap, kategoriMap) {
  const { url, aktif } = await bacaKonfigSheets();
  if (!aktif || !url || !transaksi?.length) return { skipped: true };
  const rows = transaksi.map((t) => barisUntukSheet(t, akunMap, kategoriMap));
  const jawab = await post(url, {
    praTinjau: true,
    selaras: true,
    dikirimPada: new Date().toISOString(),
    jumlah: rows.length,
    // Pratinjau cukup mengirim identitasnya saja, bukan seluruh isi baris.
    rows: rows.map((r) => ({ hash: r.hash, bank: r.bank, nomorRekening: r.nomorRekening })),
  }, 60000);
  return {
    ok: true,
    akanDihapus: Number(jawab.akanDihapus) || 0,
    dipertahankan: Number(jawab.dipertahankan) || 0,
    total: Number(jawab.total) || 0,
    spreadsheet: jawab.spreadsheet || '',
  };
}

/**
 * Beri tahu Sheet bahwa transaksi-transaksi ini sudah dihapus di aplikasi.
 *
 * Tanpa ini, baris yang dihapus tetap duduk di Sheet dan terus ikut dijumlahkan
 * selamanya — penyebab angka Dashboard melenceng jauh dari angka aplikasi.
 * Sama seperti jalur kirim: latar belakang, tidak pernah ditunggu pemanggil,
 * dan yang gagal masuk antrean untuk dicoba lagi.
 */
export async function hapusDariSheets(hashes) {
  const daftar = [...new Set((hashes || []).filter(Boolean))];
  const { url, aktif } = await bacaKonfigSheets();
  if (!aktif || !url) return { skipped: true };

  const tertunda = await bacaAntreanHapus();
  const gabungan = [...new Set([...tertunda, ...daftar])];
  if (!gabungan.length) return { skipped: true };

  try {
    await post(url, { hapus: gabungan, dikirimPada: new Date().toISOString() });
    await tulisAntreanHapus([]);
    return { ok: true, jumlah: gabungan.length };
  } catch (e) {
    await tulisAntreanHapus(gabungan);
    return { queued: true, jumlah: gabungan.length, error: e.message };
  }
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

  // Antrean hapus disiram lebih dulu supaya penghapusan yang tertunda ikut
  // terkirim oleh pemicu yang sama (simpan baru, aplikasi dibuka, koneksi
  // pulih) tanpa perlu pemantau sendiri.
  const hapusTertunda = await bacaAntreanHapus();
  if (hapusTertunda.length) await hapusDariSheets([]).catch(() => {});

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
