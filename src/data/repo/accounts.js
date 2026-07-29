/** Repository rekening, termasuk penghitungan ulang saldo dari transaksi. */

import { STORE, ambilSemua, ambil, simpan, hapus, jalankan } from '../db.js';
import { buatAkun, JENIS_AKUN } from '../../domain/entities.js';
import * as trxRepo from './transactions.js';

export async function daftar() {
  const rows = await ambilSemua(STORE.ACCOUNTS);
  rows.sort((a, b) => `${a.bank} ${a.nomorRekening}`.localeCompare(`${b.bank} ${b.nomorRekening}`));
  return rows;
}

export async function peta() {
  const rows = await daftar();
  return new Map(rows.map((a) => [a.id, a]));
}

export async function satu(id) {
  return ambil(STORE.ACCOUNTS, id);
}

export async function simpanAkun(data) {
  const akun = buatAkun(data);
  await simpan(STORE.ACCOUNTS, akun);
  return akun;
}

/**
 * Mencari rekening yang cocok dengan header statement, atau membuatnya bila belum ada.
 * Pencocokan memakai nomor rekening (yang paling khas); bila statement tidak
 * mencantumkannya, dipakai kombinasi bank + nama pemilik.
 */
export async function cariAtauBuat({ bank, nomorRekening, namaPemilik }) {
  const rows = await daftar();
  const nomorBersih = String(nomorRekening || '').replace(/\D/g, '');

  if (nomorBersih) {
    const cocok = rows.find((a) => String(a.nomorRekening).replace(/\D/g, '') === nomorBersih);
    if (cocok) return { akun: cocok, baru: false };
  } else if (bank) {
    const cocok = rows.find((a) => a.bank === bank
      && (!namaPemilik || a.namaPemilik.toUpperCase() === String(namaPemilik).toUpperCase()));
    if (cocok) return { akun: cocok, baru: false };
  }

  const akun = await simpanAkun({
    bank: bank || 'Lainnya',
    nomorRekening: nomorRekening || '',
    namaPemilik: namaPemilik || '',
    jenis: JENIS_AKUN.BANK,
  });
  return { akun, baru: true };
}

/**
 * Menghitung ulang saldo dan jumlah transaksi sebuah rekening.
 *
 * Saldo diambil dari kolom saldo transaksi terakhir bila statement mencantumkannya —
 * itu angka resmi dari bank. Kalau tidak ada (mis. rekening kas manual), saldo
 * dihitung dari saldo awal ditambah seluruh mutasi.
 */
export async function hitungUlangSaldo(accountId) {
  const akun = await satu(accountId);
  if (!akun) return null;

  const rows = await trxRepo.perAkun(accountId);
  const denganSaldo = rows.filter((r) => r.saldo !== null && r.saldo !== undefined);
  const terakhir = denganSaldo[denganSaldo.length - 1];

  const saldo = terakhir
    ? terakhir.saldo
    : (akun.saldoAwal || 0) + rows.reduce((s, r) => s + (Number(r.nominal) || 0), 0);

  const perbarui = { ...akun, saldo, jumlahTransaksi: rows.length };
  await simpan(STORE.ACCOUNTS, perbarui);
  return perbarui;
}

export async function hitungUlangSemua() {
  const rows = await daftar();
  const hasil = [];
  for (const a of rows) {
    hasil.push(await hitungUlangSaldo(a.id));
  }
  return hasil;
}

/** Menghapus rekening beserta seluruh transaksinya. */
export async function hapusAkun(id) {
  const jumlah = await trxRepo.hapusPerAkun(id);
  const upload = await ambilSemua(STORE.UPLOADED_FILES);
  const milik = upload.filter((u) => u.accountId === id).map((u) => u.id);
  if (milik.length) {
    await jalankan(STORE.UPLOADED_FILES, 'readwrite', (store) => {
      milik.forEach((uid) => store.delete(uid));
    });
  }
  await hapus(STORE.ACCOUNTS, id);
  return { transaksiTerhapus: jumlah, uploadTerhapus: milik.length };
}
