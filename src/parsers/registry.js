/**
 * Titik masuk parsing: menyatukan penyusunan baris, deteksi bank, dan adapter.
 * Modul murni — masukannya potongan teks per halaman, bukan berkas PDF.
 */

import { susunBaris, buangBarisKosong, teksPenuh } from './layout.js';
import { bacaKepala, ADAPTER } from './detect.js';
import * as bca from './banks/bca.js';
import * as permata from './banks/permata.js';
import * as generik from './banks/generic.js';
import { periodeDariBaris } from '../domain/validate.js';

const ADAPTERS = {
  [ADAPTER.BCA]: bca,
  [ADAPTER.PERMATA]: permata,
  [ADAPTER.GENERIK]: generik,
};

export function adapterUntuk(kode) {
  return ADAPTERS[kode] || generik;
}

export function daftarAdapter() {
  return [
    { kode: ADAPTER.BCA, ...bca.info },
    { kode: ADAPTER.PERMATA, ...permata.info },
    { kode: ADAPTER.GENERIK, ...generik.info },
  ];
}

/**
 * Memproses potongan teks seluruh halaman menjadi daftar transaksi.
 *
 * @param {Array<Array>} halaman daftar per halaman berisi {str,x,y,w,h}
 * @param {{paksaAdapter?: string}} opsi
 */
export function parseStatement(halaman, opsi = {}) {
  // Baris disusun per halaman supaya koordinat y antar halaman tidak tercampur.
  const barisPerHalaman = halaman.map((potongan) => buangBarisKosong(susunBaris(potongan)));
  const semuaBaris = barisPerHalaman.flat();
  const teks = barisPerHalaman.map((b) => teksPenuh(b)).join('\n');

  const kepala = bacaKepala(teks);
  const kodeAdapter = opsi.paksaAdapter || kepala.adapter;
  const adapter = adapterUntuk(kodeAdapter);

  const hasil = adapter.parse({ baris: semuaBaris, teks, kepala });

  const periode = periodeDariBaris(hasil.transaksi);
  const bank = kepala.bank || adapter.info.bank || '';

  return {
    ...hasil,
    kodeAdapter,
    namaAdapter: adapter.info.nama,
    bank,
    nomorRekening: kepala.nomorRekening,
    namaPemilik: kepala.namaPemilik,
    periodeKepala: kepala.periode,
    periodeAwal: periode.periodeAwal || kepala.periode.awal || '',
    periodeAkhir: periode.periodeAkhir || kepala.periode.akhir || '',
    teksMentah: teks,
    jumlahBaris: semuaBaris.length,
  };
}
