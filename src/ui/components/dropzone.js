/**
 * Area unggah berkas: drag & drop di layar besar, ketuk untuk memilih di HP
 * (di HP tidak ada operasi seret, jadi seluruh area dijadikan tombol).
 */

import { h, ikon } from '../../core/dom.js';

export function dropzone({ onFile, terima = 'application/pdf', banyak = true }) {
  const input = h('input', {
    type: 'file',
    accept: terima,
    multiple: banyak,
    class: 'sr-only',
    onchange: () => {
      kirim([...input.files]);
      input.value = '';
    },
  });

  const zona = h('.dropzone', {
    role: 'button',
    tabindex: '0',
    'aria-label': 'Pilih atau seret berkas e-statement PDF',
    onclick: () => input.click(),
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    },
  }, [
    h('.dropzone__ikon', null, ikon('upload', 26)),
    h('.dropzone__judul', { text: 'Seret e-statement ke sini' }),
    h('.dropzone__ket', { text: 'Atau ketuk untuk memilih berkas. Bisa beberapa PDF sekaligus — data akan ditambahkan, bukan menimpa yang sudah ada.' }),
    h('span.lencana.lencana--brand', { text: 'PDF e-statement' }),
    input,
  ]);

  function kirim(files) {
    const pdf = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (pdf.length) onFile(pdf);
    else if (files.length) onFile([], 'Hanya berkas PDF yang bisa diproses.');
  }

  ['dragenter', 'dragover'].forEach((ev) => zona.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    zona.classList.add('seret');
  }));

  ['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (ev === 'dragleave' && zona.contains(e.relatedTarget)) return;
    zona.classList.remove('seret');
  }));

  zona.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) kirim(files);
  });

  return zona;
}

/**
 * Mencegah browser membuka berkas PDF sebagai halaman baru ketika pengguna
 * meleset menjatuhkannya di luar dropzone.
 */
export function cegahDropDiLuar() {
  ['dragover', 'drop'].forEach((ev) => {
    window.addEventListener(ev, (e) => {
      if (e.target.closest?.('.dropzone')) return;
      e.preventDefault();
    });
  });
}
