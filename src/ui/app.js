/**
 * Titik masuk aplikasi: menyiapkan database, tema, kerangka layar, dan router.
 */

import { h, ikon, qs } from '../core/dom.js';
import { siapkanDb } from '../data/db.js';
import * as kategoriRepo from '../data/repo/categories.js';
import { buatSidebar, buatBottomNav, pasangPenandaAktif } from './nav.js';
import { mulaiRouter, pergiKe } from './router.js';
import { muatTema, pantauSistem, terapkanTema, temaTersimpan, setTema, TEMA } from './theme.js';
import { cegahDropDiLuar } from './components/dropzone.js';
import { toastGagal } from './components/toast.js';
import { cariMenu } from './menu.js';
import { on, EVENT } from '../core/events.js';

function buatHeader() {
  const judul = h('.header__judul', { text: 'Pembukuan' });
  const sub = h('.header__sub', { text: 'Dashboard Keuangan' });

  const tombolTema = h('button.btn-halus.btn-ikon', {
    type: 'button',
    'aria-label': 'Ganti tema terang/gelap',
    title: 'Ganti tema',
    onclick: async () => {
      const sekarang = temaTersimpan();
      const berikutnya = sekarang === TEMA.GELAP ? TEMA.TERANG : TEMA.GELAP;
      try {
        await setTema(berikutnya);
      } catch {
        terapkanTema(berikutnya);
      }
      segarkanIkonTema(tombolTema);
    },
  });
  segarkanIkonTema(tombolTema);

  const header = h('header.header', null, [
    h('.merek', null, [
      h('.merek__logo', { text: '📊', 'aria-hidden': 'true' }),
      h('div', null, [judul, sub]),
    ]),
    h('.header__aksi', null, [
      tombolTema,
      h('button.btn-primary.btn-kecil', {
        type: 'button',
        onclick: () => pergiKe('upload'),
      }, [ikon('upload', 17), h('span', { text: 'Upload' })]),
    ]),
  ]);

  on(EVENT.RUTE_BERUBAH, (id) => {
    const m = cariMenu(id);
    judul.textContent = m?.labelPanjang || 'Pembukuan';
    sub.textContent = 'Pembukuan & Dashboard Keuangan';
  });

  return header;
}

function segarkanIkonTema(tombol) {
  const gelap = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.hasAttribute('data-theme')
      && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  tombol.replaceChildren(ikon(gelap ? 'terang' : 'gelap', 20));
}

async function mulai() {
  const akar = qs('#app');
  terapkanTema(temaTersimpan());

  const utama = h('main.utama', { id: 'utama' });
  akar.replaceChildren(
    buatSidebar(),
    buatHeader(),
    utama,
    buatBottomNav(),
  );

  cegahDropDiLuar();
  pantauSistem();

  try {
    await siapkanDb();
    await kategoriRepo.semaiBawaan();
    await muatTema();
  } catch (e) {
    console.error('Gagal menyiapkan database:', e);
    toastGagal(`Database tidak bisa dibuka: ${e.message}. Coba buka lewat browser biasa (bukan mode penyamaran).`);
  }

  mulaiRouter(utama);
  pasangPenandaAktif();
  daftarkanServiceWorker();
}

function daftarkanServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  /* Apakah halaman ini sudah dikendalikan service worker saat dimuat. Penting
     dicatat sekarang: `controllerchange` juga menyala pada pemasangan pertama,
     dan memuat ulang halaman di saat itu hanya membuat kedipan tanpa guna. */
  const sudahDikendalikan = Boolean(navigator.serviceWorker.controller);
  let dimuatUlang = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    /* Versi baru mengambil alih. Halaman yang sedang terbuka masih menjalankan
       modul versi lama, jadi harus dimuat ulang sekali — tanpa ini pengguna
       tetap melihat tampilan lama sampai menutup dan membuka aplikasi. */
    if (!sudahDikendalikan || dimuatUlang) return;
    dimuatUlang = true;
    location.reload();
  });

  navigator.serviceWorker.register('./service-worker.js')
    .then((registrasi) => {
      // Periksa pembaruan saat aplikasi dibuka dan setiap kali kembali dilihat.
      registrasi.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registrasi.update().catch(() => {});
      });
    })
    .catch(() => { /* kemampuan offline memang opsional */ });
}

mulai();
