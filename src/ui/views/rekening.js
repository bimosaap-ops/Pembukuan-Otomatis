/**
 * Halaman Rekening: Bank, Nomor Rekening, Nama Pemilik, Mata Uang, Saldo,
 * dan Jumlah Transaksi. Termasuk akun "Kas Tunai" untuk pembukuan di luar bank.
 */

import { h, ikon, ganti } from '../../core/dom.js';
import { rupiah } from '../../core/format.js';
import { on, emit, EVENT } from '../../core/events.js';
import * as akunRepo from '../../data/repo/accounts.js';
import { JENIS_AKUN } from '../../domain/entities.js';
import { totalSaldo } from '../../domain/analytics.js';
import { dataView } from '../components/data-view.js';
import { toastSukses } from '../components/toast.js';

export async function mount(wadah) {
  const halaman = h('.halaman');
  const isi = h('.tumpuk');
  const lepas = on(EVENT.DATA_BERUBAH, () => render());

  halaman.append(
    h('.halaman__kepala', null, [
      h('div', null, [
        h('.halaman__judul', { text: 'Rekening' }),
        h('.halaman__ket', {
          text: 'Rekening bank terbentuk otomatis saat e-statement di-upload. Tambah/ubah rekening lewat tab "Akun" di Google Sheets.',
        }),
      ]),
    ]),
    isi,
  );
  wadah.appendChild(halaman);

  async function render() {
    const akun = await akunRepo.daftar();

    ganti(isi, [
      h('.grid-kpi', null, [
        kpi('Total Saldo', rupiah(totalSaldo(akun)), 'netral'),
        kpi('Jumlah Rekening', String(akun.filter((a) => a.jenis === JENIS_AKUN.BANK).length), 'netral'),
        kpi('Akun Kas', String(akun.filter((a) => a.jenis === JENIS_AKUN.KAS).length), 'netral'),
        kpi('Total Transaksi', String(akun.reduce((s, a) => s + (a.jumlahTransaksi || 0), 0)), 'netral'),
      ]),

      dataView({
        kolom: [
          {
            kunci: 'bank', judul: 'Bank', kartu: 'utama',
            render: (a) => h('div', null, [
              h('div.tebal', { text: a.bank || 'Tanpa nama' }),
              a.jenis === JENIS_AKUN.KAS ? h('span.lencana.lencana--info', { text: 'Kas Tunai' }) : null,
            ]),
          },
          { kunci: 'nomorRekening', judul: 'Nomor Rekening', render: (a) => a.nomorRekening || '—' },
          { kunci: 'namaPemilik', judul: 'Nama Pemilik', render: (a) => a.namaPemilik || '—' },
          { kunci: 'mataUang', judul: 'Mata Uang', lebar: '100px' },
          {
            kunci: 'saldo', judul: 'Saldo', kanan: true, angka: true, kartu: 'nilai',
            render: (a) => h(`span.${a.saldo >= 0 ? '' : 'keluar'}`, { text: rupiah(a.saldo) }),
          },
          {
            kunci: 'jumlahTransaksi', judul: 'Jumlah Transaksi', kanan: true, angka: true, lebar: '140px',
            render: (a) => String(a.jumlahTransaksi || 0),
          },
        ],
        baris: akun,
        kosong: 'Belum ada rekening',
        kosongKet: 'Upload e-statement — rekening akan dibuat otomatis dari kepala berkas.',
        aksi: (a) => [
          h('button.btn-kecil', {
            type: 'button',
            title: 'Hitung ulang saldo dari seluruh transaksi',
            onclick: async () => {
              await akunRepo.hitungUlangSaldo(a.id);
              toastSukses('Saldo dihitung ulang.');
              emit(EVENT.DATA_BERUBAH, { sumber: 'rekening' });
            },
          }, 'Hitung ulang'),
        ],
      }),

      akun.length ? h('.info-kotak', null, [
        ikon('cek', 18),
        h('div', null, [
          h('b', { text: 'Saldo diambil dari kolom saldo pada statement terakhir. ' }),
          'Sebagian berkas — misalnya unduhan "Mutasi Transaksi" dari aplikasi bank — tidak memuat kolom saldo sama sekali. Untuk rekening seperti itu, saldo dihitung dari Saldo Awal ditambah seluruh mutasi, jadi isilah Saldo Awal agar angkanya sesuai kenyataan.',
        ]),
      ]) : null,
    ]);
  }

  await render();
  return { unmount: lepas };
}

function kpi(label, nilai, jenis) {
  return h(`.kpi.kpi--${jenis}`, null, [
    h('.kpi__label', { text: label }),
    h('.kpi__nilai', { text: nilai }),
  ]);
}
