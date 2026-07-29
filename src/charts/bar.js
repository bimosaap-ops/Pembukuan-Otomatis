/**
 * Grafik batang berkelompok — dipakai untuk "Pemasukan vs Pengeluaran per bulan".
 * Setiap kelompok mewakili satu bulan dengan dua batang berdampingan.
 *
 * Digambar ulang mengikuti lebar kartu sehingga ukuran huruf sumbu tetap sama
 * di layar HP maupun monitor lebar.
 */

import {
  svgEl, kanvas, batasRapi, kisiHorizontal, kosongGrafik, legenda,
  judulAksesibilitas, labelRingkas, grafikResponsif,
} from './svg.js';

/** Batang tidak dibiarkan melebar tanpa batas saat datanya sedikit. */
const LEBAR_BATANG_MAKS = 46;

/**
 * @param {Array<{label:string, nilai:Array<number>}>} data
 * @param {{seri:Array<{nama:string, warna:string}>, judul?:string}} opsi
 */
export function grafikBatang(data, opsi = {}) {
  const seri = opsi.seri || [{ nama: 'Nilai', warna: 'var(--c1)' }];
  if (!data.length) return kosongGrafik(opsi.kosong);

  return grafikResponsif((L, T) => {
    const svg = gambar(data, seri, opsi, L, T);
    return [
      svg,
      seri.length > 1 ? legenda(seri.map((s) => ({ warna: s.warna, label: s.nama }))) : null,
    ];
  }, { tinggi: 250 });
}

function gambar(data, seri, opsi, L, T) {
  const pad = { atas: 12, kanan: 8, bawah: 30, kiri: 54 };
  const x0 = pad.kiri;
  const x1 = L - pad.kanan;
  const y0 = pad.atas;
  const y1 = T - pad.bawah;

  // Nilai negatif (arus kas bersih) butuh ruang di bawah garis nol.
  const maksPositif = Math.max(0, ...data.flatMap((d) => d.nilai));
  const maksNegatif = Math.max(0, ...data.flatMap((d) => d.nilai.map((v) => -v)));
  const adaNegatif = maksNegatif > 0;

  const maks = batasRapi(Math.max(maksPositif, maksNegatif));
  const yNol = adaNegatif ? (y0 + y1) / 2 : y1;
  const skala = (adaNegatif ? (y1 - y0) / 2 : y1 - y0) / (maks || 1);

  const svg = kanvas(L, T);

  if (adaNegatif) {
    for (let i = -2; i <= 2; i += 1) {
      const y = yNol - (i / 2) * (y1 - y0) / 2;
      svg.appendChild(svgEl('line', { x1: x0, x2: x1, y1: y, y2: y, class: 'garis-kisi' }));
      svg.appendChild(svgEl('text', {
        x: x0 - 6, y: y + 3, 'text-anchor': 'end', class: 'sumbu-teks',
      }, labelRingkas((i / 2) * maks)));
    }
  } else {
    svg.appendChild(kisiHorizontal({ x0, x1, y0, y1, maks }));
  }

  const lebarKelompok = (x1 - x0) / data.length;
  const jedaKelompok = Math.min(10, lebarKelompok * 0.18);
  const lebarBatang = Math.min(
    LEBAR_BATANG_MAKS,
    Math.max(3, (lebarKelompok - jedaKelompok) / seri.length),
  );
  const lebarIsi = lebarBatang * seri.length;

  data.forEach((d, i) => {
    // Batang dipusatkan pada kelompoknya agar tetap rapi saat lebarnya dibatasi.
    const tengahKelompok = x0 + i * lebarKelompok + lebarKelompok / 2;
    const kiri = tengahKelompok - lebarIsi / 2;

    d.nilai.forEach((v, s) => {
      const tinggi = Math.abs(v) * skala;
      const x = kiri + s * lebarBatang;
      const atas = v >= 0 ? yNol - tinggi : yNol;
      svg.appendChild(svgEl('rect', {
        x: x + 1,
        y: atas,
        width: Math.max(1, lebarBatang - 2),
        height: Math.max(v ? 1.5 : 0, tinggi),
        rx: Math.min(3, lebarBatang / 3),
        fill: seri[s]?.warna || 'var(--c1)',
      }, svgEl('title', {}, `${d.label} · ${seri[s]?.nama || ''}: ${labelRingkas(v)}`)));
    });

    // Label bulan diselang-seling bila kelompoknya rapat, agar tidak tumpang tindih.
    const muat = Math.max(1, Math.floor((x1 - x0) / 34));
    const langkah = Math.ceil(data.length / muat);
    if (i % langkah === 0 || data.length === 1) {
      svg.appendChild(svgEl('text', {
        x: tengahKelompok, y: T - 10, 'text-anchor': 'middle', class: 'sumbu-teks',
      }, d.label));
    }
  });

  svg.appendChild(svgEl('line', { x1: x0, x2: x1, y1: yNol, y2: yNol, class: 'garis-kisi' }));
  judulAksesibilitas(svg, opsi.judul || 'Grafik batang');
  return svg;
}

/**
 * Batang horizontal untuk peringkat — dipakai "Top Pengeluaran" dan
 * "Pengeluaran per Kategori" saat jumlah kategorinya banyak.
 * Dibuat dari elemen HTML biasa, jadi teksnya selalu seukuran teks lain.
 */
export function grafikBatangHorizontal(data, opsi = {}) {
  if (!data.length) return kosongGrafik(opsi.kosong);

  const maks = Math.max(...data.map((d) => Math.abs(d.nilai))) || 1;
  const el = document.createElement('div');
  el.className = 'daftar';

  data.forEach((d) => {
    const item = document.createElement('div');
    item.className = 'daftar__item';
    item.style.display = 'block';

    const atas = document.createElement('div');
    atas.className = 'baris-antara';
    const kiri = document.createElement('div');
    kiri.className = 'daftar__judul putus';
    kiri.textContent = d.label;
    const kanan = document.createElement('div');
    kanan.className = 'daftar__nilai';
    kanan.textContent = opsi.formatNilai ? opsi.formatNilai(d.nilai) : labelRingkas(d.nilai);
    atas.append(kiri, kanan);

    const bar = document.createElement('div');
    bar.className = 'bar-mini';
    const isi = document.createElement('div');
    isi.className = 'bar-mini__isi';
    isi.style.width = `${(Math.abs(d.nilai) / maks) * 100}%`;
    isi.style.setProperty('--bar-warna', d.warna || 'var(--c1)');
    bar.appendChild(isi);

    item.append(atas, bar);
    if (d.ket) {
      const ket = document.createElement('div');
      ket.className = 'daftar__ket';
      ket.textContent = d.ket;
      item.appendChild(ket);
    }
    el.appendChild(item);
  });

  return el;
}
