/**
 * Pemformatan angka, uang, dan teks dalam gaya Indonesia.
 * Modul murni: tidak menyentuh DOM maupun database.
 */

const nfCache = new Map();

/**
 * Menafsirkan angka yang hanya memakai satu jenis pemisah, mis. "1.500" atau "1234,89".
 * Lebih dari satu kemunculan pasti pemisah ribuan. Satu kemunculan dengan tepat tiga
 * digit di belakangnya juga dianggap ribuan — nominal rupiah tidak pernah punya tiga
 * angka desimal, sedangkan "1.500" sangat lazim.
 */
function satuPemisah(s, sep) {
  const bagian = s.split(sep);
  if (bagian.length > 2) return bagian.join('');
  if (bagian[1] && bagian[1].length === 3) return bagian.join('');
  return bagian.join('.');
}

function nf(minFrac, maxFrac) {
  const key = `${minFrac}:${maxFrac}`;
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: minFrac,
      maximumFractionDigits: maxFrac,
    });
    nfCache.set(key, f);
  }
  return f;
}

/** 1234567.5 -> "1.234.567,50" */
export function angka(n, desimal = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return nf(desimal, desimal).format(v);
}

/** 1234567 -> "Rp 1.234.568" (dibulatkan, tanpa sen — cara baca paling umum di Indonesia) */
export function rupiah(n, opts = {}) {
  const { desimal = 0, tanpaSimbol = false, tanda = false } = opts;
  const v = Number(n) || 0;
  const abs = nf(desimal, desimal).format(Math.abs(v));
  const prefix = tanpaSimbol ? '' : 'Rp ';
  if (tanda && v > 0) return `+${prefix}${abs}`;
  if (v < 0) return `-${prefix}${abs}`;
  return `${prefix}${abs}`;
}

/** Versi ringkas untuk kartu KPI di layar sempit: 1.250.000 -> "Rp 1,25 jt" */
export function rupiahRingkas(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const tanda = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${tanda}Rp ${angka(abs / 1e12, 2)} T`;
  if (abs >= 1e9) return `${tanda}Rp ${angka(abs / 1e9, 2)} M`;
  if (abs >= 1e6) return `${tanda}Rp ${angka(abs / 1e6, 2)} jt`;
  if (abs >= 1e3) return `${tanda}Rp ${angka(abs / 1e3, 0)} rb`;
  return `${tanda}Rp ${angka(abs, 0)}`;
}

/**
 * Membaca angka bergaya Indonesia maupun internasional dari teks statement.
 * Menangani "1.234.567,89" (id) dan "1,234,567.89" (en), tanda kurung untuk negatif,
 * serta akhiran DB/CR yang dipakai BCA.
 * Mengembalikan null bila teks bukan angka — pemanggil yang memutuskan artinya.
 */
export function parseAngka(teks) {
  if (typeof teks === 'number') return Number.isFinite(teks) ? teks : null;
  if (!teks) return null;

  let s = String(teks).trim();
  if (!s) return null;

  let negatif = false;
  if (/^\(.*\)$/.test(s)) {
    negatif = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/\b(DB|DR|CR|D|K)\b\.?$/i, '').trim();
  if (/^-/.test(s)) {
    negatif = true;
    s = s.slice(1).trim();
  }
  s = s.replace(/[^\d.,]/g, '');
  if (!s || !/\d/.test(s)) return null;

  const titik = s.lastIndexOf('.');
  const koma = s.lastIndexOf(',');

  if (titik >= 0 && koma >= 0) {
    // Dua-duanya muncul: pemisah desimal adalah yang paling akhir.
    if (koma > titik) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (koma >= 0) {
    s = satuPemisah(s, ',');
  } else if (titik >= 0) {
    s = satuPemisah(s, '.');
  }

  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return negatif ? -v : v;
}

/** Ubah input form (boleh "1.500.000" atau "1500000") menjadi angka. */
export function toNum(v) {
  const n = parseAngka(v);
  return n === null ? 0 : n;
}

/** Rapikan deskripsi transaksi: spasi ganda dihilangkan, huruf disamakan. */
export function normalisasiDeskripsi(teks) {
  return String(teks ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

/** Sembunyikan sebagian nomor rekening: "1234567890" -> "•••• 7890" */
export function maskRekening(nomor) {
  const s = String(nomor ?? '').replace(/\s/g, '');
  if (s.length <= 4) return s;
  return `•••• ${s.slice(-4)}`;
}

export function persen(bagian, total, desimal = 1) {
  if (!total) return '0%';
  return `${angka((bagian / total) * 100, desimal)}%`;
}
