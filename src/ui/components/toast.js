/** Pemberitahuan singkat di pojok layar. */

import { h, ikon } from '../../core/dom.js';

let wadah = null;

function siapkanWadah() {
  if (wadah && document.body.contains(wadah)) return wadah;
  wadah = h('.toast-wadah', { role: 'status', 'aria-live': 'polite' });
  document.body.appendChild(wadah);
  return wadah;
}

const IKON_JENIS = { sukses: 'cek', gagal: 'peringatan', warning: 'peringatan', info: 'cek' };

export function toast(pesan, jenis = 'info', durasi = 4000) {
  const el = h(`.toast.toast--${jenis}`, null, [
    ikon(IKON_JENIS[jenis] || 'cek', 18),
    h('div.isi-penuh', { text: pesan }),
    h('button.toast__tutup', { type: 'button', 'aria-label': 'Tutup', onclick: () => el.remove() }, ikon('tutup', 16)),
  ]);
  siapkanWadah().appendChild(el);
  if (durasi > 0) setTimeout(() => el.remove(), durasi);
  return el;
}

export const toastSukses = (p) => toast(p, 'sukses');
export const toastGagal = (p) => toast(p, 'gagal', 7000);
export const toastWarning = (p) => toast(p, 'warning', 6000);
