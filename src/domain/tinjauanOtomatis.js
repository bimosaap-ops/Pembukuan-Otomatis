/**
 * Analisis tambahan untuk transaksi email berstatus "Perlu Ditinjau"
 * (ambiguous, lihat rekonsiliasiEmail.js) di luar aplikasi -- pasangan dari
 * "Ekspor untuk Ditinjau"/"Terapkan Hasil Tinjauan" (email-review.js) untuk
 * kasus exception yang jumlahnya terlalu banyak diklik satu-satu.
 *
 * cocokkanTransaksiEmail() SENGAJA konservatif: kalau ada beberapa kandidat
 * berskor berdekatan, atau kandidat terbaiknya sendiri skornya rendah, ia
 * menyerah ke manusia daripada menebak dan salah pasang. Modul ini menambah
 * SATU sinyal yang manusia biasa pakai tapi cuma dihitung sebagai bonus
 * kecil (+10 dari 100) di algoritma utama: kecocokan nama merchant yang
 * lebih ketat, dipakai sebagai pemutus dasi antar kandidat.
 *
 * Kebijakan SENGAJA konservatif -- salah tautkan mencemari pembukuan, jauh
 * lebih mahal daripada dibiarkan manual:
 *   - Satu kandidat menang jelas (nominal+arah+merchant cocok, DAN jauh di
 *     atas kandidat kedua) -> USULKAN TAUTKAN.
 *   - Tidak ada kandidat sama sekali dalam jendela DAN skor asli aplikasi
 *     sudah sangat rendah (praktis cuma waktu yang kebetulan dekat) ->
 *     USULKAN ABAIKAN (kemungkinan besar transaksinya memang tidak pernah
 *     masuk e-statement).
 *   - Selain itu -> LEWATI, tetap perlu keputusan manusia.
 *
 * Transaksi berstatus "mismatch" (Tidak Cocok) SENGAJA tidak disentuh:
 * kandidatnya sudah pasti ditemukan, cuma nominalnya beda -- itu keputusan
 * manusia (typo? refund sebagian? biaya admin?), bukan sesuatu yang aman
 * ditebak dari kemiripan merchant saja.
 */

import { normalisasiMerchant } from './merchantNormalisasi.js';

const OPSI_BAWAAN = {
  jendelaHari: 7, // sama dengan jendela "Tautkan manual" & eksporUntukTinjauan()
  ambangSangatRendah: 15, // di bawah ini, skor asli praktis cuma "waktu kebetulan dekat"
  skorMenangMinimal: 3, // dari maksimal 6 (arah 1 + nominal 2 + merchant 3)
  bedaMenangMinimal: 2,
};

function kandidatDalamJendela(trx, kandidatStatement, jendelaHari) {
  const waktu = new Date(trx.waktuTransaksi).getTime();
  const ms = jendelaHari * 24 * 60 * 60 * 1000;
  return kandidatStatement.filter((k) => {
    const t = new Date(k.tanggal).getTime();
    return Number.isFinite(t) && Number.isFinite(waktu) && Math.abs(t - waktu) <= ms;
  });
}

function nilaiKandidat(trx, kunciEmail, k) {
  const arahSama = (k.nominal < 0 ? 'debit' : 'kredit') === trx.arah;
  const jumlahSama = Math.abs(Math.abs(k.nominal) - Math.abs(trx.nominal)) < 1;
  const kunciK = normalisasiMerchant(k.deskripsi);
  const merchantCocok = Boolean(kunciEmail && kunciK && (kunciK.includes(kunciEmail) || kunciEmail.includes(kunciK)));
  let skor = 0;
  if (arahSama) skor += 1;
  if (jumlahSama) skor += 2;
  if (merchantCocok) skor += 3;
  return { k, skor, arahSama, jumlahSama, merchantCocok };
}

/**
 * @param {object} data bentuk hasil eksporUntukTinjauan()/bangunEksporTinjauan():
 *   { transaksiEmail: [...], kandidatStatement: [...] }
 * @param {object} [opsi] override OPSI_BAWAAN.
 * @returns {{keputusan: Array, catatan: Array<{gmailMessageId, aksi: 'tautkan'|'abaikan'|'lewati', ket: string}>}}
 *   `keputusan` sudah dalam bentuk siap dipakai terapkanHasilTinjauan().
 *   `catatan` berisi SEMUA transaksi ambiguous yang diperiksa (termasuk
 *   yang dilewati) beserta alasannya, untuk ditinjau manusia sebelum upload.
 */
export function analisaTinjauanAmbiguous(data, opsi = {}) {
  const { jendelaHari, ambangSangatRendah, skorMenangMinimal, bedaMenangMinimal } = { ...OPSI_BAWAAN, ...opsi };
  const kandidatStatement = data?.kandidatStatement || [];

  const keputusan = [];
  const catatan = [];

  for (const trx of data?.transaksiEmail || []) {
    if (trx.statusCocok !== 'ambiguous') continue;

    const kunciEmail = normalisasiMerchant(trx.merchantMentah);
    const dinilai = kandidatDalamJendela(trx, kandidatStatement, jendelaHari)
      .map((k) => nilaiKandidat(trx, kunciEmail, k))
      .sort((a, b) => b.skor - a.skor);

    const [terbaik, kedua] = dinilai;

    if (terbaik && terbaik.merchantCocok && terbaik.skor >= skorMenangMinimal
      && (!kedua || terbaik.skor - kedua.skor >= bedaMenangMinimal)) {
      keputusan.push({
        gmailMessageId: trx.gmailMessageId,
        aksi: 'tautkan',
        transaksiCocokId: terbaik.k.id,
        alasan: 'auto_review_merchant_match',
      });
      catatan.push({
        gmailMessageId: trx.gmailMessageId, aksi: 'tautkan',
        ket: `cocok ke "${terbaik.k.deskripsi}" ${terbaik.k.tanggal} ${terbaik.k.nominal}`,
      });
    } else if (dinilai.length === 0 && (trx.skorCocok ?? 0) < ambangSangatRendah) {
      keputusan.push({ gmailMessageId: trx.gmailMessageId, aksi: 'abaikan', alasan: 'auto_review_no_plausible_candidate' });
      catatan.push({
        gmailMessageId: trx.gmailMessageId, aksi: 'abaikan',
        ket: `tidak ada kandidat sama sekali dalam ±${jendelaHari} hari, skor asli ${trx.skorCocok}`,
      });
    } else {
      catatan.push({ gmailMessageId: trx.gmailMessageId, aksi: 'lewati', ket: 'sinyal belum cukup kuat, tetap perlu tinjauan manual' });
    }
  }

  return { keputusan, catatan };
}
