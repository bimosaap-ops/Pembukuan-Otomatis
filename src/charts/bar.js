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
 * @param {{seri:Array<{nama:string, warna:string}>, judul?:string,
 *          warnaNilai?:(nilai:number)=>string}} opsi
 *
 * `warnaNilai` memberi warna per batang, bukan per seri. Dipakai grafik arus kas
 * bersih: satu deret angka yang bisa positif atau negatif, dan tandanya justru
 * hal pertama yang ingin dilihat — bulan surplus dan bulan defisit harus bisa
 * dibedakan tanpa membaca sumbu.
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

  /* Nilai negatif (arus kas bersih) butuh ruang di bawah garis nol. Ruang itu
     dibagi menurut besar data yang sebenarnya, bukan separuh-separuh: kalau
     hanya satu bulan defisit dan nilainya kecil, membagi rata membuat separuh
     grafik kosong dan batang positifnya jadi kerdil. Tetap disisakan sedikit
     ruang minimum supaya batang negatif yang kecil tidak hilang sama sekali. */
  const maksPositif = Math.max(0, ...data.flatMap((d) => d.nilai));
  const maksNegatif = Math.max(0, ...data.flatMap((d) => d.nilai.map((v) => -v)));
  const adaNegatif = maksNegatif > 0;

  const batasPositif = batasRapi(maksPositif);
  const batasNegatif = batasRapi(maksNegatif);
  const jangkauan = batasPositif + batasNegatif;
  const bagianNegatif = adaNegatif && jangkauan
    ? Math.min(0.45, Math.max(0.12, batasNegatif / jangkauan))
    : 0;

  const tinggiPlot = y1 - y0;
  const tinggiPositif = tinggiPlot * (1 - bagianNegatif);
  const tinggiNegatif = tinggiPlot * bagianNegatif;
  const yNol = y0 + tinggiPositif;
  const skalaPositif = batasPositif ? tinggiPositif / batasPositif : 0;
  const skalaNegatif = batasNegatif ? tinggiNegatif / batasNegatif : 0;

  const svg = kanvas(L, T);

  if (adaNegatif) {
    const garis = (nilai) => {
      const y = nilai >= 0 ? yNol - nilai * skalaPositif : yNol + -nilai * skalaNegatif;
      svg.appendChild(svgEl('line', { x1: x0, x2: x1, y1: y, y2: y, class: 'garis-kisi' }));
      svg.appendChild(svgEl('text', {
        x: x0 - 6, y: y + 3, 'text-anchor': 'end', class: 'sumbu-teks',
      }, labelRingkas(nilai)));
    };
    [batasPositif, batasPositif / 2, 0, -batasNegatif].forEach(garis);
  } else {
    svg.appendChild(kisiHorizontal({ x0, x1, y0, y1, maks: batasPositif }));
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
      const tinggi = Math.abs(v) * (v >= 0 ? skalaPositif : skalaNegatif);
      const x = kiri + s * lebarBatang;
      const atas = v >= 0 ? yNol - tinggi : yNol;
      svg.appendChild(svgEl('rect', {
        x: x + 1,
        y: atas,
        width: Math.max(1, lebarBatang - 2),
        height: Math.max(v ? 1.5 : 0, tinggi),
        rx: Math.min(8, lebarBatang / 3),
        fill: opsi.warnaNilai ? opsi.warnaNilai(v) : (seri[s]?.warna || 'var(--c1)'),
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
