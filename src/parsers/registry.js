/**
 * Titik masuk parsing: menyatukan penyusunan baris, deteksi bank, dan adapter.
 * Modul murni — masukannya potongan teks per halaman, bukan berkas PDF.
 */

import { susunBaris, buangBarisKosong, teksPenuh } from './layout.js';
import { bacaKepala, ADAPTER } from './detect.js';
import * as bca from './banks/bca.js';
import * as permata from './banks/permata.js';
import * as permataMutasi from './banks/permata-mutasi.js';
import * as generik from './banks/generic.js';
import { periodeDariBaris } from '../domain/validate.js';

const ADAPTERS = {
  [ADAPTER.BCA]: bca,
  [ADAPTER.PERMATA]: permata,
  [ADAPTER.PERMATA_MUTASI]: permataMutasi,
  [ADAPTER.GENERIK]: generik,
};

export function adapterUntuk(kode) {
  return ADAPTERS[kode] || generik;
}

export function daftarAdapter() {
  return [
    { kode: ADAPTER.BCA, ...bca.info },
    { kode: ADAPTER.PERMATA, ...permata.info },
    { kode: ADAPTER.PERMATA_MUTASI, ...permataMutasi.info },
    { kode: ADAPTER.GENERIK, ...generik.info },
  ];
}

/**
 * Memproses potongan teks seluruh halaman menjadi daftar transaksi.
 *
 * @param {Array<Array>} halaman daftar per halaman berisi {str,x,y,w,h}
 * @param {{paksaAdapter?: string, warna?: Array}} opsi
 *        `warna` berisi warna tiap potongan teks per halaman; hanya dipakai oleh
 *        adapter yang mengandalkan warna untuk menentukan arah transaksi.
 */
export function parseStatement(halaman, opsi = {}) {
  // Baris disusun per halaman supaya koordinat y antar halaman tidak tercampur.
  const barisPerHalaman = halaman.map((potongan) => buangBarisKosong(susunBaris(potongan)));
  const semuaBaris = barisPerHalaman.flat();
  const teks = barisPerHalaman.map((b) => teksPenuh(b)).join('\n');

  /* Kop halaman pertama dipisahkan karena identitas penerbit hanya ada di situ,
     sementara uraian transaksi penuh nama bank lawan transaksi. */
  const teksKop = teksPenuh((barisPerHalaman[0] || []).slice(0, 25));

  const kepala = bacaKepala(teks, teksKop);
  const kodeAdapter = opsi.paksaAdapter || kepala.adapter;
  const adapter = adapterUntuk(kodeAdapter);

  const warna = (opsi.warna || []).flat();
  const hasil = adapter.parse({
    baris: semuaBaris,
    barisPerHalaman,
    teks,
    teksKop,
    kepala,
    warna,
  });

  const periode = periodeDariBaris(hasil.transaksi);
  const bank = kepala.bank || adapter.info.bank || '';

  /* Periode yang tercetak di kop lebih tepat menggambarkan cakupan berkas daripada
     tanggal transaksi pertama dan terakhir — bulan bisa dimulai tanpa transaksi. */
  const kopLengkap = Boolean(kepala.periode.awal && kepala.periode.akhir);

  return {
    ...hasil,
    kodeAdapter,
    namaAdapter: adapter.info.nama,
    bank,
    nomorRekening: kepala.nomorRekening,
    namaPemilik: kepala.namaPemilik,
    periodeKepala: kepala.periode,
    periodeAwal: (kopLengkap ? kepala.periode.awal : periode.periodeAwal) || periode.periodeAwal || '',
    periodeAkhir: (kopLengkap ? kepala.periode.akhir : periode.periodeAkhir) || periode.periodeAkhir || '',
    teksMentah: teks,
    jumlahBaris: semuaBaris.length,
  };
}
