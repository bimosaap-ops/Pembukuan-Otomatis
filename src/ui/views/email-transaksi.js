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

  halaman.append(
    h('.halaman__kepala', null, [
      h('div', null, [
        h('.halaman__judul', { text: 'Transaksi Email' }),
        h('.halaman__ket', { text: 'Notifikasi transaksi dari email bank, dicocokkan otomatis dengan e-statement. Hanya yang belum beres ditampilkan di sini.' }),
      ]),
      tombolTarik,
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
    return h('.kartu', null, [
      h('.kartu__kepala', null, h('div', null, [
        h('.kartu__judul', { text: `${label.judul} (${daftar.length})` }),
        h('.kartu__ket', { text: label.ket }),
      ])),
      h('.tumpuk', null, daftar.map((t) => kartuTransaksi(t, daftarKategori, kandidatMap.get(t.transaksiCocokId)))),
    ]);
  }

  function kartuTransaksi(trx, daftarKategori, kandidat) {
    const nominalTanda = trx.arah === 'debit' ? -Math.abs(trx.nominal) : Math.abs(trx.nominal);
    const tipeDicari = trx.arah === 'debit' ? 'pengeluaran' : 'pemasukan';
    const kategoriTerpilih = trx.kategoriFinal || trx.kategoriSaran || '';

    const selectKategori = h('select', null, [
      h('option', { value: '', selected: !kategoriTerpilih, text: 'Pilih kategori…' }),
      ...daftarKategori
        .filter((k) => k.tipe === tipeDicari)
        .map((k) => h('option', { value: k.id, selected: k.id === kategoriTerpilih, text: `${k.ikon} ${k.nama}` })),
    ]);
    const checkIngat = h('input', { type: 'checkbox', checked: true });

    return h('.kartu.kartu--rapat', { style: { border: '1px solid var(--line)' } }, [
      h('.baris-antara', null, [
        h('div', null, [
          h('div.tebal', { text: trx.merchantMentah || '(tanpa nama merchant)' }),
          h('.redup-2', { text: `${trx.bank || '—'} · ${formatWaktu(trx.waktuTransaksi)}` }),
        ]),
        h('div', { style: { textAlign: 'right' } }, [
          h(`div.tebal.${nominalTanda >= 0 ? 'masuk' : 'keluar'}`, { text: rupiah(nominalTanda, { tanda: true }) }),
          h(`span.lencana.lencana--${LABEL_STATUS[trx.statusCocok].lencana}`, { text: LABEL_STATUS[trx.statusCocok].judul }),
        ]),
      ]),

      trx.alasanCocok ? h('.redup-2.mt-2', { style: { fontSize: '.78rem' }, text: `Alasan: ${trx.alasanCocok}` }) : null,

      kandidat ? h('.info-kotak.mt-2', null, [
        ikon('cek', 16),
        h('div', null, [
          h('b', { text: 'Kandidat di e-statement: ' }),
          `${kandidat.deskripsi || '(tanpa keterangan)'} · ${tanggalTampil(kandidat.tanggal)} · ${rupiah(kandidat.nominal, { tanda: true })}`,
        ]),
      ]) : null,

      h('.form-grid.mt-3', null, [
        h('div', null, [h('label', { text: 'Kategori' }), selectKategori]),
        h('div.penuh', null, h('label.baris', { style: { alignItems: 'center', gap: '8px' } }, [
          checkIngat, h('span', { text: 'Ingat kategori ini untuk merchant yang sama' }),
        ])),
      ]),

      h('.baris.bungkus.mt-3', null, [
        h('button.btn-primary.btn-kecil', {
          type: 'button',
          onclick: () => simpanKategori(trx, selectKategori.value, checkIngat.checked),
        }, 'Simpan kategori'),
        h('button.btn-kecil', {
          type: 'button',
          onclick: () => bukaTautkanManual(trx),
        }, 'Tautkan manual'),
        kandidat ? h('button.btn-kecil', {
          type: 'button',
          onclick: () => terimaTautan(trx),
        }, 'Terima tautan ini') : null,
        h('button.btn-kecil.btn-halus', {
          type: 'button',
          onclick: () => abaikan(trx),
        }, 'Abaikan'),
      ]),
    ]);
  }

  async function simpanKategori(trx, kategoriId, ingat) {
    if (!kategoriId) { toastGagal('Pilih kategori dulu.'); return; }
    await emailTrxRepo.simpanSatu({ ...trx, kategoriFinal: kategoriId, overrideUser: true });
    if (ingat && trx.merchantKey) await kamusRepo.tetapkan(trx.merchantKey, kategoriId);
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
