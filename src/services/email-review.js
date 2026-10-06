/**
 * Ekspor & terapkan hasil tinjauan manual untuk transaksi email yang masih
 * "Perlu Ditinjau"/"Tidak Cocok" (statusCocok ambiguous/mismatch, belum
 * diresolusi) — pasangan fitur untuk kasus saat exception-nya terlalu
 * banyak untuk diklik satu-satu di UI (mis. setelah backfill besar):
 *
 *   1. `eksporUntukTinjauan()` — kumpulkan exception yang masih terbuka
 *      beserta kandidat e-statement di sekitarnya jadi satu berkas JSON,
 *      supaya bisa dianalisis di luar aplikasi (mis. oleh siapa pun yang
 *      dipercaya pengguna untuk meninjau, dengan menjalankan ulang
 *      `cocokkanTransaksiEmail()` — modul murni yang sama dipakai PWA —
 *      terhadap datanya).
 *   2. `terapkanHasilTinjauan(daftarKeputusan)` — terapkan hasil tinjauan
 *      itu kembali, lewat jalur yang PERSIS SAMA dengan aksi manual yang
 *      sudah ada di `src/ui/views/email-transaksi.js` (Tautkan manual/
 *      Terima tautan ini/Abaikan) — bukan mekanisme baru, cuma dijalankan
 *      untuk banyak transaksi sekaligus dari satu berkas.
 *
 * Kandidat diambil dengan jendela yang SAMA LEBARNYA dengan modal "Tautkan
 * manual" (±7 hari, bukan ±2 hari yang dipakai rekonsiliasi otomatis) —
 * peninjau manusia perlu melihat lebih luas daripada yang algoritma
 * otomatis pertimbangkan.
 */

import * as emailTrxRepo from '../data/repo/email-transactions.js';
import * as trxRepo from '../data/repo/transactions.js';
import { STATUS_COCOK_EMAIL, STATUS_RESOLUSI_EMAIL } from '../domain/entities.js';
import { rentangTanggalKandidat } from './email-feed-sync.js';
import { tautkanManual } from './email-ledger-merge.js';

/** Sama dengan HARI_CARI_MANUAL di email-transaksi.js -- disalin, bukan
 *  diimpor, supaya service ini tidak bergantung ke lapisan UI. */
const JENDELA_HARI_TINJAUAN = 7;

const AKSI_VALID = ['tautkan', 'selesai', 'abaikan'];

/**
 * Susun bentuk JSON ekspor. Murni -- diekspor supaya bisa diuji tanpa
 * IndexedDB.
 * @param {Array} daftarTerbuka transaksi email (bentuk buatTransaksiEmail)
 * @param {Map} kandidatMap peta id->transaksi e-statement, sudah dedup
 */
export function bangunEksporTinjauan(daftarTerbuka, kandidatMap) {
  return {
    dibuatPada: new Date().toISOString(),
    transaksiEmail: (daftarTerbuka || []).map((t) => ({
      id: t.id,
      gmailMessageId: t.gmailMessageId,
      bank: t.bank,
      waktuTransaksi: t.waktuTransaksi,
      nominal: t.nominal,
      arah: t.arah,
      merchantMentah: t.merchantMentah,
      statusCocok: t.statusCocok,
      transaksiCocokId: t.transaksiCocokId || '',
      skorCocok: t.skorCocok,
      alasanCocok: t.alasanCocok || '',
    })),
    kandidatStatement: [...(kandidatMap ? kandidatMap.values() : [])].map((k) => ({
      id: k.id,
      tanggal: k.tanggal,
      deskripsi: k.deskripsi,
      nominal: k.nominal,
      accountId: k.accountId,
    })),
  };
}

/**
 * Kumpulkan exception yang masih terbuka (statusResolusi terbuka DAN
 * statusCocok mismatch/ambiguous -- persis kriteria yang dipakai
 * email-transaksi.js untuk daftar tinjauan) beserta kandidat e-statement
 * di sekitar tiap transaksi, siap diunduh sebagai JSON.
 */
export async function eksporUntukTinjauan() {
  const semua = await emailTrxRepo.semua();
  const daftarTerbuka = semua.filter((t) => t.statusResolusi === STATUS_RESOLUSI_EMAIL.TERBUKA
    && [STATUS_COCOK_EMAIL.MISMATCH, STATUS_COCOK_EMAIL.AMBIGUOUS].includes(t.statusCocok));

  const kandidatMap = new Map();
  for (const t of daftarTerbuka) {
    const rentang = rentangTanggalKandidat(t.waktuTransaksi, JENDELA_HARI_TINJAUAN);
    if (!rentang) continue;
    // Berurutan: jumlah exception yang butuh tinjauan manual realistis
    // kecil (puluhan), dan trxRepo.rentangTanggal() sendiri sudah cepat
    // lewat indeks tanggal -- sama seperti email-feed-sync.js.
    const kandidat = await trxRepo.rentangTanggal(rentang.dari, rentang.sampai);
    kandidat.forEach((k) => kandidatMap.set(k.id, k));
  }

  return bangunEksporTinjauan(daftarTerbuka, kandidatMap);
}

/**
 * Periksa satu keputusan tinjauan tanpa menyentuh database. Murni.
 * @param {{gmailMessageId: string, aksi: string, transaksiCocokId?: string, alasan?: string}} keputusan
 * @returns {{valid: boolean, error?: string}}
 */
export function validasiKeputusan(keputusan) {
  if (!keputusan || typeof keputusan !== 'object') return { valid: false, error: 'Keputusan bukan objek yang sah.' };
  if (!String(keputusan.gmailMessageId || '').trim()) return { valid: false, error: 'gmailMessageId wajib diisi.' };
  if (!AKSI_VALID.includes(keputusan.aksi)) {
    return { valid: false, error: `aksi harus salah satu dari: ${AKSI_VALID.join(', ')}.` };
  }
  if (keputusan.aksi === 'tautkan' && !String(keputusan.transaksiCocokId || '').trim()) {
    return { valid: false, error: 'aksi "tautkan" wajib menyertakan transaksiCocokId.' };
  }
  return { valid: true };
}

/**
 * Baris statement yang harus ditautkan oleh satu keputusan, atau null.
 * 'tautkan' memakai transaksiCocokId dari berkas; 'selesai' sama dengan
 * "Terima tautan ini", jadi menautkan ke kandidat yang sudah tercatat bila
 * ada. Murni. Penautannya sendiri SELALU lewat tautkanManual(), supaya
 * validasi tautanSah() dan penghapusan baris provisional tidak terlewat.
 */
export function targetTautan(trx, keputusan) {
  if (keputusan.aksi === 'tautkan') return keputusan.transaksiCocokId;
  if (keputusan.aksi === 'selesai') return trx.transaksiCocokId || null;
  return null;
}

/**
 * Keputusan tanpa tautan: 'selesai' tanpa kandidat, atau 'abaikan'. Hanya
 * statusResolusi yang berubah. Murni; hasilnya belum disimpan.
 */
export function terapkanSatuKeputusan(trx, keputusan) {
  if (keputusan.aksi === 'selesai') {
    return { ...trx, statusResolusi: STATUS_RESOLUSI_EMAIL.DISELESAIKAN };
  }
  return { ...trx, statusResolusi: STATUS_RESOLUSI_EMAIL.DIABAIKAN };
}

/**
 * Terapkan sekumpulan keputusan tinjauan. Setiap keputusan divalidasi dan
 * dicari transaksinya sendiri-sendiri -- satu keputusan yang tidak valid
 * atau tidak ditemukan tidak menggagalkan keputusan lain di daftar yang
 * sama (dilaporkan lewat `dilewati`, bukan melempar error).
 * @returns {{ditautkan:number, diselesaikan:number, diabaikan:number, dilewati:Array<{gmailMessageId:string, sebab:string}>}}
 */
export async function terapkanHasilTinjauan(daftarKeputusan) {
  const hasil = { ditautkan: 0, diselesaikan: 0, diabaikan: 0, dilewati: [] };

  for (const keputusan of daftarKeputusan || []) {
    const validasi = validasiKeputusan(keputusan);
    if (!validasi.valid) {
      hasil.dilewati.push({ gmailMessageId: keputusan?.gmailMessageId || '(tidak diketahui)', sebab: validasi.error });
      continue;
    }

    const trx = await emailTrxRepo.perGmailMessageId(keputusan.gmailMessageId);
    if (!trx) {
      hasil.dilewati.push({ gmailMessageId: keputusan.gmailMessageId, sebab: 'Transaksi email tidak ditemukan.' });
      continue;
    }

    const idTarget = targetTautan(trx, keputusan);
    if (idTarget) {
      const kandidat = await trxRepo.satu(idTarget);
      if (!kandidat) {
        hasil.dilewati.push({
          gmailMessageId: keputusan.gmailMessageId,
          sebab: `Transaksi e-statement ${idTarget} tidak ditemukan.`,
        });
        continue;
      }
      try {
        await tautkanManual(trx, kandidat);
      } catch (e) {
        hasil.dilewati.push({ gmailMessageId: keputusan.gmailMessageId, sebab: e.message });
        continue;
      }
      hasil.ditautkan += 1;
      continue;
    }

    await emailTrxRepo.simpanSatu(terapkanSatuKeputusan(trx, keputusan));
    if (keputusan.aksi === 'selesai') hasil.diselesaikan += 1;
    else hasil.diabaikan += 1;
  }

  return hasil;
}
