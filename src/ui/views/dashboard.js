/**
 * Dashboard.
 *
 * Susunannya mengikuti urutan pertanyaan yang sebenarnya diajukan pengguna:
 *
 *   1. "Sekarang uang saya berapa?"        -> satu angka besar, dengan rincian rekening
 *   2. "Bulan-bulan ini untung atau rugi?" -> arus kas bersih per bulan
 *   3. "Habisnya ke kategori apa saja?"    -> komposisi dan peringkat kategori
 *
 * Dua keputusan tampilan yang disengaja:
 *
 * - Hanya satu angka yang dibuat besar. Empat kartu berbobot sama membuat mata
 *   tidak tahu harus melihat ke mana, padahal saldo hampir selalu yang dicari.
 * - Grafiknya arus kas *bersih* — satu batang naik atau turun dari garis nol —
 *   bukan pasangan batang pemasukan dan pengeluaran. Membandingkan tinggi dua
 *   batang yang terpisah jarak jauh lebih berat dibaca daripada melihat satu
 *   batang berada di atas atau di bawah nol. Perbandingan dua deret itu tetap
 *   tersedia di halaman Analitik bagi yang memerlukannya.
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
import { grafikBatang, grafikBatangHorizontal } from '../../charts/bar.js';
import { grafikDonat } from '../../charts/donut.js';
import { filterRingkas, periodeIkutData } from '../components/filterbar.js';
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
        h('.halaman__ket', { text: 'Ringkasan dari seluruh e-statement yang sudah di-upload.' }),
      ]),
      h('button.btn-primary.btn-kecil', { type: 'button', onclick: () => pergiKe('upload') },
        [ikon('upload', 17), h('span', { text: 'Upload statement' })]),
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
      h('.kartu.kartu--rapat', null,
        filterRingkas(filter, akun, (baru) => { filter = { ...filter, ...baru }; render(); })),

      kartuSaldo(akunTampil, saldoBelumBerpatokan),

      h('.grid-stat', null, [
        statTenang('Pemasukan', rupiahRingkas(arus.masuk), 'masuk',
          `${bulanAktif(perBulan)} bulan tercakup`),
        statTenang('Pengeluaran', rupiahRingkas(arus.keluar), 'keluar',
          `Rata-rata ${rupiahRingkas(rataRataBulanan(perBulan, 'keluar'))}/bulan`),
        statTenang('Selisih', rupiahRingkas(arus.netto), arus.netto >= 0 ? 'masuk' : 'keluar',
          `${new Intl.NumberFormat('id-ID').format(arus.jumlah)} transaksi`),
      ]),

      kartuArusKas(perBulan),

      kartuPengeluaranKategori(kategoriKeluar, arus.keluar),
    ]);
  }

  await render();
  return { unmount: lepas };
}

/* ==========================================================================
   Blok-blok penyusun
   ========================================================================== */

function kartuSaldo(akun, belumBerpatokan) {
  return h('.kartu.saldo-utama', null, [
    h('.saldo-utama__label', null, [ikon('rekening', 15), h('span', { text: 'Total Saldo' })]),
    h('.saldo-utama__nilai', { text: rupiah(totalSaldo(akun)) }),
    belumBerpatokan
      ? h('.saldo-utama__ket', { text: 'Baru selisih mutasi — isi Saldo Awal di menu Rekening agar sesuai saldo bank.' })
      : null,

    h('.saldo-utama__akun', null, [
      ...akun.map((a) => h('.saldo-akun', null, [
        h('.saldo-akun__nama', { text: `${a.bank} ${maskRekening(a.nomorRekening)}`.trim() }),
        h('.saldo-akun__nilai', { text: rupiah(a.saldo) }),
      ])),
      h('button.btn-halus.btn-kecil', {
        type: 'button',
        style: { marginLeft: 'auto', alignSelf: 'center' },
        onclick: () => pergiKe('rekening'),
      }, 'Kelola rekening'),
    ]),
  ]);
}

function statTenang(label, nilai, jenis, sub) {
  return h('.stat-tenang', null, [
    h('.stat-tenang__label', { text: label }),
    h(`.stat-tenang__nilai.${jenis}`, { text: nilai }),
    h('.stat-tenang__sub', { text: sub }),
  ]);
}

function kartuArusKas(perBulan) {
  const naik = perBulan.filter((b) => b.netto > 0).length;
  const turun = perBulan.filter((b) => b.netto < 0).length;

  return h('.kartu', null, [
    h('.kartu__kepala', null, [
      h('div', null, [
        h('.kartu__judul', { text: 'Arus Kas Bersih' }),
        h('.kartu__ket', { text: 'Batang di atas garis berarti bulan itu surplus, di bawah garis berarti defisit' }),
      ]),
      h('button.btn-halus.btn-kecil', { type: 'button', onclick: () => pergiKe('analitik') }, 'Analitik'),
    ]),
    grafikBatang(
      perBulan.map((b) => ({ label: b.label, nilai: [b.netto] })),
      {
        seri: [{ nama: 'Arus kas bersih', warna: 'var(--c1)' }],
        judul: 'Arus kas bersih per bulan',
        kosong: 'Belum ada transaksi pada periode ini.',
      },
    ),
    perBulan.length ? h('.dv__kaki', null, [
      h('div.redup', { text: `${naik} bulan surplus · ${turun} bulan defisit` }),
    ]) : null,
  ]);
}

/**
 * Pengeluaran per kategori, dibaca dua cara sekaligus.
 *
 * Donat menjawab "berapa bagiannya" — proporsi paling cepat ditangkap dari luas
 * potongan. Peringkat batang menjawab "berapa nilainya dan mana yang terbesar" —
 * panjang batang jauh lebih mudah dibandingkan daripada sudut. Keduanya dijadikan
 * satu kartu, bukan dua, supaya terbaca sebagai satu gagasan.
 */
function kartuPengeluaranKategori(kategori, totalKeluar) {
  /* Enam kategori: cukup untuk menangkap hampir seluruh pengeluaran, dan
     tingginya seimbang dengan donat di sebelahnya sehingga tidak menyisakan
     ruang kosong. Sisanya bisa dilihat di halaman Analitik. */
  const atas = kategori.slice(0, 6);

  return h('.kartu', null, [
    h('.kartu__kepala', null, [
      h('div', null, [
        h('.kartu__judul', { text: 'Pengeluaran per Kategori' }),
        h('.kartu__ket', {
          text: kategori.length
            ? `Ke mana uang paling banyak keluar · ${kategori.length} kategori terpakai`
            : 'Ke mana uang paling banyak keluar',
        }),
      ]),
      h('button.btn-halus.btn-kecil', { type: 'button', onclick: () => pergiKe('transaksi') }, 'Lihat transaksi'),
    ]),

    atas.length
      ? h('.grid-2', { style: { alignItems: 'center' } }, [
        grafikDonat(
          atas.map((k) => ({ label: k.namaBersih, nilai: k.total, warna: k.warna })),
          { judul: 'Komposisi pengeluaran per kategori', labelTengah: 'Total keluar' },
        ),
        grafikBatangHorizontal(
          /* Peringkat memakai satu warna: yang dibandingkan panjangnya. Pembeda
             antar kategori sudah dikerjakan oleh donat di sebelahnya. */
          atas.map((k) => ({
            label: k.namaBersih,
            nilai: k.total,
            warna: 'var(--brand)',
            ket: `${k.jumlah} transaksi · ${persenDari(k.total, totalKeluar)}`,
          })),
          { formatNilai: (v) => rupiahRingkas(v) },
        ),
      ])
      : h('.dv__kosong', null, 'Belum ada pengeluaran pada periode ini.'),
  ]);
}

function persenDari(bagian, total) {
  if (!total) return '0%';
  return `${Math.round((bagian / total) * 100)}% dari total`;
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
      [ikon('upload', 18), h('span', { text: 'Upload e-Statement' })]),
  ]);
}
