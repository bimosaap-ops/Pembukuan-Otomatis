/**
 * Router berbasis hash (#/transaksi). Dipilih karena GitHub Pages hanya melayani
 * berkas statis — tanpa hash, muat ulang di URL dalam akan menghasilkan 404.
 *
 * View dimuat dengan dynamic import supaya halaman pertama di HP tidak perlu
 * mengunduh seluruh kode aplikasi.
 */

import { emit, EVENT } from '../core/events.js';
import { h } from '../core/dom.js';
import { RUTE_AWAL, cariMenu } from './menu.js';

const PEMUAT = {
  dashboard: () => import('./views/dashboard.js'),
  upload: () => import('./views/upload.js'),
  rekening: () => import('./views/rekening.js'),
  transaksi: () => import('./views/transaksi.js'),
  analitik: () => import('./views/analitik.js'),
  laporan: () => import('./views/laporan.js'),
  riwayat: () => import('./views/riwayat.js'),
  kategori: () => import('./views/kategori.js'),
  pengaturan: () => import('./views/pengaturan.js'),
};

let wadah = null;
let viewAktif = null;
let idAktif = null;
let jalanKe = 0;

export function bacaRute() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  const [id, ...sisa] = raw.split('/');
  return { id: PEMUAT[id] ? id : RUTE_AWAL, param: sisa };
}

export function pergiKe(id, param = []) {
  const tujuan = [id, ...param].filter(Boolean).join('/');
  const baru = `#/${tujuan}`;
  if (location.hash === baru) muatRute();
  else location.hash = baru;
}

export function ruteAktif() {
  return idAktif;
}

async function muatRute() {
  const { id, param } = bacaRute();
  const giliran = ++jalanKe;

  try {
    viewAktif?.unmount?.();
  } catch (e) {
    console.error('Gagal melepas view sebelumnya:', e);
  }
  viewAktif = null;
  idAktif = id;

  wadah.replaceChildren(h('.halaman', null, h('.kartu.dv__kosong', null, 'Memuat…')));
  emit(EVENT.RUTE_BERUBAH, id);

  try {
    const modul = await PEMUAT[id]();
    if (giliran !== jalanKe) return; // pengguna sudah pindah halaman lagi

    wadah.replaceChildren();
    viewAktif = await modul.mount(wadah, { param });
    wadah.scrollTop = 0;
    window.scrollTo({ top: 0 });

    const menu = cariMenu(id);
    document.title = `${menu?.labelPanjang || 'Pembukuan'} — Pembukuan & Keuangan`;
  } catch (e) {
    console.error(`Gagal memuat halaman "${id}":`, e);
    if (giliran !== jalanKe) return;
    wadah.replaceChildren(h('.halaman', null, h('.kartu', null, [
      h('h2.mb-2', { text: 'Halaman gagal dimuat' }),
      h('p.redup', { text: String(e?.message || e) }),
      h('button.btn-primary', { type: 'button', onclick: () => muatRute() }, 'Coba lagi'),
    ])));
  }
}

export function mulaiRouter(elWadah) {
  wadah = elWadah;
  window.addEventListener('hashchange', muatRute);
  if (!location.hash) location.replace(`#/${RUTE_AWAL}`);
  muatRute();
}

/** Memuat ulang halaman yang sedang tampil, mis. setelah data berubah. */
export function segarkan() {
  muatRute();
}
