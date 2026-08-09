/**
 * Titik masuk aplikasi: menyiapkan database, tema, kerangka layar, dan router.
 */

import { h, ikon, qs } from '../core/dom.js';
import { siapkanDb } from '../data/db.js';
import * as kategoriRepo from '../data/repo/categories.js';
import { buatSidebar, buatBottomNav, pasangPenandaAktif } from './nav.js';
import { mulaiRouter } from './router.js';
import {
  muatTema, pantauSistem, terapkanTema, temaTersimpan, setTema, modeGelapAktif, TEMA,
} from './theme.js';
import { cegahDropDiLuar } from './components/dropzone.js';
import { toastGagal } from './components/toast.js';
import { on, EVENT } from '../core/events.js';

/**
 * Header hanya dipakai di layar HP; di layar lebar tempatnya diambil alih
 * sidebar (merek) dan kepala halaman (judul + tombol utama).
 *
 * Isinya dibuat setipis mungkin: merek dan pengganti tema, itu saja. Judul
 * halaman tidak diulang di sini karena tiap layar sudah menuliskannya sendiri,
 * dan tombol Upload juga tidak — di layar HP tombol itu sudah ada dua kali
 * lagi, di kepala halaman dan di navigasi bawah.
 */
function buatHeader() {
  const tombolTema = h('button.btn-halus.btn-ikon', {
    type: 'button',
    onclick: async () => {
      /* Tujuan dihitung dari tampilan yang sedang terlihat, bukan dari nilai
         tersimpan: kalau pilihannya "otomatis" dan sistem sudah gelap, menekan
         tombol harus menerangkan layar — bukan menggelapkannya lagi. */
      const berikutnya = modeGelapAktif() ? TEMA.TERANG : TEMA.GELAP;
      try {
        await setTema(berikutnya);
      } catch {
        terapkanTema(berikutnya);
      }
    },
  });

  const segarkan = () => {
    const gelap = modeGelapAktif();
    const label = gelap ? 'Mode terang' : 'Mode gelap';
    tombolTema.setAttribute('aria-label', label);
    tombolTema.title = label;
    tombolTema.replaceChildren(ikon(gelap ? 'terang' : 'gelap', 20));
  };
  segarkan();
  on(EVENT.TEMA_BERUBAH, segarkan);

  return h('header.header', null, [
    h('.merek', null, [
      h('.merek__logo', { text: '📊', 'aria-hidden': 'true' }),
      h('.header__judul', { text: 'Pembukuan' }),
    ]),
    h('.header__aksi', null, tombolTema),
  ]);
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
