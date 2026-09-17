/**
 * Halaman Transaksi Email — dashboard exception Realtime Email Transaction
 * Feed (lihat rencana implementasi §D). Menampilkan transaksi hasil parse
 * notifikasi email bank yang BELUM beres: tidak ditemukan di e-statement
 * (missing), ditemukan tapi nominalnya beda (mismatch), atau kandidatnya
 * tidak cukup meyakinkan untuk ditautkan otomatis (ambiguous).
 *
 * Transaksi yang sudah `matched` sengaja TIDAK ditampilkan di sini —
 * halaman ini murni untuk exception yang butuh keputusan manusia, bukan
 * daftar seluruh transaksi email (itu tanggung jawab tab "Transaksi Email"
 * di Sheet dan/atau halaman Transaksi biasa setelah tertaut).
 *
 * Status pencocokan (statusCocok) dan keputusan pengguna (statusResolusi)
 * sengaja dibedakan (PRD §26): menautkan manual mengubah statusCocok jadi
 * `matched` sehingga otomatis hilang dari daftar ini, sedangkan "Abaikan"
 * mempertahankan statusCocok apa adanya tapi menandai statusResolusi
 * `diabaikan` — keduanya sama-sama membuat kartu hilang dari tinjauan,
 * tapi riwayatnya tetap bisa dibedakan lewat data tersimpan.
 */

import { h, ikon, ganti } from '../../core/dom.js';
import { rupiah } from '../../core/format.js';
import { tanggalTampil } from '../../core/dates.js';
import { on, emit, EVENT } from '../../core/events.js';
import * as emailTrxRepo from '../../data/repo/email-transactions.js';
import * as trxRepo from '../../data/repo/transactions.js';
import * as kategoriRepo from '../../data/repo/categories.js';
import * as kamusRepo from '../../data/repo/merchant-dictionary.js';
import { STATUS_COCOK_EMAIL, STATUS_RESOLUSI_EMAIL } from '../../domain/entities.js';
import { tarikTransaksiEmail, rentangTanggalKandidat } from '../../services/email-feed-sync.js';
import { eksporUntukTinjauan, terapkanHasilTinjauan } from '../../services/email-review.js';
import { hapusProvisionalManual } from '../../services/email-ledger-merge.js';
import { unduhBlob } from '../../services/export.js';
import { dataView } from '../components/data-view.js';
import { bukaModal, konfirmasi } from '../components/modal.js';
import { toastSukses, toastGagal } from '../components/toast.js';

const URUTAN_STATUS = [STATUS_COCOK_EMAIL.MISSING, STATUS_COCOK_EMAIL.MISMATCH, STATUS_COCOK_EMAIL.AMBIGUOUS];

const LABEL_STATUS = {
  [STATUS_COCOK_EMAIL.MISSING]: {
    judul: 'Tidak Ditemukan di Statement',
    ket: 'Belum ada transaksi e-statement yang cocok. Bisa berarti statement belum diupload, atau transaksinya memang tidak akan pernah muncul di sana.',
    lencana: 'warning',
  },
  [STATUS_COCOK_EMAIL.MISMATCH]: {
    judul: 'Tidak Cocok',
    ket: 'Ada transaksi e-statement di waktu yang berdekatan, tapi nominal atau arahnya berbeda dari email.',
    lencana: 'keluar',
  },
  [STATUS_COCOK_EMAIL.AMBIGUOUS]: {
    judul: 'Perlu Ditinjau',
    ket: 'Kandidat pasangannya tidak cukup meyakinkan untuk ditautkan otomatis — beberapa kemungkinan berskor berdekatan, atau skornya sendiri rendah.',
    lencana: 'info',
  },
};

/** Jendela pencarian kandidat saat menautkan MANUAL — lebih lebar dari jendela
 *  otomatis (rekonsiliasiEmail.js: 24 jam) karena di sini manusia sendiri yang
 *  menilai kecocokannya, bukan skor otomatis yang harus konservatif. */
const HARI_CARI_MANUAL = 7;

export async function mount(wadah) {
  const halaman = h('.halaman');
  const isi = h('.tumpuk');
  const lepas = on(EVENT.DATA_BERUBAH, () => render());

  const tombolTarik = h('button.btn-primary.btn-kecil', { type: 'button' }, [
    ikon('surat', 17), h('span', { text: 'Tarik Email Sekarang' }),
  ]);
  tombolTarik.addEventListener('click', () => tarik(tombolTarik));

  const tombolEkspor = h('button.btn-kecil', { type: 'button' }, 'Ekspor untuk Ditinjau');
  tombolEkspor.addEventListener('click', () => eksporTinjauan(tombolEkspor));

  const inputTinjauan = h('input', {
    type: 'file', accept: 'application/json,.json', class: 'sr-only',
    onchange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) await terapkanTinjauan(file);
    },
  });
  const tombolTerapkan = h('button.btn-kecil', { type: 'button', onclick: () => inputTinjauan.click() }, 'Terapkan Hasil Tinjauan');

  halaman.append(
    h('.halaman__kepala', null, [
      h('div', null, [
        h('.halaman__judul', { text: 'Transaksi Email' }),
        h('.halaman__ket', { text: 'Notifikasi transaksi dari email bank, dicocokkan otomatis dengan e-statement. Hanya yang belum beres ditampilkan di sini.' }),
      ]),
      h('.baris.bungkus', null, [tombolTarik, tombolEkspor, tombolTerapkan, inputTinjauan]),
    ]),
    isi,
  );
  wadah.appendChild(halaman);

  async function tarik(btn) {
    btn.disabled = true;
    ganti(btn, [h('span', { text: 'Menarik…' })]);
    try {
      const hasil = await tarikTransaksiEmail();
      if (hasil?.skipped) {
        toastGagal('Google Sheets belum aktif/diisi — atur dulu di Pengaturan.');
      } else {
        toastSukses(`Ditarik ${hasil.ditarik} baris, ${hasil.baru} transaksi baru.`);
        emit(EVENT.DATA_BERUBAH, { sumber: 'email-tarik' });
      }
    } catch (e) {
      toastGagal(`Gagal menarik: ${e.message}`);
    } finally {
      btn.disabled = false;
      ganti(btn, [ikon('surat', 17), h('span', { text: 'Tarik Email Sekarang' })]);
    }
  }

  /**
   * "Ekspor untuk Ditinjau" — untuk kasus exception-nya terlalu banyak
   * diklik satu-satu (mis. setelah backfill besar): unduh exception yang
   * masih terbuka + kandidat e-statement di sekitarnya sebagai satu
   * berkas JSON, supaya bisa dianalisis di luar aplikasi lalu hasilnya
   * diterapkan kembali lewat "Terapkan Hasil Tinjauan" di bawah.
   */
  async function eksporTinjauan(btn) {
    btn.disabled = true;
    try {
      const data = await eksporUntukTinjauan();
      if (!data.transaksiEmail.length) {
        toastGagal('Tidak ada transaksi yang perlu ditinjau saat ini.');
        return;
      }
      const tanggal = new Date().toISOString().slice(0, 10);
      await unduhBlob(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        `transaksi-email-tinjauan-${tanggal}.json`,
      );
      toastSukses(`${data.transaksiEmail.length} transaksi diekspor untuk ditinjau.`);
    } catch (e) {
      toastGagal(`Gagal mengekspor: ${e.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  /**
   * "Terapkan Hasil Tinjauan" — kebalikan dari ekspor di atas: baca berkas
   * keputusan ({gmailMessageId, aksi, transaksiCocokId?, alasan?}[]),
   * ringkas dulu lewat modal konfirmasi (tidak langsung diterapkan diam-
   * diam), baru panggil terapkanHasilTinjauan() yang menjalankan aksi yang
   * SAMA PERSIS dengan Tautkan manual/Terima tautan ini/Abaikan manual.
   */
  async function terapkanTinjauan(file) {
    let daftarKeputusan;
    try {
      daftarKeputusan = JSON.parse(await file.text());
    } catch {
      toastGagal('Berkas tidak bisa dibaca sebagai JSON.');
      return;
    }
    if (!Array.isArray(daftarKeputusan) || !daftarKeputusan.length) {
      toastGagal('Berkas ini tidak berisi daftar keputusan yang valid.');
      return;
    }

    const jumlah = { tautkan: 0, selesai: 0, abaikan: 0, lain: 0 };
    daftarKeputusan.forEach((k) => {
      if (k?.aksi === 'tautkan') jumlah.tautkan += 1;
      else if (k?.aksi === 'selesai') jumlah.selesai += 1;
      else if (k?.aksi === 'abaikan') jumlah.abaikan += 1;
      else jumlah.lain += 1;
    });

    const ya = await konfirmasi({
      judul: 'Terapkan hasil tinjauan?',
      pesan: `${daftarKeputusan.length} keputusan akan diterapkan: ${jumlah.tautkan} ditautkan, `
        + `${jumlah.selesai} ditandai selesai, ${jumlah.abaikan} diabaikan`
        + (jumlah.lain ? `, ${jumlah.lain} lainnya (akan dilewati kalau tidak valid)` : '')
        + '. Lanjutkan?',
      tombolYa: 'Ya, terapkan',
    });
    if (!ya) return;

    try {
      const hasil = await terapkanHasilTinjauan(daftarKeputusan);
      const ringkasan = `${hasil.ditautkan} ditautkan, ${hasil.diselesaikan} selesai, ${hasil.diabaikan} diabaikan`
        + (hasil.dilewati.length ? `, ${hasil.dilewati.length} dilewati (lihat konsol untuk sebabnya)` : '');
      toastSukses(`Diterapkan: ${ringkasan}.`);
      if (hasil.dilewati.length) console.warn('Keputusan yang dilewati:', hasil.dilewati);
      emit(EVENT.DATA_BERUBAH, { sumber: 'email-tinjauan' });
    } catch (e) {
      toastGagal(`Gagal menerapkan: ${e.message}`);
    }
  }

  async function render() {
    const [semua, daftarKategori] = await Promise.all([emailTrxRepo.semua(), kategoriRepo.daftar()]);

    const terbuka = semua.filter((t) => t.statusResolusi === STATUS_RESOLUSI_EMAIL.TERBUKA
      && URUTAN_STATUS.includes(t.statusCocok));

    const idKandidat = [...new Set(terbuka.map((t) => t.transaksiCocokId).filter(Boolean))];
    const kandidatMap = new Map((await trxRepo.beberapa(idKandidat)).map((t) => [t.id, t]));

    if (!terbuka.length) {
      ganti(isi, [
        h('.kartu.dv__kosong', null, [
          ikon('cek', 28),
          h('strong', { text: semua.length ? 'Semua transaksi email sudah beres' : 'Belum ada transaksi email' }),
          h('div.redup-2', {
            text: semua.length
              ? 'Tidak ada yang perlu ditinjau saat ini.'
              : 'Tekan "Tarik Email Sekarang" untuk menarik hasil pemantauan email dari Google Sheets. Pastikan Google Sheets sudah diaktifkan di Pengaturan dan pemantauan email sudah dipasang di menu Apps Script.',
          }),
        ]),
      ]);
      return;
    }

    ganti(isi, [
      h('.grid-kpi', null, URUTAN_STATUS.map((s) => kpi(
        LABEL_STATUS[s].judul,
        String(terbuka.filter((t) => t.statusCocok === s).length),
      ))),
      ...URUTAN_STATUS
        .map((s) => seksi(s, terbuka.filter((t) => t.statusCocok === s), daftarKategori, kandidatMap))
        .filter(Boolean),
    ]);
  }

  function seksi(status, daftar, daftarKategori, kandidatMap) {
    if (!daftar.length) return null;
    const label = LABEL_STATUS[status];
    const urut = [...daftar].sort((a, b) => new Date(b.waktuTransaksi) - new Date(a.waktuTransaksi));
    const punyaKandidat = status !== STATUS_COCOK_EMAIL.MISSING;

    return h('.kartu', null, [
      h('.kartu__kepala', null, h('div', null, [
        h('.kartu__judul', { text: `${label.judul} (${daftar.length})` }),
        h('.kartu__ket', { text: label.ket }),
      ])),
      dataView({
        kolom: kolomEmail(daftarKategori, kandidatMap, punyaKandidat),
        baris: urut,
        aksi: (t) => {
          const kandidat = kandidatMap.get(t.transaksiCocokId);
          return [
            h('button.btn-kecil', { type: 'button', onclick: () => bukaTautkanManual(t) }, 'Tautkan manual'),
            kandidat ? h('button.btn-kecil', { type: 'button', onclick: () => terimaTautan(t) }, 'Terima tautan ini') : null,
            h('button.btn-kecil.btn-halus', { type: 'button', onclick: () => abaikan(t) }, 'Abaikan'),
            // "Fase C": baris ini sudah dicatat sebagai transaksi provisional
            // di ledger (lihat services/email-ledger-merge.js) — beri jalan
            // keluar manual kalau ternyata memang keliru/dobel (mis. sudah
            // ada di e-statement dengan detail berbeda tapi jelas transaksi
            // yang sama).
            t.provisionalTrxId
              ? h('button.btn-kecil.btn-bahaya', { type: 'button', onclick: () => hapusProvisional(t) }, 'Hapus baris provisional')
              : null,
          ];
        },
      }),
    ]);
  }

  function kolomEmail(daftarKategori, kandidatMap, punyaKandidat) {
    const kolom = [
      { kunci: 'waktu', judul: 'Waktu', lebar: '150px', render: (t) => formatWaktu(t.waktuTransaksi) },
      {
        kunci: 'merchant', judul: 'Merchant', kartu: 'utama', lebar: '220px',
        render: (t) => h('div', null, [
          h('div.putus', { text: t.merchantMentah || '(tanpa nama merchant)' }),
          h('div.redup-2', { style: { fontSize: '.76rem' }, text: `${t.bank || '—'}${t.alasanCocok ? ` · ${t.alasanCocok}` : ''}` }),
          // "Fase C": penanda baris ini sudah tercatat di ledger sebagai
          // transaksi provisional (tampil di Dashboard) — lihat konfirmasi
          // Fase A.5/urutan implementasi Fase C soal kenapa MISMATCH/AMBIGUOUS
          // tidak menghapusnya otomatis (saldo tidak boleh diam-diam berubah).
          t.provisionalTrxId ? h('span.lencana.lencana--warning.mt-2', {
            text: (t.statusCocok === STATUS_COCOK_EMAIL.MISMATCH || t.statusCocok === STATUS_COCOK_EMAIL.AMBIGUOUS)
              ? 'Provisional di ledger · disengketakan'
              : 'Provisional di ledger',
          }) : null,
        ]),
      },
      {
        kunci: 'nominal', judul: 'Nominal', kanan: true, angka: true, lebar: '130px', kartu: 'nilai',
        render: (t) => {
          const tanda = t.arah === 'debit' ? -Math.abs(t.nominal) : Math.abs(t.nominal);
          return h(`span.${tanda >= 0 ? 'masuk' : 'keluar'}`, { text: rupiah(tanda, { tanda: true }) });
        },
      },
    ];

    if (punyaKandidat) {
      kolom.push({
        kunci: 'kandidat', judul: 'Kandidat di E-statement', lebar: '220px',
        render: (t) => {
          const k = kandidatMap.get(t.transaksiCocokId);
          if (!k) return '—';
          return `${k.deskripsi || '(tanpa keterangan)'} · ${tanggalTampil(k.tanggal)} · ${rupiah(k.nominal, { tanda: true })}`;
        },
      });
    }

    kolom.push({
      kunci: 'kategori', judul: 'Kategori', lebar: '190px',
      render: (t) => {
        const tipeDicari = t.arah === 'debit' ? 'pengeluaran' : 'pemasukan';
        const kategoriTerpilih = t.kategoriFinal || t.kategoriSaran || '';
        return h('select', {
          style: { minHeight: '36px', fontSize: '.82rem', padding: '4px 8px' },
          onchange: (e) => simpanKategori(t, e.target.value),
        }, [
          h('option', { value: '', selected: !kategoriTerpilih, text: 'Pilih kategori…' }),
          ...daftarKategori
            .filter((k) => k.tipe === tipeDicari)
            .map((k) => h('option', { value: k.id, selected: k.id === kategoriTerpilih, text: `${k.ikon} ${k.nama}` })),
        ]);
      },
    });

    return kolom;
  }

  async function simpanKategori(trx, kategoriId) {
    if (!kategoriId) { toastGagal('Pilih kategori dulu.'); return; }
    await emailTrxRepo.simpanSatu({ ...trx, kategoriFinal: kategoriId, overrideUser: true });
    if (trx.merchantKey) await kamusRepo.tetapkan(trx.merchantKey, kategoriId);
    toastSukses('Kategori disimpan.');
    emit(EVENT.DATA_BERUBAH, { sumber: 'email-kategori' });
  }

  async function terimaTautan(trx) {
    await emailTrxRepo.simpanSatu({ ...trx, statusResolusi: STATUS_RESOLUSI_EMAIL.DISELESAIKAN });
    toastSukses('Ditandai selesai.');
    emit(EVENT.DATA_BERUBAH, { sumber: 'email-selesai' });
  }

  async function abaikan(trx) {
    const ya = await konfirmasi({
      judul: 'Abaikan transaksi email ini?',
      pesan: 'Transaksi ini tidak akan muncul lagi di daftar tinjauan, tapi datanya tetap tersimpan apa adanya.',
      tombolYa: 'Ya, abaikan',
    });
    if (!ya) return;
    await emailTrxRepo.simpanSatu({ ...trx, statusResolusi: STATUS_RESOLUSI_EMAIL.DIABAIKAN });
    toastSukses('Diabaikan.');
    emit(EVENT.DATA_BERUBAH, { sumber: 'email-abaikan' });
  }

  /**
   * Resolusi manual "Fase C": baris provisional di ledger ternyata keliru
   * (mis. dobel dengan baris e-statement yang tidak terdeteksi otomatis
   * karena detailnya cukup berbeda). Berbeda dari "Abaikan" — itu cuma
   * menyembunyikan kartu ini dari tinjauan tanpa menyentuh ledger sama
   * sekali; ini benar-benar menghapus baris transaksi dari pembukuan.
   */
  async function hapusProvisional(trx) {
    const ya = await konfirmasi({
      judul: 'Hapus baris provisional dari pembukuan?',
      pesan: 'Transaksi ini akan dihapus dari daftar Transaksi (dan Google Sheets). '
        + 'Lakukan ini kalau transaksinya memang sudah tercatat lewat e-statement dengan detail berbeda, atau ternyata keliru.',
      tombolYa: 'Ya, hapus',
      bahaya: true,
    });
    if (!ya) return;
    await hapusProvisionalManual(trx);
    toastSukses('Baris provisional dihapus.');
    emit(EVENT.DATA_BERUBAH, { sumber: 'email-hapus-provisional' });
  }

  function bukaTautkanManual(trx) {
    const daftarEl = h('.tumpuk');
    const nominalTanda = trx.arah === 'debit' ? -Math.abs(trx.nominal) : Math.abs(trx.nominal);

    const m = bukaModal({
      judul: 'Tautkan manual',
      lebar: true,
      isi: h('.tumpuk', null, [
        h('p.redup.mb-0', {
          text: `Cari transaksi e-statement untuk "${trx.merchantMentah || trx.bank || 'transaksi ini'}" `
            + `(${rupiah(nominalTanda, { tanda: true })}, ${formatWaktu(trx.waktuTransaksi)}). `
            + `Menampilkan transaksi ±${HARI_CARI_MANUAL} hari dari waktu email.`,
        }),
        daftarEl,
      ]),
      aksi: [h('button', { type: 'button', onclick: () => m.tutup() }, 'Batal')],
    });

    muat();

    async function muat() {
      const rentang = rentangTanggalKandidat(trx.waktuTransaksi, HARI_CARI_MANUAL);
      const kandidat = rentang ? await trxRepo.rentangTanggal(rentang.dari, rentang.sampai) : [];
      ganti(daftarEl, kandidat.length
        ? [...kandidat].reverse().map((k) => h('.baris-antara', { style: { padding: '8px 0', borderBottom: '1px solid var(--line)' } }, [
          h('div', null, [
            h('div', { text: k.deskripsi || '(tanpa keterangan)' }),
            h('.redup-2', { text: `${tanggalTampil(k.tanggal)} · ${rupiah(k.nominal, { tanda: true })}` }),
          ]),
          h('button.btn-kecil.btn-primary', { type: 'button', onclick: () => pilih(k) }, 'Pilih'),
        ]))
        : [h('p.redup', { text: `Tidak ada transaksi e-statement dalam rentang ±${HARI_CARI_MANUAL} hari dari waktu email ini.` })]);
    }

    async function pilih(k) {
      await emailTrxRepo.simpanSatu({
        ...trx,
        statusCocok: STATUS_COCOK_EMAIL.MATCHED,
        transaksiCocokId: k.id,
        skorCocok: null,
        alasanCocok: 'manual_link',
      });
      m.tutup();
      toastSukses('Transaksi ditautkan.');
      emit(EVENT.DATA_BERUBAH, { sumber: 'email-tautkan-manual' });
    }
  }

  await render();
  return { unmount: lepas };
}

function kpi(label, nilai) {
  return h('.kpi.kpi--netral', null, [
    h('.kpi__label', { text: label }),
    h('.kpi__nilai', { text: nilai }),
  ]);
}

function formatWaktu(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '—';
  return d.toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
