/**
 * Bentuk entitas dan nilai bawaannya. Modul murni — tidak menyentuh database.
 */

import { idBaru } from '../core/hash.js';
import { hariIni } from '../core/dates.js';

export const JENIS_AKUN = { BANK: 'bank', KAS: 'kas' };
export const SUMBER = { PDF: 'pdf', MANUAL: 'manual' };
export const TIPE_KATEGORI = { PEMASUKAN: 'pemasukan', PENGELUARAN: 'pengeluaran' };
export const STATUS_UPLOAD = { SUKSES: 'sukses', SEBAGIAN: 'sebagian', GAGAL: 'gagal' };

export const BANK_DIKENAL = [
  'BCA', 'Permata', 'Mandiri', 'BRI', 'BNI', 'CIMB Niaga', 'Danamon',
  'BTN', 'Panin', 'OCBC', 'Maybank', 'Jago', 'SeaBank', 'Blu', 'Jenius', 'Lainnya',
];

export function buatAkun(data = {}) {
  return {
    id: data.id || idBaru('acc'),
    bank: data.bank || '',
    nomorRekening: String(data.nomorRekening || '').trim(),
    namaPemilik: data.namaPemilik || '',
    mataUang: data.mataUang || 'IDR',
    jenis: data.jenis || JENIS_AKUN.BANK,
    saldoAwal: Number(data.saldoAwal) || 0,
    /* Dihitung ulang dari transaksi; disimpan agar daftar rekening tidak perlu
       memindai seluruh transaksi setiap kali dibuka. */
    saldo: Number(data.saldo) || 0,
    jumlahTransaksi: Number(data.jumlahTransaksi) || 0,
    warna: data.warna || '',
    catatan: data.catatan || '',
    dibuatPada: data.dibuatPada || new Date().toISOString(),
  };
}

export function buatTransaksi(data = {}) {
  const nominal = Number(data.nominal) || 0;
  return {
    id: data.id || idBaru('trx'),
    /* `hash` unik per transaksi (baseHash + nomor urut kejadian);
       `baseHash` sama untuk transaksi kembar dan dipakai menghitung duplikat. */
    hash: data.hash || '',
    baseHash: data.baseHash || '',
    accountId: data.accountId || '',
    tanggal: data.tanggal || hariIni(),
    deskripsi: data.deskripsi || '',
    deskripsiRaw: data.deskripsiRaw || data.deskripsi || '',
    /* `nominal` adalah sumber kebenaran (positif = masuk, negatif = keluar);
       `debit`/`kredit` disimpan agar tampilan tabel dan export tidak perlu menghitung ulang. */
    nominal,
    debit: nominal < 0 ? Math.abs(nominal) : 0,
    kredit: nominal > 0 ? nominal : 0,
    saldo: data.saldo === null || data.saldo === undefined ? null : Number(data.saldo),
    kategoriId: data.kategoriId || '',
    transferInternal: Boolean(data.transferInternal),
    sumber: data.sumber || SUMBER.MANUAL,
    uploadedFileId: data.uploadedFileId || '',
    catatan: data.catatan || '',
    dibuatPada: data.dibuatPada || new Date().toISOString(),
    diubahPada: data.diubahPada || '',
  };
}

export function buatFileUpload(data = {}) {
  return {
    id: data.id || idBaru('upl'),
    namaFile: data.namaFile || '',
    bank: data.bank || '',
    nomorRekening: data.nomorRekening || '',
    accountId: data.accountId || '',
    periodeAwal: data.periodeAwal || '',
    periodeAkhir: data.periodeAkhir || '',
    tanggalUpload: data.tanggalUpload || new Date().toISOString(),
    jumlahTransaksi: Number(data.jumlahTransaksi) || 0,
    berhasil: Number(data.berhasil) || 0,
    duplikat: Number(data.duplikat) || 0,
    status: data.status || STATUS_UPLOAD.SUKSES,
    catatan: data.catatan || '',
    fileHash: data.fileHash || '',
    ukuran: Number(data.ukuran) || 0,
  };
}

export function buatKategori(data = {}) {
  return {
    id: data.id || idBaru('kat'),
    nama: data.nama || '',
    tipe: data.tipe || TIPE_KATEGORI.PENGELUARAN,
    warna: data.warna || 'var(--c1)',
    ikon: data.ikon || '🏷',
    polaKataKunci: Array.isArray(data.polaKataKunci) ? data.polaKataKunci : [],
    /* Menentukan siapa yang menang bila satu deskripsi cocok dengan beberapa kategori.
       Kata kunci transfer sengaja berprioritas rendah karena sangat umum. */
    prioritas: data.prioritas === undefined ? 50 : Number(data.prioritas),
    bawaan: Boolean(data.bawaan),
    urutan: Number(data.urutan) || 0,
  };
}

/** Kategori penampung saat tidak ada aturan yang cocok. */
export const KATEGORI_LAINNYA_MASUK = 'kat_lain_masuk';
export const KATEGORI_LAINNYA_KELUAR = 'kat_lain_keluar';
