/**
 * Alur pemrosesan e-statement, tujuh langkah sesuai rancangan:
 *
 *   1. Upload PDF          6. Simpan database
 *   2. Deteksi bank        7. Dashboard diperbarui
 *   3. Parsing transaksi
 *   4. Validasi
 *   5. Cek duplikasi
 *
 * Modul ini menjadi lapisan penghubung: parser tidak tahu database, repository
 * tidak tahu PDF, dan tampilan tidak perlu tahu keduanya. Langkah 6 sengaja
 * dipisah ke `simpanDraft` karena harus lewat persetujuan pengguna di layar Review.
 */

import { hashBiner } from '../core/hash.js';
import { bukaDokumen, ekstrakPotongan, ButuhPassword } from '../parsers/pdf-loader.js';
import { parseStatement } from '../parsers/registry.js';
import { validasiBaris, cocokkanRingkasan, periodeDariBaris } from '../domain/validate.js';
import { bubuhiBaseHash, tandaiDuplikat, ringkasDuplikat } from '../domain/dedupe.js';
import { kategorikanBanyak } from '../domain/categorize.js';
import { buatTransaksi, SUMBER, STATUS_UPLOAD } from '../domain/entities.js';
import * as akunRepo from '../data/repo/accounts.js';
import * as trxRepo from '../data/repo/transactions.js';
import * as uploadRepo from '../data/repo/uploads.js';
import * as kategoriRepo from '../data/repo/categories.js';
import { emit, EVENT } from '../core/events.js';

export const LANGKAH = [
  { id: 'upload', label: 'Upload PDF' },
  { id: 'deteksi', label: 'Deteksi bank' },
  { id: 'parsing', label: 'Parsing transaksi' },
  { id: 'validasi', label: 'Validasi' },
  { id: 'duplikasi', label: 'Cek duplikasi' },
  { id: 'simpan', label: 'Simpan database' },
  { id: 'selesai', label: 'Dashboard diperbarui' },
];

/**
 * Menjalankan langkah 1-5 dan mengembalikan draf untuk ditinjau pengguna.
 *
 * @param {File} file
 * @param {object} opsi
 * @param {(idLangkah:string, status:'jalan'|'selesai'|'gagal', ket?:string) => void} opsi.onLangkah
 * @param {(salah:boolean) => Promise<string|null>} opsi.mintaPassword
 * @param {string} [opsi.paksaAdapter] memaksa adapter bank tertentu
 */
export async function prosesFile(file, opsi = {}) {
  const { onLangkah = () => {}, mintaPassword = null, paksaAdapter = '' } = opsi;
  const lapor = (id, status, ket) => onLangkah(id, status, ket);

  // --- 1. Upload PDF ------------------------------------------------------
  lapor('upload', 'jalan');
  const buffer = await file.arrayBuffer();
  const fileHash = await hashBiner(buffer);
  const pernahAda = await uploadRepo.cariHashFile(fileHash);
  lapor('upload', 'selesai', `${file.name} · ${(file.size / 1024).toFixed(0)} KB`);

  // --- 2 & 3. Deteksi bank dan parsing ------------------------------------
  lapor('deteksi', 'jalan');

  let dokumen = null;
  let password = '';
  for (let percobaan = 0; percobaan < 5; percobaan += 1) {
    try {
      dokumen = await bukaDokumen(buffer, password);
      break;
    } catch (e) {
      if (!(e instanceof ButuhPassword)) {
        lapor('deteksi', 'gagal', e.message);
        throw e;
      }
      if (!mintaPassword) {
        lapor('deteksi', 'gagal', 'PDF terkunci password');
        throw e;
      }
      const jawab = await mintaPassword(e.salah);
      if (jawab === null) {
        lapor('deteksi', 'gagal', 'Dibatalkan');
        throw new Error('Dibatalkan: PDF memerlukan password.');
      }
      password = jawab;
    }
  }
  if (!dokumen) throw new ButuhPassword(true);

  let potongan;
  try {
    potongan = await ekstrakPotongan(dokumen, {
      onProgress: (h, total) => lapor('parsing', 'jalan', `Halaman ${h} dari ${total}`),
    });
  } finally {
    dokumen.destroy?.();
  }

  const hasil = parseStatement(potongan.halaman, { paksaAdapter });
  lapor('deteksi', 'selesai', hasil.bank ? `${hasil.bank}${hasil.nomorRekening ? ` · ${hasil.nomorRekening}` : ''}` : 'Bank tidak dikenali, memakai pembaca umum');

  if (!hasil.transaksi.length) {
    lapor('parsing', 'gagal', 'Tidak ada baris transaksi yang terbaca');
    return draftKosong({ file, fileHash, hasil, potongan, pernahAda });
  }
  lapor('parsing', 'selesai', `${hasil.transaksi.length} baris transaksi`);

  // --- 4. Validasi --------------------------------------------------------
  lapor('validasi', 'jalan');
  const { baris: barisValid, ringkas } = validasiBaris(hasil.transaksi);
  const cekTotal = cocokkanRingkasan(hasil.transaksi, hasil.ringkasan);
  lapor('validasi', ringkas.curiga ? 'gagal' : 'selesai',
    ringkas.curiga ? `${ringkas.curiga} baris perlu diperiksa` : 'Saldo berjalan konsisten');

  // --- 5. Cek duplikasi ---------------------------------------------------
  lapor('duplikasi', 'jalan');
  const cocokAkun = await cariAkunCocok(hasil);
  const identitas = {
    bank: hasil.bank || cocokAkun?.bank || '',
    nomorRekening: hasil.nomorRekening || cocokAkun?.nomorRekening || '',
  };

  const denganHash = await bubuhiBaseHash(barisValid, identitas);
  const jumlahLama = await trxRepo.hitungPerBaseHash(denganHash.map((b) => b.baseHash));
  const ditandai = tandaiDuplikat(denganHash, jumlahLama);

  const kategori = await kategoriRepo.daftar();
  const berkategori = kategorikanBanyak(ditandai, kategori);

  const ringkasDup = ringkasDuplikat(ditandai);
  lapor('duplikasi', 'selesai',
    ringkasDup.duplikat ? `${ringkasDup.baru} baru · ${ringkasDup.duplikat} duplikat` : `${ringkasDup.baru} transaksi baru`);

  const periode = periodeDariBaris(hasil.transaksi);

  return {
    file: { nama: file.name, ukuran: file.size },
    fileHash,
    pernahAda,
    hasil,
    baris: berkategori,
    ringkas,
    ringkasDup,
    cekTotal,
    jumlahLama,
    akunCocok: cocokAkun,
    identitas,
    periodeAwal: periode.periodeAwal,
    periodeAkhir: periode.periodeAkhir,
    teksMentah: hasil.teksMentah,
    catatan: hasil.catatan || [],
  };
}

function draftKosong({ file, fileHash, hasil, pernahAda }) {
  return {
    file: { nama: file.name, ukuran: file.size },
    fileHash,
    pernahAda,
    hasil,
    baris: [],
    ringkas: { total: 0, curiga: 0, adaKolomSaldo: false },
    ringkasDup: { total: 0, baru: 0, duplikat: 0 },
    cekTotal: null,
    jumlahLama: new Map(),
    akunCocok: null,
    identitas: { bank: hasil.bank, nomorRekening: hasil.nomorRekening },
    periodeAwal: '',
    periodeAkhir: '',
    teksMentah: hasil.teksMentah,
    catatan: [
      'Tidak ada baris transaksi yang bisa dibaca dari berkas ini.',
      ...(hasil.catatan || []),
    ],
  };
}

async function cariAkunCocok(hasil) {
  const daftar = await akunRepo.daftar();
  const nomor = String(hasil.nomorRekening || '').replace(/\D/g, '');
  if (nomor) {
    const cocok = daftar.find((a) => String(a.nomorRekening).replace(/\D/g, '') === nomor);
    if (cocok) return cocok;
  }
  if (hasil.bank) {
    const cocok = daftar.filter((a) => a.bank === hasil.bank);
    if (cocok.length === 1) return cocok[0];
  }
  return null;
}

/**
 * Langkah 6 dan 7: menyimpan baris yang disetujui pengguna, lalu memperbarui
 * saldo rekening dan memberi tahu seluruh tampilan bahwa data berubah.
 *
 * @param {object} draft hasil `prosesFile`, sesudah disunting di layar Review
 * @param {object} pilihan { accountId, barisDipilih, onLangkah }
 */
export async function simpanDraft(draft, pilihan = {}) {
  const { accountId = '', onLangkah = () => {} } = pilihan;
  const baris = pilihan.barisDipilih || draft.baris.filter((b) => !b.duplikat && !b.dibuang);

  onLangkah('simpan', 'jalan');

  // Rekening: pakai yang dipilih pengguna, atau bentuk dari kepala statement.
  let akun;
  if (accountId) {
    akun = await akunRepo.satu(accountId);
  } else {
    const hasilAkun = await akunRepo.cariAtauBuat({
      bank: draft.identitas.bank || draft.hasil.bank || 'Lainnya',
      nomorRekening: draft.identitas.nomorRekening || draft.hasil.nomorRekening || '',
      namaPemilik: draft.hasil.namaPemilik || '',
    });
    akun = hasilAkun.akun;
  }
  if (!akun) throw new Error('Rekening tujuan tidak ditemukan.');

  if (draft.hasil.saldoAwal !== null && draft.hasil.saldoAwal !== undefined && !akun.saldoAwal) {
    akun = await akunRepo.simpanAkun({ ...akun, saldoAwal: draft.hasil.saldoAwal });
  }

  const rekaman = await uploadRepo.simpanUpload({
    namaFile: draft.file.nama,
    ukuran: draft.file.ukuran,
    bank: akun.bank,
    nomorRekening: akun.nomorRekening,
    accountId: akun.id,
    periodeAwal: draft.periodeAwal,
    periodeAkhir: draft.periodeAkhir,
    jumlahTransaksi: draft.baris.length,
    berhasil: baris.length,
    duplikat: draft.ringkasDup.duplikat,
    fileHash: draft.fileHash,
    status: tentukanStatus(draft, baris.length),
    catatan: (draft.catatan || []).join(' '),
  });

  const transaksi = baris.map((b) => buatTransaksi({
    hash: b.hash,
    baseHash: b.baseHash,
    accountId: akun.id,
    tanggal: b.tanggal,
    deskripsi: b.deskripsi,
    deskripsiRaw: (b.barisAsli || []).join(' ') || b.deskripsi,
    nominal: b.nominal,
    saldo: b.saldo,
    kategoriId: b.kategoriId,
    transferInternal: Boolean(b.transferInternal),
    sumber: SUMBER.PDF,
    uploadedFileId: rekaman.id,
  }));

  await trxRepo.simpanBanyakTransaksi(transaksi);
  onLangkah('simpan', 'selesai', `${transaksi.length} transaksi tersimpan`);

  onLangkah('selesai', 'jalan');
  const akunTerbaru = await akunRepo.hitungUlangSaldo(akun.id);
  emit(EVENT.DATA_BERUBAH, { sumber: 'upload', uploadedFileId: rekaman.id });
  onLangkah('selesai', 'selesai', 'Saldo dan dashboard diperbarui');

  return { akun: akunTerbaru, upload: rekaman, jumlah: transaksi.length };
}

function tentukanStatus(draft, jumlahDisimpan) {
  if (!jumlahDisimpan) return STATUS_UPLOAD.GAGAL;
  if (draft.ringkas.curiga > 0 || (draft.cekTotal && !draft.cekTotal.semuaCocok)) return STATUS_UPLOAD.SEBAGIAN;
  return STATUS_UPLOAD.SUKSES;
}
