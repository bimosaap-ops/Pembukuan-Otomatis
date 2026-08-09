/**
 * Dashboard.
 *
 * Susunannya mengikuti urutan pertanyaan yang sebenarnya diajukan pengguna:
 *
 *   1. "Sekarang uang saya berapa?"        -> satu angka besar, dengan rincian rekening
 *   2. "Masuk dan keluarnya berapa?"       -> dua angka pendamping di panel yang sama
 *   3. "Bulan-bulan ini untung atau rugi?" -> arus kas bersih per bulan
 *   4. "Habisnya ke kategori apa saja?"    -> peringkat kategori dengan bar
 *
 * Tiga keputusan tampilan yang disengaja:
 *
 * - Saldo, pemasukan, dan pengeluaran berada dalam satu panel, bukan tiga kartu
 *   terpisah. Ketiganya satu kalimat, dan hanya angka saldo yang dibuat besar:
 *   kartu-kartu berbobot sama membuat mata tidak tahu harus melihat ke mana.
 * - Grafiknya arus kas *bersih* — satu batang naik atau turun dari garis nol —
 *   bukan pasangan batang pemasukan dan pengeluaran. Membandingkan tinggi dua
 *   batang yang terpisah jarak jauh lebih berat dibaca daripada melihat satu
 *   batang berada di atas atau di bawah nol. Perbandingan dua deret itu tetap
 *   tersedia di halaman Analitik bagi yang memerlukannya.
 * - Kategori ditampilkan sebagai baris berbar, bukan donat. Yang ditanyakan
 *   "mana yang paling besar", dan panjang batang jauh lebih cepat dibandingkan
 *   daripada sudut potongan lingkaran.
 */

import { h, ikon, ganti } from '../../core/dom.js';
import { rupiah, rupiahRingkas, maskRekening } from '../../core/format.js';
import { on, EVENT } from '../../core/events.js';
import * as akunRepo from '../../data/repo/accounts.js';
import * as trxRepo from '../../data/repo/transactions.js';
import * as kategoriRepo from '../../data/repo/categories.js';
import {
  ringkasArus, arusPerBulan, perKategori, totalSaldo, rataRataBulanan,
} from '../../domain/analytics.js';
import { grafikBatang } from '../../charts/bar.js';
import { filterRingkas, periodeIkutData } from '../components/filterbar.js';
import { pergiKe } from '../router.js';

export async function mount(wadah) {
  const halaman = h('.halaman');
  const isi = h('.tumpuk-pias');
  // Periode awal mengikuti data yang ada, bukan tanggal hari ini.
  let filter = { ...periodeIkutData(await trxRepo.rentangTersedia()), accountId: '' };

  const lepas = on(EVENT.DATA_BERUBAH, () => render());

  halaman.append(
    h('.halaman__kepala', null, [
      h('div', null, [
        h('.halaman__judul', { text: 'Dashboard' }),
        h('.halaman__ket', { text: 'Ringkasan dari seluruh e-statement yang sudah di-upload.' }),
      ]),
      h('button.btn-primary.btn-kecil', { type: 'button', onclick: () => pergiKe('upload') },
        [h('span', { text: 'Upload statement' }), ikon('upload', 15)]),
    ]),
    isi,
  );
  wadah.appendChild(halaman);

  async function render() {
    const [akun, petaKategori] = await Promise.all([akunRepo.daftar(), kategoriRepo.peta()]);

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
    const kategoriKeluar = perKategori(periode, petaKategori, 'keluar');

    /* Sebagian statement (mis. unduhan "Mutasi Transaksi") tidak memuat kolom saldo.
       Untuk rekening seperti itu, angka saldo sebenarnya hanya selisih mutasi yang
       pernah di-upload — bukan saldo rekening. Perbedaan ini harus dinyatakan. */
    const adaSaldoResmi = semua.some((t) => t.saldo !== null && t.saldo !== undefined);
    const adaSaldoAwal = akunTampil.some((a) => Number(a.saldoAwal) !== 0);
    const saldoBelumBerpatokan = semua.length > 0 && !adaSaldoResmi && !adaSaldoAwal;

    ganti(isi, [
      /* Pemilih periode sengaja tidak dibungkus panel: ia alat, bukan isi.
         Diberi panel sendiri, ia jadi kotak besar berisi satu baris tombol dan
         mendorong angka saldo turun dari layar pertama. */
      filterRingkas(filter, akun, (baru) => { filter = { ...filter, ...baru }; render(); }),

      kartuRingkasan(akunTampil, arus, perBulan, saldoBelumBerpatokan),

      stripSelisih(arus),

      h('.grid-2.grid-2--lebar-kiri', null, [
        kartuArusKas(perBulan),
        kartuPengeluaranKategori(kategoriKeluar, arus.keluar),
      ]),
    ]);
  }

  await render();
  return { unmount: lepas };
}

/* ==========================================================================
   Blok-blok penyusun
   ========================================================================== */

/**
 * Panel ringkasan: saldo besar di kiri, pemasukan dan pengeluaran mendampingi.
 */
function kartuRingkasan(akun, arus, perBulan, belumBerpatokan) {
  return h('.kartu', null, h('.ringkas', null, [
    h('div', null, [
      h('.ringkas__label', null, [ikon('rekening', 13), h('span', { text: 'Total Saldo' })]),
      h('.ringkas__nilai', { text: rupiah(totalSaldo(akun)) }),
      belumBerpatokan
        ? h('.ringkas__sub', { text: 'Baru selisih mutasi — isi Saldo Awal di menu Rekening agar sesuai saldo bank.' })
        : null,

      h('.ringkas__akun', null, [
        ...akun.map((a) => h('div', null, [
          h('.saldo-akun__nama', { text: `${a.bank} ${maskRekening(a.nomorRekening)}`.trim() }),
          h('.saldo-akun__nilai', { text: rupiah(a.saldo) }),
        ])),
        tautan('Kelola rekening', 'rekening', { marginLeft: 'auto' }),
      ]),
    ]),

    h('div', null, [
      h('.ringkas__label', { text: 'Pemasukan' }),
      h('.ringkas__angka.masuk', { text: rupiahRingkas(arus.masuk) }),
      h('.ringkas__sub', { text: `${bulanAktif(perBulan)} bulan tercakup` }),
    ]),

    h('div', null, [
      h('.ringkas__label', { text: 'Pengeluaran' }),
      h('.ringkas__angka.keluar', { text: rupiahRingkas(arus.keluar) }),
      h('.ringkas__sub', { text: `Rata-rata ${rupiahRingkas(rataRataBulanan(perBulan, 'keluar'))}/bulan` }),
    ]),
  ]));
}

/** Satu baris tipis: hasil akhir periode berjalan, tanpa kartu penuh. */
function stripSelisih(arus) {
  return h('.kartu.strip', null, [
    h('span', { text: 'Selisih periode berjalan' }),
    h(`span.strip__nilai.${arus.netto >= 0 ? 'masuk' : 'keluar'}`, {
      text: `${rupiah(arus.netto, { tanda: true })} · ${new Intl.NumberFormat('id-ID').format(arus.jumlah)} transaksi`,
    }),
  ]);
}

function kartuArusKas(perBulan) {
  const naik = perBulan.filter((b) => b.netto > 0).length;
  const turun = perBulan.filter((b) => b.netto < 0).length;

  return h('.kartu', null, [
    h('.kartu__kepala', null, [
      h('.kartu__judul', { text: 'Arus Kas Bersih' }),
      tautan('Analitik', 'analitik'),
    ]),
    grafikBatang(
      perBulan.map((b) => ({ label: b.label, nilai: [b.netto] })),
      {
        seri: [{ nama: 'Arus kas bersih', warna: 'var(--surplus)' }],
        /* Bulan surplus memakai warna tinta yang tenang, bulan defisit memakai
           warna aksen. Tandanya jadi terbaca sebelum sumbunya dilihat. */
        warnaNilai: (v) => (v < 0 ? 'var(--keluar)' : 'var(--surplus)'),
        judul: 'Arus kas bersih per bulan',
        kosong: 'Belum ada transaksi pada periode ini.',
      },
    ),
    perBulan.length
      ? h('.kartu__ket.mt-3', { text: `${naik} bulan surplus · ${turun} bulan defisit` })
      : null,
  ]);
}

function kartuPengeluaranKategori(kategori, totalKeluar) {
  /* Enam kategori: cukup untuk menangkap hampir seluruh pengeluaran, dan
     tingginya seimbang dengan grafik di sebelahnya. Sisanya di halaman Analitik. */
  const atas = kategori.slice(0, 6);
  const terbesar = atas.length ? atas[0].total : 0;

  return h('.kartu', null, [
    h('.kartu__kepala', null, [
      h('div', null, [
        h('.kartu__judul', { text: 'Pengeluaran per Kategori' }),
        kategori.length
          ? h('.kartu__ket', { text: `${kategori.length} kategori terpakai pada periode ini` })
          : null,
      ]),
      tautan('Transaksi', 'transaksi'),
    ]),

    atas.length
      ? h('div', null, atas.map((k) => barisKategori(k, terbesar, totalKeluar)))
      : h('.dv__kosong', null, 'Belum ada pengeluaran pada periode ini.'),
  ]);
}

/**
 * Panjang bar dibandingkan terhadap kategori terbesar, bukan terhadap total.
 * Dibandingkan total, kategori terbesar pun sering hanya mengisi seperempat bar
 * dan seluruh baris tampak sama pendeknya — persis perbandingan yang ingin
 * dilihat justru jadi hilang. Persentase terhadap total tetap ditulis sebagai
 * angka di bawahnya.
 */
function barisKategori(k, terbesar, totalKeluar) {
  return h('.kat-baris', null, [
    h('.kat-baris__utama', null, [
      h('.kat-baris__nama', { text: k.namaBersih }),
      h('.kat-baris__bar', null,
        h('.kat-baris__isi', { style: { width: `${terbesar ? (k.total / terbesar) * 100 : 0}%` } })),
      h('.kat-baris__ket', { text: `${k.jumlah} transaksi · ${persenDari(k.total, totalKeluar)} dari total` }),
    ]),
    h('.kat-baris__nilai', { text: rupiahRingkas(k.total) }),
  ]);
}

/** Tautan teks bergaya rancangan: label diikuti panah, bukan tombol berkotak. */
function tautan(label, rute, gaya = null) {
  return h('button.tautan', {
    type: 'button',
    style: gaya,
    onclick: () => pergiKe(rute),
  }, [h('span', { text: label }), h('span', { text: '→', 'aria-hidden': 'true' })]);
}

function persenDari(bagian, total) {
  if (!total) return '0%';
  return `${Math.round((bagian / total) * 100)}%`;
}

function bulanAktif(perBulan) {
  return perBulan.filter((b) => b.masuk || b.keluar).length;
}

function kartuKosong() {
  return h('.kartu.dv__kosong', null, [
    ikon('upload', 30),
    h('strong', { text: 'Pembukuan masih kosong' }),
    h('div.redup-2', { text: 'Upload e-statement PDF pertama Anda. Bank, nomor rekening, dan seluruh transaksinya akan dibaca otomatis.' }),
    h('button.btn-primary.mt-3', { type: 'button', onclick: () => pergiKe('upload') },
      [h('span', { text: 'Upload e-Statement' }), ikon('upload', 18)]),
  ]);
}
