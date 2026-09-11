/**
 * Halaman Riwayat Upload: Nama File, Bank, Periode, Tanggal Upload,
 * Jumlah Transaksi, Berhasil, Duplikat, dan Status.
 *
 * Setiap upload bisa dibatalkan — seluruh transaksi yang berasal dari berkas itu
 * ikut terhapus dan saldo dihitung ulang. Ini jalan keluar kalau ternyata ada
 * baris yang terbaca keliru setelah tersimpan.
 */

import { h, ikon, ganti } from '../../core/dom.js';
import { tanggalTampil } from '../../core/dates.js';
import { rupiah } from '../../core/format.js';
import { on, emit, EVENT } from '../../core/events.js';
import * as uploadRepo from '../../data/repo/uploads.js';
import * as trxRepo from '../../data/repo/transactions.js';
import { hapusDariSheets } from '../../services/sheets-sync.js';
import { uploadTumpangTindih, transaksiKembarAntarUpload } from '../../domain/validate.js';
import { STATUS_UPLOAD } from '../../domain/entities.js';
import { dataView } from '../components/data-view.js';
import { konfirmasi } from '../components/modal.js';
import { toastSukses } from '../components/toast.js';
import { pergiKe } from '../router.js';

const LENCANA_STATUS = {
  [STATUS_UPLOAD.SUKSES]: { kelas: 'masuk', teks: 'Sukses' },
  [STATUS_UPLOAD.SEBAGIAN]: { kelas: 'warning', teks: 'Perlu dicek' },
  [STATUS_UPLOAD.GAGAL]: { kelas: 'keluar', teks: 'Gagal' },
};

export async function mount(wadah) {
  const halaman = h('.halaman');
  const isi = h('.tumpuk');
  const lepas = on(EVENT.DATA_BERUBAH, () => render());

  halaman.append(
    h('.halaman__kepala', null, [
      h('div', null, [
        h('.halaman__judul', { text: 'Riwayat Upload' }),
        h('.halaman__ket', { text: 'Semua e-statement yang pernah diproses beserta hasilnya.' }),
      ]),
      h('button.btn-primary.btn-kecil', { type: 'button', onclick: () => pergiKe('upload') },
        [ikon('upload', 17), h('span', { text: 'Upload' })]),
    ]),
    isi,
  );
  wadah.appendChild(halaman);

  async function render() {
    const [daftar, transaksi] = await Promise.all([uploadRepo.daftar(), trxRepo.semua()]);

    const totalBerhasil = daftar.reduce((s, u) => s + (u.berhasil || 0), 0);
    const totalDuplikat = daftar.reduce((s, u) => s + (u.duplikat || 0), 0);
    // Satu e-statement yang ter-upload dua kali tidak tertangkap dedupe (hasil
    // baca ulang menghasilkan hash berbeda), jadi pembukuan menggelembung
    // diam-diam. Ditandai di sini supaya ketahuan saat kejadian, bukan
    // berbulan-bulan kemudian saat angkanya dibandingkan dengan rekening koran.
    const tumpang = uploadTumpangTindih(daftar);
    // Periode yang beririsan baru DUGAAN; ini buktinya. Yang dihitung hanya
    // transaksi kembar yang datang dari berkas berbeda — kembar di dalam satu
    // statement memang bisa benar-benar terjadi (dua QRIS Rp 20.000 di hari
    // yang sama), dan menuduhnya ikut salah akan membuat peringatan ini bising
    // sampai tidak dibaca lagi.
    const kembar = transaksiKembarAntarUpload(transaksi);

    ganti(isi, [
      h('.grid-kpi', null, [
        kpi('Berkas Diproses', String(daftar.length)),
        kpi('Transaksi Tersimpan', String(totalBerhasil)),
        kpi('Duplikat Dilewati', String(totalDuplikat)),
        kpi('Perlu Dicek', String(daftar.filter((u) => u.status === STATUS_UPLOAD.SEBAGIAN).length)),
      ]),

      kembar.jumlah
        ? h('.info-kotak.info-kotak--warning', null, [
          ikon('peringatan', 18),
          h('div', null, [
            h('b', { text: `${kembar.jumlah} transaksi tercatat dua kali dari berkas berbeda ` }),
            `(senilai ${rupiah(kembar.nilai)}). `,
            'Ini menggelembungkan pemasukan dan pengeluaran tanpa terlihat mencurigakan. '
            + 'Cari upload yang periodenya beririsan di bawah, lalu batalkan salah satunya — '
            + 'transaksi yang terhapus ikut hilang dari Google Sheet.',
          ]),
        ])
        : null,

      tumpang.size
        ? h('.info-kotak.info-kotak--warning', null, [
          ikon('peringatan', 18),
          h('div', null, [
            h('b', { text: `${tumpang.size} upload punya periode yang beririsan. ` }),
            'Satu e-statement yang ter-upload dua kali membuat transaksinya terhitung ganda '
            + 'dan tidak tertangkap pemeriksaan duplikat. Periksa baris bertanda di bawah, '
            + 'lalu batalkan salah satunya.',
          ]),
        ])
        : null,

      dataView({
        kolom: [
          { kunci: 'namaFile', judul: 'Nama File', kartu: 'utama', render: (u) => h('div.putus', { text: u.namaFile }) },
          { kunci: 'bank', judul: 'Bank', lebar: '120px', render: (u) => `${u.bank || '—'}${u.nomorRekening ? ` · ${u.nomorRekening}` : ''}` },
          {
            kunci: 'periode', judul: 'Periode', lebar: '190px',
            render: (u) => {
              const teks = u.periodeAwal
                ? `${tanggalTampil(u.periodeAwal)} – ${tanggalTampil(u.periodeAkhir || u.periodeAwal)}`
                : '—';
              if (!tumpang.has(u.id)) return teks;
              return h('div.baris', { style: { gap: '6px', alignItems: 'center' } }, [
                h('span', { text: teks }),
                h('span.lencana.lencana--warning', {
                  text: 'beririsan',
                  title: 'Periode ini beririsan dengan upload lain di rekening yang sama — kemungkinan e-statement yang sama ter-upload dua kali.',
                }),
              ]);
            },
          },
          {
            kunci: 'tanggalUpload', judul: 'Tanggal Upload', lebar: '140px',
            render: (u) => tanggalTampil(String(u.tanggalUpload).slice(0, 10)),
          },
          { kunci: 'jumlahTransaksi', judul: 'Jumlah Transaksi', kanan: true, angka: true, lebar: '140px' },
          {
            kunci: 'berhasil', judul: 'Berhasil', kanan: true, angka: true, lebar: '100px', kartu: 'nilai',
            render: (u) => h('span.masuk.tebal', { text: String(u.berhasil || 0) }),
          },
          {
            kunci: 'duplikat', judul: 'Duplikat', kanan: true, angka: true, lebar: '100px',
            render: (u) => String(u.duplikat || 0),
          },
          {
            kunci: 'status', judul: 'Status', lebar: '120px',
            render: (u) => {
              const s = LENCANA_STATUS[u.status] || LENCANA_STATUS[STATUS_UPLOAD.SUKSES];
              return h(`span.lencana.lencana--${s.kelas}`, { text: s.teks });
            },
          },
        ],
        baris: daftar,
        kosong: 'Belum ada berkas yang di-upload',
        kosongKet: 'Riwayat akan terisi otomatis setiap kali Anda memproses e-statement.',
        aksi: (u) => [
          h('button.btn-kecil.btn-bahaya', {
            type: 'button',
            title: 'Hapus upload ini beserta seluruh transaksinya',
            onclick: () => batalkan(u, render),
          }, [ikon('hapus', 15), 'Batalkan']),
        ],
      }),

      daftar.some((u) => u.catatan) ? h('.kartu', null, [
        h('.kartu__judul.mb-2', { text: 'Catatan pembacaan' }),
        h('.daftar', null, daftar.filter((u) => u.catatan).map((u) => h('.daftar__item', null, [
          h('.daftar__utama', null, [
            h('.daftar__judul.putus', { text: u.namaFile }),
            h('.daftar__ket.putus', { text: u.catatan }),
          ]),
        ]))),
      ]) : null,
    ]);
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

async function batalkan(upload, selesai) {
  const ya = await konfirmasi({
    judul: 'Batalkan upload ini?',
    pesan: `${upload.berhasil || 0} transaksi dari "${upload.namaFile}" akan dihapus dari pembukuan dan saldo rekening dihitung ulang.`,
    tombolYa: 'Ya, hapus',
    bahaya: true,
  });
  if (!ya) return;

  const hasil = await uploadRepo.hapusUpload(upload.id);
  // Membatalkan upload adalah penyebab paling sering Sheet jadi melenceng:
  // e-statement yang dibaca ulang meninggalkan baris lamanya di sana.
  hapusDariSheets(hasil.hash).catch((e) => console.warn('Hapus di Sheets gagal:', e));
  toastSukses(`${hasil.transaksiTerhapus} transaksi dihapus.`);
  emit(EVENT.DATA_BERUBAH, { sumber: 'riwayat' });
  selesai?.();
}
