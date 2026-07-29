/**
 * Menyusun ulang potongan teks PDF menjadi baris dan kolom.
 *
 * PDF tidak menyimpan tabel — hanya potongan teks beserta koordinatnya. Modul ini
 * mengembalikan strukturnya: potongan yang sejajar secara vertikal dijadikan satu
 * baris, dan posisi horizontal (x) dipertahankan karena justru itulah yang
 * membedakan kolom Debit dari kolom Kredit pada rekening koran.
 *
 * Modul murni: masukannya sekadar daftar {str, x, y, w, h}, jadi seluruh logika
 * penyusunan baris bisa diuji di Node tanpa pdf.js maupun browser.
 */

/** Toleransi selisih y (dalam poin) agar dua potongan dianggap satu baris. */
const TOLERANSI_Y = 2.5;

/**
 * @param {Array} potongan daftar {str, x, y, w, h}
 * @returns {Array} baris [{ y, teks, items: [{x, w, str}] }] urut dari atas ke bawah
 */
export function susunBaris(potongan, toleransi = TOLERANSI_Y) {
  const bersih = potongan
    .filter((p) => p && typeof p.str === 'string' && p.str.trim() !== '')
    .map((p) => ({
      str: p.str,
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      w: Number(p.w) || 0,
      h: Number(p.h) || 0,
    }));

  if (!bersih.length) return [];

  // Koordinat y dalam PDF diukur dari bawah halaman, jadi menurun berarti ke bawah.
  bersih.sort((a, b) => (Math.abs(a.y - b.y) <= toleransi ? a.x - b.x : b.y - a.y));

  const baris = [];
  let sekarang = null;

  bersih.forEach((p) => {
    if (sekarang && Math.abs(sekarang.y - p.y) <= toleransi) {
      sekarang.items.push(p);
      // y baris diambil rata-rata agar potongan yang sedikit miring tidak menggeser klaster.
      sekarang.y = (sekarang.y * (sekarang.items.length - 1) + p.y) / sekarang.items.length;
      return;
    }
    sekarang = { y: p.y, items: [p] };
    baris.push(sekarang);
  });

  return baris.map((b) => {
    b.items.sort((a, c) => a.x - c.x);
    return { y: b.y, items: b.items, teks: rangkaiTeks(b.items) };
  });
}

/**
 * Menggabungkan potongan menjadi satu string. Jarak horizontal yang lebar
 * disisipi spasi supaya "TANGGAL" dan "KETERANGAN" tidak menempel jadi satu kata.
 */
export function rangkaiTeks(items) {
  let hasil = '';
  let xAkhir = null;

  items.forEach((it) => {
    if (xAkhir !== null) {
      const jarak = it.x - xAkhir;
      const lebarHuruf = (it.h || 8) * 0.3;
      if (jarak > lebarHuruf) hasil += ' ';
    }
    hasil += it.str;
    xAkhir = it.x + (it.w || 0);
  });

  return hasil.replace(/\s+/g, ' ').trim();
}

/** Potongan teks yang berada dalam rentang x tertentu. */
export function potongKolom(baris, xMin, xMaks) {
  const items = baris.items.filter((it) => {
    const tengah = it.x + (it.w || 0) / 2;
    return tengah >= xMin && tengah < xMaks;
  });
  return { items, teks: rangkaiTeks(items) };
}

/**
 * Mencari posisi x judul-judul kolom pada sebuah baris header.
 *
 * @param {object} baris baris hasil susunBaris
 * @param {Array<{nama:string, pola:RegExp}>} definisi
 * @returns {Map<string, {x:number, xAkhir:number}>|null}
 */
export function posisiHeader(baris, definisi) {
  const hasil = new Map();

  definisi.forEach(({ nama, pola }) => {
    // Judul kolom bisa terpecah jadi beberapa potongan ("TANG" + "GAL"),
    // jadi pencocokan dilakukan pada teks gabungan lalu dipetakan balik ke x.
    for (const it of baris.items) {
      if (pola.test(it.str.trim())) {
        hasil.set(nama, { x: it.x, xAkhir: it.x + (it.w || 0) });
        return;
      }
    }
    const gabung = baris.teks;
    const m = gabung.match(pola);
    if (!m) return;
    const posisi = perkiraanXdariIndeks(baris, gabung.indexOf(m[0]));
    if (posisi !== null) hasil.set(nama, { x: posisi, xAkhir: posisi });
  });

  return hasil.size ? hasil : null;
}

function perkiraanXdariIndeks(baris, indeks) {
  if (indeks < 0) return null;
  let jalan = 0;
  for (const it of baris.items) {
    const panjang = it.str.length + 1;
    if (indeks < jalan + panjang) {
      const dalam = Math.max(0, indeks - jalan);
      const rasio = it.str.length ? dalam / it.str.length : 0;
      return it.x + rasio * (it.w || 0);
    }
    jalan += panjang;
  }
  return null;
}

/**
 * Mengubah posisi judul kolom menjadi batas-batas band.
 * Batas antar kolom diletakkan di tengah celah antara judul yang berdampingan.
 *
 * @returns {Map<string, {min:number, maks:number}>}
 */
export function bandDariHeader(posisi, lebarHalaman = 1000) {
  const urut = [...posisi.entries()].sort((a, b) => a[1].x - b[1].x);
  const band = new Map();

  urut.forEach(([nama, pos], i) => {
    const sebelum = urut[i - 1];
    const sesudah = urut[i + 1];
    const min = sebelum ? (sebelum[1].xAkhir + pos.x) / 2 : -Infinity;
    const maks = sesudah ? (pos.xAkhir + sesudah[1].x) / 2 : lebarHalaman + 1000;
    band.set(nama, { min, maks });
  });

  return band;
}

/** Baris kosong dan garis pemisah dibuang agar tidak mengacaukan penggabungan deskripsi. */
export function buangBarisKosong(baris) {
  return baris.filter((b) => b.teks && !/^[-_=.\s|]+$/.test(b.teks));
}

/** Seluruh teks halaman, dipakai untuk deteksi bank dan panel "lihat teks mentah". */
export function teksPenuh(baris) {
  return baris.map((b) => b.teks).join('\n');
}

/** Lebar halaman diperkirakan dari potongan paling kanan, dipakai sebagai batas band. */
export function perkiraanLebar(baris) {
  let maks = 0;
  baris.forEach((b) => b.items.forEach((it) => {
    maks = Math.max(maks, it.x + (it.w || 0));
  }));
  return maks || 1000;
}
