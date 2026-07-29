/**
 * Penyusunan laporan: Buku Kas, Cash Flow, Rekap Bulanan, dan Rekap Tahunan.
 * Modul murni — keluarannya berupa baris siap ditampilkan maupun diekspor.
 */

import { kunciBulan, kunciTahun, bulanTampil, rentangBulan } from '../core/dates.js';
import { tanpaTransferInternal } from './analytics.js';

/**
 * Buku Kas: daftar transaksi berurutan dengan saldo berjalan yang dihitung sendiri.
 *
 * Saldo di sini sengaja dihitung ulang dari `saldoAwal`, bukan memakai kolom saldo
 * bawaan statement, supaya buku kas tetap nyambung meski transaksi manual disisipkan
 * di tengah atau beberapa rekening digabung dalam satu laporan.
 */
export function bukuKas(transaksi, saldoAwal = 0) {
  const urut = [...transaksi].sort((a, b) => (a.tanggal === b.tanggal
    ? String(a.dibuatPada).localeCompare(String(b.dibuatPada))
    : String(a.tanggal).localeCompare(String(b.tanggal))));

  let saldo = saldoAwal;
  const baris = urut.map((t) => {
    saldo += Number(t.nominal) || 0;
    return {
      ...t,
      debit: t.nominal < 0 ? -t.nominal : 0,
      kredit: t.nominal > 0 ? t.nominal : 0,
      saldoBerjalan: saldo,
    };
  });

  return {
    baris,
    saldoAwal,
    saldoAkhir: saldo,
    totalDebit: baris.reduce((s, b) => s + b.debit, 0),
    totalKredit: baris.reduce((s, b) => s + b.kredit, 0),
  };
}

/**
 * Cash Flow: pemasukan dan pengeluaran dirinci per kategori.
 * Transfer internal dikeluarkan agar perpindahan dana antar rekening sendiri
 * tidak tampil sebagai arus kas.
 */
export function cashFlow(transaksi, petaKategori) {
  const bersih = tanpaTransferInternal(transaksi);

  const kumpul = (arah) => {
    const peta = new Map();
    bersih
      .filter((t) => (arah === 'masuk' ? t.nominal > 0 : t.nominal < 0))
      .forEach((t) => {
        const id = t.kategoriId || '';
        if (!peta.has(id)) peta.set(id, { kategoriId: id, total: 0, jumlah: 0 });
        const k = peta.get(id);
        k.total += Math.abs(t.nominal);
        k.jumlah += 1;
      });
    return [...peta.values()]
      .map((k) => {
        const kat = petaKategori.get(k.kategoriId);
        return { ...k, nama: kat ? kat.nama : 'Tanpa kategori', ikon: kat?.ikon || '🏷', warna: kat?.warna || 'var(--text-3)' };
      })
      .sort((a, b) => b.total - a.total);
  };

  const masuk = kumpul('masuk');
  const keluar = kumpul('keluar');
  const totalMasuk = masuk.reduce((s, k) => s + k.total, 0);
  const totalKeluar = keluar.reduce((s, k) => s + k.total, 0);

  return { masuk, keluar, totalMasuk, totalKeluar, netto: totalMasuk - totalKeluar };
}

/** Rekap Bulanan: satu baris per bulan. */
export function rekapBulanan(transaksi, opsi = {}) {
  const bersih = tanpaTransferInternal(transaksi);
  const peta = new Map();

  bersih.forEach((t) => {
    const ym = kunciBulan(t.tanggal);
    if (!ym) return;
    if (!peta.has(ym)) peta.set(ym, { ym, masuk: 0, keluar: 0, jumlah: 0 });
    const b = peta.get(ym);
    if (t.nominal > 0) b.masuk += t.nominal;
    else b.keluar += -t.nominal;
    b.jumlah += 1;
  });

  const kunci = [...peta.keys()].sort();
  if (!kunci.length) return [];

  const awal = opsi.dari ? kunciBulan(opsi.dari) : kunci[0];
  const akhir = opsi.sampai ? kunciBulan(opsi.sampai) : kunci[kunci.length - 1];

  let kumulatif = 0;
  return rentangBulan(awal, akhir).map((ym) => {
    const b = peta.get(ym) || { ym, masuk: 0, keluar: 0, jumlah: 0 };
    const netto = b.masuk - b.keluar;
    kumulatif += netto;
    return { ...b, netto, kumulatif, label: bulanTampil(ym) };
  });
}

/** Rekap Tahunan: satu baris per tahun, plus rata-rata bulanannya. */
export function rekapTahunan(transaksi) {
  const bersih = tanpaTransferInternal(transaksi);
  const peta = new Map();

  bersih.forEach((t) => {
    const y = kunciTahun(t.tanggal);
    if (!y) return;
    if (!peta.has(y)) peta.set(y, { tahun: y, masuk: 0, keluar: 0, jumlah: 0, bulan: new Set() });
    const b = peta.get(y);
    if (t.nominal > 0) b.masuk += t.nominal;
    else b.keluar += -t.nominal;
    b.jumlah += 1;
    b.bulan.add(kunciBulan(t.tanggal));
  });

  return [...peta.values()]
    .sort((a, b) => a.tahun.localeCompare(b.tahun))
    .map((b) => {
      const jumlahBulan = b.bulan.size || 1;
      return {
        tahun: b.tahun,
        masuk: b.masuk,
        keluar: b.keluar,
        netto: b.masuk - b.keluar,
        jumlah: b.jumlah,
        bulanAktif: jumlahBulan,
        rataMasuk: b.masuk / jumlahBulan,
        rataKeluar: b.keluar / jumlahBulan,
      };
    });
}

/** Judul periode untuk kop laporan yang dicetak. */
export function judulPeriode(dari, sampai) {
  if (!dari && !sampai) return 'Seluruh periode';
  if (dari && sampai) return `${dari} sampai ${sampai}`;
  return dari ? `Sejak ${dari}` : `Sampai ${sampai}`;
}
