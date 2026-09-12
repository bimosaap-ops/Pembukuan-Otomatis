/**
 * Rekonsiliasi transaksi email (hasil parse notifikasi bank) terhadap
 * transaksi e-statement yang sudah tersimpan di IndexedDB (`transactions`,
 * lihat src/data/repo/transactions.js). Modul murni — dipanggil dari
 * src/services/email-feed-sync.js dengan kandidat yang sudah diambil dari
 * repo, tidak menyentuh database sendiri.
 *
 * Level matching mengikuti PRD §16 dikurangi level-1 (RRN/nomor referensi),
 * yang sengaja DITUNDA ke fase pengerasan (keputusan user, lihat rencana
 * implementasi bagian "Context"):
 *   - Level 2 (deterministik): jumlah + arah + jendela waktu.
 *   - Level 3 (heuristik): kemiripan merchant, lewat normalisasiMerchant().
 *
 * Kandidat SENGAJA hanya disaring oleh jendela waktu, bukan oleh jumlah/arah
 * sekaligus — kalau disaring dari awal, transaksi yang jumlahnya salah tidak
 * akan pernah muncul sebagai kandidat sama sekali, sehingga status yang
 * benar (`mismatch`) tidak akan pernah bisa terdeteksi dan malah jatuh ke
 * `missing` (menyesatkan: `missing` mestinya berarti "tidak ada jejak sama
 * sekali di statement", bukan "ada tapi beda nominal").
 *
 * Constraint one-to-one (PRD §18) dijaga lewat pengecekan jarak skor antara
 * kandidat terbaik dan kedua terbaik: kalau terlalu berdekatan, hasilnya
 * `ambiguous` (butuh keputusan manual) alih-alih auto-match yang berisiko
 * salah pasang — sesuai prinsip PRD sendiri: "ambiguous lebih baik daripada
 * salah match".
 */

import { normalisasiMerchant } from './merchantNormalisasi.js';
import { STATUS_COCOK_EMAIL } from './entities.js';

const OPSI_BAWAAN = {
  /** Jendela waktu kandidat dipertimbangkan sama sekali (§17: default ±24 jam). */
  jendelaWaktuMs: 24 * 60 * 60 * 1000,
  /** Skor minimal supaya kandidat terbaik dianggap cukup meyakinkan untuk match/mismatch. */
  ambangKuat: 35,
  /** Kalau selisih skor kandidat #1 dan #2 di bawah ini, dianggap ambigu (bukan auto-match). */
  bedaAmbigu: 10,
};

/**
 * `transactions` (e-statement) hasil parser PDF yang sudah ada cuma punya
 * tanggal (tanpa jam) — `new Date('2025-07-05')` selalu jatuh ke tengah
 * malam UTC. Konsekuensinya di dunia nyata:
 *   - tingkatan skor "time_very_close" (<=5 menit) pada praktiknya nyaris
 *     tidak pernah kena untuk kandidat statement asli — hanya
 *     "time_within_window" yang biasanya aktif. Ini bukan bug, cuma
 *     karakteristik data sumber (bukan sesuatu yang bisa "diperbaiki" tanpa
 *     jam asli dari statement, yang memang tidak tersedia).
 *   - konversi ke UTC-midnight juga bisa menggeser batas jendela ±24 jam
 *     beberapa jam tergantung zona waktu lokal pengguna — diterima sebagai
 *     batasan MVP, sejalan dengan mandat PRD sendiri soal pendekatan
 *     best-effort/konservatif, bukan sesuatu yang layak direkayasa lebih
 *     jauh mengingat level-1 (RRN, presisi tinggi) memang ditunda dulu.
 */
function kemiripanMerchant(merchantEmail, deskripsiStatement) {
  const kunciEmail = normalisasiMerchant(merchantEmail);
  const kunciStatement = normalisasiMerchant(deskripsiStatement);
  if (!kunciEmail || !kunciStatement) return false;
  return kunciStatement.includes(kunciEmail) || kunciEmail.includes(kunciStatement);
}

/**
 * @param {object} emailTrx transaksi hasil parse email — butuh `waktuTransaksi`
 *   (ISO string), `nominal` (number), `arah` ('debit'|'kredit'), `merchantMentah`.
 * @param {object[]} kandidatStatement transaksi `transactions` (e-statement) yang
 *   SUDAH difilter kasar oleh pemanggil (mis. rentang akun/bulan) — butuh `id`,
 *   `tanggal`, `nominal` (positif=kredit, negatif=debit, mengikuti konvensi
 *   repo/transactions.js yang sudah ada), `deskripsi`.
 * @param {object} [opsi] override ambang (lihat OPSI_BAWAAN).
 * @returns {{status: string, kandidatId: string|null, skor: number, alasan: string}}
 */
export function cocokkanTransaksiEmail(emailTrx, kandidatStatement, opsi = {}) {
  const { jendelaWaktuMs, ambangKuat, bedaAmbigu } = { ...OPSI_BAWAAN, ...opsi };

  const waktuEmail = new Date(emailTrx.waktuTransaksi).getTime();
  const arahEmail = emailTrx.arah;

  const dievaluasi = [];
  (kandidatStatement || []).forEach((k) => {
    const waktuStatement = new Date(k.tanggal).getTime();
    const selisihMs = Number.isFinite(waktuStatement) && Number.isFinite(waktuEmail)
      ? Math.abs(waktuStatement - waktuEmail)
      : Infinity;
    if (!(selisihMs <= jendelaWaktuMs)) return;

    let skor = 0;
    const alasan = [];

    if (selisihMs <= 5 * 60 * 1000) {
      skor += 20;
      alasan.push('time_very_close');
    } else {
      skor += 10;
      alasan.push('time_within_window');
    }

    const arahStatement = k.nominal < 0 ? 'debit' : 'kredit';
    const arahSama = arahStatement === arahEmail;
    if (arahSama) {
      skor += 20;
      alasan.push('direction_exact');
    } else {
      alasan.push('direction_differs');
    }

    const jumlahSama = Math.abs(Math.abs(k.nominal) - Math.abs(emailTrx.nominal)) < 1;
    if (jumlahSama) {
      skor += 40;
      alasan.push('amount_exact');
    } else {
      alasan.push('amount_differs');
    }

    if (kemiripanMerchant(emailTrx.merchantMentah, k.deskripsi)) {
      skor += 10;
      alasan.push('merchant_similarity');
    }

    dievaluasi.push({ kandidat: k, skor, alasan, arahSama, jumlahSama });
  });

  if (!dievaluasi.length) {
    return { status: STATUS_COCOK_EMAIL.MISSING, kandidatId: null, skor: 0, alasan: 'no_candidate_in_time_window' };
  }

  dievaluasi.sort((a, b) => b.skor - a.skor);
  const [terbaik, keduaTerbaik] = dievaluasi;

  if (keduaTerbaik && (terbaik.skor - keduaTerbaik.skor) < bedaAmbigu) {
    return {
      status: STATUS_COCOK_EMAIL.AMBIGUOUS,
      kandidatId: null,
      skor: terbaik.skor,
      alasan: 'multiple_candidates_similar_score',
    };
  }

  if (terbaik.skor < ambangKuat) {
    return {
      status: STATUS_COCOK_EMAIL.AMBIGUOUS,
      kandidatId: terbaik.kandidat.id,
      skor: terbaik.skor,
      alasan: 'confidence_insufficient',
    };
  }

  if (terbaik.jumlahSama && terbaik.arahSama) {
    return {
      status: STATUS_COCOK_EMAIL.MATCHED,
      kandidatId: terbaik.kandidat.id,
      skor: terbaik.skor,
      alasan: terbaik.alasan.join(';'),
    };
  }

  return {
    status: STATUS_COCOK_EMAIL.MISMATCH,
    kandidatId: terbaik.kandidat.id,
    skor: terbaik.skor,
    alasan: terbaik.alasan.join(';'),
  };
}
