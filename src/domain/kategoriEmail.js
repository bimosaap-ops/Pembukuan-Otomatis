/**
 * Saran kategori untuk transaksi hasil parse email (Realtime Email
 * Transaction Feed). Modul murni — tidak menyentuh database maupun IndexedDB;
 * `kamusMerchant` disiapkan oleh pemanggil (src/services/email-feed-sync.js,
 * fase berikutnya) dari src/data/repo/merchant-dictionary.js.
 *
 * Dua sumber saran, dicoba berurutan (lihat rencana implementasi §C):
 *   1. Kamus merchant (BARU, dipelajari dari override pengguna) — exact match
 *      atas `merchant_key`, keyakinan TINGGI karena berasal dari koreksi
 *      pengguna sendiri untuk merchant yang persis sama.
 *   2. `tentukanKategori()` yang SUDAH ADA di categorize.js, dipakai ulang
 *      apa adanya (bukan diduplikasi) atas `merchantMentah` — keyakinan
 *      SEDANG kalau ada kata kunci yang benar-benar cocok, RENDAH kalau
 *      hanya jatuh ke kategori penampung arah (KATEGORI_LAINNYA_MASUK/KELUAR).
 *
 * Deviasi sadar dari rencana awal ("balikkan null kalau keduanya tidak
 * menemukan apa-apa"): `tentukanKategori()` TIDAK PERNAH mengembalikan null
 * — ia selalu jatuh ke kategori penampung sesuai arah transaksi. Daripada
 * membuang tebakan itu, `kategoriId` di sini tetap diisi (jadi UI punya
 * default yang masuk akal untuk pra-isi dropdown), dan `keyakinan: 'rendah'`
 * dipakai sebagai penanda "Perlu Ditinjau" — bukan `kategoriId: null`.
 */

import { normalisasiMerchant } from './merchantNormalisasi.js';
import { tentukanKategori, kategoriDefault } from './categorize.js';

export const KEYAKINAN_KATEGORI_EMAIL = {
  /** Dari kamus merchant — dipelajari langsung dari koreksi pengguna sendiri. */
  TINGGI: 'tinggi',
  /** Dari tentukanKategori() dengan kata kunci yang benar-benar cocok. */
  SEDANG: 'sedang',
  /** Tidak ada match sama sekali; kategoriId cuma tebakan arah (Lainnya). */
  RENDAH: 'rendah',
};

/**
 * @param {object} emailTrx transaksi hasil parse email — butuh `merchantMentah`,
 *   `nominal` (magnitudo, bisa positif atau sudah bertanda), `arah` ('debit'|'kredit').
 * @param {Map<string, string>} kamusMerchant peta merchantKey -> kategoriId,
 *   dibangun pemanggil dari merchant-dictionary.semua() (bisa Map kosong).
 * @param {object[]} daftarKategori seluruh kategori tersimpan (lihat categorize.js).
 * @returns {{kategoriId: string, keyakinan: string, merchantKey: string}}
 */
export function sarankanKategoriEmail(emailTrx, kamusMerchant, daftarKategori) {
  const merchantKey = normalisasiMerchant(emailTrx.merchantMentah);
  const magnitudo = Math.abs(Number(emailTrx.nominal) || 0);
  const nominalBertanda = emailTrx.arah === 'debit' ? -magnitudo : magnitudo;

  const dariKamus = merchantKey ? kamusMerchant.get(merchantKey) : undefined;
  if (dariKamus) {
    return { kategoriId: dariKamus, keyakinan: KEYAKINAN_KATEGORI_EMAIL.TINGGI, merchantKey };
  }

  const kategoriId = tentukanKategori(emailTrx.merchantMentah, nominalBertanda, daftarKategori);
  const keyakinan = kategoriId === kategoriDefault(nominalBertanda)
    ? KEYAKINAN_KATEGORI_EMAIL.RENDAH
    : KEYAKINAN_KATEGORI_EMAIL.SEDANG;

  return { kategoriId, keyakinan, merchantKey };
}
