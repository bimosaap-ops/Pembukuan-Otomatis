/**
 * Analitik: Cash Flow Bulanan, Pemasukan vs Pengeluaran, Trend Saldo,
 * Pengeluaran per Kategori, dan Top Pengeluaran.
 */

import { h, ikon, ganti } from '../../core/dom.js';
import { rupiah, rupiahRingkas } from '../../core/format.js';
import { tanggalTampil } from '../../core/dates.js';
import { on, EVENT } from '../../core/events.js';
import * as akunRepo from '../../data/repo/accounts.js';
import * as trxRepo from '../../data/repo/transactions.js';
import * as kategoriRepo from '../../data/repo/categories.js';
import {
  arusPerBulan, perKategori, trenSaldo, topPengeluaran, ringkasArus, totalSaldoAwal,
} from '../../domain/analytics.js';
import { grafikBatang, grafikBatangHorizontal } from '../../charts/bar.js';
import { grafikGaris } from '../../charts/line.js';
import { grafikDonat } from '../../charts/donut.js';
import { filterPeriode, pilihRekening, periodeIkutData } from '../components/filterbar.js';
import { pergiKe } from '../router.js';

export async function mount(wadah) {
  const halaman = h('.halaman');
  const isi = h('.tumpuk');
  let filter = { ...periodeIkutData(await trxRepo.rentangTersedia()), accountId: '' };

  const lepas = on(EVENT.DATA_BERUBAH, () => render());

  halaman.append(
    h('.halaman__kepala', null, h('div', null, [
      h('.halaman__judul', { text: 'Analitik' }),
      h('.halaman__ket', { text: 'Pola arus kas, tren saldo, dan ke mana uang paling banyak keluar.' }),
    ])),
    isi,
  );
  wadah.appendChild(halaman);

  async function render() {
    const [akun, petaKategori] = await Promise.all([akunRepo.daftar(), kategoriRepo.peta()]);
    const transaksi = await trxRepo.cari({
      dari: filter.dari, sampai: filter.sampai, accountId: filter.accountId,
    });

    if (!transaksi.length) {
      ganti(isi, [
        kartuFilter(akun),
        h('.kartu.dv__kosong', null, [
          ikon('analitik', 30),
          h('strong', { text: 'Belum ada data pada periode ini' }),
          h('div.redup-2', { text: 'Ubah rentang tanggal, atau upload e-statement lebih dulu.' }),
          h('button.btn-primary.mt-3', { type: 'button', onclick: () => pergiKe('upload') }, 'Upload e-Statement'),
        ]),
      ]);
      return;
    }

    const perBulan = arusPerBulan(transaksi, { dari: filter.dari, sampai: filter.sampai });
    const kategoriKeluar = perKategori(transaksi, petaKategori, 'keluar');
    const kategoriMasuk = perKategori(transaksi, petaKategori, 'masuk');
    const arus = ringkasArus(transaksi);
    const akunTerpakai = filter.accountId ? akun.filter((a) => a.id === filter.accountId) : akun;
    const tren = trenSaldo(transaksi, totalSaldoAwal(akunTerpakai), { dari: filter.dari, sampai: filter.sampai });
    const top = topPengeluaran(transaksi, 8);

    ganti(isi, [
      kartuFilter(akun),

      h('.kartu', null, [
        h('.kartu__kepala', null, h('div', null, [
          h('.kartu__judul', { text: 'Cash Flow Bulanan' }),
          h('.kartu__ket', { text: 'Selisih bersih tiap bulan; batang di bawah nol berarti pengeluaran melebihi pemasukan' }),
        ])),
        grafikBatang(
          perBulan.map((b) => ({ label: b.label, nilai: [b.netto] })),
          { seri: [{ nama: 'Arus kas bersih', warna: 'var(--c1)' }], judul: 'Arus kas bersih bulanan' },
        ),
        h('.dv__kaki', null, [
          h('div', { text: `Total bersih periode ini` }),
          h(`div.tebal.${arus.netto >= 0 ? 'masuk' : 'keluar'}`, { text: rupiah(arus.netto, { tanda: true }) }),
        ]),
      ]),

      h('.kartu', null, [
        h('.kartu__kepala', null, h('div', null, [
          h('.kartu__judul', { text: 'Pemasukan vs Pengeluaran' }),
          h('.kartu__ket', { text: 'Perbandingan langsung tiap bulan' }),
        ])),
        grafikBatang(
          perBulan.map((b) => ({ label: b.label, nilai: [b.masuk, b.keluar] })),
          {
            seri: [
              { nama: 'Pemasukan', warna: 'var(--masuk)' },
              { nama: 'Pengeluaran', warna: 'var(--keluar)' },
            ],
            judul: 'Pemasukan dibanding pengeluaran',
          },
        ),
      ]),

      h('.kartu', null, [
        h('.kartu__kepala', null, h('div', null, [
          h('.kartu__judul', { text: 'Trend Saldo' }),
          h('.kartu__ket', { text: 'Saldo akhir tiap bulan, dihitung maju dari saldo awal rekening' }),
        ])),
        grafikGaris(tren, { judul: 'Tren saldo', warna: 'var(--c1)' }),
      ]),

      h('.grid-2', null, [
        h('.kartu', null, [
          h('.kartu__kepala', null, h('div', null, [
            h('.kartu__judul', { text: 'Pengeluaran per Kategori' }),
            h('.kartu__ket', { text: `${kategoriKeluar.length} kategori terpakai` }),
          ])),
          grafikDonat(
            kategoriKeluar.slice(0, 10).map((k) => ({ label: k.namaBersih, nilai: k.total, warna: k.warna })),
            { judul: 'Pengeluaran per kategori', labelTengah: 'Total keluar' },
          ),
          h('.mt-4', null, grafikBatangHorizontal(
            kategoriKeluar.slice(0, 8).map((k) => ({
              label: k.nama, nilai: k.total, warna: k.warna, ket: `${k.jumlah} transaksi`,
            })),
            { formatNilai: (v) => rupiah(v) },
          )),
        ]),

        h('.kartu', null, [
          h('.kartu__kepala', null, h('div', null, [
            h('.kartu__judul', { text: 'Pemasukan per Kategori' }),
            h('.kartu__ket', { text: 'Dari mana uang masuk' }),
          ])),
          kategoriMasuk.length
            ? grafikBatangHorizontal(
              kategoriMasuk.slice(0, 8).map((k) => ({
                label: k.nama, nilai: k.total, warna: k.warna, ket: `${k.jumlah} transaksi`,
              })),
              { formatNilai: (v) => rupiah(v) },
            )
            : h('.dv__kosong', null, 'Belum ada pemasukan pada periode ini.'),
        ]),
      ]),

      h('.kartu', null, [
        h('.kartu__kepala', null, h('div', null, [
          h('.kartu__judul', { text: 'Top Pengeluaran' }),
          h('.kartu__ket', { text: 'Transaksi keluar terbesar pada periode ini' }),
        ])),
        top.length
          ? h('.daftar', null, top.map((t) => {
            const kat = petaKategori.get(t.kategoriId);
            return h('.daftar__item', null, [
              h('.daftar__utama', null, [
                h('.daftar__judul.putus', { text: t.deskripsi || '(tanpa keterangan)' }),
                h('.daftar__ket', { text: `${tanggalTampil(t.tanggal)} · ${kat ? kat.nama : 'Tanpa kategori'}` }),
              ]),
              h('.daftar__nilai.keluar', { text: rupiahRingkas(t.nominal) }),
            ]);
          }))
          : h('.dv__kosong', null, 'Belum ada pengeluaran pada periode ini.'),
      ]),
    ]);
  }

  function kartuFilter(akun) {
    return h('.kartu.kartu--rapat', null, [
      filterPeriode(filter, (baru) => { filter = { ...filter, ...baru }; render(); }),
      h('.filter__baris.mt-3', null, [
        pilihRekening(akun, filter.accountId, (id) => { filter.accountId = id; render(); }),
      ]),
    ]);
  }

  await render();
  return { unmount: lepas };
}
