/**
 * Adapter e-statement BCA.
 *
 * Ciri khas yang ditangani di sini:
 *   - Tanggal hanya "DD/MM" tanpa tahun. Tahunnya diambil dari kepala berkas
 *     ("PERIODE : JULI 2025") dan dinaikkan sendiri bila daftar transaksi melewati
 *     pergantian tahun (Desember lalu Januari).
 *   - Satu kolom MUTASI untuk debit maupun kredit; yang membedakan adalah akhiran
 *     "DB" di belakang nominal. Tanpa akhiran berarti transaksi masuk.
 *   - Deskripsi panjang dipecah ke beberapa baris dan hanya baris pertama yang
 *     bertanggal; baris lanjutan digabungkan ke transaksi di atasnya.
 *   - Baris "SALDO AWAL" dipakai sebagai saldo pembuka, bukan transaksi.
 */

import { posisiHeader, bandDariHeader, potongKolom, perkiraanLebar } from '../layout.js';
import {
  nominalDiBaris, barisDiabaikan, barisRingkasan, bacaRingkasan,
  gabungDeskripsi, rapikanDeskripsi, arahDariSaldo,
} from '../util.js';
import { iso, hariDalamBulan } from '../../core/dates.js';

const KOLOM = [
  { nama: 'tanggal', pola: /^TANGGAL$/i },
  { nama: 'keterangan', pola: /^KETERANGAN$/i },
  { nama: 'cabang', pola: /^(CBG|CABANG|BRANCH)$/i },
  { nama: 'mutasi', pola: /^MUTASI$/i },
  { nama: 'saldo', pola: /^SALDO$/i },
];

const POLA_TANGGAL_BCA = /^(\d{1,2})[/-](\d{1,2})$/;

export const info = { kode: 'bca', bank: 'BCA', nama: 'BCA e-Statement' };

export function cocok(teks) {
  return /BANK\s+CENTRAL\s+ASIA|KLIKBCA|MYBCA/i.test(teks || '');
}

/**
 * @param {{baris: Array, teks: string, kepala: object}} masukan
 * @returns {{transaksi: Array, ringkasan: object|null, saldoAwal: number|null, catatan: Array<string>}}
 */
export function parse({ baris, teks, kepala }) {
  const catatan = [];
  const lebar = perkiraanLebar(baris);
  const idxHeader = baris.findIndex((b) => /TANGGAL/i.test(b.teks) && /KETERANGAN/i.test(b.teks));

  let band = null;
  if (idxHeader >= 0) {
    const posisi = posisiHeader(baris[idxHeader], KOLOM);
    if (posisi && posisi.has('tanggal') && posisi.has('mutasi')) {
      band = bandDariHeader(posisi, lebar);
    }
  }
  if (!band) {
    catatan.push('Baris judul kolom tidak ditemukan; kolom ditebak dari posisi angka. Periksa hasilnya dengan teliti.');
  }

  const tahunAwal = kepala?.periode?.tahun || new Date().getFullYear();
  const isiBaris = baris.slice(idxHeader >= 0 ? idxHeader + 1 : 0);

  const transaksi = [];
  let saldoAwal = null;
  let tahun = tahunAwal;
  let bulanSebelumnya = kepala?.periode?.bulanIdx ?? null;
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

    // Ringkasan di kaki statement menutup daftar transaksi.
    if (barisRingkasan(teksBaris)) {
      if (/SALDO\s+AWAL/i.test(teksBaris) && saldoAwal === null) {
        const n = nominalDiBaris(b);
        if (n.length) saldoAwal = n[n.length - 1].nilai;
      }
      tutup();
      continue;
    }
    if (barisDiabaikan(teksBaris)) continue;
    if (/^TANGGAL\b/i.test(teksBaris)) continue;

    // Saat band kolom tersedia, tanggal hanya boleh dibaca dari kolom tanggal.
    // Baris lanjutan deskripsi sering diawali "02/07 WSID:..." yang menyerupai
    // tanggal, dan akan salah dibaca kalau seluruh isi baris ikut diperiksa.
    const kolTanggal = band
      ? potongKolom(b, band.get('tanggal').min, band.get('tanggal').maks).teks
      : teksBaris;
    const tokenTanggal = kolTanggal.trim().split(/\s+/)[0] || '';
    const m = tokenTanggal.match(POLA_TANGGAL_BCA);

    if (!m) {
      // Baris lanjutan: tambahkan ke deskripsi transaksi sebelumnya.
      if (sekarang) {
        const lanjut = band
          ? potongKolom(b, band.get('keterangan').min, band.get('keterangan').maks).teks
          : teksBaris;
        sekarang.deskripsi = gabungDeskripsi(sekarang.deskripsi, lanjut);
        sekarang.barisAsli.push(teksBaris);
      }
      continue;
    }

    tutup();

    const hari = Number(m[1]);
    const bulanIdx = Number(m[2]) - 1;
    if (bulanIdx < 0 || bulanIdx > 11 || hari < 1) continue;
    // Bulan yang tiba-tiba mundur jauh berarti sudah berganti tahun.
    if (bulanSebelumnya !== null && bulanIdx < bulanSebelumnya - 6) tahun += 1;
    bulanSebelumnya = bulanIdx;
    if (hari > hariDalamBulan(tahun, bulanIdx)) continue;

    const tanggal = iso(tahun, bulanIdx, hari);
    const angka = nominalDiBaris(b);

    let mutasi = null;
    let saldo = null;

    if (band) {
      const bMut = band.get('mutasi');
      const bSal = band.get('saldo');
      mutasi = angka.find((a) => tengah(a) >= bMut.min && tengah(a) < bMut.maks) || null;
      if (bSal) saldo = angka.find((a) => tengah(a) >= bSal.min && tengah(a) < bSal.maks) || null;
    }
    // Tanpa band kolom, dua angka terakhir pada baris adalah mutasi lalu saldo.
    if (!mutasi && angka.length) {
      if (angka.length >= 2) { mutasi = angka[angka.length - 2]; saldo = angka[angka.length - 1]; }
      else { mutasi = angka[angka.length - 1]; }
    }

    const deskripsiAwal = band
      ? potongKolom(b, band.get('keterangan').min, band.get('keterangan').maks).teks
      : teksBaris.replace(tokenTanggal, '');

    if (/SALDO\s+AWAL/i.test(deskripsiAwal) || /SALDO\s+AWAL/i.test(teksBaris)) {
      if (saldoAwal === null) saldoAwal = (saldo || mutasi)?.nilai ?? null;
      saldoSebelumnya = saldoAwal;
      continue;
    }

    if (!mutasi) continue;

    const nilaiSaldo = saldo ? saldo.nilai : null;
    let nominal = Math.abs(mutasi.nilai);

    // Akhiran "DB" adalah penanda resmi BCA untuk transaksi keluar.
    if (/^(DB|DR|D)$/i.test(mutasi.arah)) nominal = -nominal;
    else if (!mutasi.arah) {
      // Tanpa penanda, perubahan saldo yang menentukan; kalau saldo juga tidak
      // terbaca, barulah dianggap transaksi masuk sesuai konvensi BCA.
      const arah = arahDariSaldo(saldoSebelumnya, nilaiSaldo, nominal);
      if (arah < 0) nominal = -nominal;
    }

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
