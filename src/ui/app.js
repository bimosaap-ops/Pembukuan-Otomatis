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
import { rupiah } from '../core/format.js';
import { pantauKoneksiSheets } from '../services/sheets-sync.js';
import { jalankanAutoPull } from '../services/auto-pull.js';
import {
  migrasiKataKunciBawaan, bersihkanProvisionalTertaut, perbaikiTautanManualSalah,
  hapusProvisionalTakTerjangkau, pulihkanProvisionalHilang,
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

    // Tautan manual ke baris yang tidak bisa mewakilinya (arah/bank beda,
    // atau baris provisional) dikembalikan jadi "belum cocok" lebih dulu,
    // supaya pembersihan di bawah tidak menghapus provisional karenanya.
    const tautanSalah = await perbaikiTautanManualSalah().catch((e) => {
      console.error('Perbaikan tautan manual gagal:', e);
      return null;
    });
    if (tautanSalah?.jumlah) {
      toastSukses(`${tautanSalah.jumlah} tautan manual yang keliru dikembalikan ke daftar tinjauan`
        + (tautanSalah.dibuatUlang ? ` (${tautanSalah.dibuatUlang} baris provisional dibuat ulang).` : '.'));
    }

    // Transaksi email yang sudah ditautkan manual ke baris e-statement tapi
    // baris provisional-nya tertinggal (perilaku "Tautkan manual" lama).
    const tertaut = await bersihkanProvisionalTertaut().catch((e) => {
      console.error('Pembersihan provisional tertaut gagal:', e);
      return null;
    });
    if (tertaut?.jumlah) {
      toastSukses(`${tertaut.jumlah} baris provisional yang sudah ditautkan ke e-statement dihapus `
        + `(${rupiah(tertaut.nominal)}).`);
    }

    // Email yang merujuk baris provisional yang sudah hilang -- transaksinya
    // lenyap dari saldo padahal label di halaman Email masih menampilkannya.
    const hilang = await pulihkanProvisionalHilang().catch((e) => {
      console.error('Pemulihan provisional hilang gagal:', e);
      return null;
    });
    if (hilang?.jumlah) {
      toastSukses(`${hilang.jumlah} transaksi email yang baris pembukuannya hilang dicatat ulang`
        + (hilang.dibuat ? ` (${hilang.dibuat} baris provisional dibuat).` : '.'));
    }

    // Provisional tanpa pemilik yang tampil di tinjauan, padahal kembarannya
    // di e-statement sudah ada -- tidak ada tombol yang bisa menjangkaunya.
    const takTerjangkau = await hapusProvisionalTakTerjangkau().catch((e) => {
      console.error('Pembersihan provisional tak terjangkau gagal:', e);
      return null;
    });
    if (takTerjangkau?.jumlah) {
      toastSukses(`${takTerjangkau.jumlah} baris provisional yang sudah ada di e-statement dihapus `
        + `(${rupiah(takTerjangkau.nominal)}).`);
    }

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
