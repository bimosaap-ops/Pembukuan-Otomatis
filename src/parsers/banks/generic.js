/**
 * Adapter serba guna untuk bank yang belum punya adapter khusus.
 *
 * Tidak ada asumsi tentang nama kolom. Yang dipakai:
 *   1. Baris transaksi selalu diawali tanggal.
 *   2. Kalau ada baris judul yang memuat Debet/Kredit atau Mutasi, posisi kolomnya dipakai.
 *   3. Kalau tidak ada, susunan angka yang menentukan — dan arah transaksi
 *      disimpulkan dari perubahan saldo, cara paling andal ketika statement tidak
 *      memberi penanda apa pun.
 *
 * Hasil adapter ini memang perlu diperiksa di layar Review; karena itu setiap
 * dugaan yang lemah dicatat di `catatan` agar muncul sebagai peringatan.
 */

import { posisiHeader, bandDariHeader, potongKolom, perkiraanLebar } from '../layout.js';
import {
  nominalDiBaris, barisDiabaikan, barisRingkasan, bacaRingkasan,
  gabungDeskripsi, rapikanDeskripsi,
} from '../util.js';
import { parseTanggal } from '../../core/dates.js';

const KOLOM = [
  { nama: 'tanggal', pola: /^(TANGGAL|TGL|DATE|POSTING)$/i },
  { nama: 'keterangan', pola: /^(KETERANGAN|URAIAN|DESKRIPSI|DESCRIPTION|REMARK|TRANSAKSI)$/i },
  { nama: 'debet', pola: /^(DEBET|DEBIT|PENGELUARAN|KELUAR)$/i },
  { nama: 'kredit', pola: /^(KREDIT|CREDIT|PEMASUKAN|MASUK)$/i },
  { nama: 'mutasi', pola: /^(MUTASI|JUMLAH|NOMINAL|AMOUNT)$/i },
  { nama: 'saldo', pola: /^(SALDO|BALANCE)$/i },
];

const POLA_AWAL_TANGGAL = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,12}\s+\d{2,4}|\d{1,2}[-/.]\d{1,2})\b/;

const KATA_KELUAR = /(BIAYA|ADM|TARIK|PENARIKAN|PEMBAYARAN|PEMBELIAN|TRANSFER KE|TRF KE|PAJAK|DEBET|DEBIT|PURCHASE|WITHDRAWAL|QRIS|ANGSURAN|CICILAN)/i;
const KATA_MASUK = /(SETORAN|TRANSFER DARI|TRF DARI|GAJI|BUNGA|KREDIT|CREDIT|DEPOSIT|REFUND|MASUK|PENERIMAAN)/i;

export const info = { kode: 'generik', bank: '', nama: 'Statement umum' };

export function cocok() {
  return true; // penampung terakhir
}

export function parse({ baris, teks, kepala }) {
  const catatan = [];
  const lebar = perkiraanLebar(baris);

  const idxHeader = baris.findIndex((b) => /\b(TANGGAL|TGL|DATE)\b/i.test(b.teks)
    && /\b(SALDO|BALANCE|MUTASI|DEBET|DEBIT|KREDIT|CREDIT|JUMLAH|NOMINAL)\b/i.test(b.teks));

  let band = null;
  if (idxHeader >= 0) {
    const posisi = posisiHeader(baris[idxHeader], KOLOM);
    if (posisi && posisi.size >= 2) band = bandDariHeader(posisi, lebar);
  }

  const punyaKolomArah = Boolean(band && band.has('debet') && band.has('kredit'));
  if (!band) catatan.push('Judul kolom tidak ditemukan. Struktur tabel ditebak dari susunan angka di tiap baris.');
  else if (!punyaKolomArah) catatan.push('Kolom Debet/Kredit terpisah tidak ditemukan; arah transaksi disimpulkan dari perubahan saldo.');

  const isiBaris = baris.slice(idxHeader >= 0 ? idxHeader + 1 : 0);
  const tahunDefault = kepala?.periode?.tahun || null;

  // --- Tahap 1: kumpulkan baris bertanggal beserta seluruh angkanya ---------
  const mentah = [];
  let saldoAwal = null;

  for (const b of isiBaris) {
    const teksBaris = b.teks;
    if (!teksBaris) continue;

    if (barisRingkasan(teksBaris)) {
      if (/SALDO\s+AWAL/i.test(teksBaris) && saldoAwal === null) {
        const n = nominalDiBaris(b);
        if (n.length) saldoAwal = n[n.length - 1].nilai;
      }
      continue;
    }
    if (barisDiabaikan(teksBaris)) continue;

    const kolTanggal = band && band.has('tanggal')
      ? potongKolom(b, band.get('tanggal').min, band.get('tanggal').maks).teks
      : teksBaris;
    const m = String(kolTanggal).trim().match(POLA_AWAL_TANGGAL);
    const tanggal = m ? parseTanggal(m[1], tahunDefault) : null;

    if (!tanggal) {
      const sebelumnya = mentah[mentah.length - 1];
      if (sebelumnya) {
        const lanjut = band && band.has('keterangan')
          ? potongKolom(b, band.get('keterangan').min, band.get('keterangan').maks).teks
          : teksBaris;
        sebelumnya.deskripsi = gabungDeskripsi(sebelumnya.deskripsi, lanjut);
        sebelumnya.barisAsli.push(teksBaris);
      }
      continue;
    }

    const angka = nominalDiBaris(b);
    if (!angka.length) continue;

    const deskripsi = band && band.has('keterangan')
      ? potongKolom(b, band.get('keterangan').min, band.get('keterangan').maks).teks
      : teksBaris.replace(m[1], '');

    if (/SALDO\s+AWAL/i.test(deskripsi) || /SALDO\s+AWAL/i.test(teksBaris)) {
      if (saldoAwal === null) saldoAwal = angka[angka.length - 1].nilai;
      continue;
    }

    mentah.push({ baris: b, tanggal, deskripsi, angka, barisAsli: [teksBaris] });
  }

  // --- Tahap 2: tentukan susunan kolom -------------------------------------
  const adaSaldo = punyaSaldoBerjalan(mentah, band);
  if (!band && !adaSaldo) {
    catatan.push('Kolom saldo berjalan tidak terdeteksi; arah transaksi ditebak dari kata kunci deskripsi. Periksa tanda masuk/keluar sebelum menyimpan.');
  }

  // --- Tahap 3: bentuk transaksi -------------------------------------------
  const transaksi = [];
  let saldoSebelumnya = saldoAwal;

  for (const r of mentah) {
    let nominal = null;
    let saldo = null;

    if (punyaKolomArah) {
      const cari = (nama) => {
        if (!band.has(nama)) return null;
        const { min, maks } = band.get(nama);
        return r.angka.find((a) => tengah(a) >= min && tengah(a) < maks) || null;
      };
      const debet = cari('debet');
      const kredit = cari('kredit');
      saldo = cari('saldo');
      if (kredit) nominal = Math.abs(kredit.nilai);
      else if (debet) nominal = -Math.abs(debet.nilai);
    }

    if (nominal === null) {
      const daftar = r.angka;
      let tokenNominal = null;
      if (adaSaldo && daftar.length >= 2) {
        saldo = saldo || daftar[daftar.length - 1];
        tokenNominal = daftar[daftar.length - 2];
      } else {
        tokenNominal = daftar[daftar.length - 1];
      }

      const besar = Math.abs(tokenNominal.nilai);
      let arah = 0;

      if (saldo && saldoSebelumnya !== null) {
        const selisih = saldo.nilai - saldoSebelumnya;
        if (Math.abs(Math.abs(selisih) - besar) <= 0.999) arah = selisih >= 0 ? 1 : -1;
      }
      if (arah === 0 && /^(DB|DR|D)$/i.test(tokenNominal.arah)) arah = -1;
      if (arah === 0 && /^(CR|K)$/i.test(tokenNominal.arah)) arah = 1;
      if (arah === 0 && tokenNominal.nilai < 0) arah = -1;
      if (arah === 0) {
        const teksUji = `${r.deskripsi} ${r.barisAsli.join(' ')}`;
        if (KATA_KELUAR.test(teksUji)) arah = -1;
        else if (KATA_MASUK.test(teksUji)) arah = 1;
        else arah = -1; // dugaan paling aman: mayoritas baris statement adalah pengeluaran
      }
      nominal = arah * besar;
    }

    if (saldo) saldoSebelumnya = saldo.nilai;

    transaksi.push({
      tanggal: r.tanggal,
      deskripsi: rapikanDeskripsi(r.deskripsi),
      nominal,
      saldo: saldo ? saldo.nilai : null,
      barisAsli: r.barisAsli,
    });
  }

  const ringkasan = bacaRingkasan(teks);
  if (ringkasan && saldoAwal === null && ringkasan.saldoAwal !== null) saldoAwal = ringkasan.saldoAwal;

  return { transaksi, ringkasan, saldoAwal, catatan };
}

/**
 * Menguji apakah angka terakhir tiap baris benar-benar saldo berjalan:
 * selisih antar baris harus sama dengan salah satu angka lain di baris itu.
 */
function punyaSaldoBerjalan(mentah, band) {
  if (band && band.has('saldo')) return true;
  const uji = mentah.filter((r) => r.angka.length >= 2).slice(0, 12);
  if (uji.length < 2) return false;

  let cocok = 0;
  for (let i = 1; i < uji.length; i += 1) {
    const sebelum = uji[i - 1].angka[uji[i - 1].angka.length - 1].nilai;
    const sesudah = uji[i].angka[uji[i].angka.length - 1].nilai;
    const nominal = Math.abs(uji[i].angka[uji[i].angka.length - 2].nilai);
    if (Math.abs(Math.abs(sesudah - sebelum) - nominal) <= 0.999) cocok += 1;
  }
  return cocok >= Math.ceil((uji.length - 1) * 0.6);
}

function tengah(a) {
  return (a.x + a.xAkhir) / 2;
}
