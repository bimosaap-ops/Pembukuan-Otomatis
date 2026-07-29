/**
 * Adapter e-statement PermataBank.
 *
 * Ciri khas yang ditangani di sini:
 *   - Kolom Debet dan Kredit terpisah. Yang menentukan arah transaksi adalah
 *     posisi horizontal angka, bukan tanda maupun akhiran.
 *   - Tanggal lengkap (DD/MM/YYYY atau "25 Jul 2025"), dan sebagian statement
 *     memuat dua kolom tanggal (Transaksi dan Valuta) — yang dipakai kolom pertama.
 *   - Deskripsi bisa memanjang ke baris berikutnya tanpa tanggal.
 */

import { posisiHeader, bandDariHeader, potongKolom, perkiraanLebar } from '../layout.js';
import {
  nominalDiBaris, barisDiabaikan, barisRingkasan, bacaRingkasan,
  gabungDeskripsi, rapikanDeskripsi, arahDariSaldo,
} from '../util.js';
import { parseTanggal } from '../../core/dates.js';

const KOLOM = [
  { nama: 'tanggal', pola: /^(TANGGAL|TGL|DATE)$/i },
  { nama: 'valuta', pola: /^(VALUTA|VALUE)$/i },
  { nama: 'keterangan', pola: /^(KETERANGAN|URAIAN|DESKRIPSI|DESCRIPTION|TRANSAKSI)$/i },
  { nama: 'debet', pola: /^(DEBET|DEBIT)$/i },
  { nama: 'kredit', pola: /^(KREDIT|CREDIT)$/i },
  { nama: 'saldo', pola: /^(SALDO|BALANCE)$/i },
];

const POLA_AWAL_TANGGAL = /^(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,12}\s+\d{2,4})/;

export const info = { kode: 'permata', bank: 'Permata', nama: 'PermataBank e-Statement' };

export function cocok(teks) {
  return /BANK\s+PERMATA|PERMATABANK|PERMATA\s*BANK/i.test(teks || '');
}

export function parse({ baris, teks, kepala }) {
  const catatan = [];
  const lebar = perkiraanLebar(baris);

  const idxHeader = baris.findIndex((b) => /\b(TANGGAL|TGL|DATE)\b/i.test(b.teks)
    && /\b(DEBET|DEBIT)\b/i.test(b.teks)
    && /\b(KREDIT|CREDIT)\b/i.test(b.teks));

  let band = null;
  if (idxHeader >= 0) {
    const posisi = posisiHeader(baris[idxHeader], KOLOM);
    if (posisi && posisi.has('debet') && posisi.has('kredit')) band = bandDariHeader(posisi, lebar);
  }
  if (!band) {
    catatan.push('Kolom Debet/Kredit tidak terbaca dari judul tabel; arah transaksi ditentukan dari perubahan saldo.');
  }

  const isiBaris = baris.slice(idxHeader >= 0 ? idxHeader + 1 : 0);
  const tahunDefault = kepala?.periode?.tahun || null;

  const transaksi = [];
  let saldoAwal = null;
  let saldoSebelumnya = null;
  let sekarang = null;

  const tutup = () => {
    if (!sekarang) return;
    sekarang.deskripsi = rapikanDeskripsi(sekarang.deskripsi);
    transaksi.push(sekarang);
    sekarang = null;
  };

  for (const b of isiBaris) {
    const teksBaris = b.teks;
    if (!teksBaris) continue;

    if (barisRingkasan(teksBaris)) {
      if (/SALDO\s+AWAL/i.test(teksBaris) && saldoAwal === null) {
        const n = nominalDiBaris(b);
        if (n.length) { saldoAwal = n[n.length - 1].nilai; saldoSebelumnya = saldoAwal; }
      }
      tutup();
      continue;
    }
    if (barisDiabaikan(teksBaris)) continue;

    const kolTanggal = band && band.has('tanggal')
      ? potongKolom(b, band.get('tanggal').min, band.get('tanggal').maks).teks
      : teksBaris;

    const m = String(kolTanggal).trim().match(POLA_AWAL_TANGGAL);
    const tanggal = m ? parseTanggal(m[1], tahunDefault) : null;

    if (!tanggal) {
      if (sekarang) {
        const lanjut = band && band.has('keterangan')
          ? potongKolom(b, band.get('keterangan').min, band.get('keterangan').maks).teks
          : teksBaris;
        sekarang.deskripsi = gabungDeskripsi(sekarang.deskripsi, lanjut);
        sekarang.barisAsli.push(teksBaris);
      }
      continue;
    }

    tutup();

    const angka = nominalDiBaris(b);
    let debet = null;
    let kredit = null;
    let saldo = null;

    if (band) {
      const cari = (nama) => {
        if (!band.has(nama)) return null;
        const { min, maks } = band.get(nama);
        return angka.find((a) => tengah(a) >= min && tengah(a) < maks) || null;
      };
      debet = cari('debet');
      kredit = cari('kredit');
      saldo = cari('saldo');
    }

    if (!debet && !kredit) {
      // Tanpa band: angka terakhir dianggap saldo, sebelumnya nominal transaksi.
      if (angka.length >= 2) {
        saldo = saldo || angka[angka.length - 1];
        const nom = angka[angka.length - 2];
        const arah = arahDariSaldo(saldoSebelumnya, saldo?.nilai ?? null, nom.nilai);
        if (arah < 0) debet = nom;
        else if (arah > 0) kredit = nom;
        else if (/^(DB|DR|D)$/i.test(nom.arah)) debet = nom;
        else kredit = nom;
      } else if (angka.length === 1) {
        const nom = angka[0];
        if (/^(DB|DR|D)$/i.test(nom.arah)) debet = nom;
        else if (/^(CR|K)$/i.test(nom.arah)) kredit = nom;
        else if (/(BIAYA|ADM|TARIK|PEMBAYARAN|PEMBELIAN|TRANSFER KE)/i.test(teksBaris)) debet = nom;
        else kredit = nom;
      }
    }

    if (!debet && !kredit) continue;

    const deskripsiAwal = band && band.has('keterangan')
      ? potongKolom(b, band.get('keterangan').min, band.get('keterangan').maks).teks
      : teksBaris.replace(m[1], '');

    if (/SALDO\s+AWAL/i.test(deskripsiAwal)) {
      if (saldoAwal === null) saldoAwal = (saldo || kredit || debet)?.nilai ?? null;
      saldoSebelumnya = saldoAwal;
      continue;
    }

    const nominal = kredit ? Math.abs(kredit.nilai) : -Math.abs(debet.nilai);
    const nilaiSaldo = saldo ? saldo.nilai : null;
    if (nilaiSaldo !== null) saldoSebelumnya = nilaiSaldo;

    sekarang = {
      tanggal,
      deskripsi: rapikanDeskripsi(deskripsiAwal),
      nominal,
      saldo: nilaiSaldo,
      barisAsli: [teksBaris],
    };
  }

  tutup();

  const ringkasan = bacaRingkasan(teks);
  if (ringkasan && saldoAwal === null && ringkasan.saldoAwal !== null) saldoAwal = ringkasan.saldoAwal;

  return { transaksi, ringkasan, saldoAwal, catatan };
}

function tengah(a) {
  return (a.x + a.xAkhir) / 2;
}
