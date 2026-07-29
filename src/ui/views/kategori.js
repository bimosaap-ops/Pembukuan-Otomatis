/**
 * Halaman Kategori: daftar kategori bawaan yang bisa ditambah, diubah, dan dihapus,
 * lengkap dengan kata kunci yang dipakai untuk mengelompokkan transaksi otomatis.
 */

import { h, ikon, ganti } from '../../core/dom.js';
import { rupiah } from '../../core/format.js';
import { on, emit, EVENT } from '../../core/events.js';
import * as kategoriRepo from '../../data/repo/categories.js';
import * as trxRepo from '../../data/repo/transactions.js';
import { buatKategori, TIPE_KATEGORI, KATEGORI_LAINNYA_MASUK, KATEGORI_LAINNYA_KELUAR } from '../../domain/entities.js';
import { tentukanKategori } from '../../domain/categorize.js';
import { bukaModal, konfirmasi } from '../components/modal.js';
import { toastSukses, toastGagal } from '../components/toast.js';

const WARNA = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)',
  'var(--c7)', 'var(--c8)', 'var(--c9)', 'var(--c10)', 'var(--c11)', 'var(--c12)'];

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
      h('button.btn-primary.btn-kecil', {
        type: 'button', onclick: () => bukaForm(null, tipeAktif, render),
      }, [ikon('tambah', 17), h('span', { text: 'Tambah' })]),
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

      h('.grid-3', null, tampil.map((k) => kartuKategori(k, pakai.get(k.id), render))),

      h('.info-kotak', null, [
        ikon('cek', 18),
        h('div', null, [
          h('b', { text: 'Aturan bisa belajar sendiri. ' }),
          'Saat Anda mengganti kategori sebuah transaksi di halaman Transaksi, aplikasi menawarkan untuk mengingat kata kuncinya supaya upload berikutnya langsung masuk kategori yang benar.',
        ]),
      ]),

      h('.kartu', null, [
        h('.kartu__kepala', null, h('div', null, [
          h('.kartu__judul', { text: 'Kelompokkan ulang transaksi' }),
          h('.kartu__ket', { text: 'Menerapkan aturan kata kunci terbaru ke seluruh transaksi yang sudah tersimpan.' }),
        ])),
        h('button', {
          type: 'button',
          onclick: () => kelompokkanUlang(render),
        }, [ikon('kategori', 17), h('span', { text: 'Kelompokkan ulang semua transaksi' })]),
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

function kartuKategori(kategori, pakai, selesai) {
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

    h('.baris.bungkus.mt-3', null, [
      h('button.btn-kecil', { type: 'button', onclick: () => bukaForm(kategori, kategori.tipe, selesai) },
        [ikon('edit', 15), 'Ubah']),
      bawaan
        ? h('span.lencana.lencana--info', { text: 'Kategori penampung' })
        : h('button.btn-kecil.btn-bahaya', { type: 'button', onclick: () => hapus(kategori, selesai) },
          [ikon('hapus', 15), 'Hapus']),
    ]),
  ]);
}

function bukaForm(kategori, tipeAwal, selesai) {
  const ubah = Boolean(kategori);

  const fNama = h('input', { type: 'text', value: kategori?.nama || '', placeholder: 'mis. Sewa Alat' });
  const fIkon = h('input', { type: 'text', value: kategori?.ikon || '🏷', maxlength: '4', style: { maxWidth: '90px' } });
  const fTipe = h('select', null, [
    h('option', { value: TIPE_KATEGORI.PENGELUARAN, selected: (kategori?.tipe || tipeAwal) === TIPE_KATEGORI.PENGELUARAN, text: 'Pengeluaran' }),
    h('option', { value: TIPE_KATEGORI.PEMASUKAN, selected: (kategori?.tipe || tipeAwal) === TIPE_KATEGORI.PEMASUKAN, text: 'Pemasukan' }),
  ]);
  const fWarna = h('select', null, WARNA.map((w, i) => h('option', {
    value: w, selected: w === kategori?.warna, text: `Warna ${i + 1}`,
  })));
  const fPola = h('textarea', {
    value: (kategori?.polaKataKunci || []).join('\n'),
    placeholder: 'Satu kata kunci per baris, mis.\nALFAMART\nINDOMARET',
  });
  const fPrioritas = h('input', {
    type: 'number', min: '0', max: '100',
    value: String(kategori?.prioritas ?? 50),
  });

  const m = bukaModal({
    judul: ubah ? 'Ubah kategori' : 'Kategori baru',
    isi: h('.tumpuk', null, [
      h('.form-grid', null, [
        h('div', null, [h('label', { text: 'Nama kategori' }), fNama]),
        h('div', null, [h('label', { text: 'Ikon' }), fIkon]),
        h('div', null, [h('label', { text: 'Jenis' }), fTipe]),
        h('div', null, [h('label', { text: 'Warna' }), fWarna]),
        h('div.penuh', null, [h('label', { text: 'Kata kunci' }), fPola]),
        h('div', null, [h('label', { text: 'Prioritas (0–100)' }), fPrioritas]),
      ]),
      h('.info-kotak', null, [
        ikon('cek', 18),
        h('div', { text: 'Prioritas menentukan pemenang bila satu deskripsi cocok dengan beberapa kategori. Kata kunci umum seperti "TRANSFER" sebaiknya berprioritas rendah agar tidak menelan kategori yang lebih spesifik.' }),
      ]),
    ]),
    aksi: [
      h('button', { type: 'button', onclick: () => m.tutup() }, 'Batal'),
      h('button.btn-primary', {
        type: 'button',
        onclick: async () => {
          if (!fNama.value.trim()) { toastGagal('Nama kategori tidak boleh kosong.'); return; }
          await kategoriRepo.simpanKategori(buatKategori({
            ...(kategori || {}),
            nama: fNama.value.trim(),
            ikon: fIkon.value.trim() || '🏷',
            tipe: fTipe.value,
            warna: fWarna.value,
            prioritas: Number(fPrioritas.value) || 50,
            polaKataKunci: fPola.value.split('\n').map((s) => s.trim()).filter(Boolean),
            urutan: kategori?.urutan ?? 999,
          }));
          toastSukses(ubah ? 'Kategori diperbarui.' : 'Kategori ditambahkan.');
          m.tutup();
          emit(EVENT.DATA_BERUBAH, { sumber: 'kategori' });
          selesai?.();
        },
      }, ubah ? 'Simpan perubahan' : 'Tambah kategori'),
    ],
  });
}

async function hapus(kategori, selesai) {
  const transaksi = await trxRepo.semua();
  const terpakai = transaksi.filter((t) => t.kategoriId === kategori.id);

  const ya = await konfirmasi({
    judul: 'Hapus kategori?',
    pesan: terpakai.length
      ? `${terpakai.length} transaksi memakai kategori "${kategori.nama}". Transaksi itu akan dipindahkan ke kategori penampung, bukan dihapus.`
      : `Kategori "${kategori.nama}" akan dihapus.`,
    tombolYa: 'Hapus kategori',
    bahaya: true,
  });
  if (!ya) return;

  if (terpakai.length) {
    const penampung = kategori.tipe === TIPE_KATEGORI.PEMASUKAN ? KATEGORI_LAINNYA_MASUK : KATEGORI_LAINNYA_KELUAR;
    await trxRepo.ubahKategoriBanyak(terpakai.map((t) => t.id), penampung);
  }
  await kategoriRepo.hapusKategori(kategori.id);
  toastSukses('Kategori dihapus.');
  emit(EVENT.DATA_BERUBAH, { sumber: 'kategori' });
  selesai?.();
}

/** Menerapkan ulang seluruh aturan kata kunci ke transaksi yang sudah tersimpan. */
async function kelompokkanUlang(selesai) {
  const ya = await konfirmasi({
    judul: 'Kelompokkan ulang semua transaksi?',
    pesan: 'Kategori setiap transaksi akan dihitung ulang memakai aturan kata kunci yang berlaku sekarang. Perubahan kategori yang pernah Anda lakukan manual bisa tertimpa.',
    tombolYa: 'Ya, kelompokkan ulang',
  });
  if (!ya) return;

  const [kategori, transaksi] = await Promise.all([kategoriRepo.daftar(), trxRepo.semua()]);
  let berubah = 0;

  for (const t of transaksi) {
    const baru = tentukanKategori(t.deskripsi, t.nominal, kategori);
    if (baru !== t.kategoriId) {
      await trxRepo.simpanSatu({ ...t, kategoriId: baru, diubahPada: new Date().toISOString() });
      berubah += 1;
    }
  }

  toastSukses(berubah ? `${berubah} transaksi dikelompokkan ulang.` : 'Semua transaksi sudah sesuai aturan.');
  emit(EVENT.DATA_BERUBAH, { sumber: 'kategori' });
  selesai?.();
}
