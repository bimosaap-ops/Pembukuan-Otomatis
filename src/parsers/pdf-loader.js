/**
 * Membuka berkas PDF dan mengambil potongan teks beserta koordinatnya.
 *
 * pdf.js disalin ke dalam repo (lihat keuangan/vendor/) supaya aplikasi tetap
 * berfungsi offline sebagai PWA dan tidak bergantung pada CDN mana pun.
 * Seluruh proses berjalan di perangkat pengguna — berkas tidak pernah dikirim ke server.
 */

const JALUR_PDFJS = new URL('../../vendor/pdfjs/pdf.min.js', import.meta.url).href;
const JALUR_WORKER = new URL('../../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;

let pemuat = null;

/** Memuat pdf.js sekali saja, lalu dipakai ulang. */
export function muatPdfJs() {
  if (pemuat) return pemuat;

  pemuat = new Promise((resolve, reject) => {
    if (globalThis.pdfjsLib) {
      globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = JALUR_WORKER;
      resolve(globalThis.pdfjsLib);
      return;
    }

    const s = document.createElement('script');
    s.src = JALUR_PDFJS;
    s.onload = () => {
      if (!globalThis.pdfjsLib) {
        reject(new Error('pdf.js termuat tetapi tidak terdaftar. Coba muat ulang halaman.'));
        return;
      }
      globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = JALUR_WORKER;
      resolve(globalThis.pdfjsLib);
    };
    s.onerror = () => reject(new Error('Gagal memuat pdf.js dari folder vendor.'));
    document.head.appendChild(s);
  });

  return pemuat;
}

export class ButuhPassword extends Error {
  constructor(salah = false) {
    super(salah ? 'Password PDF salah.' : 'PDF ini dilindungi password.');
    this.name = 'ButuhPassword';
    this.salah = salah;
  }
}

/**
 * Membuka dokumen PDF.
 * @throws {ButuhPassword} bila berkas terenkripsi dan password belum/salah diberikan.
 */
export async function bukaDokumen(dataAsli, password = '') {
  const pdfjsLib = await muatPdfJs();

  // pdf.js memindahkan buffer ke worker sehingga buffer aslinya menjadi kosong.
  // Salinan baru dibuat setiap percobaan agar pengisian ulang password tetap bisa jalan.
  const data = salinBuffer(dataAsli);

  try {
    const tugas = pdfjsLib.getDocument({
      data,
      password: password || undefined,
      isEvalSupported: false,
      useSystemFonts: false,
    });
    return await tugas.promise;
  } catch (e) {
    if (e?.name === 'PasswordException') {
      // code 2 = password yang diberikan salah, code 1 = belum ada password.
      throw new ButuhPassword(e.code === 2);
    }
    throw e;
  }
}

function salinBuffer(sumber) {
  const view = sumber instanceof Uint8Array ? sumber : new Uint8Array(sumber);
  return view.slice();
}

/**
 * Mengambil potongan teks tiap halaman dalam bentuk {str, x, y, w, h}.
 * Fungsi ini menerima dokumen pdf.js yang sudah terbuka, sehingga bisa dipakai
 * ulang oleh berkas uji di Node yang membuka PDF-nya dengan caranya sendiri.
 */
export async function ekstrakPotongan(dokumen, { onProgress = null, batasHalaman = 0, ambilWarna = true } = {}) {
  const total = dokumen.numPages;
  const batas = batasHalaman > 0 ? Math.min(batasHalaman, total) : total;
  const halaman = [];
  const warna = [];

  for (let i = 1; i <= batas; i += 1) {
    const page = await dokumen.getPage(i);
    const isi = await page.getTextContent({ disableCombineTextItems: false });

    const potongan = isi.items
      .filter((it) => typeof it.str === 'string')
      .map((it) => ({
        str: it.str,
        // transform = [a, b, c, d, e, f]; e dan f adalah posisi x dan y.
        x: it.transform[4],
        y: it.transform[5],
        w: it.width || 0,
        h: it.height || Math.abs(it.transform[3]) || 8,
      }));

    halaman.push(potongan);
    warna.push(ambilWarna ? await warnaTeks(page) : []);
    page.cleanup?.();
    onProgress?.(i, batas);
  }

  return { halaman, warna, jumlahHalaman: total };
}

/**
 * Mengambil warna isian setiap potongan teks, berurutan sesuai penggambaran.
 *
 * Sebagian statement tidak punya kolom Debit/Kredit terpisah maupun penanda DB/CR;
 * satu-satunya pembeda arah transaksi adalah warna nominalnya — merah untuk uang
 * keluar, hijau untuk uang masuk. Warna itu tidak tersedia lewat `getTextContent`,
 * jadi harus dibaca dari daftar operator penggambaran halaman.
 *
 * Kegagalan di sini tidak fatal: bila warnanya tak terbaca, adapter kembali
 * memakai kata kunci deskripsi.
 */
export async function warnaTeks(page) {
  try {
    const pdfjsLib = await muatPdfJs();
    const { OPS } = pdfjsLib;
    const ops = await page.getOperatorList();
    const hasil = [];
    let rgb = null;

    for (let i = 0; i < ops.fnArray.length; i += 1) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];

      if (fn === OPS.setFillRGBColor) {
        rgb = { r: args[0], g: args[1], b: args[2] };
      } else if (fn === OPS.setFillGray) {
        const v = Math.round((args[0] ?? 0) * 255);
        rgb = { r: v, g: v, b: v };
      } else if (fn === OPS.setFillCMYKColor) {
        const [c, m, y, k] = args;
        rgb = {
          r: Math.round(255 * (1 - Math.min(1, c + k))),
          g: Math.round(255 * (1 - Math.min(1, m + k))),
          b: Math.round(255 * (1 - Math.min(1, y + k))),
        };
      } else if (fn === OPS.showText) {
        const teks = (args[0] || [])
          .map((g) => (g && typeof g.unicode === 'string' ? g.unicode : ''))
          .join('')
          .trim();
        if (teks) hasil.push({ teks, rgb });
      }
    }

    return hasil;
  } catch (e) {
    console.warn('Warna teks tidak bisa dibaca:', e);
    return [];
  }
}

/**
 * Menyimpulkan arah transaksi dari warna nominal.
 * Perbandingan komponen merah dan hijau dipakai, bukan kecocokan warna persis,
 * supaya tetap jalan bila bank sedikit mengubah nuansa warnanya.
 *
 * @returns 1 (masuk), -1 (keluar), atau 0 bila warnanya netral/tak terbaca
 */
export function arahDariWarna(rgb) {
  if (!rgb) return 0;
  const { r, g, b } = rgb;
  if (![r, g, b].every((v) => Number.isFinite(v))) return 0;
  // Hitam, putih, dan abu-abu tidak membawa arti apa pun.
  if (Math.max(r, g, b) - Math.min(r, g, b) < 40) return 0;
  if (g > r + 30) return 1;
  if (r > g + 30) return -1;
  return 0;
}

/** Jalan pintas: buka berkas lalu langsung ambil potongan teksnya. */
export async function bacaPdf(data, { password = '', onProgress = null } = {}) {
  const dokumen = await bukaDokumen(data, password);
  try {
    return await ekstrakPotongan(dokumen, { onProgress });
  } finally {
    dokumen.destroy?.();
  }
}
