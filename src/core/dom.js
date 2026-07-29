/**
 * Helper DOM seperlunya. Tidak ada framework — cukup pembuat elemen dan
 * beberapa utilitas yang dipakai berulang oleh view.
 */

/**
 * h('div.kartu', { onclick }, ['isi'])
 * Selector mendukung tag, .kelas, dan #id.
 */
export function h(selector, props = null, anak = null) {
  const m = String(selector).match(/^([a-zA-Z0-9-]*)((?:[.#][\w-]+)*)$/);
  const tag = (m?.[1] || 'div');
  const el = document.createElement(tag);

  if (m?.[2]) {
    m[2].match(/[.#][\w-]+/g).forEach((tok) => {
      if (tok[0] === '.') el.classList.add(tok.slice(1));
      else el.id = tok.slice(1);
    });
  }

  if (props) {
    Object.entries(props).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = `${el.className} ${v}`.trim();
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && k !== 'list' && typeof v !== 'object') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
  }

  tambah(el, anak);
  return el;
}

export function tambah(induk, anak) {
  if (anak === null || anak === undefined || anak === false) return induk;
  if (Array.isArray(anak)) {
    anak.forEach((a) => tambah(induk, a));
    return induk;
  }
  induk.appendChild(anak instanceof Node ? anak : document.createTextNode(String(anak)));
  return induk;
}

export function kosongkan(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function ganti(el, anak) {
  kosongkan(el);
  return tambah(el, anak);
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Ikon SVG inline agar tidak perlu file gambar terpisah dan ikut tema. */
export function ikon(nama, ukuran = 20) {
  const jalur = IKON[nama];
  if (!jalur) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', ukuran);
  svg.setAttribute('height', ukuran);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  jalur.forEach((d) => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  });
  return svg;
}

const IKON = {
  dashboard: ['M3 12l9-8 9 8', 'M5 10v10h14V10'],
  upload: ['M12 16V4', 'M8 8l4-4 4 4', 'M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3'],
  rekening: ['M3 7h18v12H3z', 'M3 11h18', 'M7 15h4'],
  transaksi: ['M4 7h13', 'M14 4l3 3-3 3', 'M20 17H7', 'M10 14l-3 3 3 3'],
  analitik: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  laporan: ['M6 3h9l5 5v13H6z', 'M15 3v5h5', 'M9 13h7', 'M9 17h7'],
  riwayat: ['M3 7l2-3h5l2 3h7a1 1 0 011 1v11a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1z'],
  kategori: ['M3 3h8v8H3z', 'M13 3h8v8h-8z', 'M3 13h8v8H3z', 'M13 13h8v8h-8z'],
  pengaturan: ['M12 15a3 3 0 100-6 3 3 0 000 6z', 'M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.6 1.6 0 008.7 19a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1A1.6 1.6 0 004.6 8.7a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  tutup: ['M6 6l12 12', 'M18 6L6 18'],
  cari: ['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.3-4.3'],
  tambah: ['M12 5v14', 'M5 12h14'],
  unduh: ['M12 4v12', 'M8 12l4 4 4-4', 'M4 20h16'],
  hapus: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13'],
  edit: ['M4 20h4l10-10-4-4L4 16z', 'M14 6l4 4'],
  cek: ['M5 13l4 4L19 7'],
  peringatan: ['M12 3l9 16H3z', 'M12 10v4', 'M12 17h.01'],
  terang: ['M12 17a5 5 0 100-10 5 5 0 000 10z', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'M5 5l1.5 1.5', 'M17.5 17.5L19 19', 'M19 5l-1.5 1.5', 'M6.5 17.5L5 19'],
  gelap: ['M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z'],
};

/** Fokus ke elemen pertama yang bisa difokus di dalam sebuah wadah (untuk modal). */
export function fokusPertama(wadah) {
  const el = wadah.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  el?.focus();
}

/** Debounce untuk kotak pencarian. */
export function debounce(fn, ms = 250) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
