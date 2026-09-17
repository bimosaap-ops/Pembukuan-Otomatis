/**
 * Alat bantu yang dipakai bersama oleh semua adapter bank.
 * Modul murni.
 */

import { parseAngka } from '../core/format.js';

/** Bentuk nominal uang: minimal ada satu digit dan hanya berisi angka, titik, koma. */
const POLA_NOMINAL = /-?\(?\d[\d.,]*\)?/g;
const AKHIRAN_ARAH = /^(DB|DR|CR|D|K)\.?$/i;

/**
 * Mengambil seluruh nominal pada sebuah baris beserta posisi x-nya.
 * Posisi x inilah yang nanti dipakai menentukan sebuah angka masuk kolom
 * Debit atau kolom Kredit.
 *
 * @returns {Array<{nilai:number, teks:string, x:number, xAkhir:number, arah:string}>}
 */
export function nominalDiBaris(baris) {
  const hasil = [];

  baris.items.forEach((it, idx) => {
    const teks = it.str.trim();
    if (!teks || !/\d/.test(teks)) return;
    // Lewati potongan yang jelas bukan uang: tanggal, jam, dan nomor referensi panjang.
    if (/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/.test(teks)) return;
    if (/^\d{1,2}:\d{2}/.test(teks)) return;

    const cocok = teks.match(POLA_NOMINAL);
    if (!cocok) return;

    cocok.forEach((tok) => {
      // Angka tanpa pemisah dan tanpa desimal yang sangat panjang biasanya nomor referensi.
      if (/^\d{11,}$/.test(tok)) return;
      const nilai = parseAngka(tok);
      if (nilai === null) return;

      // Arah bisa menempel ("500.000DB") atau berada di potongan berikutnya.
      let arah = '';
      const sisa = teks.slice(teks.indexOf(tok) + tok.length).trim();
      if (AKHIRAN_ARAH.test(sisa)) arah = sisa.toUpperCase();
      else {
        // Penanda DB/CR biasanya berupa potongan tersendiri di kanan nominal.
        // Jaraknya bervariasi antar bank karena mengikuti perataan kolom, jadi
        // yang dipakai sebagai syarat adalah "potongan berikutnya", bukan jarak sempit.
        const berikut = baris.items[idx + 1];
        if (berikut && AKHIRAN_ARAH.test(berikut.str.trim())
          && berikut.x - (it.x + (it.w || 0)) < 100) {
          arah = berikut.str.trim().toUpperCase();
        }
      }

      hasil.push({
        nilai,
        teks: tok,
        x: it.x,
        xAkhir: it.x + (it.w || 0),
        arah: arah.replace(/\./g, ''),
      });
    });
  });

  return hasil;
}

/** Baris kop, kaki halaman, dan keterangan hukum yang bukan transaksi. */
const POLA_ABAIKAN = [
  /^HALAMAN\b/i, /^PAGE\b/i, /^BERSAMBUNG/i, /^LANJUTAN/i,
  /^INFORMASI\b/i, /^CATATAN\b/i, /^KETERANGAN\s*:/i,
  /^PT\.?\s+BANK/i, /^BANK\s+/i, /^KANTOR\b/i, /^ALAMAT\b/i,
  /BUKTI\s+TRANSAKSI/i, /DICETAK\s+OLEH/i, /TANPA\s+TANDA\s+TANGAN/i,
  /^REKENING\s+KORAN/i, /^E-?STATEMENT/i, /^MUTASI\s+REKENING/i,
  /HUBUNGI\s+HALO/i, /^www\./i, /^Terdaftar\s+dan\s+diawasi/i,
  /OTORITAS\s+JASA\s+KEUANGAN/i, /LEMBAGA\s+PENJAMIN\s+SIMPANAN/i,
];

export function barisDiabaikan(teks) {
  const t = String(teks || '').trim();
  if (!t) return true;
  return POLA_ABAIKAN.some((p) => p.test(t));
}

/** Baris ringkasan di kaki statement, bukan transaksi tapi berguna untuk validasi. */
export function barisRingkasan(teks) {
  return /^(SALDO\s+AWAL|SALDO\s+AKHIR|MUTASI\s+(CR|DB|KREDIT|DEBET|DEBIT)|TOTAL\s+(MUTASI|KREDIT|DEBET))/i
    .test(String(teks || '').trim());
}

/**
 * Membaca ringkasan mutasi yang tercetak di statement. Kalau totalnya cocok dengan
 * hasil parsing, itu bukti kuat bahwa tidak ada baris yang terlewat.
 */
export function bacaRingkasan(teksPenuh) {
  const isi = String(teksPenuh || '');
  const ambil = (pola) => {
    const m = isi.match(pola);
    if (!m) return null;
    const v = parseAngka(m[1]);
    return v === null ? null : Math.abs(v);
  };

  const hasil = {
    saldoAwal: ambil(/SALDO\s+AWAL\s*[:\s]\s*([\d.,]+)/i),
    saldoAkhir: ambil(/SALDO\s+AKHIR\s*[:\s]\s*([\d.,]+)/i),
    mutasiKredit: ambil(/MUTASI\s+(?:CR|KREDIT)\s*[:\s]\s*([\d.,]+)/i),
    mutasiDebet: ambil(/MUTASI\s+(?:DB|DEBET|DEBIT)\s*[:\s]\s*([\d.,]+)/i),
  };

  const adaIsi = Object.values(hasil).some((v) => v !== null);
  return adaIsi ? hasil : null;
}

/**
 * Menggabungkan baris lanjutan ke transaksi sebelumnya.
 * Pada rekening koran, deskripsi panjang dipecah ke beberapa baris dan hanya
 * baris pertama yang punya tanggal.
 */
export function gabungDeskripsi(utama, lanjutan) {
  const tambahan = String(lanjutan || '').trim();
  if (!tambahan) return utama;
  return `${String(utama || '').trim()} ${tambahan}`.trim();
}

/**
 * Teks cetakan statement yang bukan bagian dari uraian transaksi: kop, kaki
 * halaman, dan paragraf disclaimer. Semuanya bisa jatuh di dalam pita kolom
 * Keterangan, dan karena tidak bertanggal, adapter menyambungkannya ke
 * transaksi terakhir sebagai "baris lanjutan". Akibatnya satu transaksi bisa
 * membawa seluruh kaki halaman — pernah sampai 2.000 karakter — dan nama
 * merchant di depannya jadi tenggelam.
 *
 * Yang dipakai di sini hanya penanda yang mustahil ditulis bank sebagai uraian
 * transaksi: alamat situs, nomor layanan, dan judul blok kop. Nama bank tidak
 * masuk daftar, karena "BANK CENTRAL ASIA" justru uraian yang sah.
 */
const POLA_CHROME = [
  /PermataBank\.com/i,
  /Permata\s+Tel\s*1500/i,
  /\bRekening\s+Koran\b/i,
  /\bAccount\s+Statement\b/i,
  /\bTanggal\s+Laporan\b/i,
  /\bPeriode\s+Laporan\b/i,
  /\bStatement\s+(?:Date|Period)\b/i,
  /\bNo\.?\s*CIF\b/i,
  /\bNama\s+Produk\b/i,
  /\bwww\.bca\.co\.id\b/i,
  /\bHalo\s*BCA\b/i,
  /\bBersambung\s+ke\s+halaman\b/i,
  /\bHalaman\s*:?\s*\d+\s*(?:dari|of)\b/i,
  /* Paragraf disclaimer BCA dicetak dengan jarak antar huruf, sehingga setiap
     hurufnya jadi potongan teks sendiri: "m e l a k u k a n s a n g g a h a n".
     Tidak ada pola kata yang bisa menangkapnya — bentuk renggangnya sendiri
     yang jadi penanda. Delapan huruf berturut-turut sudah cukup khas; nama
     merchant terpanjang pun tidak pernah ditulis begitu. */
  /(?:\b\p{L}\s+){8,}/u,
];

/**
 * Memotong deskripsi tepat sebelum cetakan statement yang pertama muncul.
 * Memotong, bukan membuang barisnya: sebagian kaki halaman menempel pada baris
 * yang SAMA dengan transaksi yang sah, jadi membuang seluruh baris berarti
 * kehilangan transaksinya.
 */
export function potongChrome(teks) {
  const isi = String(teks || '');
  let batas = isi.length;
  POLA_CHROME.forEach((pola) => {
    const m = isi.match(pola);
    if (m && m.index >= 0 && m.index < batas) batas = m.index;
  });
  return batas === isi.length ? isi : isi.slice(0, batas);
}

/**
 * Benar bila baris ini seluruhnya cetakan statement, sehingga tidak ada uraian
 * yang hilang bila barisnya dilewati. Dipakai adapter pada jalur "baris
 * lanjutan": memotong di akhir saja tidak cukup, karena kaki halaman yang
 * terlanjur tersambung akan ikut memotong uraian sah yang menyusul di
 * bawahnya.
 */
export function barisChrome(teks) {
  const isi = String(teks || '').trim();
  if (!isi) return false;
  return potongChrome(isi).trim() === '';
}

/** Membersihkan deskripsi dari cetakan statement, penanda kolom, dan spasi berlebih. */
export function rapikanDeskripsi(teks) {
  return potongChrome(String(teks || '').replace(/\s{2,}/g, ' '))
    .replace(/\s*\|\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-–—\s]+|[-–—\s]+$/g, '')
    .trim();
}

/**
 * Menentukan arah transaksi dari perubahan saldo.
 * Ini cara paling andal ketika statement tidak memakai penanda DB/CR maupun
 * kolom debit/kredit yang terpisah.
 *
 * @returns 1 (masuk), -1 (keluar), atau 0 bila tidak bisa disimpulkan
 */
export function arahDariSaldo(saldoSebelum, saldoSesudah, nominal) {
  if (saldoSebelum === null || saldoSebelum === undefined) return 0;
  if (saldoSesudah === null || saldoSesudah === undefined) return 0;
  const selisih = saldoSesudah - saldoSebelum;
  if (Math.abs(Math.abs(selisih) - Math.abs(nominal)) > 0.999) return 0;
  return selisih >= 0 ? 1 : -1;
}
