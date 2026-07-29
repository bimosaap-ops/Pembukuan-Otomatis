/**
 * Dasar penggambaran grafik.
 *
 * Semua grafik digambar sebagai SVG dengan `viewBox` dan tanpa lebar tetap,
 * sehingga ikut melebar mengikuti kartu induknya — dari layar HP 360px sampai
 * monitor lebar — tanpa perlu mendengarkan perubahan ukuran jendela.
 * Warnanya memakai variabel CSS agar mode gelap tidak perlu kode tersendiri.
 */

const NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs = {}, anak = null) {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === null || v === undefined || v === false) return;
    el.setAttribute(k, String(v));
  });
  if (anak) [].concat(anak).forEach((a) => {
    if (!a) return;
    el.appendChild(a instanceof Node ? a : document.createTextNode(String(a)));
  });
  return el;
}

export function kanvas(lebar, tinggi, kelas = '') {
  return svgEl('svg', {
    viewBox: `0 0 ${lebar} ${tinggi}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    class: kelas,
  });
}

/** Pembulatan batas atas sumbu ke angka "bulat" supaya kisi enak dibaca. */
export function batasRapi(nilaiMaks) {
  if (!Number.isFinite(nilaiMaks) || nilaiMaks <= 0) return 1;
  const pangkat = 10 ** Math.floor(Math.log10(nilaiMaks));
  const rasio = nilaiMaks / pangkat;
  const tangga = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const pilih = tangga.find((t) => rasio <= t) ?? 10;
  return pilih * pangkat;
}

/** Label sumbu nilai dalam bentuk ringkas: 1.500.000 -> "1,5 jt". */
export function labelRingkas(n) {
  const abs = Math.abs(n);
  const tanda = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${tanda}${bulat(abs / 1e12)} T`;
  if (abs >= 1e9) return `${tanda}${bulat(abs / 1e9)} M`;
  if (abs >= 1e6) return `${tanda}${bulat(abs / 1e6)} jt`;
  if (abs >= 1e3) return `${tanda}${bulat(abs / 1e3)} rb`;
  return `${tanda}${bulat(abs)}`;
}

function bulat(n) {
  const v = Math.round(n * 10) / 10;
  return String(v).replace('.', ',');
}

/** Garis kisi horizontal beserta label nilainya. */
export function kisiHorizontal({ x0, x1, y0, y1, maks, min = 0, jumlah = 4 }) {
  const grup = svgEl('g');
  for (let i = 0; i <= jumlah; i += 1) {
    const rasio = i / jumlah;
    const nilai = min + (maks - min) * rasio;
    const y = y1 - (y1 - y0) * rasio;
    grup.appendChild(svgEl('line', { x1: x0, x2: x1, y1: y, y2: y, class: 'garis-kisi' }));
    grup.appendChild(svgEl('text', {
      x: x0 - 6, y: y + 3, 'text-anchor': 'end', class: 'sumbu-teks',
    }, labelRingkas(nilai)));
  }
  return grup;
}

/** Judul yang dibacakan pembaca layar — grafik tetap punya makna tanpa warna. */
export function judulAksesibilitas(svg, teks) {
  const t = svgEl('title', {}, teks);
  svg.insertBefore(t, svg.firstChild);
  svg.setAttribute('aria-label', teks);
  return svg;
}

export function wadahGrafik(svg, legenda = null) {
  const el = document.createElement('div');
  el.className = 'grafik';
  el.appendChild(svg);
  if (legenda) el.appendChild(legenda);
  return el;
}

/**
 * Wadah grafik yang menggambar ulang mengikuti lebar sebenarnya.
 *
 * SVG dengan viewBox tetap memang ikut melebar, tapi seluruh isinya — termasuk
 * teks sumbu — ikut mengecil ketika ditampilkan di kartu selebar 300px, sampai
 * angkanya tidak terbaca. Dengan menyamakan satuan viewBox dengan piksel nyata,
 * ukuran huruf tetap sama di HP maupun di monitor lebar.
 */
export function grafikResponsif(gambar, { tinggi = 260, minLebar = 260 } = {}) {
  const el = document.createElement('div');
  el.className = 'grafik';
  let lebarTerakhir = 0;

  const gambarUlang = (lebar) => {
    const pakai = Math.max(minLebar, Math.round(lebar));
    // Selisih kecil diabaikan supaya tidak menggambar ulang terus-menerus.
    if (Math.abs(pakai - lebarTerakhir) < 8) return;
    lebarTerakhir = pakai;
    el.replaceChildren(...[].concat(gambar(pakai, tinggi)).filter(Boolean));
  };

  if (typeof ResizeObserver === 'function') {
    const pengamat = new ResizeObserver((entri) => {
      const lebar = entri[0]?.contentRect?.width;
      if (lebar) gambarUlang(lebar);
    });
    // Pengamatan dimulai setelah elemen masuk ke halaman.
    queueMicrotask(() => pengamat.observe(el));
  }

  // Gambar awal memakai perkiraan, lalu diperbaiki begitu lebar aslinya diketahui.
  gambarUlang(minLebar * 2);
  return el;
}

export function kosongGrafik(pesan = 'Belum ada data untuk ditampilkan.') {
  const el = document.createElement('div');
  el.className = 'grafik__kosong';
  el.textContent = pesan;
  return el;
}

export function legenda(item) {
  const el = document.createElement('div');
  el.className = 'grafik__legenda';
  item.forEach(({ warna, label }) => {
    const span = document.createElement('span');
    span.className = 'grafik__legenda-item';
    const titik = document.createElement('span');
    titik.className = 'titik-warna';
    titik.style.setProperty('--titik', warna);
    span.append(titik, document.createTextNode(label));
    el.appendChild(span);
  });
  return el;
}
