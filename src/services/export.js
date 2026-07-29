/**
 * Ekspor data: Excel, CSV, PDF (lewat cetak), serta backup dan restore database.
 *
 * SheetJS disalin ke folder vendor, sama seperti pdf.js, supaya ekspor Excel tetap
 * berfungsi ketika aplikasi dibuka tanpa koneksi internet.
 */

import { STORE, ambilSemua, kosongkanSemua, simpanBanyak } from '../data/db.js';
import * as kategoriRepo from '../data/repo/categories.js';
import * as akunRepo from '../data/repo/accounts.js';

const JALUR_XLSX = new URL('../../vendor/xlsx/xlsx.mini.min.js', import.meta.url).href;
let pemuatXlsx = null;

function muatXlsx() {
  if (pemuatXlsx) return pemuatXlsx;
  pemuatXlsx = new Promise((resolve, reject) => {
    if (globalThis.XLSX) { resolve(globalThis.XLSX); return; }
    const s = document.createElement('script');
    s.src = JALUR_XLSX;
    s.onload = () => (globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error('SheetJS gagal dimuat.')));
    s.onerror = () => reject(new Error('Gagal memuat pustaka Excel dari folder vendor.'));
    document.head.appendChild(s);
  });
  return pemuatXlsx;
}

/**
 * Mengunduh berkas. Bila browser mendukung File System Access API (Chrome/Edge
 * di desktop), pengguna bisa memilih lokasi simpan; di HP API itu tidak tersedia
 * sehingga berkas jatuh ke folder unduhan bawaan.
 */
export async function unduhBlob(blob, namaFile) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: namaFile,
        types: [{ description: 'Berkas', accept: { [blob.type || 'application/octet-stream']: [`.${namaFile.split('.').pop()}`] } }],
      });
      const tulis = await handle.createWritable();
      await tulis.write(blob);
      await tulis.close();
      return { lokasiDipilih: true };
    } catch (e) {
      // Pengguna membatalkan dialog: jangan diam-diam mengunduh ke folder lain.
      if (e?.name === 'AbortError') return { batal: true };
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { lokasiDipilih: false };
}

export function dukunganPilihFolder() {
  return Boolean(window.showSaveFilePicker);
}

/* ==========================================================================
   CSV
   ========================================================================== */

function selCsv(nilai) {
  const s = nilai === null || nilai === undefined ? '' : String(nilai);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV memakai titik koma sebagai pemisah dan koma sebagai desimal, mengikuti
 * kebiasaan Excel pada Windows berbahasa Indonesia. Tanpa itu, angka seperti
 * "1.234,56" akan pecah ke beberapa kolom saat berkas dibuka.
 */
export async function exportCsv(namaFile, kolom, baris) {
  const judul = kolom.map((k) => selCsv(k.judul)).join(';');
  const isi = baris.map((row) => kolom.map((k) => selCsv(k.nilai(row))).join(';'));
  const teks = `﻿${[judul, ...isi].join('\r\n')}`;
  return unduhBlob(new Blob([teks], { type: 'text/csv;charset=utf-8' }), namaFile);
}

/* ==========================================================================
   Excel
   ========================================================================== */

/**
 * @param {string} namaFile
 * @param {Array<{nama:string, kolom:Array, baris:Array}>} lembar
 */
export async function exportExcel(namaFile, lembar) {
  const XLSX = await muatXlsx();
  const wb = XLSX.utils.book_new();

  lembar.forEach((l) => {
    const data = [
      l.kolom.map((k) => k.judul),
      ...l.baris.map((row) => l.kolom.map((k) => k.nilai(row))),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = l.kolom.map((k) => ({ wch: k.lebar || 18 }));
    // Nama lembar Excel dibatasi 31 karakter dan tidak boleh memuat : \ / ? * [ ]
    const nama = String(l.nama).replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, nama);
  });

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return unduhBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    namaFile,
  );
}

/* ==========================================================================
   PDF lewat dialog cetak
   ========================================================================== */

/**
 * Ekspor PDF memakai dialog cetak bawaan browser ("Simpan sebagai PDF").
 * Cara ini menghasilkan teks yang bisa dicari dan dipilih, jalan sama baiknya di
 * Android maupun iOS, dan tidak menambah pustaka berat ke dalam aplikasi.
 */
export function cetakHalaman() {
  window.print();
}

/* ==========================================================================
   Backup & Restore
   ========================================================================== */

export const VERSI_BACKUP = 1;

export async function buatBackup() {
  const [accounts, transactions, uploaded, categories, settings] = await Promise.all([
    ambilSemua(STORE.ACCOUNTS),
    ambilSemua(STORE.TRANSACTIONS),
    ambilSemua(STORE.UPLOADED_FILES),
    ambilSemua(STORE.CATEGORIES),
    ambilSemua(STORE.SETTINGS),
  ]);

  return {
    aplikasi: 'pembukuan-keuangan',
    versi: VERSI_BACKUP,
    dibuatPada: new Date().toISOString(),
    jumlah: {
      rekening: accounts.length,
      transaksi: transactions.length,
      upload: uploaded.length,
      kategori: categories.length,
    },
    data: { accounts, transactions, uploaded_files: uploaded, categories, settings },
  };
}

export async function unduhBackup() {
  const backup = await buatBackup();
  const tanggal = new Date().toISOString().slice(0, 10);
  return unduhBlob(
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
    `backup-pembukuan-${tanggal}.json`,
  );
}

/**
 * Memulihkan database dari berkas backup.
 * @param {object} backup isi berkas JSON
 * @param {'ganti'|'gabung'} mode `ganti` mengosongkan database lebih dulu
 */
export async function pulihkanBackup(backup, mode = 'ganti') {
  if (!backup || backup.aplikasi !== 'pembukuan-keuangan' || !backup.data) {
    throw new Error('Berkas ini bukan backup Pembukuan yang sah.');
  }
  if (Number(backup.versi) > VERSI_BACKUP) {
    throw new Error('Backup dibuat oleh versi aplikasi yang lebih baru. Perbarui aplikasinya lebih dulu.');
  }

  if (mode === 'ganti') await kosongkanSemua();

  const { accounts = [], transactions = [], uploaded_files: uploaded = [], categories = [], settings = [] } = backup.data;

  await simpanBanyak(STORE.CATEGORIES, categories);
  await simpanBanyak(STORE.ACCOUNTS, accounts);
  await simpanBanyak(STORE.UPLOADED_FILES, uploaded);
  await simpanBanyak(STORE.SETTINGS, settings);

  // Saat menggabung, transaksi dengan hash yang sudah ada dilewati supaya
  // memulihkan backup lama tidak menggandakan pembukuan yang berjalan.
  if (mode === 'gabung') {
    const adaSekarang = await ambilSemua(STORE.TRANSACTIONS);
    const hashAda = new Set(adaSekarang.map((t) => t.hash));
    await simpanBanyak(STORE.TRANSACTIONS, transactions.filter((t) => !hashAda.has(t.hash)));
  } else {
    await simpanBanyak(STORE.TRANSACTIONS, transactions);
  }

  kategoriRepo.kosongkanCache();
  await akunRepo.hitungUlangSemua();

  return {
    rekening: accounts.length,
    transaksi: transactions.length,
    upload: uploaded.length,
    kategori: categories.length,
  };
}
