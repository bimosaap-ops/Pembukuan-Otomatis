/**
 * Kategorisasi otomatis berdasarkan kata kunci pada deskripsi transaksi.
 * Modul murni: menerima daftar kategori dan mengembalikan id kategori.
 *
 * Aturan penentuan pemenang bila beberapa kategori cocok:
 *   1. prioritas kategori (kata kunci transfer sengaja rendah karena terlalu umum),
 *   2. panjang kata kunci yang cocok (yang lebih spesifik menang),
 *   3. urutan kategori.
 */

import { normalisasiDeskripsi } from '../core/format.js';
import { TIPE_KATEGORI, KATEGORI_LAINNYA_MASUK, KATEGORI_LAINNYA_KELUAR } from './entities.js';

const { PEMASUKAN, PENGELUARAN } = TIPE_KATEGORI;

/**
 * Kategori bawaan untuk konteks Indonesia. Semuanya bisa diubah, ditambah,
 * atau dihapus lewat menu Kategori — daftar ini hanya isi awal database.
 */
export const KATEGORI_BAWAAN = [
  // --- Pemasukan ---------------------------------------------------------
  { id: 'kat_gaji', nama: 'Gaji & THR', tipe: PEMASUKAN, ikon: '💼', warna: 'var(--c6)', prioritas: 70,
    polaKataKunci: ['GAJI', 'PAYROLL', 'SALARY', 'THR', 'TUNJANGAN', 'BONUS'] },
  { id: 'kat_penjualan', nama: 'Penjualan & Omzet', tipe: PEMASUKAN, ikon: '🧾', warna: 'var(--c2)', prioritas: 65,
    polaKataKunci: ['PENJUALAN', 'INVOICE', 'TAGIHAN PROYEK', 'TERMIN', 'OMZET', 'SETTLEMENT', 'PENCAIRAN'] },
  { id: 'kat_bunga', nama: 'Bunga & Bagi Hasil', tipe: PEMASUKAN, ikon: '🏦', warna: 'var(--c8)', prioritas: 75,
    polaKataKunci: ['BUNGA', 'BAGI HASIL', 'JASA GIRO', 'DEPOSITO', 'CASHBACK'] },
  { id: 'kat_refund', nama: 'Refund & Pengembalian', tipe: PEMASUKAN, ikon: '↩️', warna: 'var(--c9)', prioritas: 72,
    polaKataKunci: ['REFUND', 'RETUR', 'PENGEMBALIAN', 'REVERSAL', 'KOREKSI'] },
  { id: 'kat_setoran', nama: 'Setoran Tunai', tipe: PEMASUKAN, ikon: '💵', warna: 'var(--c12)', prioritas: 68,
    polaKataKunci: ['SETORAN TUNAI', 'SETORAN', 'CASH DEPOSIT', 'STR TUNAI'] },
  { id: 'kat_transfer_masuk', nama: 'Transfer Masuk', tipe: PEMASUKAN, ikon: '⬇️', warna: 'var(--c1)', prioritas: 10,
    polaKataKunci: ['TRSF E-BANKING CR', 'TRANSFER MASUK', 'INCOMING', 'KREDIT', 'BI-FAST CR', 'TRANSFER DARI'] },
  { id: KATEGORI_LAINNYA_MASUK, nama: 'Pemasukan Lain', tipe: PEMASUKAN, ikon: '➕', warna: 'var(--c10)', prioritas: 0,
    polaKataKunci: [] },

  // --- Pengeluaran -------------------------------------------------------
  { id: 'kat_makan', nama: 'Makan & Minum', tipe: PENGELUARAN, ikon: '🍜', warna: 'var(--c3)', prioritas: 70,
    polaKataKunci: ['GOFOOD', 'GRABFOOD', 'SHOPEEFOOD', 'RESTO', 'RESTAURANT', 'WARUNG', 'RUMAH MAKAN',
      'KOPI', 'COFFEE', 'CAFE', 'KEDAI', 'MCDONALD', 'KFC', 'STARBUCKS', 'PIZZA', 'BAKERY', 'CATERING'] },
  { id: 'kat_belanja', nama: 'Belanja Harian', tipe: PENGELUARAN, ikon: '🛒', warna: 'var(--c4)', prioritas: 72,
    polaKataKunci: ['ALFAMART', 'ALFAMIDI', 'INDOMARET', 'SUPERINDO', 'HYPERMART', 'TRANSMART', 'CARREFOUR',
      'GIANT', 'LOTTE', 'RANCH MARKET', 'HERO', 'YOGYA', 'PASAR', 'GROSIR'] },
  { id: 'kat_belanja_online', nama: 'Belanja Online', tipe: PENGELUARAN, ikon: '📦', warna: 'var(--c5)', prioritas: 74,
    polaKataKunci: ['TOKOPEDIA', 'SHOPEE', 'LAZADA', 'BUKALAPAK', 'BLIBLI', 'TIKTOK', 'ZALORA', 'AMAZON', 'IKEA'] },
  { id: 'kat_transport', nama: 'Transportasi & BBM', tipe: PENGELUARAN, ikon: '🚗', warna: 'var(--c8)', prioritas: 70,
    polaKataKunci: ['GRAB', 'GOJEK', 'GOCAR', 'GORIDE', 'MAXIM', 'BLUEBIRD', 'TAKSI', 'KRL', 'MRT', 'LRT',
      'TRANSJAKARTA', 'PARKIR', 'E-TOLL', 'ETOLL', 'JASA MARGA', 'TOL', 'SPBU', 'PERTAMINA', 'SHELL',
      'BENSIN', 'GARUDA', 'LION AIR', 'CITILINK', 'TIKET.COM', 'TRAVELOKA', 'KAI'] },
  { id: 'kat_tagihan', nama: 'Tagihan & Utilitas', tipe: PENGELUARAN, ikon: '💡', warna: 'var(--c9)', prioritas: 76,
    polaKataKunci: ['PLN', 'LISTRIK', 'PDAM', 'AETRA', 'PALYJA', 'TELKOM', 'INDIHOME', 'FIRST MEDIA',
      'BIZNET', 'MYREPUBLIC', 'MNC PLAY', 'GAS NEGARA', 'PGN', 'IPL', 'IURAN', 'SERVICE CHARGE'] },
  { id: 'kat_pulsa', nama: 'Pulsa & Internet', tipe: PENGELUARAN, ikon: '📱', warna: 'var(--c2)', prioritas: 74,
    polaKataKunci: ['PULSA', 'TELKOMSEL', 'INDOSAT', 'IM3', 'XL AXIATA', 'AXIS', 'SMARTFREN', 'TRI ',
      'BY.U', 'PAKET DATA', 'VOUCHER DATA'] },
  { id: 'kat_biaya_bank', nama: 'Biaya Bank & Admin', tipe: PENGELUARAN, ikon: '🏛', warna: 'var(--c11)', prioritas: 80,
    polaKataKunci: ['BIAYA ADM', 'BIAYA ADMIN', 'BY ADM', 'ADMINISTRASI', 'BIAYA TRANSFER', 'BIAYA TRF',
      'BIAYA RTGS', 'BIAYA SKN', 'BIAYA KARTU', 'MATERAI', 'ADM ATM', 'FEE'] },
  { id: 'kat_pajak', nama: 'Pajak', tipe: PENGELUARAN, ikon: '🧮', warna: 'var(--c7)', prioritas: 78,
    polaKataKunci: ['PAJAK', 'PPH', 'PPN', 'SAMSAT', 'PBB', 'MPN', 'DJP', 'BEA'] },
  { id: 'kat_tarik_tunai', nama: 'Tarik Tunai', tipe: PENGELUARAN, ikon: '🏧', warna: 'var(--c10)', prioritas: 78,
    polaKataKunci: ['TARIKAN TUNAI', 'TARIK TUNAI', 'TARIKAN ATM', 'CASH WITHDRAWAL', 'ATM WITHDRAWAL', 'PENARIKAN'] },
  { id: 'kat_dompet_digital', nama: 'Dompet Digital & QRIS', tipe: PENGELUARAN, ikon: '📲', warna: 'var(--c1)', prioritas: 60,
    polaKataKunci: ['QRIS', 'QR PAYMENT', 'GOPAY', 'OVO', 'DANA', 'SHOPEEPAY', 'LINKAJA', 'E-WALLET', 'ISI SALDO'] },
  { id: 'kat_cicilan', nama: 'Cicilan & Pinjaman', tipe: PENGELUARAN, ikon: '📉', warna: 'var(--c5)', prioritas: 76,
    polaKataKunci: ['ANGSURAN', 'CICILAN', 'INSTALLMENT', 'KPR', 'LEASING', 'ADIRA', 'FIF', 'BAF', 'PINJAMAN', 'KARTU KREDIT'] },
  { id: 'kat_asuransi', nama: 'Asuransi & BPJS', tipe: PENGELUARAN, ikon: '🛡', warna: 'var(--c6)', prioritas: 76,
    polaKataKunci: ['ASURANSI', 'INSURANCE', 'PRUDENTIAL', 'ALLIANZ', 'MANULIFE', 'AXA', 'BPJS', 'JASA RAHARJA'] },
  { id: 'kat_kesehatan', nama: 'Kesehatan', tipe: PENGELUARAN, ikon: '🏥', warna: 'var(--c12)', prioritas: 72,
    polaKataKunci: ['APOTEK', 'KIMIA FARMA', 'GUARDIAN', 'KLINIK', 'RUMAH SAKIT', 'DOKTER', 'LABORATORIUM',
      'PRODIA', 'HALODOC', 'ALODOKTER'] },
  { id: 'kat_pendidikan', nama: 'Pendidikan', tipe: PENGELUARAN, ikon: '🎓', warna: 'var(--c2)', prioritas: 72,
    polaKataKunci: ['SPP', 'SEKOLAH', 'KAMPUS', 'UNIVERSITAS', 'KURSUS', 'BIMBEL', 'RUANGGURU', 'UANG PANGKAL'] },
  { id: 'kat_langganan', nama: 'Hiburan & Langganan', tipe: PENGELUARAN, ikon: '🎬', warna: 'var(--c4)', prioritas: 74,
    polaKataKunci: ['NETFLIX', 'SPOTIFY', 'YOUTUBE', 'DISNEY', 'VIU', 'VIDIO', 'APPLE', 'GOOGLE', 'STEAM',
      'CANVA', 'ADOBE', 'MICROSOFT', 'CGV', 'XXI', 'CINEPOLIS', 'BIOSKOP'] },
  { id: 'kat_gaji_karyawan', nama: 'Gaji Karyawan', tipe: PENGELUARAN, ikon: '👷', warna: 'var(--c3)', prioritas: 68,
    polaKataKunci: ['GAJI', 'PAYROLL', 'UPAH', 'HONOR', 'THR', 'MANDOR', 'TUKANG'] },
  { id: 'kat_operasional', nama: 'Operasional Usaha', tipe: PENGELUARAN, ikon: '🏗', warna: 'var(--c8)', prioritas: 66,
    polaKataKunci: ['SUPPLIER', 'VENDOR', 'MATERIAL', 'PROYEK', 'SEWA', 'ONGKIR', 'JNE', 'J&T', 'SICEPAT',
      'ANTERAJA', 'POS INDONESIA', 'NINJA', 'ATK', 'PERCETAKAN'] },
  { id: 'kat_donasi', nama: 'Donasi & Zakat', tipe: PENGELUARAN, ikon: '🤲', warna: 'var(--c6)', prioritas: 76,
    polaKataKunci: ['ZAKAT', 'INFAQ', 'INFAK', 'SEDEKAH', 'DONASI', 'QURBAN', 'BAZNAS', 'DOMPET DHUAFA', 'KITABISA'] },
  { id: 'kat_transfer_keluar', nama: 'Transfer Keluar', tipe: PENGELUARAN, ikon: '⬆️', warna: 'var(--c1)', prioritas: 10,
    polaKataKunci: ['TRSF E-BANKING DB', 'TRANSFER KE', 'TRANSFER', 'BI-FAST', 'RTGS', 'SKN', 'OVERBOOKING',
      'TRF', 'SWITCHING', 'KIRIM UANG'] },
  { id: KATEGORI_LAINNYA_KELUAR, nama: 'Pengeluaran Lain', tipe: PENGELUARAN, ikon: '➖', warna: 'var(--c11)', prioritas: 0,
    polaKataKunci: [] },
].map((k, i) => ({ ...k, bawaan: true, urutan: i }));

/** Kategori penampung sesuai arah transaksi. */
export function kategoriDefault(nominal) {
  return nominal >= 0 ? KATEGORI_LAINNYA_MASUK : KATEGORI_LAINNYA_KELUAR;
}

/**
 * Menentukan kategori sebuah transaksi.
 * Hanya kategori dengan tipe yang searah yang dipertimbangkan, sehingga kata "GAJI"
 * pada transaksi masuk jatuh ke "Gaji & THR" dan pada transaksi keluar ke "Gaji Karyawan".
 */
export function tentukanKategori(deskripsi, nominal, daftarKategori) {
  const teks = normalisasiDeskripsi(deskripsi);
  if (!teks) return kategoriDefault(nominal);

  const tipeDicari = nominal >= 0 ? PEMASUKAN : PENGELUARAN;
  let terbaik = null;

  for (const kat of daftarKategori) {
    if (kat.tipe !== tipeDicari) continue;
    for (const pola of kat.polaKataKunci || []) {
      const kunci = normalisasiDeskripsi(pola);
      if (!kunci || !teks.includes(kunci)) continue;
      const skor = { prioritas: kat.prioritas ?? 50, panjang: kunci.length, urutan: kat.urutan ?? 999, id: kat.id };
      if (!terbaik
        || skor.prioritas > terbaik.prioritas
        || (skor.prioritas === terbaik.prioritas && skor.panjang > terbaik.panjang)
        || (skor.prioritas === terbaik.prioritas && skor.panjang === terbaik.panjang && skor.urutan < terbaik.urutan)) {
        terbaik = skor;
      }
    }
  }

  return terbaik ? terbaik.id : kategoriDefault(nominal);
}

/** Terapkan kategorisasi ke sekumpulan transaksi sekaligus. */
export function kategorikanBanyak(transaksi, daftarKategori) {
  return transaksi.map((t) => (t.kategoriId
    ? t
    : { ...t, kategoriId: tentukanKategori(t.deskripsi, t.nominal, daftarKategori) }));
}

const KATA_UMUM = new Set([
  'TRSF', 'TRANSFER', 'TRF', 'PEMBAYARAN', 'PEMBELIAN', 'PAYMENT', 'DARI', 'KE', 'DB', 'CR',
  'E-BANKING', 'EBANKING', 'MOBILE', 'INTERNET', 'BANKING', 'VIA', 'AN', 'A/N', 'NO', 'REF',
  'TANGGAL', 'BIAYA', 'ADM', 'SWITCHING', 'SETOR', 'TARIK', 'KARTU', 'DEBIT', 'KREDIT', 'BANK',
]);

/**
 * Menebak kata kunci yang layak diingat ketika pengguna mengoreksi kategori
 * sebuah transaksi — biasanya nama merchant, bukan kata umum perbankan atau angka.
 * Dipakai fitur "terapkan ke semua transaksi serupa".
 */
export function saranPola(deskripsi) {
  const teks = normalisasiDeskripsi(deskripsi);
  const kandidat = teks
    .split(/[^A-Z0-9&.'-]+/)
    .map((w) => w.replace(/^[.'-]+|[.'-]+$/g, ''))
    .filter((w) => w.length >= 4 && !KATA_UMUM.has(w) && !/^\d+$/.test(w) && !/^\d/.test(w));

  if (!kandidat.length) return teks.slice(0, 24).trim();

  // Kata terpanjang biasanya paling khas (mis. "TOKOPEDIA" pada "PEMBAYARAN TOKOPEDIA 0812").
  return kandidat.sort((a, b) => b.length - a.length)[0];
}

/** Tambahkan sebuah kata kunci ke kategori, tanpa duplikat. */
export function tambahPola(kategori, pola) {
  const kunci = normalisasiDeskripsi(pola);
  if (!kunci) return kategori;
  const ada = (kategori.polaKataKunci || []).some((p) => normalisasiDeskripsi(p) === kunci);
  if (ada) return kategori;
  return { ...kategori, polaKataKunci: [...(kategori.polaKataKunci || []), kunci] };
}
