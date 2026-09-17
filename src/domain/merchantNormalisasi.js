/**
 * Normalisasi teks merchant mentah (dari email transaksi atau deskripsi
 * statement) jadi `merchant_key` yang stabil — dipakai kategoriEmail.js
 * untuk mencari kategori tersimpan di kamus merchant, dan rekonsiliasiEmail.js
 * sebagai salah satu sinyal kemiripan (level 3). Modul murni, tidak
 * menyentuh database.
 *
 * Pipeline mengikuti PRD §24 Realtime Email Transaction Feed:
 *   A. Canonicalize: trim, uppercase, tanda baca -> spasi, rapatkan spasi.
 *   B. Buang boilerplate "TRANSAKSI DEBIT TGL: DD/MM [kode QR] 00000.00"
 *      yang muncul di depan deskripsi statement kartu/QR BCA — nama
 *      merchant aslinya seringkali nempel LANGSUNG di belakang placeholder
 *      nominal itu tanpa spasi (mis. "...00000.00IDM INDOMA"), hasil
 *      ekstraksi teks PDF yang menggabungkan kolom nominal & keterangan.
 *      Tanpa langkah ini, merchant_key kebanjiran noise TGL/kode QR/sisa
 *      angka nominal sehingga kemiripan merchant nyaris tidak pernah
 *      terdeteksi untuk mayoritas transaksi kartu/QR (ditemukan lewat data
 *      nyata: ~50% deskripsi statement BCA berformat ini).
 *   C. Buang kata noise umum (QRIS, QR, MOBILE, dst.) dan label ID (MID/
 *      TID/TERMINAL) beserta token yang jelas cuma nomor referensi/kode
 *      acak.
 *   D. Buang akhiran "TBK" — "PT"/"CV"/"UD" SENGAJA TIDAK dibuang: PRD
 *      eksplisit itu cuma boleh dihapus "kalau terbukti jadi noise", dan
 *      tanpa bukti dari data nyata itu bisa jadi bagian identitas merchant
 *      yang berarti (mis. dua merchant beda badan hukum, nama sama).
 *   E. Fallback keamanan: kalau hasil jadi kosong/terlalu pendek, pakai
 *      versi kurang agresif (cuma langkah A) — dua merchant berbeda tidak
 *      boleh jatuh ke merchant_key yang sama gara-gara normalisasi
 *      kebablasan (PRD: "jangan sampai dua merchant berbeda menjadi
 *      merchant_key yang sama").
 */

const KATA_NOISE_MERCHANT = [
  'QRIS', 'QR', 'MBCA', 'MYBCA', 'MOBILE', 'INTERNET', 'BANKING', 'TRX',
  'TRANSAKSI', 'PEMBAYARAN', 'PAYMENT',
];

const LABEL_ID_MERCHANT = ['MID', 'TID', 'TERMINAL'];

/** Di bawah ini dianggap "kehilangan identitas merchant" -> pakai fallback. */
const BATAS_MINIMAL_HASIL = 3;

function canonicalize(teks) {
  return String(teks || '')
    .trim()
    .toUpperCase()
    // \p{L}\p{N} (unicode-aware) supaya nama merchant berhuruf non-latin
    // tidak ikut terbuang sebagai "tanda baca".
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Token dianggap "ID acak", bukan bagian nama merchant, kalau salah satu:
 *   - digit murni sepanjang >=6 (nomor referensi/kartu/terminal)
 *   - campuran huruf+angka sepanjang >=8 DENGAN keduanya hadir (mis.
 *     "9527120260911135324660QRS1141733407", "A2AI8721")
 *
 * Syarat "huruf DAN angka sama-sama hadir" sengaja ditambahkan di atas
 * regex mentah PRD (^[A-Z0-9]{8,}$) — regex itu sendiri juga cocok untuk
 * nama merchant asli yang kebetulan panjang dan huruf semua (mis.
 * "STARBUCKS", "MCDONALD"), yang harus TETAP ada, bukan malah terbuang.
 */
function idAcak(token) {
  if (/^\d{6,}$/.test(token)) return true;
  if (token.length >= 8 && /[A-Z]/.test(token) && /\d/.test(token) && /^[A-Z0-9]+$/.test(token)) return true;
  return false;
}

/**
 * Buang boilerplate statement kartu/QR BCA: "TRANSAKSI DEBIT TGL DD MM
 * [kode QR] 00000 00<merchant>" (sudah di-canonicalize, jadi tanda baca
 * sudah jadi spasi). Setiap `.replace` tidak berpengaruh kalau polanya
 * tidak cocok, jadi teks lain (bukan format ini) lewat tanpa berubah.
 */
function buangPrefixStatementDebit(teks) {
  return teks
    .replace(/^TRANSAKSI DEBIT TGL \d{1,2} \d{1,2}\s+/, '')
    .replace(/^QR[A-Z]?\d{2,4}\s+/, '') // kode QR glued, mis. "QRC014"
    .replace(/^QR\s+\d{2,4}\s+/, '') // kode QR dengan spasi, mis. "QR 009"
    .replace(/^0+\s+0+/, '') // sisa placeholder nominal "00000 00", termasuk
    // yang "00" keduanya nempel langsung ke nama merchant (mis. "00IDM").
    .trim();
}

function buangNoiseDanId(teks) {
  return teks
    .split(' ')
    .filter(Boolean)
    .filter((t) => !KATA_NOISE_MERCHANT.includes(t) && !LABEL_ID_MERCHANT.includes(t) && !idAcak(t))
    .join(' ')
    .trim();
}

function buangAkhiranBisnis(teks) {
  return teks.replace(/\bTBK\.?$/, '').trim();
}

/**
 * @param {string} teksMentah merchant_raw dari parser email, atau deskripsi statement
 * @returns {string} merchant_key ternormalisasi, atau string kosong kalau input kosong
 */
export function normalisasiMerchant(teksMentah) {
  const dasar = canonicalize(teksMentah);
  if (!dasar) return '';

  const disaring = buangAkhiranBisnis(buangNoiseDanId(buangPrefixStatementDebit(dasar)));
  return disaring.length >= BATAS_MINIMAL_HASIL ? disaring : dasar;
}
