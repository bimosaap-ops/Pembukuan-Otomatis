/**
 * Perhitungan angka untuk Dashboard dan Analitik. Modul murni: menerima daftar
 * transaksi biasa dan mengembalikan angka siap tampil.
 *
 * Transaksi yang ditandai "transfer internal" (pindah dana antar rekening milik
 * sendiri) dikeluarkan dari total pemasukan dan pengeluaran, karena kalau ikut
 * dihitung satu perpindahan uang akan muncul dua kali — sekali sebagai
 * pengeluaran di rekening asal dan sekali sebagai pemasukan di rekening tujuan.
 */

import { kunciBulan, rentangBulan, bulanTampil, namaBulan } from '../core/dates.js';

export function tanpaTransferInternal(transaksi) {
  return transaksi.filter((t) => !t.transferInternal);
}

export function ringkasArus(transaksi) {
  const bersih = tanpaTransferInternal(transaksi);
  const masuk = bersih.reduce((s, t) => s + (t.nominal > 0 ? t.nominal : 0), 0);
  const keluar = bersih.reduce((s, t) => s + (t.nominal < 0 ? -t.nominal : 0), 0);
  return { masuk, keluar, netto: masuk - keluar, jumlah: bersih.length };
}

/**
 * Arus kas per bulan. Bulan tanpa transaksi tetap muncul dengan nilai nol supaya
 * grafik tidak "melompat" dan jeda aktivitas tetap terlihat.
 */
export function arusPerBulan(transaksi, opsi = {}) {
  const bersih = tanpaTransferInternal(transaksi);
  const peta = new Map();

  bersih.forEach((t) => {
    const ym = kunciBulan(t.tanggal);
    if (!ym) return;
    if (!peta.has(ym)) peta.set(ym, { ym, masuk: 0, keluar: 0 });
    const b = peta.get(ym);
    if (t.nominal > 0) b.masuk += t.nominal;
    else b.keluar += -t.nominal;
  });

  const kunci = [...peta.keys()].sort();
  const awal = opsi.dari ? kunciBulan(opsi.dari) : kunci[0];
  const akhir = opsi.sampai ? kunciBulan(opsi.sampai) : kunci[kunci.length - 1];
  if (!awal || !akhir) return [];

  return rentangBulan(awal, akhir).map((ym) => {
    const b = peta.get(ym) || { ym, masuk: 0, keluar: 0 };
    return {
      ...b,
      netto: b.masuk - b.keluar,
      label: labelBulanPendek(ym),
      labelPanjang: bulanTampil(ym),
    };
  });
}

function labelBulanPendek(ym) {
  const [, m] = ym.split('-').map(Number);
  return namaBulan(m - 1, true);
}

/** Komposisi per kategori untuk satu arah transaksi. */
export function perKategori(transaksi, petaKategori, arah = 'keluar') {
  const bersih = tanpaTransferInternal(transaksi)
    .filter((t) => (arah === 'keluar' ? t.nominal < 0 : t.nominal > 0));

  const peta = new Map();
  bersih.forEach((t) => {
    const id = t.kategoriId || '(tanpa kategori)';
    if (!peta.has(id)) peta.set(id, { kategoriId: id, total: 0, jumlah: 0 });
    const k = peta.get(id);
    k.total += Math.abs(t.nominal);
    k.jumlah += 1;
  });

  return [...peta.values()]
    .map((k) => {
      const kat = petaKategori.get(k.kategoriId);
      return {
        ...k,
        nama: kat ? `${kat.ikon} ${kat.nama}` : 'Tanpa kategori',
        namaBersih: kat ? kat.nama : 'Tanpa kategori',
        warna: kat?.warna || 'var(--text-3)',
      };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Tren saldo gabungan per bulan.
 *
 * Saldo dihitung maju dari `saldoAwal`, bukan diambil dari kolom saldo statement,
 * karena dengan beberapa rekening yang periodenya berbeda kolom saldo masing-masing
 * tidak bisa dijumlahkan begitu saja.
 */
export function trenSaldo(transaksi, saldoAwal = 0, opsi = {}) {
  const urut = [...transaksi].sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
  if (!urut.length) return [];

  const perBulanNetto = new Map();
  urut.forEach((t) => {
    const ym = kunciBulan(t.tanggal);
    if (!ym) return;
    perBulanNetto.set(ym, (perBulanNetto.get(ym) || 0) + (Number(t.nominal) || 0));
  });

  const kunci = [...perBulanNetto.keys()].sort();
  const awal = opsi.dari ? kunciBulan(opsi.dari) : kunci[0];
  const akhir = opsi.sampai ? kunciBulan(opsi.sampai) : kunci[kunci.length - 1];

  let saldo = saldoAwal;
  return rentangBulan(awal, akhir).map((ym) => {
    saldo += perBulanNetto.get(ym) || 0;
    return { ym, label: labelBulanPendek(ym), labelPanjang: bulanTampil(ym), nilai: saldo };
  });
}

/** Pengeluaran tunggal terbesar. */
export function topPengeluaran(transaksi, n = 5) {
  return tanpaTransferInternal(transaksi)
    .filter((t) => t.nominal < 0)
    .sort((a, b) => a.nominal - b.nominal)
    .slice(0, n);
}

/** Transaksi terbaru, dipakai blok "10 Transaksi Terbaru" di Dashboard. */
export function terbaru(transaksi, n = 10) {
  return [...transaksi]
    .sort((a, b) => (a.tanggal === b.tanggal
      ? String(b.dibuatPada).localeCompare(String(a.dibuatPada))
      : String(b.tanggal).localeCompare(String(a.tanggal))))
    .slice(0, n);
}

/** Total saldo seluruh rekening. */
export function totalSaldo(akun) {
  return akun.reduce((s, a) => s + (Number(a.saldo) || 0), 0);
}

/** Saldo awal gabungan, dipakai sebagai titik mula tren saldo. */
export function totalSaldoAwal(akun) {
  return akun.reduce((s, a) => s + (Number(a.saldoAwal) || 0), 0);
}

/** Rata-rata pengeluaran per bulan, untuk konteks di samping angka bulan ini. */
export function rataRataBulanan(arus, medan = 'keluar') {
  const isi = arus.filter((b) => b.masuk || b.keluar);
  if (!isi.length) return 0;
  return isi.reduce((s, b) => s + b[medan], 0) / isi.length;
}
