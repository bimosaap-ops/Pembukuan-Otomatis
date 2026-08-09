/**
 * Navigasi: sidebar (tablet & desktop) dan bottom navigation + sheet menu (HP).
 * Keduanya selalu ada di DOM; CSS yang menentukan mana yang tampil.
 */

import { h, ikon, qsa } from '../core/dom.js';
import { on, EVENT } from '../core/events.js';
import { MENU, menuUtama, menuTambahan } from './menu.js';
import { pergiKe, ruteAktif } from './router.js';
import { bukaSheet } from './components/modal.js';
import { terapkanTema, setTema, modeGelapAktif, TEMA } from './theme.js';

export function buatSidebar() {
  const tombol = MENU.map((m) => h('button.sidebar__btn', {
    type: 'button',
    dataset: { rute: m.id },
    onclick: () => pergiKe(m.id),
  }, [
    ikon(m.ikon, 21),
    h('span.sidebar__label', { text: m.label }),
  ]));

  return h('nav.sidebar', { 'aria-label': 'Menu utama' }, [
    h('.sidebar__merek', null, [
      h('.merek', null, [
        h('.merek__logo', { text: '📊', 'aria-hidden': 'true' }),
        h('.merek__teks', null, [
          h('div', { text: 'Pembukuan', style: { fontWeight: '800', fontSize: '1.05rem', letterSpacing: '-.01em' } }),
          h('div.redup-2', { text: 'Dashboard Keuangan', style: { fontSize: '.72rem' } }),
        ]),
      ]),
    ]),
    ...tombol,
    // Di layar lebar header tidak ditampilkan, jadi pengganti tema pindah ke sini.
    h('.sidebar__kaki', null, tombolTema()),
  ]);
}

/**
 * Tombol tema. Labelnya menyebut tujuan ("Mode gelap"), bukan keadaan sekarang,
 * supaya jelas apa yang akan terjadi kalau ditekan.
 */
function tombolTema() {
  const tombol = h('button.sidebar__btn', {
    type: 'button',
    onclick: async () => {
      const berikutnya = modeGelapAktif() ? TEMA.TERANG : TEMA.GELAP;
      try {
        await setTema(berikutnya);
      } catch {
        terapkanTema(berikutnya);
      }
      segarkan();
    },
  });

  function segarkan() {
    const gelap = modeGelapAktif();
    const label = gelap ? 'Mode terang' : 'Mode gelap';
    tombol.setAttribute('aria-label', label);
    tombol.title = label;
    tombol.replaceChildren(
      ikon(gelap ? 'terang' : 'gelap', 21),
      h('span.sidebar__label', { text: label }),
    );
  }

  segarkan();
  // Tema juga bisa diganti dari Pengaturan atau dari preferensi sistem.
  on(EVENT.TEMA_BERUBAH, segarkan);
  return tombol;
}

export function buatBottomNav() {
  const tombol = menuUtama().map((m) => h('button.bottomnav__btn', {
    type: 'button',
    dataset: { rute: m.id },
    onclick: () => pergiKe(m.id),
  }, [ikon(m.ikon, 21), h('span', { text: m.label })]));

  const tombolMenu = h('button.bottomnav__btn', {
    type: 'button',
    dataset: { rute: '__menu' },
    'aria-haspopup': 'dialog',
    onclick: bukaMenuTambahan,
  }, [ikon('menu', 21), h('span', { text: 'Menu' })]);

  return h('nav.bottomnav', { 'aria-label': 'Navigasi bawah' }, [...tombol, tombolMenu]);
}

function bukaMenuTambahan() {
  const aktif = ruteAktif();
  const sheet = bukaSheet({
    judul: 'Menu lainnya',
    isi: h('div', null, menuTambahan().map((m) => h('button.sheet__item', {
      type: 'button',
      'aria-current': m.id === aktif ? 'page' : null,
      onclick: () => { sheet.tutup(); pergiKe(m.id); },
    }, [
      h('span', { text: m.emoji, style: { fontSize: '1.15rem' } }),
      h('span.isi-penuh', { text: m.labelPanjang }),
    ]))),
  });
}

/** Menyorot menu yang sedang aktif di semua bentuk navigasi. */
export function pasangPenandaAktif() {
  const perbarui = (id) => {
    qsa('[data-rute]').forEach((btn) => {
      const rute = btn.dataset.rute;
      const aktif = rute === id;
      if (aktif) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
      btn.classList.toggle('aktif', aktif);
    });

    // Menu yang tidak ada di bottom navigation tetap perlu penanda:
    // tombol "Menu" ikut menyala bila halaman aktif berada di dalamnya.
    const diSheet = menuTambahan().some((m) => m.id === id);
    const btnMenu = document.querySelector('[data-rute="__menu"]');
    if (btnMenu) {
      btnMenu.classList.toggle('aktif', diSheet);
      if (diSheet) btnMenu.setAttribute('aria-current', 'page');
      else btnMenu.removeAttribute('aria-current');
    }
  };

  on(EVENT.RUTE_BERUBAH, perbarui);
  perbarui(ruteAktif());
}
