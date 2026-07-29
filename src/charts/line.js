/**
 * Grafik garis dengan area berarsir — dipakai untuk tren saldo.
 * Sumbu nilai sengaja tidak dipaksa mulai dari nol supaya perubahan saldo
 * yang kecil tetap terlihat bentuknya.
 */

import { svgEl, kanvas, kosongGrafik, judulAksesibilitas, labelRingkas, grafikResponsif } from './svg.js';

export function grafikGaris(data, opsi = {}) {
  if (data.length < 2) return kosongGrafik(opsi.kosong || 'Butuh minimal dua titik data untuk menggambar tren.');
  return grafikResponsif((L, T) => gambar(data, opsi, L, T), { tinggi: 230 });
}

function gambar(data, opsi, L, T) {
  const pad = { atas: 16, kanan: 12, bawah: 32, kiri: 56 };
  const x0 = pad.kiri;
  const x1 = L - pad.kanan;
  const y0 = pad.atas;
  const y1 = T - pad.bawah;

  const nilai = data.map((d) => d.nilai);
  let min = Math.min(...nilai);
  let maks = Math.max(...nilai);
  if (min === maks) { min -= Math.abs(min) * 0.1 || 1; maks += Math.abs(maks) * 0.1 || 1; }
  const jarak = maks - min;
  min -= jarak * 0.08;
  maks += jarak * 0.08;

  const x = (i) => x0 + (i / (data.length - 1)) * (x1 - x0);
  const y = (v) => y1 - ((v - min) / (maks - min)) * (y1 - y0);

  const svg = kanvas(L, T);
  const warna = opsi.warna || 'var(--c1)';

  // Kisi dan label sumbu nilai.
  for (let i = 0; i <= 4; i += 1) {
    const v = min + ((maks - min) * i) / 4;
    const yy = y(v);
    svg.appendChild(svgEl('line', { x1: x0, x2: x1, y1: yy, y2: yy, class: 'garis-kisi' }));
    svg.appendChild(svgEl('text', { x: x0 - 6, y: yy + 3, 'text-anchor': 'end', class: 'sumbu-teks' }, labelRingkas(v)));
  }

  const titik = data.map((d, i) => `${x(i).toFixed(1)},${y(d.nilai).toFixed(1)}`);

  const id = `area-${Math.random().toString(36).slice(2, 8)}`;
  const gradien = svgEl('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' }, [
    svgEl('stop', { offset: '0%', 'stop-color': warna, 'stop-opacity': '.28' }),
    svgEl('stop', { offset: '100%', 'stop-color': warna, 'stop-opacity': '0' }),
  ]);
  svg.appendChild(svgEl('defs', {}, gradien));

  svg.appendChild(svgEl('path', {
    d: `M ${titik[0]} L ${titik.slice(1).join(' L ')} L ${x(data.length - 1).toFixed(1)},${y1} L ${x(0).toFixed(1)},${y1} Z`,
    fill: `url(#${id})`,
  }));

  svg.appendChild(svgEl('polyline', {
    points: titik.join(' '),
    fill: 'none',
    stroke: warna,
    'stroke-width': 2.2,
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  }));

  data.forEach((d, i) => {
    const rapat = data.length > 18;
    if (!rapat || i === 0 || i === data.length - 1) {
      svg.appendChild(svgEl('circle', {
        cx: x(i), cy: y(d.nilai), r: 3, fill: 'var(--surface)', stroke: warna, 'stroke-width': 2,
      }, svgEl('title', {}, `${d.label}: ${labelRingkas(d.nilai)}`)));
    } else {
      // Titik tetap punya area sentuh tak terlihat supaya tooltip bisa dibuka di HP.
      svg.appendChild(svgEl('circle', { cx: x(i), cy: y(d.nilai), r: 7, fill: 'transparent' },
        svgEl('title', {}, `${d.label}: ${labelRingkas(d.nilai)}`)));
    }
  });

  // Jumlah label mengikuti lebar yang benar-benar tersedia.
  const langkahLabel = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor((x1 - x0) / 48))));
  data.forEach((d, i) => {
    if (i % langkahLabel !== 0 && i !== data.length - 1) return;
    svg.appendChild(svgEl('text', {
      x: x(i), y: T - 10, 'text-anchor': i === 0 ? 'start' : (i === data.length - 1 ? 'end' : 'middle'), class: 'sumbu-teks',
    }, d.label));
  });

  judulAksesibilitas(svg, opsi.judul || 'Grafik tren');
  return svg;
}
