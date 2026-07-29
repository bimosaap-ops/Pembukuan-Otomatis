/** Repository transaksi: penyaringan, penyimpanan massal, dan hitungan duplikat. */

import {
  STORE, jalankan, ambilSemua, ambil, simpan, hapus, hapusBanyak,
  ambilLewatIndex, telusuriIndex,
} from '../db.js';
import { buatTransaksi } from '../../domain/entities.js';

export async function semua() {
  const rows = await ambilSemua(STORE.TRANSACTIONS);
  rows.sort(bandingkan);
  return rows;
}

/** Urut menaik berdasarkan tanggal; dalam satu hari ikuti urutan statement. */
function bandingkan(a, b) {
  if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? -1 : 1;
  return String(a.dibuatPada).localeCompare(String(b.dibuatPada));
}

export async function satu(id) {
  return ambil(STORE.TRANSACTIONS, id);
}

export async function perAkun(accountId) {
  const rows = await ambilLewatIndex(STORE.TRANSACTIONS, 'accountId', accountId);
  rows.sort(bandingkan);
  return rows;
}

export async function perFileUpload(uploadedFileId) {
  const rows = await ambilLewatIndex(STORE.TRANSACTIONS, 'uploadedFileId', uploadedFileId);
  rows.sort(bandingkan);
  return rows;
}

/**
 * Menghitung berapa transaksi yang sudah tersimpan untuk setiap baseHash.
 * Inilah masukan untuk `tandaiDuplikat` di lapisan domain.
 */
export async function hitungPerBaseHash(daftarBaseHash) {
  const unik = [...new Set(daftarBaseHash)].filter(Boolean);
  const hasil = new Map();
  if (!unik.length) return hasil;

  await jalankan(STORE.TRANSACTIONS, 'readonly', (store) => {
    const idx = store.index('baseHash');
    unik.forEach((bh) => {
      const req = idx.count(IDBKeyRange.only(bh));
      req.onsuccess = () => { if (req.result) hasil.set(bh, req.result); };
    });
  });

  return hasil;
}

export async function simpanSatu(data) {
  const trx = buatTransaksi(data);
  await simpan(STORE.TRANSACTIONS, trx);
  return trx;
}

export async function simpanBanyakTransaksi(daftar) {
  if (!daftar.length) return [];
  const siap = daftar.map((d) => buatTransaksi(d));
  await jalankan(STORE.TRANSACTIONS, 'readwrite', (store) => {
    siap.forEach((t) => store.put(t));
  });
  return siap;
}

export async function hapusTransaksi(id) {
  return hapus(STORE.TRANSACTIONS, id);
}

export async function hapusPerFileUpload(uploadedFileId) {
  const rows = await perFileUpload(uploadedFileId);
  await hapusBanyak(STORE.TRANSACTIONS, rows.map((r) => r.id));
  return rows.length;
}

export async function hapusPerAkun(accountId) {
  const rows = await perAkun(accountId);
  await hapusBanyak(STORE.TRANSACTIONS, rows.map((r) => r.id));
  return rows.length;
}

/**
 * Mengambil transaksi dalam rentang tanggal lewat indeks, sehingga laporan
 * bertahun-tahun tidak perlu memuat seluruh tabel ke memori.
 */
export async function rentangTanggal(dari, sampai) {
  const hasil = [];
  let range = null;
  if (dari && sampai) range = IDBKeyRange.bound(dari, sampai);
  else if (dari) range = IDBKeyRange.lowerBound(dari);
  else if (sampai) range = IDBKeyRange.upperBound(sampai);

  await telusuriIndex(STORE.TRANSACTIONS, 'tanggal', range, (row) => { hasil.push(row); });
  hasil.sort(bandingkan);
  return hasil;
}

/**
 * Penyaringan lengkap untuk halaman Transaksi.
 * Filter tanggal dijalankan lewat indeks, sisanya di memori atas hasil yang sudah menyempit.
 */
export async function cari(filter = {}) {
  const {
    dari = '', sampai = '', accountId = '', kategoriId = '',
    nominalMin = null, nominalMaks = null, kataKunci = '',
    arah = '', sertakanTransferInternal = true,
  } = filter;

  let rows = await rentangTanggal(dari, sampai);

  if (accountId) rows = rows.filter((r) => r.accountId === accountId);
  if (kategoriId) rows = rows.filter((r) => r.kategoriId === kategoriId);
  if (!sertakanTransferInternal) rows = rows.filter((r) => !r.transferInternal);
  if (arah === 'masuk') rows = rows.filter((r) => r.nominal > 0);
  if (arah === 'keluar') rows = rows.filter((r) => r.nominal < 0);

  if (Number.isFinite(nominalMin)) rows = rows.filter((r) => Math.abs(r.nominal) >= nominalMin);
  if (Number.isFinite(nominalMaks)) rows = rows.filter((r) => Math.abs(r.nominal) <= nominalMaks);

  const kunci = String(kataKunci || '').trim().toUpperCase();
  if (kunci) {
    rows = rows.filter((r) => `${r.deskripsi} ${r.catatan}`.toUpperCase().includes(kunci));
  }

  return rows;
}

/**
 * Tanggal transaksi paling awal dan paling akhir yang tersimpan.
 * Dipakai untuk menentukan periode awal filter: kalau memakai "12 bulan terakhir"
 * dihitung dari hari ini, statement lama akan tampil kosong dan membingungkan.
 * Dibaca lewat kursor indeks, jadi tidak perlu memuat seluruh tabel.
 */
export async function rentangTersedia() {
  let min = '';
  let maks = '';
  await telusuriIndex(STORE.TRANSACTIONS, 'tanggal', null, (row) => { min = row.tanggal; return false; });
  await telusuriIndex(STORE.TRANSACTIONS, 'tanggal', null, (row) => { maks = row.tanggal; return false; }, 'prev');
  return { min, maks };
}

/** Perubahan massal kategori — dipakai fitur "terapkan ke semua transaksi serupa". */
export async function ubahKategoriBanyak(ids, kategoriId) {
  if (!ids.length) return 0;
  const waktu = new Date().toISOString();
  await jalankan(STORE.TRANSACTIONS, 'readwrite', (store) => {
    ids.forEach((id) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const row = req.result;
        if (!row) return;
        store.put({ ...row, kategoriId, diubahPada: waktu });
      };
    });
  });
  return ids.length;
}
