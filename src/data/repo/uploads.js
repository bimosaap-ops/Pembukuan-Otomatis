/** Repository riwayat upload e-statement. */

import { STORE, ambilSemua, ambil, simpan, hapus, ambilLewatIndex } from '../db.js';
import { buatFileUpload } from '../../domain/entities.js';
import * as trxRepo from './transactions.js';
import * as akunRepo from './accounts.js';

export async function daftar() {
  const rows = await ambilSemua(STORE.UPLOADED_FILES);
  rows.sort((a, b) => String(b.tanggalUpload).localeCompare(String(a.tanggalUpload)));
  return rows;
}

export async function satu(id) {
  return ambil(STORE.UPLOADED_FILES, id);
}

export async function simpanUpload(data) {
  const rec = buatFileUpload(data);
  await simpan(STORE.UPLOADED_FILES, rec);
  return rec;
}

/** Mendeteksi file PDF yang isinya persis sama dengan yang pernah di-upload. */
export async function cariHashFile(fileHash) {
  if (!fileHash) return null;
  const rows = await ambilLewatIndex(STORE.UPLOADED_FILES, 'fileHash', fileHash);
  return rows[0] || null;
}

/**
 * Membatalkan satu upload: seluruh transaksi yang berasal dari file itu dihapus,
 * lalu saldo rekening dihitung ulang. Ini jalan keluar kalau parsing ternyata meleset.
 */
export async function hapusUpload(id) {
  const rec = await satu(id);
  const jumlah = await trxRepo.hapusPerFileUpload(id);
  await hapus(STORE.UPLOADED_FILES, id);
  if (rec?.accountId) await akunRepo.hitungUlangSaldo(rec.accountId);
  return { transaksiTerhapus: jumlah };
}

export async function terakhir(n = 5) {
  const rows = await daftar();
  return rows.slice(0, n);
}
