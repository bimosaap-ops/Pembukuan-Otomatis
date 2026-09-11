/**
 * Halaman Pengaturan: mode terang/gelap, folder upload & export,
 * backup dan restore database.
 */

import { h, ikon, ganti } from '../../core/dom.js';
import { emit, EVENT } from '../../core/events.js';
import { infoPenyimpanan, kosongkanSemua } from '../../data/db.js';
import * as pengaturanRepo from '../../data/repo/settings.js';
import * as kategoriRepo from '../../data/repo/categories.js';
import * as akunRepo from '../../data/repo/accounts.js';
import * as trxRepo from '../../data/repo/transactions.js';
import * as uploadRepo from '../../data/repo/uploads.js';
import { setTema, temaTersimpan, TEMA } from '../theme.js';
import { versiBerjalan, periksaPembaruan } from '../versi.js';
import { unduhBackup, pulihkanBackup, dukunganPilihFolder } from '../../services/export.js';
import {
  bacaKonfigSheets, simpanKonfigSheets, testWebhook, syncKeSheets, jumlahAntrean, praTinjauSelaras,
} from '../../services/sheets-sync.js';
import { bukaModal, konfirmasi } from '../components/modal.js';
import { toastSukses, toastGagal } from '../components/toast.js';

export async function mount(wadah) {
  const halaman = h('.halaman');
  const isi = h('.tumpuk');

  halaman.append(
    h('.halaman__kepala', null, h('div', null, [
      h('.halaman__judul', { text: 'Pengaturan' }),
      h('.halaman__ket', { text: 'Tampilan, lokasi berkas, dan pengelolaan database lokal.' }),
    ])),
    isi,
  );
  wadah.appendChild(halaman);

  async function render() {
    const [akun, transaksi, upload, kategori, penyimpanan, versi] = await Promise.all([
      akunRepo.daftar(), trxRepo.semua(), uploadRepo.daftar(), kategoriRepo.daftar(),
      infoPenyimpanan(), versiBerjalan(),
    ]);

    ganti(isi, [
      kartuTampilan(render),
      kartuFolder(),
      await kartuSheets(),
      kartuDatabase({ akun, transaksi, upload, kategori, penyimpanan }, render),
      kartuVersi(versi),
      kartuTentang(),
    ]);
  }

  await render();
  return { unmount() {} };
}

/* ==========================================================================
   Tampilan
   ========================================================================== */

function kartuTampilan(render) {
  const aktif = temaTersimpan();

  const pilihan = [
    { id: TEMA.OTOMATIS, label: 'Ikuti sistem' },
    { id: TEMA.TERANG, label: 'Terang' },
    { id: TEMA.GELAP, label: 'Gelap' },
  ];

  return h('.kartu', null, [
    h('.kartu__kepala', null, h('div', null, [
      h('.kartu__judul', { text: 'Tampilan' }),
      h('.kartu__ket', { text: 'Mode gelap membantu saat membuka pembukuan di tempat minim cahaya.' }),
    ])),
    h('.segment', { role: 'group', 'aria-label': 'Mode tampilan' }, pilihan.map((p) => h('button.segment__btn', {
      type: 'button',
      'aria-pressed': p.id === aktif ? 'true' : 'false',
      onclick: async () => {
        await setTema(p.id);
        // Halaman digambar ulang agar penanda pilihan ikut berpindah.
        render();
      },
    }, [ikon(p.id === TEMA.GELAP ? 'gelap' : 'terang', 16), h('span', { text: p.label })]))),
  ]);
}

/* ==========================================================================
   Folder upload & export
   ========================================================================== */

function kartuFolder() {
  const bisaPilih = dukunganPilihFolder();

  return h('.kartu', null, [
    h('.kartu__kepala', null, h('div', null, [
      h('.kartu__judul', { text: 'Folder Upload & Export' }),
      h('.kartu__ket', { text: 'Tempat berkas diambil dan disimpan.' }),
    ])),

    h('.pengaturan-baris', null, [
      h('.pengaturan-baris__teks', null, [
        h('.pengaturan-baris__judul', { text: 'Folder Upload' }),
        h('.pengaturan-baris__ket', { text: 'E-statement dipilih lewat dialog berkas bawaan perangkat, jadi Anda bisa mengambilnya dari folder mana pun — termasuk Google Drive atau berkas yang baru diunduh dari aplikasi m-banking.' }),
      ]),
      h('span.lencana.lencana--info', { text: 'Bebas' }),
    ]),

    h('.pengaturan-baris', null, [
      h('.pengaturan-baris__teks', null, [
        h('.pengaturan-baris__judul', { text: 'Folder Export' }),
        h('.pengaturan-baris__ket', {
          text: bisaPilih
            ? 'Browser ini mendukung pemilihan lokasi simpan. Setiap kali mengekspor, Anda akan diminta memilih foldernya.'
            : 'Browser di HP tidak mengizinkan aplikasi web memilih folder tetap, jadi hasil ekspor masuk ke folder Unduhan bawaan perangkat.',
        }),
      ]),
      h(`span.lencana.lencana--${bisaPilih ? 'masuk' : 'warning'}`, {
        text: bisaPilih ? 'Bisa dipilih' : 'Folder Unduhan',
      }),
    ]),
  ]);
}

/* ==========================================================================
   Database
   ========================================================================== */

function kartuDatabase(data, render) {
  const { akun, transaksi, upload, kategori, penyimpanan } = data;

  const inputRestore = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'sr-only',
    onchange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) await mulaiRestore(file, render);
    },
  });

  return h('.kartu', null, [
    h('.kartu__kepala', null, h('div', null, [
      h('.kartu__judul', { text: 'Database' }),
      h('.kartu__ket', { text: 'Seluruh data tersimpan di perangkat ini saja dan tidak pernah dikirim ke server mana pun.' }),
    ])),

    h('.grid-kpi', null, [
      kpi('Rekening', String(akun.length)),
      kpi('Transaksi', String(transaksi.length)),
      kpi('Berkas Upload', String(upload.length)),
      kpi('Kategori', String(kategori.length)),
    ]),

    penyimpanan ? h('.mt-4', null, [
      h('.baris-antara.mb-2', null, [
        h('span.redup', { text: 'Pemakaian penyimpanan browser' }),
        h('span.tebal', { text: `${(penyimpanan.terpakai / 1048576).toFixed(1)} MB` }),
      ]),
      h('.bar-progres', null, h('.bar-progres__isi', {
        style: { width: `${Math.min(100, (penyimpanan.terpakai / (penyimpanan.kuota || 1)) * 100)}%` },
      })),
      h('.redup-2.mt-2', {
        style: { fontSize: '.78rem' },
        text: `Tersedia sekitar ${(penyimpanan.kuota / 1048576).toFixed(0)} MB untuk aplikasi ini.`,
      }),
    ]) : null,

    h('.info-kotak.info-kotak--warning.mt-4', null, [
      ikon('peringatan', 18),
      h('div', null, [
        h('b', { text: 'Data ini hanya ada di perangkat ini. ' }),
        'Membersihkan data situs di browser, mengganti HP, atau memasang ulang browser akan menghapusnya. Unduh backup secara berkala.',
      ]),
    ]),

    h('.baris.bungkus.mt-4', null, [
      h('button.btn-primary', {
        type: 'button',
        onclick: async () => {
          try {
            const hasil = await unduhBackup();
            if (!hasil?.batal) toastSukses('Backup diunduh.');
          } catch (e) {
            toastGagal(`Gagal membuat backup: ${e.message}`);
          }
        },
      }, [ikon('unduh', 17), h('span', { text: 'Backup Database' })]),

      h('button', { type: 'button', onclick: () => inputRestore.click() },
        [ikon('upload', 17), h('span', { text: 'Restore Database' })]),

      h('button.btn-bahaya', { type: 'button', onclick: () => hapusSemua(render) },
        [ikon('hapus', 17), h('span', { text: 'Hapus semua data' })]),

      inputRestore,
    ]),
  ]);
}

function kpi(label, nilai) {
  return h('.kpi.kpi--netral', null, [
    h('.kpi__label', { text: label }),
    h('.kpi__nilai', { text: nilai }),
  ]);
}

async function mulaiRestore(file, render) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    toastGagal('Berkas tidak bisa dibaca sebagai JSON.');
    return;
  }

  if (backup?.aplikasi !== 'pembukuan-keuangan') {
    toastGagal('Berkas ini bukan backup Pembukuan.');
    return;
  }

  const j = backup.jumlah || {};
  let mode = 'ganti';

  const m = bukaModal({
    judul: 'Restore database',
    isi: h('.tumpuk', null, [
      h('p.mb-0', {
        text: `Backup dibuat ${String(backup.dibuatPada).slice(0, 10)} berisi ${j.transaksi ?? 0} transaksi, ${j.rekening ?? 0} rekening, dan ${j.upload ?? 0} riwayat upload.`,
      }),
      h('div', null, [
        h('label', { text: 'Cara memulihkan' }),
        h('select', { onchange: (e) => { mode = e.target.value; } }, [
          h('option', { value: 'ganti', text: 'Ganti — hapus data sekarang, pakai isi backup' }),
          h('option', { value: 'gabung', text: 'Gabung — tambahkan yang belum ada, data sekarang dipertahankan' }),
        ]),
      ]),
      h('.info-kotak.info-kotak--warning', null, [
        ikon('peringatan', 18),
        h('div', { text: 'Mode "Ganti" menghapus seluruh isi pembukuan saat ini dan tidak bisa dibatalkan. Unduh backup dulu bila ragu.' }),
      ]),
    ]),
    aksi: [
      h('button', { type: 'button', onclick: () => m.tutup() }, 'Batal'),
      h('button.btn-primary', {
        type: 'button',
        onclick: async () => {
          try {
            const hasil = await pulihkanBackup(backup, mode);
            m.tutup();
            toastSukses(`Pulih: ${hasil.transaksi} transaksi, ${hasil.rekening} rekening.`
              + ' Tekan "Kirim semua sekarang" agar Google Sheet ikut menyesuaikan.');
            emit(EVENT.DATA_BERUBAH, { sumber: 'restore' });
            render();
          } catch (e) {
            toastGagal(e.message);
          }
        },
      }, 'Mulai restore'),
    ],
  });
}

async function hapusSemua(render) {
  const ya = await konfirmasi({
    judul: 'Hapus semua data?',
    pesan: 'Seluruh rekening, transaksi, riwayat upload, dan kategori akan dihapus dari perangkat ini. Pastikan Anda sudah mengunduh backup.',
    tombolYa: 'Ya, hapus semuanya',
    bahaya: true,
  });
  if (!ya) return;

  const yakin = await konfirmasi({
    judul: 'Sekali lagi: yakin?',
    pesan: 'Tindakan ini tidak bisa dibatalkan.',
    tombolYa: 'Hapus permanen',
    bahaya: true,
  });
  if (!yakin) return;

  await kosongkanSemua();
  kategoriRepo.kosongkanCache();
  await pengaturanRepo.hapusKunci(pengaturanRepo.KUNCI.KATEGORI_TERSEMAI);
  await kategoriRepo.semaiBawaan();
  // Sheet TIDAK ikut dikosongkan, dan penyelarasan pun tidak bisa
  // membereskannya: pengamannya menolak payload kosong, justru supaya database
  // yang kebetulan kosong tidak pernah menghapus isi Sheet. Katakan apa adanya
  // daripada membiarkan pengguna mengira keduanya sudah bersih.
  toastSukses('Semua data dihapus. Kategori bawaan dipasang kembali. Isi Google Sheet tidak ikut dihapus.');
  emit(EVENT.DATA_BERUBAH, { sumber: 'reset' });
  render();
}

/* ==========================================================================
   Google Sheets — webhook Apps Script
   ========================================================================== */

async function kartuSheets() {
  const [{ url, aktif }, antrean] = await Promise.all([bacaKonfigSheets(), jumlahAntrean()]);
  let urlVal = url;
  let aktifVal = aktif;
  let sibuk = false;

  const inputUrl = h('input', {
    type: 'url',
    placeholder: 'https://script.google.com/macros/s/.../exec',
    value: urlVal,
    oninput: (e) => { urlVal = e.target.value; },
    style: { width: '100%' },
  });
  const checkAktif = h('input', {
    type: 'checkbox',
    checked: aktifVal,
    onchange: (e) => { aktifVal = e.target.checked; },
  });
  const statusEl = h('.redup-2', { style: { fontSize: '.82rem' }, text: aktif ? 'Aktif — tiap simpan auto kirim ke Sheets' : 'Nonaktif' });

  const simpan = async (btn) => {
    if (sibuk) return;
    sibuk = true; btn.disabled = true;
    try {
      await simpanKonfigSheets({ url: urlVal, aktif: aktifVal });
      statusEl.textContent = aktifVal ? 'Tersimpan · Aktif' : 'Tersimpan · Nonaktif';
      toastSukses('Pengaturan Sheets tersimpan');
    } catch (e) { toastGagal(e.message); }
    finally { sibuk = false; btn.disabled = false; }
  };

  return h('.kartu', null, [
    h('.kartu__kepala', null, h('div', null, [
      h('.kartu__judul', { text: 'Google Sheets' }),
      h('.kartu__ket', { text: 'Tempel URL Web App Apps Script. Tiap transaksi baru auto-POST ke Sheet. Kosongkan untuk matikan.' }),
    ])),
    h('.tumpuk', null, [
      h('label', { text: 'Webhook URL' }),
      inputUrl,
      h('.baris.bungkus.mt-2', null, [
        h('label.baris', { style: { gap: '8px', alignItems: 'center' } }, [checkAktif, h('span', { text: 'Aktifkan sync otomatis' })]),
        statusEl,
      ]),
      antrean
        ? h('.info-kotak.info-kotak--warning.mt-2', null, [
          ikon('peringatan', 18),
          h('div', null, [
            h('b', { text: `${antrean} transaksi menunggu dikirim ke Sheets. ` }),
            'Terakhir gagal (offline, URL salah, atau Apps Script tidak merespons) — dicoba otomatis lagi saat simpan berikutnya atau koneksi pulih. "Kirim semua sekarang" juga membersihkannya.',
          ]),
        ])
        : null,
      h('.baris.bungkus.mt-3', null, [
        h('button.btn-primary', { type: 'button', onclick(e) { simpan(e.currentTarget); } }, 'Simpan'),
        h('button', { type: 'button', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { await testWebhook(); toastSukses('Webhook OK'); } catch (err) { toastGagal(err.message); } finally { b.disabled = false; }
        } }, 'Test webhook'),
        h('button', { type: 'button', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try {
            const [trx, akun, kategori] = await Promise.all([trxRepo.semua(), akunRepo.peta(), kategoriRepo.peta()]);
            if (!trx.length) { toastGagal('Belum ada transaksi'); return; }

            // Dihitung dulu, baru ditanyakan. Menghapus data pengguna tanpa
            // menyebut berapa banyak bukan pilihan — dan angka yang jauh dari
            // dugaan justru tanda ada yang salah, sehingga masih bisa dibatalkan.
            const tinjau = await praTinjauSelaras(trx, akun, kategori);
            if (tinjau?.skipped) { toastGagal('Aktifkan Sheets & isi URL dulu'); return; }

            if (tinjau.akanDihapus > 0) {
              const ya = await konfirmasi({
                judul: 'Samakan Sheet dengan perangkat ini?',
                pesan: `${tinjau.akanDihapus} baris di Sheet tidak ada lagi di perangkat ini dan akan DIHAPUS `
                  + `(biasanya sisa upload yang pernah dibatalkan). ${trx.length} transaksi akan dikirim ulang.`
                  + (tinjau.dipertahankan
                    ? ` ${tinjau.dipertahankan} baris milik rekening lain tetap dipertahankan.`
                    : ' Catatan: data pembukuan tersimpan per perangkat, jadi jalankan ini dari perangkat yang datanya paling lengkap.'),
                tombolYa: 'Ya, samakan',
                bahaya: true,
              });
              if (!ya) return;
            }

            // Batas waktu dinaikkan jauh: backfill mengirim SELURUH transaksi
            // dalam satu permintaan — pada pembukuan ribuan baris itu berarti
            // payload ratusan KB, ditambah cold start Apps Script yang bisa
            // beberapa detik sendiri. Batas 30 detik terlalu mepet dan membuat
            // pengiriman yang sebenarnya berhasil terlihat gagal.
            const r = await syncKeSheets(trx, akun, kategori, { batasMs: 60000, selaras: true });
            if (r?.skipped) toastGagal('Aktifkan Sheets & isi URL dulu');
            else toastSukses(`Terkirim ${r.jumlah} baris${r.dihapus ? `, ${r.dihapus} baris yatim dihapus` : ''}.`);
          } catch (err) { toastGagal(err.message); } finally { b.disabled = false; }
        } }, 'Kirim semua sekarang'),
      ]),
      h('details.mt-3', null, [
        h('summary.redup', { text: 'Cara buat Sheet + Script (1 menit)' }),
        h('.redup-2.mt-2', { style: { fontSize: '.82rem', lineHeight: '1.6' } }, [
          h('div', { text: '1. Buat Google Sheet baru, header baris 1: hash | tanggal | deskripsi | nominal | debit | kredit | kategoriId | bank | nomorRekening | namaPemilik | sumber' }),
          h('div', { text: '2. Extensions → Apps Script → tempel Code.gs dari repo (lihat sheets/Code.gs) → Deploy → Web App → Anyone with link → copy URL → tempel di atas → Simpan → Test webhook.' }),
          h('div', { text: '3. Sheet terisi otomatis tiap upload. Tombol \"Kirim semua\" untuk backfill.' }),
        ]),
      ]),
    ]),
  ]);
}

/* ==========================================================================
   Versi aplikasi
   ========================================================================== */

function kartuVersi(versi) {
  return h('.kartu', null, [
    h('.kartu__kepala', null, h('div', null, [
      h('.kartu__judul', { text: 'Versi Aplikasi' }),
      h('.kartu__ket', { text: 'Berguna saat memastikan pembaruan sudah benar-benar masuk ke perangkat ini.' }),
    ])),

    h('.pengaturan-baris', null, [
      h('.pengaturan-baris__teks', null, [
        h('.pengaturan-baris__judul', { text: 'Versi yang sedang berjalan' }),
        h('.pengaturan-baris__ket', {
          text: versi
            ? 'Angka ini berasal dari service worker, jadi mencerminkan berkas yang benar-benar dipakai.'
            : 'Belum ada service worker yang mengendalikan halaman ini. Muat ulang sekali, lalu periksa lagi.',
        }),
      ]),
      h(`span.lencana.lencana--${versi ? 'brand' : 'warning'}`, { text: versi || 'belum aktif' }),
    ]),

    h('.baris.bungkus.mt-3', null, [
      h('button', {
        type: 'button',
        onclick: async () => {
          try {
            const adaBaru = await periksaPembaruan();
            if (adaBaru) toastSukses('Versi baru sedang dipasang. Halaman akan dimuat ulang sendiri sebentar lagi.');
            else toastSukses('Sudah memakai versi terbaru.');
          } catch (e) {
            toastGagal(`Gagal memeriksa pembaruan: ${e.message}`);
          }
        },
      }, [ikon('unduh', 17), h('span', { text: 'Periksa pembaruan' })]),
    ]),
  ]);
}

/* ==========================================================================
   Tentang
   ========================================================================== */

function kartuTentang() {
  return h('.kartu', null, [
    h('.kartu__judul.mb-3', { text: 'Tentang aplikasi' }),
    h('.daftar', null, [
      barisInfo('Cara kerja', 'E-statement PDF dibaca langsung di browser dengan pdf.js, lalu transaksinya disimpan ke IndexedDB perangkat Anda.'),
      barisInfo('Privasi', 'Tidak ada server. Berkas, password PDF, maupun data transaksi tidak pernah meninggalkan perangkat ini.'),
      barisInfo('Bank yang dikenali', 'BCA dan Permata punya pembaca khusus. Bank lain diproses pembaca umum, dan hasilnya bisa dikoreksi di layar tinjau sebelum disimpan.'),
      barisInfo('Offline', 'Setelah dibuka sekali, aplikasi bisa dipakai tanpa koneksi internet dan bisa dipasang ke layar utama HP.'),
    ]),
  ]);
}

function barisInfo(judul, isi) {
  return h('.daftar__item', null, h('.daftar__utama', null, [
    h('.daftar__judul', { text: judul }),
    h('.daftar__ket', { text: isi }),
  ]));
}
