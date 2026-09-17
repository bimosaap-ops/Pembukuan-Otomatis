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
import { toastGagal, toastSukses } from './components/toast.js';
import { on, EVENT } from '../core/events.js';
import { pantauKoneksiSheets } from '../services/sheets-sync.js';
import { jalankanAutoPull } from '../services/auto-pull.js';
import {
  jalankanMigrasi, migrasiKataKunciBawaan, migrasiKategoriInvestasi, migrasiKategoriFinalEmail,
} from '../data/migrasi.js';

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

    // Migrasi dijalankan SEBELUM sinkron. Kalau antrean lama terkirim duluan,
    // Sheet menerima baris berhash lama yang beberapa detik kemudian jadi yatim.
    const migrasi = await jalankanMigrasi().catch((e) => {
      console.error('Migrasi hash gagal:', e);
      return null;
    });
    if (migrasi?.dijalankan) {
      toastSukses(`${migrasi.jumlah} transaksi diperiksa ulang terhadap duplikat. `
        + 'Tekan "Kirim semua sekarang" di Pengaturan agar Google Sheet ikut menyesuaikan.');
    }

    // Menambah kata kunci baru ke kategori bawaan (mis. "BAKSO", "SATE",
    // "WARTEG" ke Makan & Minum) di kode tidak sampai ke pengguna lama —
    // semaiBawaan() cuma menyalin sekali saat pertama pakai. Migrasi ini
    // menutup celah itu; tidak mengubah kategori transaksi mana pun dengan
    // sendirinya, jadi diberi tahu lewat toast supaya pengguna tahu perlu
    // menekan "Kelompokkan ulang semua transaksi" di halaman Kategori.
    const migrasiKataKunci = await migrasiKataKunciBawaan().catch((e) => {
      console.error('Migrasi kata kunci kategori gagal:', e);
      return null;
    });
    if (migrasiKataKunci?.dijalankan && migrasiKataKunci.jumlahKataKunci) {
      toastSukses(`${migrasiKataKunci.jumlahKataKunci} kata kunci baru ditambahkan ke `
        + `${migrasiKataKunci.jumlahKategori} kategori bawaan. Buka halaman Kategori dan tekan `
        + '"Kelompokkan ulang semua transaksi" agar transaksi lama ikut terkoreksi.');
    }

    // Kategori "Investasi" baru ditambahkan ke KATEGORI_BAWAAN setelah
    // pengguna lama menjalankan semaiBawaan() — migrasi terpisah ini
    // menyisipkannya bila belum ada (lihat migrasiKategoriInvestasi).
    const migrasiInvestasi = await migrasiKategoriInvestasi().catch((e) => {
      console.error('Migrasi kategori Investasi gagal:', e);
      return null;
    });
    if (migrasiInvestasi?.dijalankan && migrasiInvestasi.jumlahKategori) {
      toastSukses('Kategori "Investasi" ditambahkan. Buka halaman Kategori dan tekan '
        + '"Kelompokkan ulang semua transaksi" agar transaksi reksa dana lama ikut terkoreksi.');
    }

    // "Fase B": transaksi email lama (ditarik sebelum kategoriFinal otomatis
    // ada) disusulkan sekali di sini -- kode barunya cuma jalan untuk baris
    // yang baru ditarik (lihat email-feed-sync.js).
    await migrasiKategoriFinalEmail().catch((e) => {
      console.error('Migrasi kategoriFinal email gagal:', e);
      return null;
    });

    // Antrean retry Sheets (kalau ada, dari sesi sebelumnya yang gagal
    // tersinkron) dicoba lagi begitu database siap, dan tiap kali koneksi pulih.
    pantauKoneksiSheets();

    // "Fase A": Sheets jadi editor utama Transaksi/Akun/Kategori -- tarik
    // otomatis berkala supaya edit manual di Sheets sampai ke PWA tanpa
    // perlu tombol manual (yang tetap ada di Pengaturan sebagai fallback).
    jalankanAutoPull();
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
