/**
 * Halaman Transaksi.
 *
 * Kolom: Tanggal, Deskripsi, Debit, Kredit, Saldo, Kategori, Rekening, File Sumber.
 * Filter: rentang tanggal, rekening, kategori, rentang nominal, dan kata kunci.
 * Di layar HP tabel berubah jadi daftar kartu (diatur `data-view` lewat CSS).
 */

import { h, ikon, ganti, debounce } from '../../core/dom.js';
import { rupiah, toNum, angka } from '../../core/format.js';
import { tanggalTampil } from '../../core/dates.js';
import { on, EVENT } from '../../core/events.js';
import * as akunRepo from '../../data/repo/accounts.js';
import * as trxRepo from '../../data/repo/transactions.js';
import * as uploadRepo from '../../data/repo/uploads.js';
import * as kategoriRepo from '../../data/repo/categories.js';
import { SUMBER } from '../../domain/entities.js';
import { ringkasArus } from '../../domain/analytics.js';
import { dataView } from '../components/data-view.js';
import { pergiKe } from '../router.js';

const BATAS_TAMPIL = 200;

export async function mount(wadah) {
  const halaman = h('.halaman');
  const areaFilter = h('.kartu.kartu--rapat');
  const areaDaftar = h('.tumpuk');

  let filter = {
    dari: '', sampai: '', accountId: '', kategoriId: '',
    nominalMin: null, nominalMaks: null, kataKunci: '', arah: '',
  };
  let batas = BATAS_TAMPIL;

  const lepas = on(EVENT.DATA_BERUBAH, () => render());

  const [akun, kategori, upload] = await Promise.all([
    akunRepo.daftar(), kategoriRepo.daftar(), uploadRepo.daftar(),
  ]);
  const petaUpload = new Map(upload.map((u) => [u.id, u]));

  halaman.append(
    h('.halaman__kepala', null, [
      h('div', null, [
        h('.halaman__judul', { text: 'Transaksi' }),
        h('.halaman__ket', {
          text: 'Seluruh transaksi dari e-statement dan catatan kas manual. Koreksi dilakukan langsung di tab "Transaksi" pada Google Sheets.',
        }),
      ]),
    ]),
    areaFilter,
    areaDaftar,
  );
  wadah.appendChild(halaman);

  function renderFilter() {
    const cariInput = h('input', {
      type: 'search',
      placeholder: 'Cari deskripsi atau catatan…',
      value: filter.kataKunci,
      oninput: debounce((e) => { filter.kataKunci = e.target.value; batas = BATAS_TAMPIL; render(); }, 300),
    });

    // Di HP, deretan filter memenuhi satu layar penuh dan menutupi daftar
    // transaksinya. Karena itu hanya kotak pencarian yang selalu tampak;
    // sisanya dilipat, dan di layar lebar tetap terbuka.
    const layarLebar = window.matchMedia('(min-width: 768px)').matches;
    const jumlahAktif = hitungFilterAktif(filter);

    ganti(areaFilter, [
      h('.filter', null, [
        h('.filter__cari', null, [ikon('cari', 18), cariInput]),
        h('details.lipat', { open: layarLebar || jumlahAktif > 0 }, [
          h('summary', { text: jumlahAktif ? `Filter lanjutan (${jumlahAktif} aktif)` : 'Filter lanjutan' }),
          h('.filter__baris.mt-3', null, [
            h('div', null, [h('label', { text: 'Dari tanggal' }), h('input', {
              type: 'date', value: filter.dari,
              onchange: (e) => { filter.dari = e.target.value; render(); },
            })]),
            h('div', null, [h('label', { text: 'Sampai tanggal' }), h('input', {
              type: 'date', value: filter.sampai,
              onchange: (e) => { filter.sampai = e.target.value; render(); },
            })]),
            h('div', null, [h('label', { text: 'Rekening' }), h('select', {
              onchange: (e) => { filter.accountId = e.target.value; render(); },
            }, [
              h('option', { value: '', selected: !filter.accountId, text: 'Semua rekening' }),
              ...akun.map((a) => h('option', {
                value: a.id, selected: a.id === filter.accountId,
                text: `${a.bank} ${a.nomorRekening || ''}`.trim(),
              })),
            ])]),
            h('div', null, [h('label', { text: 'Kategori' }), h('select', {
              onchange: (e) => { filter.kategoriId = e.target.value; render(); },
            }, [
              h('option', { value: '', selected: !filter.kategoriId, text: 'Semua kategori' }),
              ...kategori.map((k) => h('option', {
                value: k.id, selected: k.id === filter.kategoriId, text: `${k.ikon} ${k.nama}`,
              })),
            ])]),
            h('div', null, [h('label', { text: 'Nominal minimal' }), h('input', {
              type: 'text', inputmode: 'numeric', placeholder: 'mis. 100.000',
              value: filter.nominalMin === null ? '' : angka(filter.nominalMin, 0),
              onchange: (e) => {
                filter.nominalMin = e.target.value.trim() ? toNum(e.target.value) : null;
                render();
              },
            })]),
            h('div', null, [h('label', { text: 'Nominal maksimal' }), h('input', {
              type: 'text', inputmode: 'numeric', placeholder: 'mis. 5.000.000',
              value: filter.nominalMaks === null ? '' : angka(filter.nominalMaks, 0),
              onchange: (e) => {
                filter.nominalMaks = e.target.value.trim() ? toNum(e.target.value) : null;
                render();
              },
            })]),
            h('div', null, [h('label', { text: 'Arah' }), h('select', {
              onchange: (e) => { filter.arah = e.target.value; render(); },
            }, [
              h('option', { value: '', selected: !filter.arah, text: 'Masuk & keluar' }),
              h('option', { value: 'masuk', selected: filter.arah === 'masuk', text: 'Hanya masuk' }),
              h('option', { value: 'keluar', selected: filter.arah === 'keluar', text: 'Hanya keluar' }),
            ])]),
          ]),
          jumlahAktif ? h('.baris.bungkus.mt-3', null, [
            h('button.btn-halus.btn-kecil', {
              type: 'button',
              onclick: () => {
                filter = {
                  dari: '', sampai: '', accountId: '', kategoriId: '',
                  nominalMin: null, nominalMaks: null, kataKunci: '', arah: '',
                };
                batas = BATAS_TAMPIL;
                render();
              },
            }, 'Bersihkan filter'),
          ]) : null,
        ]),
      ]),
    ]);
  }

  async function render() {
    renderFilter();

    const petaAkun = new Map(akun.map((a) => [a.id, a]));
    const petaKategori = new Map(kategori.map((k) => [k.id, k]));
    const semua = await trxRepo.cari(filter);
    const urut = [...semua].reverse(); // terbaru di atas
    const tampil = urut.slice(0, batas);
    const arus = ringkasArus(semua);

    ganti(areaDaftar, [
      h('.grid-kpi', null, [
        kpi('Jumlah transaksi', String(semua.length), 'netral'),
        kpi('Total masuk', rupiah(arus.masuk), 'masuk'),
        kpi('Total keluar', rupiah(arus.keluar), 'keluar'),
        kpi('Selisih', rupiah(arus.netto, { tanda: true }), arus.netto >= 0 ? 'masuk' : 'keluar'),
      ]),

      dataView({
        kolom: kolom(petaAkun, petaKategori, petaUpload),
        baris: tampil,
        kosong: 'Tidak ada transaksi yang cocok',
        kosongKet: semua.length === 0 && !filter.kataKunci
          ? 'Upload e-statement untuk mulai membukukan.'
          : 'Coba longgarkan filter atau kata kuncinya.',
        kelasBaris: (t) => (t.transferInternal ? 'baris--duplikat' : ''),
      }),

      tampil.length < urut.length
        ? h('.tengah.mt-3', null, h('button', {
          type: 'button',
          onclick: () => { batas += BATAS_TAMPIL; render(); },
        }, `Tampilkan ${Math.min(BATAS_TAMPIL, urut.length - tampil.length)} transaksi lagi (${urut.length - tampil.length} tersisa)`))
        : null,
    ]);
  }

  await render();
  return { unmount: lepas };
}

/** Berapa filter yang sedang dipakai, di luar kotak pencarian. */
function hitungFilterAktif(filter) {
  return [
    filter.dari, filter.sampai, filter.accountId, filter.kategoriId, filter.arah,
    filter.nominalMin === null ? '' : filter.nominalMin,
    filter.nominalMaks === null ? '' : filter.nominalMaks,
  ].filter((v) => v !== '' && v !== null && v !== undefined).length;
}

function kpi(label, nilai, jenis) {
  return h(`.kpi.kpi--${jenis}`, null, [
    h('.kpi__label', { text: label }),
    h('.kpi__nilai', { text: nilai }),
  ]);
}

function kolom(petaAkun, petaKategori, petaUpload) {
  return [
    { kunci: 'tanggal', judul: 'Tanggal', lebar: '110px', render: (t) => tanggalTampil(t.tanggal) },
    {
      kunci: 'deskripsi', judul: 'Deskripsi', kartu: 'utama', lebar: '240px',
      render: (t) => h('div', null, [
        h('div.putus', { text: t.deskripsi || '(tanpa keterangan)' }),
        t.transferInternal ? h('span.lencana', { text: 'Transfer internal' }) : null,
        t.sumber === SUMBER.MANUAL ? h('span.lencana.lencana--info', { text: 'Manual' }) : null,
      ]),
    },
    {
      kunci: 'debit', judul: 'Debit', kanan: true, angka: true, lebar: '120px', kartu: false,
      render: (t) => (t.nominal < 0 ? h('span.keluar', { text: rupiah(-t.nominal) }) : ''),
    },
    {
      kunci: 'kredit', judul: 'Kredit', kanan: true, angka: true, lebar: '120px', kartu: 'nilai',
      render: (t) => (t.nominal > 0 ? h('span.masuk', { text: rupiah(t.nominal) }) : ''),
      // Di kartu, kolom ini jadi satu-satunya tempat nominal muncul,
      // jadi nilainya ditampilkan lengkap dengan tandanya.
      renderKartu: (t) => h(`span.${t.nominal >= 0 ? 'masuk' : 'keluar'}`, {
        text: rupiah(t.nominal, { tanda: true }),
      }),
    },
    {
      kunci: 'saldo', judul: 'Saldo', kanan: true, angka: true, lebar: '130px',
      render: (t) => (t.saldo === null || t.saldo === undefined ? '—' : rupiah(t.saldo)),
    },
    {
      kunci: 'kategori', judul: 'Kategori', lebar: '190px',
      render: (t) => {
        const k = petaKategori.get(t.kategoriId);
        return k ? `${k.ikon} ${k.nama}` : '—';
      },
    },
    {
      kunci: 'rekening', judul: 'Rekening', lebar: '150px',
      render: (t) => {
        const a = petaAkun.get(t.accountId);
        return a ? `${a.bank} ${a.nomorRekening || ''}`.trim() : '—';
      },
    },
    {
      kunci: 'sumber', judul: 'File Sumber', lebar: '170px',
      render: (t) => {
        const u = petaUpload.get(t.uploadedFileId);
        if (!u) return t.sumber === SUMBER.MANUAL ? 'Input manual' : '—';
        return h('button.btn-halus.btn-kecil.putus', {
          type: 'button',
          style: { padding: '2px 6px', minHeight: '28px', fontSize: '.78rem' },
          title: 'Buka riwayat upload',
          onclick: () => pergiKe('riwayat'),
        }, u.namaFile);
      },
    },
  ];
}
