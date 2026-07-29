/**
 * Dashboard: Total Saldo, Total Pemasukan, Total Pengeluaran, Cash Flow Bulanan,
 * Saldo per Rekening, 10 Transaksi Terbaru, dan Upload Terakhir.
 */

import { h, ikon, ganti } from '../../core/dom.js';
import { rupiah, rupiahRingkas, maskRekening } from '../../core/format.js';
import { tanggalTampil, bulanTampil, kunciBulan, hariIni } from '../../core/dates.js';
import { on, EVENT } from '../../core/events.js';
import * as akunRepo from '../../data/repo/accounts.js';
import * as trxRepo from '../../data/repo/transactions.js';
import * as uploadRepo from '../../data/repo/uploads.js';
import * as kategoriRepo from '../../data/repo/categories.js';
import {
  ringkasArus, arusPerBulan, totalSaldo, terbaru, rataRataBulanan, tanpaTransferInternal,
} from '../../domain/analytics.js';
import { grafikBatang } from '../../charts/bar.js';
import { filterPeriode, pilihRekening, periodeIkutData } from '../components/filterbar.js';
import { pergiKe } from '../router.js';

export async function mount(wadah) {
  const halaman = h('.halaman');
  const isi = h('.tumpuk');
  // Periode awal mengikuti data yang ada, bukan tanggal hari ini.
  let filter = { ...periodeIkutData(await trxRepo.rentangTersedia()), accountId: '' };

  const lepas = on(EVENT.DATA_BERUBAH, () => render());

  halaman.append(
    h('.halaman__kepala', null, [
      h('div', null, [
        h('.halaman__judul', { text: 'Dashboard' }),
        h('.halaman__ket', { text: 'Ringkasan keuangan dari seluruh e-statement yang sudah di-upload.' }),
      ]),
      h('button.btn-primary.btn-kecil', { type: 'button', onclick: () => pergiKe('upload') },
        [ikon('upload', 17), h('span', { text: 'Upload statement' })]),
    ]),
    isi,
  );
  wadah.appendChild(halaman);

  async function render() {
    const [akun, kategori, upload] = await Promise.all([
      akunRepo.daftar(), kategoriRepo.peta(), uploadRepo.terakhir(5),
    ]);

    if (!akun.length) {
      ganti(isi, kartuKosong());
      return;
    }

    const semua = await trxRepo.cari({ accountId: filter.accountId });
    const periode = await trxRepo.cari({
      dari: filter.dari, sampai: filter.sampai, accountId: filter.accountId,
    });

    const arus = ringkasArus(periode);
    const perBulan = arusPerBulan(periode, { dari: filter.dari, sampai: filter.sampai });
    const akunTampil = filter.accountId ? akun.filter((a) => a.id === filter.accountId) : akun;
    const bulanIni = kunciBulan(hariIni());
    const arusBulanIni = ringkasArus(semua.filter((t) => kunciBulan(t.tanggal) === bulanIni));

    ganti(isi, [
      h('.kartu.kartu--rapat', null, [
        filterPeriode(filter, (baru) => { filter = { ...filter, ...baru }; render(); }),
        h('.filter__baris.mt-3', null, [
          pilihRekening(akun, filter.accountId, (id) => { filter.accountId = id; render(); }),
        ]),
      ]),

      h('.grid-kpi', null, [
        kartuKpi('Total Saldo', rupiah(totalSaldo(akunTampil)), 'netral', 'rekening',
          `${akunTampil.length} rekening`),
        kartuKpi('Total Pemasukan', rupiah(arus.masuk), 'masuk', 'transaksi',
          `Bulan ini ${rupiahRingkas(arusBulanIni.masuk)}`),
        kartuKpi('Total Pengeluaran', rupiah(arus.keluar), 'keluar', 'transaksi',
          `Rata-rata ${rupiahRingkas(rataRataBulanan(perBulan, 'keluar'))}/bulan`),
        kartuKpi('Arus Kas Bersih', rupiah(arus.netto, { tanda: true }), arus.netto >= 0 ? 'masuk' : 'keluar',
          'analitik', `${arus.jumlah} transaksi pada periode ini`),
      ]),

      h('.kartu', null, [
        h('.kartu__kepala', null, [
          h('div', null, [
            h('.kartu__judul', { text: 'Cash Flow Bulanan' }),
            h('.kartu__ket', { text: 'Pemasukan dibanding pengeluaran tiap bulan' }),
          ]),
        ]),
        grafikBatang(
          perBulan.map((b) => ({ label: b.label, nilai: [b.masuk, b.keluar] })),
          {
            seri: [
              { nama: 'Pemasukan', warna: 'var(--masuk)' },
              { nama: 'Pengeluaran', warna: 'var(--keluar)' },
            ],
            judul: 'Cash flow bulanan',
            kosong: 'Belum ada transaksi pada periode ini.',
          },
        ),
      ]),

      h('.grid-2.grid-2--lebar-kiri', null, [
        kartuTransaksiTerbaru(tanpaTransferInternal(periode), kategori),
        h('.tumpuk', null, [
          kartuSaldoRekening(akunTampil),
          kartuUploadTerakhir(upload),
        ]),
      ]),
    ]);
  }

  await render();
  return { unmount: lepas };
}

function kartuKpi(label, nilai, jenis, namaIkon, sub) {
  return h(`.kpi.kpi--${jenis}`, null, [
    h('.kpi__label', null, [ikon(namaIkon, 15), h('span', { text: label })]),
    h('.kpi__nilai', { text: nilai }),
    sub ? h('.kpi__sub', { text: sub }) : null,
  ]);
}

function kartuSaldoRekening(akun) {
  const total = totalSaldo(akun);
  return h('.kartu', null, [
    h('.kartu__kepala', null, [
      h('.kartu__judul', { text: 'Saldo per Rekening' }),
      h('button.btn-halus.btn-kecil', { type: 'button', onclick: () => pergiKe('rekening') }, 'Kelola'),
    ]),
    h('.daftar', null, akun.map((a) => h('.daftar__item', null, [
      h('.daftar__utama', null, [
        h('.daftar__judul', { text: a.bank || 'Rekening' }),
        h('.daftar__ket', { text: `${maskRekening(a.nomorRekening) || a.jenis} · ${a.jumlahTransaksi} transaksi` }),
      ]),
      h('.daftar__nilai', { text: rupiah(a.saldo) }),
    ]))),
    h('.dv__kaki', null, [
      h('div', { text: 'Total gabungan' }),
      h('div.tebal', { text: rupiah(total) }),
    ]),
  ]);
}

function kartuTransaksiTerbaru(transaksi, petaKategori) {
  const daftar = terbaru(transaksi, 10);

  return h('.kartu', null, [
    h('.kartu__kepala', null, [
      h('.kartu__judul', { text: '10 Transaksi Terbaru' }),
      h('button.btn-halus.btn-kecil', { type: 'button', onclick: () => pergiKe('transaksi') }, 'Lihat semua'),
    ]),
    daftar.length
      ? h('.daftar', null, daftar.map((t) => {
        const kat = petaKategori.get(t.kategoriId);
        return h('.daftar__item', null, [
          h('.daftar__utama', null, [
            h('.daftar__judul.putus', { text: t.deskripsi || '(tanpa keterangan)' }),
            h('.daftar__ket', { text: `${tanggalTampil(t.tanggal)} · ${kat ? `${kat.ikon} ${kat.nama}` : 'Tanpa kategori'}` }),
          ]),
          h(`.daftar__nilai.${t.nominal >= 0 ? 'masuk' : 'keluar'}`, {
            text: rupiah(t.nominal, { tanda: true }),
          }),
        ]);
      }))
      : h('.dv__kosong', null, 'Belum ada transaksi pada periode ini.'),
  ]);
}

function kartuUploadTerakhir(upload) {
  return h('.kartu', null, [
    h('.kartu__kepala', null, [
      h('.kartu__judul', { text: 'Upload Terakhir' }),
      h('button.btn-halus.btn-kecil', { type: 'button', onclick: () => pergiKe('riwayat') }, 'Riwayat'),
    ]),
    upload.length
      ? h('.daftar', null, upload.map((u) => h('.daftar__item', null, [
        h('.daftar__utama', null, [
          h('.daftar__judul.putus', { text: u.namaFile }),
          h('.daftar__ket', {
            text: `${u.bank || 'Bank'} · ${u.periodeAwal ? bulanTampil(kunciBulan(u.periodeAwal)) : 'periode tidak terbaca'}`,
          }),
        ]),
        h(`span.lencana.lencana--${u.status === 'sukses' ? 'masuk' : u.status === 'gagal' ? 'keluar' : 'warning'}`, {
          text: `${u.berhasil} baris`,
        }),
      ])))
      : h('.dv__kosong', null, 'Belum ada berkas yang di-upload.'),
  ]);
}

function kartuKosong() {
  return h('.kartu.dv__kosong', null, [
    ikon('upload', 30),
    h('strong', { text: 'Pembukuan masih kosong' }),
    h('div.redup-2', { text: 'Upload e-statement PDF pertama Anda. Bank, nomor rekening, dan seluruh transaksinya akan dibaca otomatis.' }),
    h('button.btn-primary.mt-3', { type: 'button', onclick: () => pergiKe('upload') },
      [ikon('upload', 18), h('span', { text: 'Upload e-Statement' })]),
  ]);
}
