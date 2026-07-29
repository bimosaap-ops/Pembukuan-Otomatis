/**
 * Halaman Rekening: Bank, Nomor Rekening, Nama Pemilik, Mata Uang, Saldo,
 * dan Jumlah Transaksi. Termasuk akun "Kas Tunai" untuk pembukuan di luar bank.
 */

import { h, ikon, ganti } from '../../core/dom.js';
import { rupiah, toNum } from '../../core/format.js';
import { on, emit, EVENT } from '../../core/events.js';
import * as akunRepo from '../../data/repo/accounts.js';
import { BANK_DIKENAL, JENIS_AKUN } from '../../domain/entities.js';
import { totalSaldo } from '../../domain/analytics.js';
import { dataView } from '../components/data-view.js';
import { bukaModal, konfirmasi } from '../components/modal.js';
import { toastSukses, toastGagal } from '../components/toast.js';

export async function mount(wadah) {
  const halaman = h('.halaman');
  const isi = h('.tumpuk');
  const lepas = on(EVENT.DATA_BERUBAH, () => render());

  halaman.append(
    h('.halaman__kepala', null, [
      h('div', null, [
        h('.halaman__judul', { text: 'Rekening' }),
        h('.halaman__ket', { text: 'Rekening bank terbentuk otomatis saat e-statement di-upload. Akun kas ditambahkan sendiri.' }),
      ]),
      h('button.btn-primary.btn-kecil', {
        type: 'button', onclick: () => bukaForm(null, render),
      }, [ikon('tambah', 17), h('span', { text: 'Tambah' })]),
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
          h('button.btn-kecil', { type: 'button', onclick: () => bukaForm(a, render) }, [ikon('edit', 15), 'Ubah']),
          h('button.btn-kecil', {
            type: 'button',
            title: 'Hitung ulang saldo dari seluruh transaksi',
            onclick: async () => {
              await akunRepo.hitungUlangSaldo(a.id);
              toastSukses('Saldo dihitung ulang.');
              emit(EVENT.DATA_BERUBAH, { sumber: 'rekening' });
            },
          }, 'Hitung ulang'),
          h('button.btn-kecil.btn-bahaya', { type: 'button', onclick: () => hapus(a, render) }, [ikon('hapus', 15)]),
        ],
      }),

      akun.length ? h('.info-kotak', null, [
        ikon('cek', 18),
        h('div', null, [
          h('b', { text: 'Saldo diambil dari kolom saldo statement terakhir. ' }),
          'Untuk akun kas yang tidak punya kolom saldo, saldo dihitung dari saldo awal ditambah seluruh mutasi.',
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

function bukaForm(akun, selesai) {
  const ubah = Boolean(akun);

  const fJenis = h('select', null, [
    h('option', { value: JENIS_AKUN.BANK, selected: !akun || akun.jenis === JENIS_AKUN.BANK, text: 'Rekening bank' }),
    h('option', { value: JENIS_AKUN.KAS, selected: akun?.jenis === JENIS_AKUN.KAS, text: 'Kas tunai' }),
  ]);
  const fBank = h('input', {
    type: 'text', list: 'daftar-bank', value: akun?.bank || '',
    placeholder: 'mis. BCA, Permata, Kas Proyek',
  });
  const datalist = h('datalist', { id: 'daftar-bank' }, BANK_DIKENAL.map((b) => h('option', { value: b })));
  const fNomor = h('input', { type: 'text', inputmode: 'numeric', value: akun?.nomorRekening || '' });
  const fNama = h('input', { type: 'text', value: akun?.namaPemilik || '' });
  const fMataUang = h('input', { type: 'text', value: akun?.mataUang || 'IDR' });
  const fSaldoAwal = h('input', {
    type: 'text', inputmode: 'decimal',
    value: akun ? String(akun.saldoAwal || 0) : '0',
  });

  const m = bukaModal({
    judul: ubah ? 'Ubah rekening' : 'Tambah rekening',
    isi: h('.form-grid', null, [
      datalist,
      h('div', null, [h('label', { text: 'Jenis' }), fJenis]),
      h('div', null, [h('label', { text: 'Bank / Nama akun' }), fBank]),
      h('div', null, [h('label', { text: 'Nomor Rekening' }), fNomor]),
      h('div', null, [h('label', { text: 'Nama Pemilik' }), fNama]),
      h('div', null, [h('label', { text: 'Mata Uang' }), fMataUang]),
      h('div', null, [h('label', { text: 'Saldo Awal' }), fSaldoAwal]),
    ]),
    aksi: [
      h('button', { type: 'button', onclick: () => m.tutup() }, 'Batal'),
      h('button.btn-primary', {
        type: 'button',
        onclick: async () => {
          if (!fBank.value.trim()) { toastGagal('Isi nama bank atau nama akun.'); return; }
          const tersimpan = await akunRepo.simpanAkun({
            ...(akun || {}),
            jenis: fJenis.value,
            bank: fBank.value.trim(),
            nomorRekening: fNomor.value.trim(),
            namaPemilik: fNama.value.trim(),
            mataUang: fMataUang.value.trim() || 'IDR',
            saldoAwal: toNum(fSaldoAwal.value),
          });
          await akunRepo.hitungUlangSaldo(tersimpan.id);
          toastSukses(ubah ? 'Rekening diperbarui.' : 'Rekening ditambahkan.');
          m.tutup();
          emit(EVENT.DATA_BERUBAH, { sumber: 'rekening' });
          selesai?.();
        },
      }, ubah ? 'Simpan perubahan' : 'Tambah'),
    ],
  });
}

async function hapus(akun, selesai) {
  const ya = await konfirmasi({
    judul: 'Hapus rekening?',
    pesan: `${akun.bank} ${akun.nomorRekening || ''} akan dihapus beserta ${akun.jumlahTransaksi || 0} transaksinya dan seluruh riwayat upload yang terkait. Tindakan ini tidak bisa dibatalkan.`,
    tombolYa: 'Hapus rekening',
    bahaya: true,
  });
  if (!ya) return;

  const hasil = await akunRepo.hapusAkun(akun.id);
  toastSukses(`Rekening dihapus beserta ${hasil.transaksiTerhapus} transaksi.`);
  emit(EVENT.DATA_BERUBAH, { sumber: 'rekening' });
  selesai?.();
}
