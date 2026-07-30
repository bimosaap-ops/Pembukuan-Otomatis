/**
 * Adapter "Mutasi Transaksi" PermataBank — hasil unduhan dari PermataMobile/PermataNet.
 *
 * Bentuknya jauh berbeda dari rekening koran bulanan, dan sengaja ditangani terpisah:
 *
 *   - Tidak ada baris judul kolom sama sekali.
 *   - Tidak ada kolom saldo, jadi arah transaksi tidak bisa disimpulkan dari
 *     perubahan saldo berjalan.
 *   - Hanya ada satu kolom nominal (semuanya rata kanan pada tepi yang sama),
 *     jadi posisi angka juga tidak membedakan debit dari kredit.
 *   - Yang membedakan arah adalah **warna nominal**: merah untuk uang keluar,
 *     hijau untuk uang masuk. Itulah penanda yang dipakai di sini.
 *   - Transaksi dikelompokkan di bawah baris tanggal, dan satu transaksi bisa
 *     memakai beberapa baris deskripsi dengan nominal tercetak di tengah-tengahnya.
 *   - Urutannya dari transaksi terbaru ke terlama.
 *
 * Bila warna tidak terbaca (mis. berkas hasil cetak ulang yang hitam-putih),
 * arah ditebak dari kata kunci deskripsi dan barisnya ditandai agar diperiksa
 * pengguna di layar tinjau.
 */

import { parseTanggal } from '../../core/dates.js';
import { parseAngka } from '../../core/format.js';
import { arahDariWarna } from '../pdf-loader.js';
import { rapikanDeskripsi, gabungDeskripsi } from '../util.js';

export const info = { kode: 'permata-mutasi', bank: 'Permata', nama: 'PermataBank — Mutasi Transaksi' };

/** Nominal selalu ditulis lengkap dengan satuan mata uang. */
const POLA_NOMINAL = /^(Rp|IDR)\s*[\d.,]+$/i;

/** Baris tanggal berdiri sendiri, mis. "23 Januari 2026". */
const POLA_TANGGAL_UTUH = /^\d{1,2}\s+[A-Za-z]{3,12}\s+\d{4}$/;

const KATA_KELUAR = /\b(KE|BIAYA|ADM|PEMBAYARAN|PEMBELIAN|TARIK|PENARIKAN|TRANSFER KE|TRF KE|QRIS|TOP\s?UP|PAJAK|ANGSURAN)\b/i;
const KATA_MASUK = /\b(DARI|GAJI|PAYROLL|SETORAN|BUNGA|REFUND|PENERIMAAN|MASUK|CR)\b/i;

export function cocok(teks) {
  return /MUTASI\s+TRANSAKSI/i.test(teks || '') && /PERMATA/i.test(teks || '');
}

/**
 * @param {{baris:Array, teks:string, kepala:object, warna:Array}} masukan
 */
export function parse({ baris, kepala, warna = [] }) {
  const catatan = [];
  const tepiKanan = hitungTepiKanan(baris);
  const tinggiBaris = perkiraanTinggiBaris(baris);

  // Warna nominal, berurutan sesuai penggambaran halaman.
  const warnaNominal = warna.filter((w) => POLA_NOMINAL.test(String(w.teks).trim()));
  let indeksWarna = 0;
  let adaWarna = false;

  const blok = kelompokkanBlok(baris, tinggiBaris);

  const transaksi = [];
  let tanggalAktif = kepala?.periode?.awal || '';

  for (const b of blok) {
    // Baris tanggal berdiri sendiri: menjadi tanggal untuk blok-blok berikutnya.
    if (b.tanggalHeader) {
      tanggalAktif = b.tanggalHeader;
      continue;
    }
    // Blok tanpa nominal bukan transaksi — ini yang menyingkirkan kop dan kaki halaman.
    if (!b.nominal) continue;

    const nilai = parseAngka(b.nominal.str);
    if (nilai === null || nilai === 0) continue;

    const deskripsi = rapikanDeskripsi(b.deskripsi.reduce((s, t) => gabungDeskripsi(s, t), ''));

    // Arah diambil dari warna; kalau tidak ada, dari kata kunci.
    let arah = 0;
    let dariWarna = false;
    const w = warnaNominal[indeksWarna];
    if (w && samaNominal(w.teks, b.nominal.str)) {
      arah = arahDariWarna(w.rgb);
      indeksWarna += 1;
      if (arah !== 0) { dariWarna = true; adaWarna = true; }
    }
    if (arah === 0) arah = arahDariKataKunci(deskripsi);

    transaksi.push({
      tanggal: tanggalAktif,
      deskripsi,
      nominal: arah * Math.abs(nilai),
      saldo: null,
      arahDariWarna: dariWarna,
      barisAsli: b.barisAsli,
    });
  }

  if (!adaWarna && transaksi.length) {
    catatan.push('Warna nominal tidak terbaca dari berkas ini, jadi arah masuk/keluar ditebak dari kata kunci deskripsi. Periksa kolom Debit dan Kredit sebelum menyimpan.');
  } else if (transaksi.some((t) => !t.arahDariWarna)) {
    const n = transaksi.filter((t) => !t.arahDariWarna).length;
    catatan.push(`${n} baris tidak punya penanda warna sehingga arahnya ditebak dari kata kunci. Periksa baris tersebut sebelum menyimpan.`);
  }

  // Statement ini mengurutkan dari yang terbaru; dibalik agar kronologis.
  transaksi.reverse();

  return { transaksi, ringkasan: null, saldoAwal: null, catatan, urutanTerbalik: true };

  /* --- pembantu yang butuh tepiKanan --------------------------------------- */

  function kelompokkanBlok(daftar, tinggi) {
    const hasil = [];
    let sekarang = null;
    let ySebelumnya = null;

    const tutup = () => { if (sekarang) hasil.push(sekarang); sekarang = null; };

    for (const r of daftar) {
      const teksBaris = r.teks.trim();
      if (!teksBaris) continue;

      // Jarak vertikal yang melebar menandai transaksi baru. Ambangnya memakai
      // tinggi baris, bukan angka tetap, supaya tidak bergantung ukuran font.
      const jarak = ySebelumnya === null ? Infinity : ySebelumnya - r.y;
      if (jarak > tinggi * 1.5) tutup();
      ySebelumnya = r.y;

      if (POLA_TANGGAL_UTUH.test(teksBaris)) {
        const t = parseTanggal(teksBaris);
        if (t) { tutup(); hasil.push({ tanggalHeader: t }); continue; }
      }

      if (!sekarang) sekarang = { deskripsi: [], nominal: null, barisAsli: [] };
      sekarang.barisAsli.push(teksBaris);

      r.items.forEach((it) => {
        const isi = it.str.trim();
        if (!isi) return;
        if (diKolomNominal(it) && POLA_NOMINAL.test(isi)) sekarang.nominal = it;
        else sekarang.deskripsi.push(isi);
      });
    }

    tutup();
    return hasil;
  }

  function diKolomNominal(it) {
    // Seluruh nominal rata kanan pada tepi yang sama.
    return (it.x + (it.w || 0)) > tepiKanan - 30;
  }
}

function arahDariKataKunci(teks) {
  if (KATA_MASUK.test(teks) && !KATA_KELUAR.test(teks)) return 1;
  if (KATA_KELUAR.test(teks)) return -1;
  // Statement mutasi didominasi pengeluaran; dugaan ini yang paling jarang meleset.
  return -1;
}

function samaNominal(a, b) {
  const bersih = (s) => String(s).replace(/\s+/g, '').toUpperCase();
  return bersih(a) === bersih(b);
}

function hitungTepiKanan(baris) {
  let maks = 0;
  baris.forEach((b) => b.items.forEach((it) => {
    maks = Math.max(maks, it.x + (it.w || 0));
  }));
  return maks || 1000;
}

/** Tinggi baris yang paling sering muncul, dipakai sebagai satuan jarak. */
function perkiraanTinggiBaris(baris) {
  const tinggi = [];
  baris.forEach((b) => b.items.forEach((it) => {
    if (it.h > 0) tinggi.push(Math.round(it.h));
  }));
  if (!tinggi.length) return 12;

  const hitung = new Map();
  tinggi.forEach((t) => hitung.set(t, (hitung.get(t) || 0) + 1));
  return [...hitung.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
