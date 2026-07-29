/**
 * Modal dan bottom sheet. Di HP muncul dari bawah layar, di layar lebar
 * jadi kotak di tengah — perbedaannya diatur CSS, bukan JavaScript.
 */

import { h, ikon, fokusPertama } from '../../core/dom.js';

/**
 * bukaModal({ judul, isi, aksi, lebar })
 * `aksi` adalah daftar tombol; mengembalikan objek dengan fungsi tutup().
 */
export function bukaModal({ judul, isi, aksi = [], lebar = false, onTutup = null }) {
  const sebelumnya = document.activeElement;

  const kotak = h(`.modal${lebar ? '.modal--lebar' : ''}`, {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': judul || 'Dialog',
  }, [
    h('.modal__kepala', null, [
      h('.modal__judul', { text: judul || '' }),
      h('button.btn-halus.btn-ikon', {
        type: 'button', 'aria-label': 'Tutup', onclick: () => tutup(),
      }, ikon('tutup', 20)),
    ]),
    h('.modal__isi', null, isi),
    aksi.length ? h('.modal__kaki', null, aksi) : null,
  ]);

  const latar = h('.modal-latar', {
    onclick: (e) => { if (e.target === latar) tutup(); },
  }, kotak);

  function padaTombol(e) {
    if (e.key === 'Escape') { e.preventDefault(); tutup(); }
  }

  function tutup() {
    document.removeEventListener('keydown', padaTombol);
    latar.remove();
    document.body.style.overflow = '';
    sebelumnya?.focus?.();
    onTutup?.();
  }

  document.addEventListener('keydown', padaTombol);
  document.body.appendChild(latar);
  document.body.style.overflow = 'hidden';
  fokusPertama(kotak);

  return { el: kotak, tutup };
}

/** Konfirmasi ya/tidak. Mengembalikan Promise<boolean>. */
export function konfirmasi({ judul = 'Konfirmasi', pesan, tombolYa = 'Ya, lanjutkan', bahaya = false }) {
  return new Promise((resolve) => {
    let jawab = false;
    const m = bukaModal({
      judul,
      isi: h('p.mb-0', { text: pesan }),
      aksi: [
        h('button', { type: 'button', onclick: () => m.tutup() }, 'Batal'),
        h(`button.${bahaya ? 'btn-bahaya' : 'btn-primary'}`, {
          type: 'button',
          onclick: () => { jawab = true; m.tutup(); },
        }, tombolYa),
      ],
      onTutup: () => resolve(jawab),
    });
  });
}

/** Kotak isian satu baris, mis. password PDF. Mengembalikan Promise<string|null>. */
export function tanyaTeks({ judul, pesan, label, tipe = 'text', nilaiAwal = '', tombol = 'Lanjutkan' }) {
  return new Promise((resolve) => {
    let hasil = null;
    const input = h('input', { type: tipe, value: nilaiAwal, autocomplete: 'off' });

    const m = bukaModal({
      judul,
      isi: h('.tumpuk', null, [
        pesan ? h('p.redup.mb-0', { text: pesan }) : null,
        h('div', null, [h('label', { text: label || '' }), input]),
      ]),
      aksi: [
        h('button', { type: 'button', onclick: () => m.tutup() }, 'Batal'),
        h('button.btn-primary', {
          type: 'button',
          onclick: () => { hasil = input.value; m.tutup(); },
        }, tombol),
      ],
      onTutup: () => resolve(hasil),
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { hasil = input.value; m.tutup(); }
    });
    setTimeout(() => input.focus(), 30);
  });
}

/** Bottom sheet untuk menu tambahan di HP. */
export function bukaSheet({ judul, isi }) {
  const sheet = h('.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': judul || 'Menu' }, [
    h('.sheet__pegangan'),
    judul ? h('.sheet__judul', { text: judul }) : null,
    isi,
  ]);

  const latar = h('.sheet-latar', { onclick: (e) => { if (e.target === latar) tutup(); } }, sheet);

  function padaTombol(e) { if (e.key === 'Escape') tutup(); }
  function tutup() {
    document.removeEventListener('keydown', padaTombol);
    latar.remove();
    document.body.style.overflow = '';
  }

  document.addEventListener('keydown', padaTombol);
  document.body.appendChild(latar);
  document.body.style.overflow = 'hidden';
  fokusPertama(sheet);

  return { el: sheet, tutup };
}
