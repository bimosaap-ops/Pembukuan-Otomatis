/**
 * Penanganan tanggal. Semua tanggal disimpan sebagai string 'YYYY-MM-DD' supaya
 * urutan leksikografis sama dengan urutan kronologis dan bebas dari masalah zona waktu.
 */

const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Nama bulan Indonesia dan Inggris -> indeks 0-11. Dipakai parser statement. */
const PETA_BULAN = (() => {
  const peta = new Map();
  const daftar = [
    ['jan', 'januari', 'january'], ['feb', 'februari', 'february', 'pebruari'],
    ['mar', 'maret', 'march'], ['apr', 'april'],
    ['mei', 'may'], ['jun', 'juni', 'june'],
    ['jul', 'juli', 'july'], ['agu', 'ags', 'agustus', 'aug', 'august'],
    ['sep', 'sept', 'september'], ['okt', 'oktober', 'oct', 'october'],
    ['nov', 'nop', 'november', 'nopember'], ['des', 'desember', 'dec', 'december'],
  ];
  daftar.forEach((nama, i) => nama.forEach((n) => peta.set(n, i)));
  return peta;
})();

export function namaBulan(idx, pendek = false) {
  return (pendek ? BULAN_PENDEK : BULAN_PANJANG)[idx] ?? '';
}

export function bulanDariNama(teks) {
  if (!teks) return null;
  const k = String(teks).toLowerCase().replace(/[^a-z]/g, '');
  return PETA_BULAN.has(k) ? PETA_BULAN.get(k) : null;
}

export function iso(tahun, bulanIdx, hari) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(tahun, 4)}-${p(bulanIdx + 1)}-${p(hari)}`;
}

export function hariIni() {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
}

export function validIso(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= hariDalamBulan(y, m - 1);
}

export function hariDalamBulan(tahun, bulanIdx) {
  return new Date(Date.UTC(tahun, bulanIdx + 1, 0)).getUTCDate();
}

/**
 * Membaca tanggal dari teks statement dengan berbagai format:
 * 25/07/2025, 25-07-25, 2025-07-25, "25 Jul 2025", "25 Juli 2025", dan
 * "25/07" (tanpa tahun — dipakai BCA, tahunnya diambil dari `tahunDefault`).
 * Mengembalikan 'YYYY-MM-DD' atau null.
 */
export function parseTanggal(teks, tahunDefault = null) {
  if (!teks) return null;
  const s = String(teks).trim();

  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return rakit(+m[1], +m[2] - 1, +m[3]);

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return rakit(normalisasiTahun(+m[3]), +m[2] - 1, +m[1]);

  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,12})[\s-]+(\d{2,4})/);
  if (m) {
    const b = bulanDariNama(m[2]);
    if (b !== null) return rakit(normalisasiTahun(+m[3]), b, +m[1]);
  }

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (m && tahunDefault) return rakit(tahunDefault, +m[2] - 1, +m[1]);

  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,12})(?![\s-]*\d)/);
  if (m && tahunDefault) {
    const b = bulanDariNama(m[2]);
    if (b !== null) return rakit(tahunDefault, b, +m[1]);
  }

  return null;
}

function rakit(tahun, bulanIdx, hari) {
  if (bulanIdx < 0 || bulanIdx > 11) return null;
  if (hari < 1 || hari > hariDalamBulan(tahun, bulanIdx)) return null;
  return iso(tahun, bulanIdx, hari);
}

function normalisasiTahun(y) {
  if (y >= 1000) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

/** 'YYYY-MM-DD' -> '25 Jul 2025' */
export function tanggalTampil(isoStr, pendek = true) {
  if (!validIso(isoStr)) return isoStr ?? '';
  const [y, m, d] = isoStr.split('-').map(Number);
  return `${d} ${namaBulan(m - 1, pendek)} ${y}`;
}

/** 'YYYY-MM' -> 'Juli 2025' */
export function bulanTampil(ym, pendek = false) {
  const [y, m] = String(ym).split('-').map(Number);
  if (!y || !m) return String(ym ?? '');
  return `${namaBulan(m - 1, pendek)} ${y}`;
}

export function kunciBulan(isoStr) {
  return String(isoStr ?? '').slice(0, 7);
}

export function kunciTahun(isoStr) {
  return String(isoStr ?? '').slice(0, 4);
}

/** Daftar 'YYYY-MM' berurutan dari bulan awal sampai bulan akhir (inklusif). */
export function rentangBulan(ymAwal, ymAkhir) {
  const hasil = [];
  if (!ymAwal || !ymAkhir) return hasil;
  let [y, m] = ymAwal.split('-').map(Number);
  const [ya, ma] = ymAkhir.split('-').map(Number);
  let batas = 0;
  while ((y < ya || (y === ya && m <= ma)) && batas++ < 600) {
    hasil.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return hasil;
}

/** Geser tanggal sejumlah bulan, hari akhir bulan tetap aman (31 Jan -1 bulan -> 31 Des). */
export function tambahBulan(isoStr, delta) {
  const [y, m, d] = isoStr.split('-').map(Number);
  const total = (y * 12) + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  return iso(ny, nm, Math.min(d, hariDalamBulan(ny, nm)));
}

export function awalBulan(isoStr) {
  return `${kunciBulan(isoStr)}-01`;
}

export function akhirBulan(isoStr) {
  const [y, m] = isoStr.split('-').map(Number);
  return iso(y, m - 1, hariDalamBulan(y, m - 1));
}

/**
 * Preset periode untuk filter. Mengembalikan {dari, sampai} dalam ISO.
 */
export function periodePreset(nama, acuan = hariIni()) {
  switch (nama) {
    case 'bulan-ini':
      return { dari: awalBulan(acuan), sampai: akhirBulan(acuan) };
    case 'bulan-lalu': {
      const l = tambahBulan(awalBulan(acuan), -1);
      return { dari: awalBulan(l), sampai: akhirBulan(l) };
    }
    case '3-bulan':
      return { dari: awalBulan(tambahBulan(acuan, -2)), sampai: akhirBulan(acuan) };
    case '6-bulan':
      return { dari: awalBulan(tambahBulan(acuan, -5)), sampai: akhirBulan(acuan) };
    case '12-bulan':
      return { dari: awalBulan(tambahBulan(acuan, -11)), sampai: akhirBulan(acuan) };
    case 'tahun-ini':
      return { dari: `${kunciTahun(acuan)}-01-01`, sampai: `${kunciTahun(acuan)}-12-31` };
    case 'tahun-lalu': {
      const t = Number(kunciTahun(acuan)) - 1;
      return { dari: `${t}-01-01`, sampai: `${t}-12-31` };
    }
    case 'semua':
    default:
      return { dari: '', sampai: '' };
  }
}

/**
 * Statement BCA hanya mencantumkan tanggal dan bulan. Saat daftar transaksi
 * melewati pergantian tahun (Desember -> Januari), tahunnya harus ikut naik.
 * Fungsi ini menerima daftar {bulanIdx, hari} berurutan dan tahun awal periode.
 */
export function isiTahunBerurutan(daftar, tahunAwal) {
  let tahun = tahunAwal;
  let bulanSebelumnya = null;
  return daftar.map(({ bulanIdx, hari }) => {
    if (bulanSebelumnya !== null && bulanIdx < bulanSebelumnya - 6) tahun += 1;
    bulanSebelumnya = bulanIdx;
    return rakit(tahun, bulanIdx, hari);
  });
}
