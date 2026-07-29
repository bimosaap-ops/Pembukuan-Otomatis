/**
 * Halaman Transaksi.
 *
 * Kolom: Tanggal, Deskripsi, Debit, Kredit, Saldo, Kategori, Rekening, File Sumber.
 * Filter: rentang tanggal, rekening, kategori, rentang nominal, dan kata kunci.
 * Di layar HP tabel berubah jadi daftar kartu (diatur `data-view` lewat CSS).
 */

import { h, ikon, ganti, debounce } from '../../core/dom.js';
import { rupiah, toNum, angka } from '../../core/format.js';
import { tanggalTampil, hariIni } from '../../core/dates.js';
import { on, emit, EVENT } from '../../core/events.js';
import * as akunRepo from '../../data/repo/accounts.js';
import * as trxRepo from '../../data/repo/transactions.js';
import * as uploadRepo from '../../data/repo/uploads.js';
import * as kategoriRepo from '../../data/repo/categories.js';
import { buatTransaksi, SUMBER, JENIS_AKUN } from '../../domain/entities.js';
import { hitungBaseHash, hashFinal } from '../../domain/dedupe.js';
import { saranPola, tambahPola, tentukanKategori } from '../../domain/categorize.js';
import { ringkasArus } from '../../domain/analytics.js';
import { dataView } from '../components/data-view.js';
import { bukaModal, konfirmasi } from '../components/modal.js';
import { toastSukses, toastGagal } from '../components/toast.js';
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
        h('.halaman__ket', { text: 'Seluruh transaksi dari e-statement dan catatan kas manual.' }),
      ]),
      h('button.btn-primary.btn-kecil', {
        type: 'button',
        onclick: () => bukaFormManual(null, akun, kategori, () => render()),
      }, [ikon('tambah', 17), h('span', { text: 'Transaksi Manual' })]),
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
        kolom: kolom(petaAkun, petaKategori, petaUpload, kategori, render),
        baris: tampil,
        kosong: 'Tidak ada transaksi yang cocok',
        kosongKet: semua.length === 0 && !filter.kataKunci
          ? 'Upload e-statement atau tambahkan transaksi manual untuk mulai membukukan.'
          : 'Coba longgarkan filter atau kata kuncinya.',
        kelasBaris: (t) => (t.transferInternal ? 'baris--duplikat' : ''),
        aksi: (t) => [
          h('button.btn-kecil', {
            type: 'button',
            onclick: () => bukaFormManual(t, akun, kategori, render),
          }, [ikon('edit', 15), 'Ubah']),
          h('button.btn-kecil.btn-bahaya', {
            type: 'button',
            onclick: () => hapus(t, render),
          }, [ikon('hapus', 15)]),
        ],
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

function kolom(petaAkun, petaKategori, petaUpload, daftarKategori, render) {
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
      kunci: 'debit', judul: 'Debit', kanan: true, angka: true, lebar: '120px',
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
      render: (t) => h('select', {
        style: { minHeight: '36px', fontSize: '.82rem', padding: '4px 8px' },
        onchange: (e) => gantiKategori(t, e.target.value, daftarKategori, render),
      }, daftarKategori
        .filter((k) => (t.nominal >= 0 ? k.tipe === 'pemasukan' : k.tipe === 'pengeluaran'))
        .map((k) => h('option', { value: k.id, selected: k.id === t.kategoriId, text: `${k.ikon} ${k.nama}` }))),
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

/**
 * Mengganti kategori satu transaksi, lalu menawarkan agar aturan yang sama
 * dipakai untuk transaksi serupa — inilah cara aplikasi "belajar" dari koreksi.
 */
async function gantiKategori(trx, kategoriId, daftarKategori, render) {
  await trxRepo.simpanSatu({ ...trx, kategoriId, diubahPada: new Date().toISOString() });

  const pola = saranPola(trx.deskripsi);
  const semua = await trxRepo.semua();
  const serupa = semua.filter((t) => t.id !== trx.id
    && t.kategoriId !== kategoriId
    && String(t.deskripsi).toUpperCase().includes(pola));

  emit(EVENT.DATA_BERUBAH, { sumber: 'kategori' });

  if (!pola || serupa.length === 0) {
    toastSukses('Kategori diperbarui.');
    return;
  }

  const kategori = daftarKategori.find((k) => k.id === kategoriId);
  const ya = await konfirmasi({
    judul: 'Terapkan ke transaksi serupa?',
    pesan: `Ada ${serupa.length} transaksi lain yang deskripsinya memuat "${pola}". Ubah semuanya menjadi "${kategori?.nama || 'kategori ini'}" dan ingat aturannya untuk upload berikutnya?`,
    tombolYa: `Ya, ubah ${serupa.length} transaksi`,
  });

  if (!ya) { render(); return; }

  await trxRepo.ubahKategoriBanyak(serupa.map((t) => t.id), kategoriId);
  if (kategori) await kategoriRepo.simpanKategori(tambahPola(kategori, pola));
  toastSukses(`${serupa.length} transaksi diperbarui. Kata kunci "${pola}" diingat untuk upload berikutnya.`);
  emit(EVENT.DATA_BERUBAH, { sumber: 'kategori' });
}

async function hapus(trx, render) {
  const ya = await konfirmasi({
    judul: 'Hapus transaksi?',
    pesan: `"${trx.deskripsi}" sebesar ${rupiah(trx.nominal, { tanda: true })} akan dihapus dari pembukuan.`,
    tombolYa: 'Hapus',
    bahaya: true,
  });
  if (!ya) return;

  await trxRepo.hapusTransaksi(trx.id);
  await akunRepo.hitungUlangSaldo(trx.accountId);
  toastSukses('Transaksi dihapus.');
  emit(EVENT.DATA_BERUBAH, { sumber: 'hapus-transaksi' });
  render();
}

/* ==========================================================================
   Form transaksi manual (kas/tunai) — juga dipakai untuk menyunting
   ========================================================================== */

export function bukaFormManual(trx, akun, daftarKategori, selesai) {
  const ubah = Boolean(trx);
  const akunKas = akun.filter((a) => a.jenis === JENIS_AKUN.KAS);
  const akunPilihan = akun.length ? akun : [];

  const fTanggal = h('input', { type: 'date', value: trx?.tanggal || hariIni() });
  const fArah = h('select', null, [
    h('option', { value: 'keluar', selected: !trx || trx.nominal < 0, text: 'Pengeluaran' }),
    h('option', { value: 'masuk', selected: trx && trx.nominal > 0, text: 'Pemasukan' }),
  ]);
  const fNominal = h('input', {
    type: 'text', inputmode: 'decimal', placeholder: '0',
    value: trx ? angka(Math.abs(trx.nominal), 0) : '',
  });
  const fDeskripsi = h('input', { type: 'text', value: trx?.deskripsi || '', placeholder: 'mis. Beli material tunai' });
  const fAkun = h('select', null, akunPilihan.map((a) => h('option', {
    value: a.id,
    selected: trx ? a.id === trx.accountId : a.jenis === JENIS_AKUN.KAS,
    text: `${a.bank} ${a.nomorRekening || ''} ${a.jenis === JENIS_AKUN.KAS ? '(kas)' : ''}`.replace(/\s+/g, ' ').trim(),
  })));
  const fKategori = h('select');
  const fCatatan = h('input', { type: 'text', value: trx?.catatan || '', placeholder: 'Opsional' });
  const fTransfer = h('input', { type: 'checkbox', checked: Boolean(trx?.transferInternal) });

  function isiKategori() {
    const tipe = fArah.value === 'masuk' ? 'pemasukan' : 'pengeluaran';
    ganti(fKategori, daftarKategori
      .filter((k) => k.tipe === tipe)
      .map((k) => h('option', { value: k.id, selected: k.id === trx?.kategoriId, text: `${k.ikon} ${k.nama}` })));
  }
  isiKategori();
  fArah.addEventListener('change', isiKategori);

  const peringatanKas = !akunKas.length && !ubah
    ? h('.info-kotak', null, [
      ikon('cek', 18),
      h('div', { text: 'Belum ada akun Kas Tunai. Transaksi manual bisa dimasukkan ke rekening bank, atau buat akun kas lebih dulu di menu Rekening.' }),
    ])
    : null;

  const m = bukaModal({
    judul: ubah ? 'Ubah transaksi' : 'Transaksi manual',
    isi: h('.tumpuk', null, [
      peringatanKas,
      h('.form-grid', null, [
        h('div', null, [h('label', { text: 'Tanggal' }), fTanggal]),
        h('div', null, [h('label', { text: 'Jenis' }), fArah]),
        h('div.penuh', null, [h('label', { text: 'Deskripsi' }), fDeskripsi]),
        h('div', null, [h('label', { text: 'Nominal (Rp)' }), fNominal]),
        h('div', null, [h('label', { text: 'Rekening / Kas' }), fAkun]),
        h('div', null, [h('label', { text: 'Kategori' }), fKategori]),
        h('div', null, [h('label', { text: 'Catatan' }), fCatatan]),
        h('div.penuh', null, h('label.baris', { style: { fontWeight: '600' } }, [
          fTransfer,
          h('span', { text: 'Transfer internal (pindah dana antar rekening sendiri, tidak dihitung sebagai pemasukan/pengeluaran)' }),
        ])),
      ]),
    ]),
    aksi: [
      h('button', { type: 'button', onclick: () => m.tutup() }, 'Batal'),
      h('button.btn-primary', { type: 'button', onclick: () => simpan() }, ubah ? 'Simpan perubahan' : 'Tambah transaksi'),
    ],
  });

  async function simpan() {
    const besar = Math.abs(toNum(fNominal.value));
    if (!besar) { toastGagal('Nominal harus lebih dari nol.'); return; }
    if (!fAkun.value) { toastGagal('Pilih rekening atau kas tujuan.'); return; }

    const nominal = fArah.value === 'masuk' ? besar : -besar;
    const akunTerpilih = akun.find((a) => a.id === fAkun.value);
    const deskripsi = fDeskripsi.value.trim() || (fArah.value === 'masuk' ? 'Pemasukan manual' : 'Pengeluaran manual');

    const baseHash = await hitungBaseHash({
      bank: akunTerpilih?.bank || '',
      nomorRekening: akunTerpilih?.nomorRekening || '',
      tanggal: fTanggal.value,
      deskripsi,
      nominal,
    });

    const data = buatTransaksi({
      ...(trx || {}),
      accountId: fAkun.value,
      tanggal: fTanggal.value,
      deskripsi,
      nominal,
      // Transaksi manual tidak punya kolom saldo dari bank.
      saldo: null,
      kategoriId: fKategori.value || tentukanKategori(deskripsi, nominal, daftarKategori),
      catatan: fCatatan.value.trim(),
      transferInternal: fTransfer.checked,
      sumber: SUMBER.MANUAL,
      baseHash,
      // Hash manual diberi penanda waktu agar tidak pernah bentrok dengan
      // transaksi hasil parsing yang kebetulan identik.
      hash: trx?.hash || hashFinal(baseHash, `m${Date.now()}`),
      diubahPada: trx ? new Date().toISOString() : '',
    });

    try {
      await trxRepo.simpanSatu(data);
      await akunRepo.hitungUlangSaldo(data.accountId);
      if (trx && trx.accountId !== data.accountId) await akunRepo.hitungUlangSaldo(trx.accountId);
      toastSukses(trx ? 'Transaksi diperbarui.' : 'Transaksi ditambahkan.');
      m.tutup();
      emit(EVENT.DATA_BERUBAH, { sumber: 'manual' });
      selesai?.();
    } catch (e) {
      toastGagal(`Gagal menyimpan: ${e.message}`);
    }
  }
}
