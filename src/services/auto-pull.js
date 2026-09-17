/**
 * Auto-pull ("Fase A" — Sheets jadi editor utama untuk Transaksi/Akun/
 * Kategori, PWA read-only untuk data itu): tarik akun, kategori, lalu
 * transaksi dari Google Sheets secara berkala TANPA perlu klik tombol,
 * supaya edit manual di Sheets (yang menstempel "Diubah Pada"/"Dikirim
 * Pada" lewat onEdit() baru di sheets/Code.gs) sampai ke PWA dalam hitungan
 * puluhan detik, bukan harus diingat buka Pengaturan dan menekan tombol.
 *
 * Urutan pull SENGAJA akun/kategori dulu baru transaksi: resolusi accountId
 * (lihat transaksi-sync.js) dan nama kategori paling akurat kalau data
 * rekening/kategori terbaru sudah tertarik lebih dulu.
 *
 * TIDAK menampilkan toast kegagalan (beda dari tombol manual di Pengaturan)
 * — pada interval 60 detik, kegagalan jaringan sesaat yang berulang akan
 * sangat mengganggu lewat toast. Tombol manual tetap ada sebagai fallback
 * eksplisit dengan feedback visual.
 */

import { tarikDanGabungEntitas } from './entitas-sync.js';
import { tarikDanGabungTransaksi } from './transaksi-sync.js';
import { emit, EVENT } from '../core/events.js';

/** Fallback selama tab tetap terbuka & visible tanpa berpindah fokus. */
const INTERVAL_MS = 60 * 1000;
/** Jitter kecil di awal interval supaya banyak tab tidak menembak bersamaan. */
const JITTER_MAKS_MS = 5000;

let sedangJalan = false;
let timerId = null;

async function tarikSemua() {
  if (sedangJalan) return;
  sedangJalan = true;
  try {
    const rAkun = await tarikDanGabungEntitas('akun').catch((e) => {
      console.warn('Auto-pull akun gagal:', e);
      return null;
    });
    const rKategori = await tarikDanGabungEntitas('kategori').catch((e) => {
      console.warn('Auto-pull kategori gagal:', e);
      return null;
    });
    const rTransaksi = await tarikDanGabungTransaksi().catch((e) => {
      console.warn('Auto-pull transaksi gagal:', e);
      return null;
    });

    const jumlahPerubahan = (r) => (r && !r.skipped
      ? (r.baru || 0) + (r.diperbarui || 0) + (r.dihapus || 0)
      : 0);
    const totalPerubahan = jumlahPerubahan(rAkun) + jumlahPerubahan(rKategori) + jumlahPerubahan(rTransaksi);
    if (totalPerubahan > 0) emit(EVENT.DATA_BERUBAH, { sumber: 'auto-pull' });
  } finally {
    sedangJalan = false;
  }
}

function mulaiInterval() {
  if (timerId) return; // sudah jalan
  const jitter = Math.random() * JITTER_MAKS_MS;
  timerId = setTimeout(function tik() {
    tarikSemua();
    timerId = setTimeout(tik, INTERVAL_MS);
  }, jitter);
}

function hentikanInterval() {
  if (!timerId) return;
  clearTimeout(timerId);
  timerId = null;
}

/**
 * Dipanggil sekali dari app.js saat aplikasi dibuka. Memasang seluruh
 * pemicu (sekali sekarang, visibilitychange, online, interval fallback) —
 * aman dipanggil walau fitur Sheets belum aktif (tarikDanGabungEntitas/
 * tarikDanGabungTransaksi sendiri yang memutuskan tidak ada yang perlu
 * dikerjakan lewat `{skipped:true}`).
 */
export function jalankanAutoPull() {
  tarikSemua();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tarikSemua();
      mulaiInterval();
    } else {
      hentikanInterval();
    }
  });

  window.addEventListener('online', tarikSemua);

  if (document.visibilityState === 'visible') mulaiInterval();
}
