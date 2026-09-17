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
import { bubuhiBaseHash, tandaiDuplikat, ringkasDuplikat, hashFinal } from '../domain/dedupe.js';
import { kategorikanBanyak } from '../domain/categorize.js';
import { buatTransaksi, SUMBER, STATUS_UPLOAD } from '../domain/entities.js';
import * as akunRepo from '../data/repo/accounts.js';
import * as trxRepo from '../data/repo/transactions.js';
import * as uploadRepo from '../data/repo/uploads.js';
import * as kategoriRepo from '../data/repo/categories.js';
import { emit, EVENT } from '../core/events.js';
import { syncAtauAntri, syncStatementKeSheets } from './sheets-sync.js';
import { ledgerMergeAktif, rekonsiliasiSetelahUpload } from './email-ledger-merge.js';

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

  const hasil = parseStatement(potongan.halaman, { paksaAdapter, warna: potongan.warna });
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

  // Hash di sini SEMENTARA: rekening tujuan baru pasti setelah pengguna
  // memilihnya di layar Review, dan untuk berkas dari rekening yang belum
  // pernah ada, rekeningnya memang belum terbentuk. Angka duplikat yang
  // ditampilkan memakai tebakan terbaik (rekening yang cocok, kalau ada);
  // `simpanDraft` menghitung ulang dengan id yang sudah pasti sebelum menyimpan.
  const denganHash = await bubuhiBaseHash(barisValid, cocokAkun?.id || '');
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
  // Nomor diseragamkan dulu: berkas dari bank yang sama bisa menulisnya berbeda.
  const nomor = akunRepo.normalkanNomor(hasil.nomorRekening);
  if (nomor) {
    const cocok = daftar.find((a) => akunRepo.normalkanNomor(a.nomorRekening) === nomor);
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

  if (draft.hasil.saldoAwal !== null && draft.hasil.saldoAwal !== undefined && (akun.saldoAwal == null || akun.saldoAwal === 0)) {
    akun = await akunRepo.simpanAkun({ ...akun, saldoAwal: draft.hasil.saldoAwal });
  }

  // Hash dihitung ULANG di sini, dengan rekening yang sudah pasti.
  //
  // Yang dihitung di `prosesFile` hanya tebakan — rekeningnya bisa saja belum
  // ada saat itu, atau pengguna memindahkannya ke rekening lain di layar
  // Review. Menyimpan hash tebakan berarti transaksi yang sama bisa masuk dua
  // kali lewat berkas yang rekeningnya tertulis berbeda, dan itu penyebab
  // penggelembungan yang paling sulit dilihat karena angkanya tetap tampak wajar.
  const barisFinal = await bubuhiBaseHash(baris, akun.id);
  const jumlahLamaFinal = await trxRepo.hitungPerBaseHash(barisFinal.map((b) => b.baseHash));
  const bernomor = tandaiDuplikat(barisFinal, jumlahLamaFinal);

  // Duplikat yang baru ketahuan SEKARANG (karena rekeningnya baru pasti) tidak
  // ikut disimpan — itu justru gunanya menghitung ulang. Kecuali baris yang di
  // layar Review pengguna putuskan "tetap simpan": keputusan itu dihormati, tapi
  // nomor urutnya harus digeser ke kejadian yang masih kosong. Indeks `hash` di
  // database bersifat unik, jadi memaksakan nomor yang sudah terpakai bukan
  // sekadar salah hitung — seluruh penyimpanan akan ditolak.
  const dipakai = new Set(bernomor.filter((b) => !b.duplikat).map((b) => b.hash));
  const siapSimpan = [];
  bernomor.forEach((b, i) => {
    if (!b.duplikat) { siapSimpan.push(b); return; }
    if (!baris[i] || !baris[i].dipaksa) return;

    let ordinal = (jumlahLamaFinal.get(b.baseHash) || 0) + 1;
    while (dipakai.has(hashFinal(b.baseHash, ordinal))) ordinal += 1;
    const digeser = {
      ...b, ordinal, hash: hashFinal(b.baseHash, ordinal), duplikat: false, dipaksa: true,
    };
    dipakai.add(digeser.hash);
    siapSimpan.push(digeser);
  });

  // Ringkasan cetakan statement ikut disimpan apa adanya — termasuk yang
  // tidak terbaca (null). Inilah satu-satunya kesempatan merekamnya: sesudah
  // layar Review ditutup, teks PDF-nya tidak disimpan dan angka bank itu
  // tidak bisa didapat lagi tanpa upload ulang. Yang memakainya: tab
  // "Kontrol Saldo" di Google Sheet, yang menghadapkan angka ini dengan
  // saldo hasil hitungan pembukuan per rekening per bulan.
  const ringkasanStatement = draft.hasil?.ringkasan || {};
  const rekaman = await uploadRepo.simpanUpload({
    namaFile: draft.file.nama,
    ukuran: draft.file.ukuran,
    bank: akun.bank,
    nomorRekening: akun.nomorRekening,
    accountId: akun.id,
    periodeAwal: draft.periodeAwal,
    periodeAkhir: draft.periodeAkhir,
    jumlahTransaksi: draft.baris.length,
    berhasil: siapSimpan.length,
    duplikat: draft.baris.length - siapSimpan.length,
    fileHash: draft.fileHash,
    status: tentukanStatus(draft, siapSimpan.length),
    catatan: (draft.catatan || []).join(' '),
    // `draft.hasil.saldoAwal` dipakai sebagai cadangan: beberapa adapter
    // (BCA, generic) menemukan SALDO AWAL dari badan tabel walau blok
    // ringkasan di kaki statement tidak terbaca sama sekali.
    saldoAwalStatement: ringkasanStatement.saldoAwal ?? draft.hasil?.saldoAwal ?? null,
    saldoAkhirStatement: ringkasanStatement.saldoAkhir ?? null,
    mutasiDebetStatement: ringkasanStatement.mutasiDebet ?? null,
    mutasiKreditStatement: ringkasanStatement.mutasiKredit ?? null,
  });

  const transaksi = siapSimpan.map((b, i) => buatTransaksi({
    urutan: i,
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
  const tertahan = baris.length - transaksi.length;
  onLangkah('simpan', 'selesai', tertahan
    ? `${transaksi.length} transaksi tersimpan · ${tertahan} ternyata sudah ada`
    : `${transaksi.length} transaksi tersimpan`);

  // "Fase C": e-statement yang baru tersimpan mungkin mengonfirmasi transaksi
  // email yang sebelumnya dicatat provisional (belum ada padanan statement).
  // WAJIB dijalankan SEBELUM hitungUlangSaldo final di bawah -- kalau
  // dibalik, saldo sempat dihitung dari state yang belum tuntas (provisional
  // masih ada + statement baru sudah ada = double count sesaat).
  let akunTersentuhRekonsiliasi = new Set();
  if (await ledgerMergeAktif()) {
    const hasilRekonsiliasi = await rekonsiliasiSetelahUpload(transaksi);
    akunTersentuhRekonsiliasi = hasilRekonsiliasi.akunTersentuh;
  }

  onLangkah('selesai', 'jalan');
  // Hitung ulang SEKALI untuk setiap akun yang tersentuh -- akun upload ini
  // sendiri, plus akun lain yang provisional-nya barusan digantikan (bisa
  // beda dari akun upload kalau resolusiAkunEmail() sempat salah tebak).
  const seluruhAkunTersentuh = new Set([akun.id, ...akunTersentuhRekonsiliasi]);
  let akunTerbaru = akun;
  for (const accountId of seluruhAkunTersentuh) {
    const hasilHitung = await akunRepo.hitungUlangSaldo(accountId);
    if (accountId === akun.id) akunTerbaru = hasilHitung;
  }
  emit(EVENT.DATA_BERUBAH, { sumber: 'upload', uploadedFileId: rekaman.id });
  onLangkah('selesai', 'selesai', 'Saldo dan dashboard diperbarui');

  // Google Sheets: sepenuhnya di latar belakang. Alur simpan di atas sudah
  // selesai dan TIDAK ditunda menunggu jaringan — URL webhook yang salah atau
  // Apps Script yang lambat tidak boleh membuat layar Upload terlihat macet,
  // padahal datanya sudah aman tersimpan. Hasilnya (sukses/antre) dilaporkan
  // belakangan ke langkah yang sama; aman diabaikan kalau kartunya sudah tidak
  // terlihat lagi karena pengguna sudah pindah layar. `akunRepo.peta()` dipakai
  // (bukan hanya rekening yang baru disimpan) karena antrean bisa berisi
  // transaksi dari rekening lain yang gagal tersinkron sebelumnya.
  // Baris "Statement" dikirim TERPISAH dari transaksinya, dan tidak
  // ditunggu: angka kontrol yang gagal terkirim tidak boleh membuat upload
  // yang datanya sudah aman terlihat gagal. Kalaupun luput, "Kirim semua
  // sekarang" di Pengaturan mengirim ulang seluruh riwayat upload.
  syncStatementKeSheets([rekaman]).catch((e) => console.warn('Sheets statement gagal:', e));

  Promise.all([akunRepo.peta(), kategoriRepo.peta()])
    .then(([akunMap, kategoriMap]) => syncAtauAntri(transaksi, akunMap, kategoriMap))
    .then((r) => {
      if (r?.ok) onLangkah('selesai', 'selesai', `Saldo diperbarui · ${r.dikirim} baris ke Sheets`);
      else if (r?.queued) onLangkah('selesai', 'selesai', 'Saldo diperbarui · Sheets diantrekan, dicoba lagi otomatis');
    })
    .catch((e) => console.warn('Sheets sync gagal:', e));

  return { akun: akunTerbaru, upload: rekaman, jumlah: transaksi.length };
}

function tentukanStatus(draft, jumlahDisimpan) {
  if (!jumlahDisimpan) return STATUS_UPLOAD.GAGAL;
  if (draft.ringkas.curiga > 0 || (draft.cekTotal && !draft.cekTotal.semuaCocok)) return STATUS_UPLOAD.SEBAGIAN;
  return STATUS_UPLOAD.SUKSES;
}
