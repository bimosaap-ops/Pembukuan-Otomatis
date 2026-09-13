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

/**
 * Berapa baris per permintaan.
 *
 * Sebelumnya seluruh pembukuan dikirim dalam satu POST, dan pada ribuan baris
 * permintaan itu tidak pernah selesai tepat waktu — yang terlihat oleh pengguna
 * cuma "Sheets tidak merespons dalam 60 detik", tanpa satu pun bagian yang
 * terselamatkan. Dipecah, tiap permintaan jadi pendek, kemajuannya bisa
 * ditunjukkan, dan yang gagal cukup diulang sepotong. Aman diulang karena
 * upsert di sisi Apps Script berbasis hash: mengirim bongkah yang sama dua kali
 * tidak menggandakan apa pun.
 */
export const UKURAN_BONGKAH = 250;

/** Batas waktu satu bongkah. Lega, karena cold start Apps Script sendiri bisa
 *  beberapa detik — tapi tidak lagi harus memuat seluruh pembukuan. */
const BATAS_BONGKAH_MS = 45000;

/** Permintaan terakhir juga membangun ulang Dashboard, dan itu memang lama. */
const BATAS_RAPIKAN_MS = 90000;

/** Berapa kali satu bongkah diulang sebelum menyerah. */
const COBA_ULANG_BONGKAH = 2;

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
 * Ulangi permintaan yang gagal karena keadaan sesaat, bukan karena salah alamat.
 *
 * Membedakan keduanya penting: batas waktu dan kunci Apps Script yang sedang
 * dipegang proses lain memang bisa berbeda hasilnya sedetik kemudian, sedangkan
 * URL yang salah atau deployment yang tidak publik akan gagal dengan cara yang
 * persis sama berapa kali pun dicoba — mengulangnya hanya memperlama kegagalan
 * yang sudah pasti, dan menyembunyikan pesannya di balik penungguan.
 */
function layakDiulang(e) {
  const pesan = String((e && e.message) || '');
  return /tidak merespons dalam/i.test(pesan)
    || /sedang dipakai proses lain/i.test(pesan)
    || /failed to fetch|networkerror|network error|load failed/i.test(pesan);
}

async function postUlang(url, payload, batasMs, maksUlang = COBA_ULANG_BONGKAH) {
  let terakhir;
  for (let coba = 0; coba <= maksUlang; coba += 1) {
    try {
      return await post(url, payload, batasMs);
    } catch (e) {
      terakhir = e;
      if (!layakDiulang(e)) throw e;
    }
  }
  throw terakhir;
}

/** Serap satu balasan server ke hasil gabungan. */
function serap(hasil, jawab) {
  hasil.baru += Number(jawab.inserted) || 0;
  hasil.diperbarui += Number(jawab.updated) || 0;
  hasil.dihapus += Number(jawab.dihapus) || 0;
  // Baris milik rekening yang tidak dikenal pengirim — sah, dan sengaja tidak
  // dihapus. Tanpa membawanya sampai ke layar, `total` di Sheet akan tampak
  // lebih besar dari yang dikirim dan aplikasi menuduh webhooknya salah alamat.
  hasil.dipertahankan += Number(jawab.dipertahankan) || 0;
  // `total` adalah keadaan Sheet SESUDAH permintaan itu, jadi yang berlaku
  // adalah balasan terakhir — bukan penjumlahan seluruh balasan.
  hasil.total = Number(jawab.total) || 0;
  if (jawab.spreadsheet) hasil.spreadsheet = jawab.spreadsheet;
  if (jawab.sheet) hasil.sheet = jawab.sheet;
}

/**
 * Kegagalan yang membawa serta berapa baris yang sudah benar-benar mendarat.
 *
 * Tanpa angka ini, pengiriman yang putus di tengah tidak bisa dibedakan dari
 * yang tidak pernah dimulai, dan pengguna hanya bisa menebak apakah menekan
 * tombolnya lagi akan menggandakan datanya (tidak akan — upsertnya per hash).
 */
function terputus(sebab, terkirim, total) {
  const e = new Error(sebab.message);
  e.terkirim = terkirim;
  e.total = total;
  e.sebab = sebab;
  return e;
}

/**
 * Kirim transaksi ke webhook secara langsung, tanpa antrean.
 * Dipakai "Kirim semua sekarang" (backfill penuh) dan oleh `syncAtauAntri`.
 * Melempar error bila gagal — pemanggil yang memutuskan mau diantrekan atau tidak.
 *
 * Dikirim per bongkah (lihat UKURAN_BONGKAH), berurutan. Berurutan, bukan
 * serentak: Apps Script menyerialkan permintaan dengan LockService, jadi
 * mengirim paralel hanya membuat sebagian menunggu kunci sampai batas waktunya
 * habis — lebih lambat, bukan lebih cepat.
 *
 * @param {Array} transaksi daftar buatTransaksi()
 * @param {Map} akunMap peta id->akun
 * @param {Map} kategoriMap peta id->kategori (untuk kolom kategoriNama yang mudah dibaca)
 * @param {{batasMs?: number, selaras?: boolean, onProgress?: Function}} [opsi]
 *   `onProgress({terkirim, total, tahap})` dipanggil di antara bongkah;
 *   `selaras` menambahkan permintaan penutup yang membuang baris yatim.
 */
export async function syncKeSheets(transaksi, akunMap, kategoriMap, opsi = {}) {
  const { url, aktif } = await bacaKonfigSheets();
  if (!aktif || !url || !transaksi?.length) return { skipped: true };
  return kirimBaris(url, transaksi.map((t) => barisUntukSheet(t, akunMap, kategoriMap)), opsi);
}

/**
 * Inti pengirimannya, dipisah dari pembacaan konfigurasi supaya bisa diuji
 * langsung dengan `fetch` palsu — seluruh tes di repositori ini sengaja tidak
 * menyentuh IndexedDB, dan pemotongan bongkah justru bagian yang paling perlu
 * dibuktikan: salah di sini berarti baris hilang diam-diam.
 */
export async function kirimBaris(url, rows, opsi = {}) {
  const batasMs = opsi.batasMs || BATAS_BONGKAH_MS;
  const lapor = typeof opsi.onProgress === 'function' ? opsi.onProgress : () => {};

  const hasil = {
    ok: true, dikirim: rows.length, baru: 0, diperbarui: 0, dihapus: 0,
    dipertahankan: 0, total: 0, spreadsheet: '', sheet: '',
  };
  let terkirim = 0;

  for (let i = 0; i < rows.length; i += UKURAN_BONGKAH) {
    const bongkah = rows.slice(i, i + UKURAN_BONGKAH);
    let jawab;
    try {
      jawab = await postUlang(url, {
        rows: bongkah,
        dikirimPada: new Date().toISOString(),
        // `jumlah` dibandingkan dengan rows.length di sisi Apps Script untuk
        // mendeteksi JSON yang terpotong di tengah jalan — penting justru pada
        // mode selaras, karena payload cacat di sana berarti penghapusan yang salah.
        jumlah: bongkah.length,
      }, batasMs);
    } catch (e) {
      throw terputus(e, terkirim, rows.length);
    }
    serap(hasil, jawab);
    terkirim += bongkah.length;
    lapor({ terkirim, total: rows.length, tahap: 'kirim' });
  }

  if (opsi.selaras === true) {
    lapor({ terkirim, total: rows.length, tahap: 'selaras' });
    try {
      serap(hasil, await postUlang(url, permintaanSelaras(rows, { rapikan: true }),
        opsi.batasRapikanMs || BATAS_RAPIKAN_MS));
    } catch (e) {
      throw terputus(e, terkirim, rows.length);
    }
  } else {
    // Dashboard disegarkan lewat permintaan TERPISAH yang tidak ditunggu.
    // Memisahkannya adalah intinya: membangun Dashboard berarti membaca seluruh
    // tab data dan menghitung ulang QUERY di atasnya, dan selama itu menumpang
    // permintaan yang membawa data, hiasan ikut menentukan apakah transaksinya
    // terlihat tersimpan. Gagal pun tidak apa-apa — permintaan berikutnya, atau
    // menu "Pembukuan" di Sheet, akan mengulangnya.
    post(url, { rapikan: true, rows: [], dikirimPada: new Date().toISOString() },
      BATAS_RAPIKAN_MS).catch(() => {});
  }

  return hasil;
}

/**
 * Payload penyelarasan: hanya identitas baris, bukan seluruh isinya.
 *
 * Server cuma butuh hash (untuk tahu baris mana yang masih ada) dan label
 * rekening (untuk tidak menyentuh rekening milik perangkat lain). Mengirim isi
 * lengkapnya berarti penghapusan baris yatim ikut menunggu ribuan baris
 * terkirim ulang, padahal baris-baris itu barusan saja dikirim.
 *
 * `hanyaSelaras` WAJIB ikut: tanpa penanda itu Apps Script akan memperlakukan
 * baris identitas sebagai data dan menuliskannya — mengosongkan tanggal,
 * nominal, dan kategori yang sudah benar.
 */
function permintaanSelaras(rows, opsi = {}) {
  const identitas = rows.map((r) => ({
    hash: r.hash, bank: r.bank, nomorRekening: r.nomorRekening,
  }));
  return {
    selaras: true,
    hanyaSelaras: true,
    rapikan: opsi.rapikan === true,
    rows: identitas,
    jumlah: identitas.length,
    dikirimPada: new Date().toISOString(),
  };
}

/**
 * Tanyakan keadaan Sheet sekarang: namanya, dan berapa baris yang ada di sana.
 *
 * `AbortController` hanya memutus sisi browser — Apps Script terus berjalan
 * sampai selesai. Jadi "tidak merespons dalam 45 detik" sama sekali bukan
 * berarti tidak ada yang mendarat, dan menebaknya adalah hal terakhir yang
 * pantas disuruhkan ke pengguna. Satu ping murah menjawabnya dengan pasti.
 */
export async function statusSheets() {
  const { url, aktif } = await bacaKonfigSheets();
  if (!aktif || !url) return { skipped: true };
  const j = await post(url, { ping: true, dikirimPada: new Date().toISOString() }, 10000);
  return {
    ok: true,
    total: Number(j.total) || 0,
    spreadsheet: j.spreadsheet || '',
    sheet: j.sheet || '',
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
  // Bentuk payloadnya persis sama dengan permintaan penyelarasan sungguhan,
  // hanya ditandai pratinjau — supaya angka yang disebut di dialog konfirmasi
  // dihitung dari masukan yang sama dengan yang nanti benar-benar dipakai.
  const jawab = await post(url, Object.assign(permintaanSelaras(rows), { praTinjau: true }), 45000);
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

  const { dihapus, sisa } = await kirimHapus(url, gabungan);
  // Yang belum sempat terkirim disimpan lagi, bukan seluruhnya: bongkah yang
  // sudah dikonfirmasi server tidak perlu diulang. Mengulangnya pun tidak
  // merusak (baris yang sudah hilang tidak akan ketemu lagi), tapi mengantre
  // pekerjaan yang jelas sudah selesai membuat setiap simpan berikutnya
  // membayar ongkosnya lagi.
  await tulisAntreanHapus(sisa);
  if (!sisa.length) return { ok: true, jumlah: dihapus };
  return { queued: true, jumlah: sisa.length, dihapus };
}

/**
 * Kirim daftar hash yang harus hilang dari Sheet, per bongkah.
 *
 * Dipisah dan diekspor karena alasan yang sama dengan `kirimBaris`: bisa diuji
 * tanpa IndexedDB. Dan dipecah karena alasan yang sama pula — menghapus satu
 * rekening berarti mengirim SELURUH hash miliknya, yang di pembukuan ribuan
 * baris tidak mungkin selesai dalam satu permintaan. Ini jalur yang tertinggal
 * waktu jalur kirim dipecah.
 */
export async function kirimHapus(url, hashes, opsi = {}) {
  const batasMs = opsi.batasMs || BATAS_BONGKAH_MS;
  const daftar = [...hashes];
  let dihapus = 0;

  for (let i = 0; i < daftar.length; i += UKURAN_BONGKAH) {
    const bongkah = daftar.slice(i, i + UKURAN_BONGKAH);
    try {
      const jawab = await postUlang(url, {
        hapus: bongkah,
        dikirimPada: new Date().toISOString(),
      }, batasMs);
      dihapus += Number(jawab.dihapus) || 0;
    } catch (e) {
      // Bongkah ini dan seluruh sisanya belum tentu sampai — antrekan lagi.
      return { dihapus, sisa: daftar.slice(i), error: e.message };
    }
  }
  return { dihapus, sisa: [] };
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
    // Antrean hapus AKUN/KATEGORI: panggil dengan daftar baru kosong supaya
    // hanya yang tertunda dari percobaan sebelumnya yang dicoba ulang — sama
    // seperti syncAtauAntri([], ...) di atas.
    hapusEntitasDariSheets('akun', []).catch(() => {});
    hapusEntitasDariSheets('kategori', []).catch(() => {});
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

/* ==========================================================================
   AKUN & KATEGORI — cadangan ke tab masing-masing, upsert per id.

   Beda dari transaksi: baris di sini genuinely dibuat pengguna (halaman
   Rekening/Kategori), bukan diturunkan dari isi statement, jadi `id` yang
   sudah stabil sejak awal cukup jadi kunci — tidak perlu dihash untuk dedup.

   Kirim/upsert TANPA antrean retry seperti transaksi: kedua tabel ini kecil
   dan jarang berubah, jadi kegagalan sesaat pada CREATE/UPDATE cukup
   diperbaiki lewat "Kirim semua sekarang" di Pengaturan. DELETE beda cerita:
   sejak tarikEntitasDariSheets() ada, sebuah delete yang gagal terkirim
   berarti Sheet tidak pernah tahu record itu hilang — pull berikutnya (dari
   perangkat mana pun) akan menariknya lagi dan menghidupkannya kembali
   secara lokal (persis skenario yang diperingatkan AD-008). Karena itu
   delete SATU-SATUNYA operasi di sini yang punya antrean retry persisten,
   sama seperti ANTREAN_HAPUS milik transaksi.
   ========================================================================== */

/** Diekspor supaya bisa diuji langsung tanpa IndexedDB — sama seperti barisUntukSheet. */
export function barisAkunUntukSheet(a) {
  return {
    id: a.id || '',
    bank: a.bank || '',
    nomorRekening: a.nomorRekening || '',
    namaPemilik: a.namaPemilik || '',
    mataUang: a.mataUang || '',
    jenis: a.jenis || '',
    saldoAwal: Number(a.saldoAwal) || 0,
    saldo: Number(a.saldo) || 0,
    jumlahTransaksi: Number(a.jumlahTransaksi) || 0,
    warna: a.warna || '',
    catatan: a.catatan || '',
    dibuatPada: a.dibuatPada || '',
    // Waktu edit SUNGGUHAN di perangkat ini, dikirim apa adanya (beda dari
    // "Dikirim Pada" tab Transaksi yang distempel server) — dipakai resolusi
    // konflik last-updated-wins saat perangkat lain menariknya balik.
    diubahPada: a.diubahPada || '',
  };
}

export function barisKategoriUntukSheet(k) {
  return {
    id: k.id || '',
    nama: k.nama || '',
    tipe: k.tipe || '',
    warna: k.warna || '',
    ikon: k.ikon || '',
    // Array digabung jadi satu string: Apps Script menerima JSON, tapi kolom
    // Sheet-nya teks biasa — menaruh array di satu sel akan tampil "[object]".
    polaKataKunci: Array.isArray(k.polaKataKunci) ? k.polaKataKunci.join(', ') : '',
    prioritas: Number.isFinite(Number(k.prioritas)) ? Number(k.prioritas) : 50,
    bawaan: Boolean(k.bawaan),
    urutan: Number(k.urutan) || 0,
    dibuatPada: k.dibuatPada || '',
    diubahPada: k.diubahPada || '',
  };
}

/**
 * Kebalikan dari barisAkunUntukSheet/barisKategoriUntukSheet — ubah baris
 * hasil tarikEntitasDariSheets() balik jadi bentuk yang siap dilempar ke
 * repo/accounts.js simpanAkun() / repo/categories.js simpanKategori().
 * Dipisah dari entitas-sync.js (yang menyentuh IndexedDB) supaya bisa diuji
 * murni tanpa database — sama seperti seluruh fungsi lain di berkas ini.
 *
 * `saldo`/`jumlahTransaksi` SENGAJA tidak ikut dipetakan: keduanya dihitung
 * ulang dari transaksi lokal (lihat entitas-sync.js), nilai dari Sheet cuma
 * informasi tampilan milik perangkat yang mengirimnya dan tidak boleh
 * menimpa angka lokal yang lebih akurat.
 */
export function akunDariBarisSheet(row) {
  return {
    id: row.id || '',
    bank: row.bank || '',
    nomorRekening: row.nomorRekening || '',
    namaPemilik: row.namaPemilik || '',
    mataUang: row.mataUang || '',
    jenis: row.jenis || '',
    saldoAwal: Number(row.saldoAwal) || 0,
    warna: row.warna || '',
    catatan: row.catatan || '',
    dibuatPada: row.dibuatPada || '',
    diubahPada: row.diubahPada || '',
  };
}

export function kategoriDariBarisSheet(row) {
  return {
    id: row.id || '',
    nama: row.nama || '',
    tipe: row.tipe || '',
    warna: row.warna || '',
    ikon: row.ikon || '',
    // Kebalikan dari join(', ') saat dikirim — string kosong berarti tidak
    // ada kata kunci sama sekali, bukan satu kata kunci kosong.
    polaKataKunci: String(row.polaKataKunci || '').split(',').map((s) => s.trim()).filter(Boolean),
    prioritas: Number.isFinite(Number(row.prioritas)) ? Number(row.prioritas) : 50,
    bawaan: Boolean(row.bawaan),
    urutan: Number(row.urutan) || 0,
    dibuatPada: row.dibuatPada || '',
    diubahPada: row.diubahPada || '',
  };
}

/**
 * Kirim satu atau beberapa AKUN/KATEGORI ke tab masing-masing di Sheet.
 * Dipanggil fire-and-forget dari halaman Rekening/Kategori setiap kali
 * disimpan — pemanggil tidak menunggu ini, sama seperti syncAtauAntri.
 * @param {'akun'|'kategori'} entity
 */
export async function syncEntitasKeSheets(entity, rows) {
  const { url, aktif } = await bacaKonfigSheets();
  if (!aktif || !url || !rows?.length) return { skipped: true };
  const bentuk = entity === 'akun' ? barisAkunUntukSheet : barisKategoriUntukSheet;
  return postUlang(url, {
    entity,
    rows: rows.map(bentuk),
    dikirimPada: new Date().toISOString(),
  }, BATAS_BONGKAH_MS);
}

const KUNCI_ANTREAN_HAPUS_ENTITAS = {
  akun: 'sheetsAntreanHapusAkun',
  kategori: 'sheetsAntreanHapusKategori',
};

async function bacaAntreanHapusEntitas(entity) {
  const ids = await pengaturanRepo.baca(KUNCI_ANTREAN_HAPUS_ENTITAS[entity], []);
  return Array.isArray(ids) ? ids : [];
}

async function tulisAntreanHapusEntitas(entity, ids) {
  await pengaturanRepo.tulis(KUNCI_ANTREAN_HAPUS_ENTITAS[entity], [...new Set(ids)].filter(Boolean));
}

/**
 * Beri tahu Sheet bahwa AKUN/KATEGORI ini sudah dihapus di aplikasi.
 * Gabungan dengan antrean tertunda sebelumnya (mis. percobaan yang gagal
 * offline), dan sisa yang masih gagal disimpan lagi untuk dicoba
 * berikutnya — lihat catatan antrean retry di kepala berkas bagian ini.
 */
export async function hapusEntitasDariSheets(entity, ids) {
  const baru = [...new Set((ids || []).filter(Boolean))];
  const { url, aktif } = await bacaKonfigSheets();
  if (!aktif || !url) return { skipped: true };

  const tertunda = await bacaAntreanHapusEntitas(entity);
  const gabungan = [...new Set([...tertunda, ...baru])];
  if (!gabungan.length) return { skipped: true };

  try {
    const jawab = await postUlang(url, { entity, hapus: gabungan, dikirimPada: new Date().toISOString() }, BATAS_BONGKAH_MS);
    await tulisAntreanHapusEntitas(entity, []);
    return jawab;
  } catch (e) {
    await tulisAntreanHapusEntitas(entity, gabungan);
    return { queued: true, jumlah: gabungan.length, error: e.message };
  }
}

/**
 * Tarik seluruh baris AKUN/KATEGORI dari Sheet — dipakai
 * services/entitas-sync.js untuk restore & sync lintas perangkat. Beda dari
 * tarikTransaksiEmail: tidak pakai checkpoint, seluruh tab ditarik tiap kali
 * (lihat catatan di sheets/Code.gs tarikEntitas() soal alasannya).
 */
export async function tarikEntitasDariSheets(entity) {
  const { url, aktif } = await bacaKonfigSheets();
  if (!aktif || !url) return { skipped: true };
  const jawab = await post(url, { tarikEntitas: true, entity }, BATAS_BONGKAH_MS);
  return { ok: true, baris: Array.isArray(jawab.baris) ? jawab.baris : [] };
}
