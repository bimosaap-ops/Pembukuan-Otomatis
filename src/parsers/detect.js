/**
 * Mengenali bank penerbit statement dan membaca informasi kepala berkas
 * (nomor rekening, nama pemilik, periode). Modul murni: masukannya teks halaman.
 */

import { bulanDariNama, parseTanggal } from '../core/dates.js';

export const ADAPTER = { BCA: 'bca', PERMATA: 'permata', GENERIK: 'generik' };

/**
 * Tanda pengenal tiap bank. `skor` menentukan pemenang bila beberapa pola cocok —
 * nama badan hukum lebih dipercaya daripada singkatan yang bisa muncul kebetulan.
 */
const TANDA_BANK = [
  { adapter: ADAPTER.BCA, bank: 'BCA', pola: /BANK\s+CENTRAL\s+ASIA/i, skor: 100 },
  { adapter: ADAPTER.BCA, bank: 'BCA', pola: /KLIKBCA|MYBCA|BCA\s+MOBILE/i, skor: 70 },
  { adapter: ADAPTER.BCA, bank: 'BCA', pola: /\bBCA\b/i, skor: 40 },

  { adapter: ADAPTER.PERMATA, bank: 'Permata', pola: /BANK\s+PERMATA/i, skor: 100 },
  { adapter: ADAPTER.PERMATA, bank: 'Permata', pola: /PERMATABANK|PERMATA\s*BANK/i, skor: 90 },
  { adapter: ADAPTER.PERMATA, bank: 'Permata', pola: /PERMATAMOBILE|PERMATANET/i, skor: 70 },
  { adapter: ADAPTER.PERMATA, bank: 'Permata', pola: /\bPERMATA\b/i, skor: 40 },

  // Bank berikut belum punya adapter khusus; adapter generik yang menanganinya,
  // tetapi nama banknya tetap dikenali supaya rekening terbentuk dengan benar.
  { adapter: ADAPTER.GENERIK, bank: 'Mandiri', pola: /BANK\s+MANDIRI|LIVIN/i, skor: 100 },
  { adapter: ADAPTER.GENERIK, bank: 'BRI', pola: /BANK\s+RAKYAT\s+INDONESIA|BRIMO|\bBRI\b/i, skor: 90 },
  { adapter: ADAPTER.GENERIK, bank: 'BNI', pola: /BANK\s+NEGARA\s+INDONESIA|\bBNI\b/i, skor: 90 },
  { adapter: ADAPTER.GENERIK, bank: 'CIMB Niaga', pola: /CIMB\s*NIAGA|OCTO/i, skor: 90 },
  { adapter: ADAPTER.GENERIK, bank: 'Danamon', pola: /BANK\s+DANAMON/i, skor: 90 },
  { adapter: ADAPTER.GENERIK, bank: 'BTN', pola: /BANK\s+TABUNGAN\s+NEGARA/i, skor: 90 },
  { adapter: ADAPTER.GENERIK, bank: 'OCBC', pola: /\bOCBC\b/i, skor: 85 },
  { adapter: ADAPTER.GENERIK, bank: 'Maybank', pola: /MAYBANK/i, skor: 85 },
  { adapter: ADAPTER.GENERIK, bank: 'Jago', pola: /BANK\s+JAGO/i, skor: 90 },
  { adapter: ADAPTER.GENERIK, bank: 'SeaBank', pola: /SEABANK/i, skor: 90 },
  { adapter: ADAPTER.GENERIK, bank: 'Blu', pola: /\bBLU\s+BY\s+BCA\b/i, skor: 95 },
  { adapter: ADAPTER.GENERIK, bank: 'Jenius', pola: /JENIUS|BANK\s+BTPN/i, skor: 90 },
];

export function deteksiBank(teks) {
  const isi = String(teks || '');
  let terbaik = null;

  TANDA_BANK.forEach((t) => {
    if (!t.pola.test(isi)) return;
    if (!terbaik || t.skor > terbaik.skor) terbaik = t;
  });

  if (!terbaik) {
    return { adapter: ADAPTER.GENERIK, bank: '', keyakinan: 0 };
  }
  return { adapter: terbaik.adapter, bank: terbaik.bank, keyakinan: terbaik.skor };
}

const POLA_NOMOR = [
  /NO\.?\s*REKENING\s*[:\-]?\s*([\d][\d\s.\-]{5,24}\d)/i,
  /NOMOR\s+REKENING\s*[:\-]?\s*([\d][\d\s.\-]{5,24}\d)/i,
  /ACCOUNT\s*(?:NO|NUMBER)?\.?\s*[:\-]?\s*([\d][\d\s.\-]{5,24}\d)/i,
  /REKENING\s*[:\-]\s*([\d][\d\s.\-]{5,24}\d)/i,
];

export function bacaNomorRekening(teks) {
  const isi = String(teks || '');
  for (const pola of POLA_NOMOR) {
    const m = isi.match(pola);
    if (m) {
      const nomor = m[1].replace(/[\s.\-]/g, '');
      if (nomor.length >= 6 && nomor.length <= 20) return nomor;
    }
  }
  return '';
}

const POLA_NAMA = [
  /NAMA\s*(?:NASABAH|PEMILIK|REKENING)?\s*[:\-]\s*([A-Z][A-Z0-9 .,'&\-]{2,60})/i,
  /ACCOUNT\s+NAME\s*[:\-]\s*([A-Z][A-Z0-9 .,'&\-]{2,60})/i,
];

export function bacaNamaPemilik(teks) {
  const isi = String(teks || '');
  for (const pola of POLA_NAMA) {
    const m = isi.match(pola);
    if (m) {
      const nama = m[1].replace(/\s{2,}/g, ' ').trim();
      // Baris seperti "NAMA : PERIODE" jelas salah tangkap.
      if (nama && !/^(PERIODE|HALAMAN|TANGGAL|NO)\b/i.test(nama)) return nama;
    }
  }
  return '';
}

/**
 * Membaca periode statement. Ada dua bentuk yang lazim:
 *   "PERIODE : JULI 2025"                       -> satu bulan penuh
 *   "PERIODE : 01/07/2025 s/d 31/07/2025"       -> rentang tanggal
 *
 * Tahunnya penting: statement BCA hanya mencantumkan tanggal dan bulan pada tiap
 * baris transaksi, jadi tahun harus diambil dari kepala berkas.
 */
export function bacaPeriode(teks) {
  const isi = String(teks || '');

  const rentang = isi.match(
    /PERIODE\s*[:\-]?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s*(?:S\/D|SD|-|SAMPAI|TO|HINGGA)\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
  );
  if (rentang) {
    const awal = parseTanggal(rentang[1]);
    const akhir = parseTanggal(rentang[2]);
    if (awal && akhir) {
      return { awal, akhir, tahun: Number(awal.slice(0, 4)), bulanIdx: Number(awal.slice(5, 7)) - 1 };
    }
  }

  const bulanTahun = isi.match(/PERIODE\s*[:\-]?\s*([A-Z]{3,12})\s+(\d{4})/i);
  if (bulanTahun) {
    const b = bulanDariNama(bulanTahun[1]);
    const tahun = Number(bulanTahun[2]);
    if (b !== null && tahun) {
      return {
        awal: `${tahun}-${String(b + 1).padStart(2, '0')}-01`,
        akhir: '',
        tahun,
        bulanIdx: b,
      };
    }
  }

  // Sebagian statement hanya menulis "Juli 2025" di dekat kop tanpa kata "PERIODE".
  const longgar = isi.match(/\b(JANUARI|FEBRUARI|MARET|APRIL|MEI|JUNI|JULI|AGUSTUS|SEPTEMBER|OKTOBER|NOVEMBER|DESEMBER)\s+(\d{4})\b/i);
  if (longgar) {
    const b = bulanDariNama(longgar[1]);
    const tahun = Number(longgar[2]);
    if (b !== null) {
      return { awal: `${tahun}-${String(b + 1).padStart(2, '0')}-01`, akhir: '', tahun, bulanIdx: b };
    }
  }

  const tahunSaja = isi.match(/\b(20\d{2})\b/);
  if (tahunSaja) return { awal: '', akhir: '', tahun: Number(tahunSaja[1]), bulanIdx: null };

  return { awal: '', akhir: '', tahun: null, bulanIdx: null };
}

/** Semua informasi kepala berkas sekaligus. */
export function bacaKepala(teks) {
  const { adapter, bank, keyakinan } = deteksiBank(teks);
  return {
    adapter,
    bank,
    keyakinan,
    nomorRekening: bacaNomorRekening(teks),
    namaPemilik: bacaNamaPemilik(teks),
    periode: bacaPeriode(teks),
  };
}
