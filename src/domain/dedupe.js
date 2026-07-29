/**
 * Deteksi duplikat — inti dari sifat "terakumulasi" aplikasi ini.
 *
 * Dua lapis:
 *   1. Hash isi file. Kalau PDF yang sama persis di-upload ulang, ketahuan
 *      sebelum parsing dimulai.
 *   2. Hash per transaksi dari lima komponen: bank, nomor rekening, tanggal,
 *      deskripsi, dan nominal.
 *
 * Kelima komponen itu saja belum cukup: dua transaksi yang memang benar-benar
 * terjadi dua kali (misal dua pembayaran QRIS Rp 20.000 di hari yang sama)
 * menghasilkan hash identik dan salah satunya akan hilang. Karena itu hash akhir
 * diberi nomor urut kejadian, dan saat impor yang dibandingkan adalah *jumlah*
 * kejadian per kunci: yang disimpan hanya kelebihannya terhadap data lama.
 *
 * Modul murni — tidak menyentuh database. Pemanggil yang menyediakan jumlah
 * kejadian lama, sehingga logikanya bisa diuji tanpa browser.
 */

import { hashTeks } from '../core/hash.js';
import { normalisasiDeskripsi } from '../core/format.js';

export const STATUS_BARIS = { BARU: 'baru', DUPLIKAT: 'duplikat' };

/** Teks kunci dari lima komponen. Nominal dibulatkan ke 2 desimal agar stabil. */
export function kunciDasar({ bank, nomorRekening, tanggal, deskripsi, nominal }) {
  const nom = Math.round((Number(nominal) || 0) * 100) / 100;
  return [
    normalisasiDeskripsi(bank),
    String(nomorRekening ?? '').replace(/\D/g, ''),
    String(tanggal ?? ''),
    normalisasiDeskripsi(deskripsi),
    nom.toFixed(2),
  ].join('|');
}

export function hitungBaseHash(bagian) {
  return hashTeks(kunciDasar(bagian));
}

/** Hash akhir sebuah transaksi: baseHash ditambah nomor urut kejadian. */
export function hashFinal(baseHash, ordinal) {
  return `${baseHash}#${ordinal}`;
}

/**
 * Menghitung baseHash untuk setiap baris hasil parsing.
 * `akun` menyediakan bank dan nomor rekening yang jadi bagian kunci.
 */
export async function bubuhiBaseHash(baris, akun) {
  return Promise.all(baris.map(async (b) => ({
    ...b,
    baseHash: await hitungBaseHash({
      bank: akun.bank,
      nomorRekening: akun.nomorRekening,
      tanggal: b.tanggal,
      deskripsi: b.deskripsi,
      nominal: b.nominal,
    }),
  })));
}

/**
 * Menandai baris mana yang duplikat.
 *
 * @param {Array} baris        baris yang sudah punya `baseHash`, urut sesuai statement
 * @param {Map}   jumlahLama   baseHash -> berapa transaksi dengan kunci itu sudah ada di database
 * @returns baris dengan tambahan `ordinal`, `hash`, `status`, dan `duplikat`
 *
 * Untuk setiap kunci, sebanyak N kejadian pertama (N = jumlah yang sudah ada)
 * dianggap duplikat; sisanya transaksi baru. Dengan begitu upload statement yang
 * tumpang tindih periodenya tidak menggandakan data, sementara transaksi kembar
 * yang benar-benar baru tetap masuk.
 */
export function tandaiDuplikat(baris, jumlahLama = new Map()) {
  const terpakai = new Map();

  return baris.map((b) => {
    const sudahAda = jumlahLama.get(b.baseHash) || 0;
    const keN = (terpakai.get(b.baseHash) || 0) + 1;
    terpakai.set(b.baseHash, keN);

    const duplikat = keN <= sudahAda;
    return {
      ...b,
      ordinal: keN,
      hash: hashFinal(b.baseHash, keN),
      duplikat,
      status: duplikat ? STATUS_BARIS.DUPLIKAT : STATUS_BARIS.BARU,
    };
  });
}

/**
 * Saat pengguna memaksa sebuah baris duplikat tetap disimpan (tombol "tetap simpan"
 * di layar Review), nomor urutnya digeser ke kejadian berikutnya yang masih kosong
 * supaya `hash` tetap unik di database.
 */
export function paksaSimpan(barisTerpilih, semuaBaris, jumlahLama = new Map()) {
  const dipakai = new Set(semuaBaris.filter((b) => !b.duplikat || b.dipaksa).map((b) => b.hash));
  let ordinal = (jumlahLama.get(barisTerpilih.baseHash) || 0) + 1;
  while (dipakai.has(hashFinal(barisTerpilih.baseHash, ordinal))) ordinal += 1;
  return {
    ...barisTerpilih,
    ordinal,
    hash: hashFinal(barisTerpilih.baseHash, ordinal),
    duplikat: false,
    dipaksa: true,
    status: STATUS_BARIS.BARU,
  };
}

export function ringkasDuplikat(baris) {
  const baru = baris.filter((b) => !b.duplikat).length;
  return { total: baris.length, baru, duplikat: baris.length - baru };
}
