/**
 * Halaman Laporan: Buku Kas, Cash Flow, Rekap Bulanan, Rekap Tahunan,
 * dengan ekspor Excel, CSV, dan PDF.
 */

import { h, ikon, ganti } from '../../core/dom.js';
import { rupiah } from '../../core/format.js';
import { tanggalTampil, hariIni } from '../../core/dates.js';
import { on, EVENT } from '../../core/events.js';
import * as akunRepo from '../../data/repo/accounts.js';
import * as trxRepo from '../../data/repo/transactions.js';
import * as kategoriRepo from '../../data/repo/categories.js';
import { bukuKas, cashFlow, rekapBulanan, rekapTahunan, judulPeriode } from '../../domain/reports.js';
import { totalSaldoAwal } from '../../domain/analytics.js';
import { dataView } from '../components/data-view.js';
import { filterPeriode, pilihRekening, periodeIkutData } from '../components/filterbar.js';
import { exportCsv, exportExcel, cetakHalaman } from '../../services/export.js';
import { toastSukses, toastGagal } from '../components/toast.js';

const JENIS = [
  { id: 'buku-kas', label: 'Buku Kas' },
  { id: 'cash-flow', label: 'Cash Flow' },
  { id: 'rekap-bulanan', label: 'Rekap Bulanan' },
  { id: 'rekap-tahunan', label: 'Rekap Tahunan' },
];

export async function mount(wadah) {
  const halaman = h('.halaman');
  const isi = h('.tumpuk');
  let filter = { ...periodeIkutData(await trxRepo.rentangTersedia()), accountId: '' };
  let jenis = 'buku-kas';

  const lepas = on(EVENT.DATA_BERUBAH, () => render());

  halaman.append(
    h('.halaman__kepala.tanpa-cetak', null, h('div', null, [
      h('.halaman__judul', { text: 'Laporan' }),
      h('.halaman__ket', { text: 'Laporan siap cetak dan siap ekspor ke Excel maupun CSV.' }),
    ])),
    isi,
  );
  wadah.appendChild(halaman);

  async function render() {
    const [akun, petaKategori] = await Promise.all([akunRepo.daftar(), kategoriRepo.peta()]);
    const transaksi = await trxRepo.cari({
      dari: filter.dari, sampai: filter.sampai, accountId: filter.accountId,
    });

    const akunTerpakai = filter.accountId ? akun.filter((a) => a.id === filter.accountId) : akun;
    const namaRekening = filter.accountId
      ? `${akunTerpakai[0]?.bank || ''} ${akunTerpakai[0]?.nomorRekening || ''}`.trim()
      : 'Semua rekening';

    const laporan = susun(jenis, transaksi, petaKategori, akunTerpakai, filter);

    ganti(isi, [
      h('.kartu.kartu--rapat.tanpa-cetak', null, [
        h('.segment', { role: 'group', 'aria-label': 'Jenis laporan' }, JENIS.map((j) => h('button.segment__btn', {
          type: 'button',
          'aria-pressed': j.id === jenis ? 'true' : 'false',
          onclick: () => { jenis = j.id; render(); },
        }, j.label))),
        h('.mt-3', null, filterPeriode(filter, (baru) => { filter = { ...filter, ...baru }; render(); })),
        h('.filter__baris.mt-3', null, [
          pilihRekening(akun, filter.accountId, (id) => { filter.accountId = id; render(); }),
        ]),
      ]),

      h('.baris.bungkus.tanpa-cetak', null, [
        h('button', { type: 'button', onclick: () => unduhExcel(laporan, jenis) },
          [ikon('unduh', 17), h('span', { text: 'Excel' })]),
        h('button', { type: 'button', onclick: () => unduhCsv(laporan, jenis) },
          [ikon('unduh', 17), h('span', { text: 'CSV' })]),
        h('button', { type: 'button', onclick: () => cetakHalaman() },
          [ikon('laporan', 17), h('span', { text: 'PDF / Cetak' })]),
      ]),

      // Kop hanya muncul di kertas, bukan di layar.
      h('.cetak-saja.cetak-kop', null, [
        h('h1', { text: laporan.judul }),
        h('.cetak-sub', { text: `${namaRekening} · ${judulPeriode(filter.dari, filter.sampai)} · dicetak ${tanggalTampil(hariIni())}` }),
      ]),

      ...laporan.blok,
    ]);
  }

  await render();
  return { unmount: lepas };
}

/* ==========================================================================
   Penyusunan tiap jenis laporan
   ========================================================================== */

function susun(jenis, transaksi, petaKategori, akun, filter) {
  if (jenis === 'cash-flow') return laporanCashFlow(transaksi, petaKategori);
  if (jenis === 'rekap-bulanan') return laporanRekapBulanan(transaksi, filter);
  if (jenis === 'rekap-tahunan') return laporanRekapTahunan(transaksi);
  return laporanBukuKas(transaksi, petaKategori, akun);
}

function laporanBukuKas(transaksi, petaKategori, akun) {
  const hasil = bukuKas(transaksi, totalSaldoAwal(akun));

  const kolom = [
    { kunci: 'tanggal', judul: 'Tanggal', lebar: '110px', nilai: (r) => r.tanggal, render: (r) => tanggalTampil(r.tanggal) },
    { kunci: 'deskripsi', judul: 'Uraian', kartu: 'utama', lebar: '240px', nilai: (r) => r.deskripsi, render: (r) => h('div.putus', { text: r.deskripsi }) },
    {
      kunci: 'kategori', judul: 'Kategori', lebar: '150px',
      nilai: (r) => petaKategori.get(r.kategoriId)?.nama || '',
      render: (r) => petaKategori.get(r.kategoriId)?.nama || '—',
    },
    {
      kunci: 'debit', judul: 'Debit', kanan: true, angka: true, lebar: '130px', kartu: false,
      nilai: (r) => r.debit || '', render: (r) => (r.debit ? h('span.keluar', { text: rupiah(r.debit) }) : ''),
    },
    {
      kunci: 'kredit', judul: 'Kredit', kanan: true, angka: true, lebar: '130px', kartu: 'nilai',
      nilai: (r) => r.kredit || '', render: (r) => (r.kredit ? h('span.masuk', { text: rupiah(r.kredit) }) : ''),
      renderKartu: (r) => h(`span.${r.kredit ? 'masuk' : 'keluar'}`, {
        text: rupiah(r.kredit ? r.kredit : -r.debit, { tanda: true }),
      }),
    },
    {
      kunci: 'saldoBerjalan', judul: 'Saldo', kanan: true, angka: true, lebar: '140px',
      nilai: (r) => r.saldoBerjalan, render: (r) => rupiah(r.saldoBerjalan),
    },
  ];

  return {
    judul: 'Buku Kas',
    kolom,
    baris: hasil.baris,
    blok: [
      h('.grid-kpi', null, [
        kpi('Saldo Awal', rupiah(hasil.saldoAwal)),
        kpi('Total Debit', rupiah(hasil.totalDebit), 'keluar'),
        kpi('Total Kredit', rupiah(hasil.totalKredit), 'masuk'),
        kpi('Saldo Akhir', rupiah(hasil.saldoAkhir)),
      ]),
      h('.kartu.kartu--kosong', null, dataView({
        kolom,
        baris: hasil.baris,
        kosong: 'Belum ada transaksi pada periode ini',
      })),
    ],
  };
}

function laporanCashFlow(transaksi, petaKategori) {
  const hasil = cashFlow(transaksi, petaKategori);

  const kolom = [
    { kunci: 'arah', judul: 'Arah', lebar: '110px', nilai: (r) => r.arah },
    { kunci: 'nama', judul: 'Kategori', kartu: 'utama', nilai: (r) => r.nama, render: (r) => `${r.ikon} ${r.nama}` },
    { kunci: 'jumlah', judul: 'Transaksi', kanan: true, angka: true, lebar: '110px', nilai: (r) => r.jumlah },
    {
      kunci: 'total', judul: 'Nilai', kanan: true, angka: true, lebar: '150px', kartu: 'nilai',
      nilai: (r) => r.total,
      render: (r) => h(`span.${r.arah === 'Masuk' ? 'masuk' : 'keluar'}`, { text: rupiah(r.total) }),
    },
  ];

  const baris = [
    ...hasil.masuk.map((k) => ({ ...k, arah: 'Masuk' })),
    ...hasil.keluar.map((k) => ({ ...k, arah: 'Keluar' })),
  ];

  return {
    judul: 'Laporan Cash Flow',
    kolom,
    baris,
    blok: [
      h('.grid-kpi', null, [
        kpi('Total Pemasukan', rupiah(hasil.totalMasuk), 'masuk'),
        kpi('Total Pengeluaran', rupiah(hasil.totalKeluar), 'keluar'),
        kpi('Arus Kas Bersih', rupiah(hasil.netto, { tanda: true }), hasil.netto >= 0 ? 'masuk' : 'keluar'),
        kpi('Kategori Terpakai', String(baris.length)),
      ]),
      h('.kartu.kartu--kosong', null, dataView({
        kolom, baris, kosong: 'Belum ada arus kas pada periode ini',
      })),
    ],
  };
}

function laporanRekapBulanan(transaksi, filter) {
  const baris = rekapBulanan(transaksi, { dari: filter.dari, sampai: filter.sampai });

  const kolom = [
    { kunci: 'label', judul: 'Bulan', kartu: 'utama', nilai: (r) => r.label },
    { kunci: 'jumlah', judul: 'Transaksi', kanan: true, angka: true, lebar: '110px', nilai: (r) => r.jumlah },
    { kunci: 'masuk', judul: 'Pemasukan', kanan: true, angka: true, lebar: '150px', nilai: (r) => r.masuk, render: (r) => h('span.masuk', { text: rupiah(r.masuk) }) },
    { kunci: 'keluar', judul: 'Pengeluaran', kanan: true, angka: true, lebar: '150px', nilai: (r) => r.keluar, render: (r) => h('span.keluar', { text: rupiah(r.keluar) }) },
    {
      kunci: 'netto', judul: 'Selisih', kanan: true, angka: true, lebar: '150px', kartu: 'nilai',
      nilai: (r) => r.netto,
      render: (r) => h(`span.${r.netto >= 0 ? 'masuk' : 'keluar'}`, { text: rupiah(r.netto, { tanda: true }) }),
    },
    { kunci: 'kumulatif', judul: 'Kumulatif', kanan: true, angka: true, lebar: '150px', nilai: (r) => r.kumulatif, render: (r) => rupiah(r.kumulatif, { tanda: true }) },
  ];

  const totalMasuk = baris.reduce((s, b) => s + b.masuk, 0);
  const totalKeluar = baris.reduce((s, b) => s + b.keluar, 0);

  return {
    judul: 'Rekap Bulanan',
    kolom,
    baris,
    blok: [
      h('.grid-kpi', null, [
        kpi('Bulan Tercakup', String(baris.length)),
        kpi('Total Pemasukan', rupiah(totalMasuk), 'masuk'),
        kpi('Total Pengeluaran', rupiah(totalKeluar), 'keluar'),
        kpi('Selisih', rupiah(totalMasuk - totalKeluar, { tanda: true }), totalMasuk - totalKeluar >= 0 ? 'masuk' : 'keluar'),
      ]),
      h('.kartu.kartu--kosong', null, dataView({ kolom, baris, kosong: 'Belum ada data bulanan' })),
    ],
  };
}

function laporanRekapTahunan(transaksi) {
  const baris = rekapTahunan(transaksi);

  const kolom = [
    { kunci: 'tahun', judul: 'Tahun', kartu: 'utama', nilai: (r) => r.tahun },
    { kunci: 'bulanAktif', judul: 'Bulan Aktif', kanan: true, angka: true, lebar: '120px', nilai: (r) => r.bulanAktif },
    { kunci: 'jumlah', judul: 'Transaksi', kanan: true, angka: true, lebar: '110px', nilai: (r) => r.jumlah },
    { kunci: 'masuk', judul: 'Pemasukan', kanan: true, angka: true, lebar: '150px', nilai: (r) => r.masuk, render: (r) => h('span.masuk', { text: rupiah(r.masuk) }) },
    { kunci: 'keluar', judul: 'Pengeluaran', kanan: true, angka: true, lebar: '150px', nilai: (r) => r.keluar, render: (r) => h('span.keluar', { text: rupiah(r.keluar) }) },
    {
      kunci: 'netto', judul: 'Selisih', kanan: true, angka: true, lebar: '150px', kartu: 'nilai',
      nilai: (r) => r.netto,
      render: (r) => h(`span.${r.netto >= 0 ? 'masuk' : 'keluar'}`, { text: rupiah(r.netto, { tanda: true }) }),
    },
    { kunci: 'rataKeluar', judul: 'Rata-rata Keluar/bln', kanan: true, angka: true, lebar: '170px', nilai: (r) => Math.round(r.rataKeluar), render: (r) => rupiah(r.rataKeluar) },
  ];

  return {
    judul: 'Rekap Tahunan',
    kolom,
    baris,
    blok: [h('.kartu.kartu--kosong', null, dataView({ kolom, baris, kosong: 'Belum ada data tahunan' }))],
  };
}

function kpi(label, nilai, jenis = 'netral') {
  return h(`.kpi.kpi--${jenis}`, null, [
    h('.kpi__label', { text: label }),
    h('.kpi__nilai', { text: nilai }),
  ]);
}

/* ==========================================================================
   Ekspor
   ========================================================================== */

function namaBerkas(jenis, ekstensi) {
  return `${jenis}-${hariIni()}.${ekstensi}`;
}

async function unduhCsv(laporan, jenis) {
  try {
    const hasil = await exportCsv(namaBerkas(jenis, 'csv'), laporan.kolom, laporan.baris);
    if (!hasil?.batal) toastSukses('Berkas CSV diunduh.');
  } catch (e) {
    toastGagal(`Gagal membuat CSV: ${e.message}`);
  }
}

async function unduhExcel(laporan, jenis) {
  try {
    const hasil = await exportExcel(namaBerkas(jenis, 'xlsx'), [{
      nama: laporan.judul,
      kolom: laporan.kolom,
      baris: laporan.baris,
    }]);
    if (!hasil?.batal) toastSukses('Berkas Excel diunduh.');
  } catch (e) {
    toastGagal(`Gagal membuat Excel: ${e.message}`);
  }
}
