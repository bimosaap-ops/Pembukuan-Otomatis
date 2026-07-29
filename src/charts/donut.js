/**
 * Grafik donat untuk komposisi pengeluaran per kategori.
 * Bagian tengahnya dipakai menampilkan total, sehingga angka pentingnya tetap
 * terbaca walau potongan kecil sulit dibedakan di layar HP.
 */

import { svgEl, kanvas, wadahGrafik, kosongGrafik, legenda, judulAksesibilitas } from './svg.js';
import { rupiahRingkas, persen } from '../core/format.js';

export function grafikDonat(data, opsi = {}) {
  const isi = data.filter((d) => Math.abs(d.nilai) > 0);
  if (!isi.length) return kosongGrafik(opsi.kosong);

  const L = 260;
  const T = 260;
  const pusat = L / 2;
  const rLuar = 104;
  const rDalam = 66;

  const total = isi.reduce((s, d) => s + Math.abs(d.nilai), 0);
  const svg = kanvas(L, T);

  let sudut = -Math.PI / 2; // mulai dari atas

  isi.forEach((d) => {
    const bagian = Math.abs(d.nilai) / total;
    const sapuan = bagian * Math.PI * 2;

    // Satu-satunya bagian yang mengisi lingkaran penuh tidak bisa digambar
    // dengan busur (titik awal dan akhirnya berimpit), jadi dipakai cincin.
    if (bagian > 0.9999) {
      svg.appendChild(svgEl('circle', {
        cx: pusat, cy: pusat, r: (rLuar + rDalam) / 2,
        fill: 'none', stroke: d.warna, 'stroke-width': rLuar - rDalam,
      }, svgEl('title', {}, `${d.label}: ${rupiahRingkas(d.nilai)}`)));
    } else {
      svg.appendChild(svgEl('path', {
        d: jalurBusur(pusat, pusat, rDalam, rLuar, sudut, sudut + sapuan),
        fill: d.warna,
      }, svgEl('title', {}, `${d.label}: ${rupiahRingkas(d.nilai)} (${persen(Math.abs(d.nilai), total)})`)));
    }
    sudut += sapuan;
  });

  svg.appendChild(svgEl('text', {
    x: pusat, y: pusat - 4, 'text-anchor': 'middle',
    style: 'font-size:13px;font-weight:700;fill:var(--text)',
  }, rupiahRingkas(total)));
  svg.appendChild(svgEl('text', {
    x: pusat, y: pusat + 14, 'text-anchor': 'middle', class: 'sumbu-teks',
  }, opsi.labelTengah || 'Total'));

  judulAksesibilitas(svg, opsi.judul || 'Komposisi per kategori');

  const wadah = wadahGrafik(svg, legenda(isi.slice(0, 8).map((d) => ({
    warna: d.warna,
    label: `${d.label} · ${persen(Math.abs(d.nilai), total)}`,
  }))));
  wadah.querySelector('svg').style.maxWidth = '260px';
  wadah.querySelector('svg').style.margin = '0 auto';
  return wadah;
}

function jalurBusur(cx, cy, rDalam, rLuar, mulai, selesai) {
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = p(rLuar, mulai);
  const [x2, y2] = p(rLuar, selesai);
  const [x3, y3] = p(rDalam, selesai);
  const [x4, y4] = p(rDalam, mulai);
  const besar = selesai - mulai > Math.PI ? 1 : 0;

  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rLuar} ${rLuar} 0 ${besar} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rDalam} ${rDalam} 0 ${besar} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}
