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
export async function ekstrakPotongan(dokumen, { onProgress = null, batasHalaman = 0 } = {}) {
  const total = dokumen.numPages;
  const batas = batasHalaman > 0 ? Math.min(batasHalaman, total) : total;
  const halaman = [];

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
    page.cleanup?.();
    onProgress?.(i, batas);
  }

  return { halaman, jumlahHalaman: total };
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
