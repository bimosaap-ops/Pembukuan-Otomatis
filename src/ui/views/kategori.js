/**
 * Halaman Kategori: daftar kategori beserta kata kunci yang dipakai untuk
 * mengelompokkan transaksi otomatis. Hanya baca — kategori diedit di tab
 * "Kategori" pada Google Sheets.
 */

import { h, ikon, ganti } from '../../core/dom.js';
import { rupiah } from '../../core/format.js';
import { on, EVENT } from '../../core/events.js';
import * as kategoriRepo from '../../data/repo/categories.js';
import * as trxRepo from '../../data/repo/transactions.js';
import { TIPE_KATEGORI, KATEGORI_LAINNYA_MASUK, KATEGORI_LAINNYA_KELUAR } from '../../domain/entities.js';

export async function mount(wadah) {
  const halaman = h('.halaman');
  const isi = h('.tumpuk');
  const lepas = on(EVENT.DATA_BERUBAH, () => render());
  let tipeAktif = TIPE_KATEGORI.PENGELUARAN;

  halaman.append(
    h('.halaman__kepala', null, [
      h('div', null, [
        h('.halaman__judul', { text: 'Kategori' }),
        h('.halaman__ket', { text: 'Kata kunci di sini dipakai untuk mengelompokkan transaksi secara otomatis saat e-statement di-upload.' }),
      ]),
    ]),
    isi,
  );
  wadah.appendChild(halaman);

  async function render() {
    const [kategori, transaksi] = await Promise.all([kategoriRepo.daftar(), trxRepo.semua()]);

    const pakai = new Map();
    transaksi.forEach((t) => {
      if (!pakai.has(t.kategoriId)) pakai.set(t.kategoriId, { jumlah: 0, total: 0 });
      const p = pakai.get(t.kategoriId);
      p.jumlah += 1;
      p.total += Math.abs(t.nominal);
    });

    const tampil = kategori.filter((k) => k.tipe === tipeAktif);

    ganti(isi, [
      h('.segment', { role: 'group', 'aria-label': 'Jenis kategori' }, [
        tombolTipe('Pengeluaran', TIPE_KATEGORI.PENGELUARAN),
        tombolTipe('Pemasukan', TIPE_KATEGORI.PEMASUKAN),
      ]),

      h('.grid-3', null, tampil.map((k) => kartuKategori(k, pakai.get(k.id)))),

      h('.info-kotak', null, [
        ikon('cek', 18),
        h('div', null, [
          h('b', { text: 'Kategori diedit di Google Sheets. ' }),
          'Tambah, ubah, atau hapus kategori langsung di tab "Kategori" pada spreadsheet. Perubahan otomatis muncul di sini dalam waktu singkat, tanpa perlu tekan tombol apa pun.',
        ]),
      ]),
    ]);
  }

  function tombolTipe(label, tipe) {
    return h('button.segment__btn', {
      type: 'button',
      'aria-pressed': tipe === tipeAktif ? 'true' : 'false',
      onclick: () => { tipeAktif = tipe; render(); },
    }, label);
  }

  await render();
  return { unmount: lepas };
}

function kartuKategori(kategori, pakai) {
  const bawaan = kategori.id === KATEGORI_LAINNYA_MASUK || kategori.id === KATEGORI_LAINNYA_KELUAR;

  return h('.kartu', null, [
    h('.kartu__kepala', null, [
      h('.baris', null, [
        h('span.titik-warna', { style: { '--titik': kategori.warna, width: '14px', height: '14px' } }),
        h('div', null, [
          h('.kartu__judul', { text: `${kategori.ikon} ${kategori.nama}` }),
          h('.kartu__ket', {
            text: pakai
              ? `${pakai.jumlah} transaksi · ${rupiah(pakai.total)}`
              : 'Belum dipakai',
          }),
        ]),
      ]),
    ]),

    kategori.polaKataKunci?.length
      ? h('.baris.bungkus', null, kategori.polaKataKunci.slice(0, 12).map((p) => h('span.lencana', { text: p })))
      : h('.redup-2', { style: { fontSize: '.82rem' }, text: 'Tanpa kata kunci — hanya bisa dipilih manual.' }),

    kategori.polaKataKunci?.length > 12
      ? h('.redup-2.mt-2', { style: { fontSize: '.78rem' }, text: `+${kategori.polaKataKunci.length - 12} kata kunci lain` })
      : null,

    bawaan
      ? h('.baris.bungkus.mt-3', null, [h('span.lencana.lencana--info', { text: 'Kategori penampung' })])
      : null,
  ]);
}
