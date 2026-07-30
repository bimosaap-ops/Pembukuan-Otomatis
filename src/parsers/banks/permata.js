/**
 * Adapter Rekening Koran bulanan PermataBank (unduhan Permata ME / Permata Net).
 *
 * Ciri berkasnya, berdasarkan statement sungguhan:
 *
 *   - Berkasnya berhalaman banyak dengan peran berbeda: halaman pertama berisi
 *     ringkasan rekening, halaman terakhir disclaimer, dan hanya halaman yang
 *     memuat baris judul kolom yang berisi tabel transaksi. Karena itu tiap
 *     halaman diproses sendiri, bukan digabung jadi satu daftar panjang.
 *   - Judul kolomnya dua bahasa dan berulang di setiap halaman:
 *     "Tgl Trx. | Tgl Valuta | Uraian Trx. | Debet | Kredit | Saldo", disusul
 *     baris Inggrisnya lalu baris "(dd/mm)". Ketiganya harus dilewati.
 *   - Ada dua kolom tanggal. Yang dipakai kolom pertama (tanggal transaksi);
 *     tanggal valuta diabaikan karena bisa berbeda hari — misalnya bunga yang
 *     dibukukan 31/07 dengan valuta 01/08.
 *   - Tanggal hanya "DD/MM" tanpa tahun, jadi tahunnya diambil dari
 *     "Periode Laporan" di kop.
 *   - Nominal rata kanan pada pita Debet, Kredit, dan Saldo. Pencarian nominal
 *     dibatasi pada pita-pita itu — penting, karena uraian transaksi penuh angka
 *     panjang (nomor rekening tujuan, nomor referensi) yang tidak boleh terbaca
 *     sebagai uang.
 *   - Uraian bisa memanjang sampai empat baris tanpa tanggal.
 *   - "SALDO AWAL" tercetak di kolom Saldo tanpa tanggal.
 *   - Tabel ditutup baris Total: nominalnya di satu baris, kata "Total" di baris
 *     berikutnya. Kedua angka itu dipakai memastikan tidak ada baris yang terlewat.
 */

import { posisiHeader, bandDariHeader, potongKolom, perkiraanLebar } from '../layout.js';
import { nominalDiBaris, rapikanDeskripsi, gabungDeskripsi } from '../util.js';
import { iso, hariDalamBulan } from '../../core/dates.js';

const KOLOM = [
  { nama: 'tanggal', pola: /^(TGL|TANGGAL|DATE)$/i },
  { nama: 'valuta', pola: /^(VALUTA|VAL)$/i },
  { nama: 'keterangan', pola: /^(URAIAN|KETERANGAN|DESKRIPSI|DESCRIPTION)$/i },
  { nama: 'debet', pola: /^(DEBET|DEBIT)$/i },
  { nama: 'kredit', pola: /^(KREDIT|CREDIT)$/i },
  { nama: 'saldo', pola: /^(SALDO|BALANCE)$/i },
];

const POLA_TANGGAL = /^(\d{1,2})[/-](\d{1,2})$/;

/** Baris judul — versi Indonesia, versi Inggris, dan baris satuan "(dd/mm)". */
const POLA_BARIS_JUDUL = /^(?:\(dd\/mm\)\s*)+$|(?:TGL|TANGGAL|TRX\.?\s*DATE|VAL\.?\s*DATE).*(?:DEBET|DEBIT).*(?:KREDIT|CREDIT)/i;

export const info = { kode: 'permata', bank: 'Permata', nama: 'PermataBank — Rekening Koran' };

export function cocok(teks) {
  const isi = teks || '';
  return /BANK\s+PERMATA|PERMATABANK/i.test(isi)
    && /REKENING\s+KORAN|ACCOUNT\s+STATEMENT/i.test(isi);
}

export function parse({ baris, barisPerHalaman, kepala }) {
  const catatan = [];
  // Bila baris per halaman tidak tersedia, seluruh baris dianggap satu halaman.
  const halaman = (barisPerHalaman && barisPerHalaman.length) ? barisPerHalaman : [baris];

  const transaksi = [];
  let saldoAwal = null;
  let totalDebet = null;
  let totalKredit = null;
  let tahun = kepala?.periode?.tahun || new Date().getFullYear();
  let bulanSebelumnya = kepala?.periode?.bulanIdx ?? null;
  let sekarang = null;
  let adaHalamanTabel = false;

  const tutup = () => {
    if (!sekarang) return;
    sekarang.deskripsi = rapikanDeskripsi(sekarang.deskripsi);
    transaksi.push(sekarang);
    sekarang = null;
  };

  for (const isiHalaman of halaman) {
    const idxHeader = isiHalaman.findIndex((b) => {
      const t = b.teks;
      return /\b(TGL|TANGGAL|TRX\.?\s*DATE)\b/i.test(t)
        && /\b(DEBET|DEBIT)\b/i.test(t)
        && /\b(KREDIT|CREDIT)\b/i.test(t);
    });

    // Halaman tanpa judul kolom bukan tabel transaksi: sampul, pengumuman, disclaimer.
    if (idxHeader < 0) continue;

    const posisi = posisiHeader(isiHalaman[idxHeader], KOLOM);
    if (!posisi || !posisi.has('debet') || !posisi.has('kredit')) {
      catatan.push('Kolom Debet/Kredit tidak terbaca pada salah satu halaman; sebagian transaksi mungkin terlewat.');
      continue;
    }

    adaHalamanTabel = true;
    const band = bandDariHeader(posisi, perkiraanLebar(isiHalaman));
    const kolom = (nama) => (band.has(nama) ? band.get(nama) : null);
    const nominalDi = (b, nama) => {
      const p = kolom(nama);
      if (!p) return null;
      return nominalDiBaris(b).find((a) => tengah(a) >= p.min && tengah(a) < p.maks) || null;
    };

    // Tiap halaman selalu dimulai dari transaksi baru: baris transaksi pertama
    // pada halaman berikutnya pasti bertanggal, bukan sambungan uraian.
    tutup();

    for (const b of isiHalaman.slice(idxHeader + 1)) {
      const teksBaris = b.teks.trim();
      if (!teksBaris) continue;
      if (POLA_BARIS_JUDUL.test(teksBaris)) continue;

      const kolTanggal = kolom('tanggal')
        ? potongKolom(b, kolom('tanggal').min, kolom('tanggal').maks).teks.trim()
        : '';
      const m = kolTanggal.split(/\s+/)[0]?.match(POLA_TANGGAL);

      const kolKeterangan = kolom('keterangan')
        ? potongKolom(b, kolom('keterangan').min, kolom('keterangan').maks).teks
        : teksBaris;

      // "SALDO AWAL" tidak bertanggal dan nominalnya berada di kolom Saldo.
      if (/SALDO\s+AWAL/i.test(kolKeterangan)) {
        tutup();
        const s = nominalDi(b, 'saldo');
        if (s && saldoAwal === null) saldoAwal = s.nilai;
        continue;
      }

      if (!m) {
        const d = nominalDi(b, 'debet');
        const k = nominalDi(b, 'kredit');

        // Baris penutup tabel: nominal tanpa tanggal dan tanpa uraian.
        if (!kolKeterangan.trim() && (d || k)) {
          tutup();
          if (d && totalDebet === null) totalDebet = Math.abs(d.nilai);
          if (k && totalKredit === null) totalKredit = Math.abs(k.nilai);
          continue;
        }
        if (/^TOTAL\b/i.test(teksBaris)) { tutup(); continue; }

        // Baris di luar pita tabel — kop dan kaki halaman — tidak menyumbang apa pun.
        if (!kolKeterangan.trim()) continue;

        // Sisanya sambungan uraian transaksi di atasnya.
        if (sekarang) {
          sekarang.deskripsi = gabungDeskripsi(sekarang.deskripsi, kolKeterangan);
          sekarang.barisAsli.push(teksBaris);
        }
        continue;
      }

      tutup();

      const hari = Number(m[1]);
      const bulanIdx = Number(m[2]) - 1;
      if (bulanIdx < 0 || bulanIdx > 11 || hari < 1) continue;
      // Bulan yang mundur jauh berarti daftar sudah melewati pergantian tahun.
      if (bulanSebelumnya !== null && bulanIdx < bulanSebelumnya - 6) tahun += 1;
      bulanSebelumnya = bulanIdx;
      if (hari > hariDalamBulan(tahun, bulanIdx)) continue;

      const debet = nominalDi(b, 'debet');
      const kredit = nominalDi(b, 'kredit');
      const saldo = nominalDi(b, 'saldo');
      if (!debet && !kredit) continue;

      sekarang = {
        tanggal: iso(tahun, bulanIdx, hari),
        deskripsi: rapikanDeskripsi(kolKeterangan),
        nominal: kredit ? Math.abs(kredit.nilai) : -Math.abs(debet.nilai),
        saldo: saldo ? saldo.nilai : null,
        barisAsli: [teksBaris],
      };
    }

    tutup();
  }

  if (!adaHalamanTabel) {
    catatan.push('Tidak ada halaman bertabel transaksi yang dikenali pada berkas ini.');
  }

  const ringkasan = (totalDebet !== null || totalKredit !== null)
    ? {
      saldoAwal,
      saldoAkhir: transaksi.length ? transaksi[transaksi.length - 1].saldo : null,
      mutasiDebet: totalDebet,
      mutasiKredit: totalKredit,
    }
    : null;

  return { transaksi, ringkasan, saldoAwal, catatan };
}

function tengah(a) {
  return (a.x + a.xAkhir) / 2;
}
