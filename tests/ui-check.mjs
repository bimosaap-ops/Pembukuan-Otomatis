/**
 * Uji antarmuka dengan browser sungguhan: mengunggah e-statement PDF lewat
 * tampilan aplikasi, meninjau hasilnya, menyimpan, lalu memeriksa dashboard —
 * diulang pada empat ukuran layar.
 *
 * Berbeda dari `node --test` yang menguji logika, berkas ini menguji hal yang
 * hanya bisa dibuktikan di browser: pdf.js berjalan di web worker, IndexedDB,
 * dan peralihan tabel menjadi daftar kartu di layar sempit.
 *
 * Cara menjalankan:
 *   npm install playwright     (sekali saja)
 *   npx serve .                (atau server statis apa pun di root repo)
 *   node keuangan/tests/ui-check.mjs [url] [folder-screenshot]
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(DIR, 'fixtures');
const BASE = process.argv[2] || 'http://127.0.0.1:8099/keuangan/';
const SHOT = process.argv[3] || join(DIR, 'screenshot');

const VIEWPORT = [
  { nama: 'iphone', width: 390, height: 844, bentuk: 'kartu' },
  { nama: 'android', width: 412, height: 915, bentuk: 'kartu' },
  { nama: 'tablet', width: 820, height: 1180, bentuk: 'tabel' },
  { nama: 'desktop', width: 1440, height: 900, bentuk: 'tabel' },
];

const CHROME = process.env.CHROME_PATH || undefined;

let gagal = 0;
function cek(nama, lulus, ket = '') {
  console.log(`${lulus ? '  ok  ' : ' GAGAL'} ${nama}${ket ? ` — ${ket}` : ''}`);
  if (!lulus) gagal += 1;
}

if (!existsSync(join(FIXTURE, 'bca-juli-2025.pdf'))) {
  console.error('Fixture PDF belum ada. Jalankan dulu: python3 keuangan/tests/buat-fixture-pdf.py');
  process.exit(1);
}
mkdirSync(SHOT, { recursive: true });

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

/** Tombol simpan utama di layar tinjau — dibedakan dari "Tetap simpan" per baris. */
const tombolSimpan = (page) => page.locator('button:has-text("ke pembukuan")').first();

/** Mengunggah berkas lalu menunggu layar tinjau muncul. */
async function unggah(page, namaFile) {
  // Selalu lewat halaman lain dulu: berpindah ke URL hash yang sama tidak memicu
  // hashchange, sehingga layar tinjau dari berkas sebelumnya masih tertinggal
  // dan pemeriksaan bisa membaca hasil yang lama.
  await page.goto(`${BASE}#/dashboard`, { waitUntil: 'load' });
  await page.goto(`${BASE}#/upload`, { waitUntil: 'load' });
  await page.waitForSelector('.dropzone', { timeout: 10000 });
  await page.setInputFiles('.dropzone input[type=file]', join(FIXTURE, namaFile));
  await page.waitForSelector('text=Tinjau sebelum disimpan', { timeout: 20000 });
}

/* ==========================================================================
   1. Alur lengkap: upload -> tinjau -> simpan -> dashboard
   ========================================================================== */

console.log('\n== Alur upload sampai dashboard (390x844) ==');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const galat = [];
  page.on('pageerror', (e) => galat.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') galat.push(m.text()); });

  await unggah(page, 'bca-juli-2025.pdf');

  const langkahSelesai = await page.locator('.step--selesai').count();
  cek('lima langkah pertama selesai', langkahSelesai >= 5, `${langkahSelesai} langkah`);

  cek('bank terdeteksi BCA', (await page.locator('text=BCA · 1234567890').count()) > 0);

  const teksSimpan = await tombolSimpan(page).textContent();
  cek('tombol simpan menyebut 10 transaksi', /10 transaksi/.test(teksSimpan), teksSimpan.trim());

  cek('total cocok dengan ringkasan statement',
    (await page.locator('text=Total cocok dengan ringkasan statement').count()) > 0);

  await page.screenshot({ path: join(SHOT, 'review-mobile.png'), fullPage: true });

  await tombolSimpan(page).click();
  await page.waitForSelector('text=transaksi masuk ke pembukuan', { timeout: 15000 });
  cek('penyimpanan berhasil', true);

  // Dashboard
  await page.goto(`${BASE}#/dashboard`, { waitUntil: 'load' });
  await page.waitForSelector('.ringkas__nilai', { timeout: 10000 });
  const saldo = (await page.locator('.ringkas__nilai').textContent()).trim();
  cek('saldo terisi di dashboard', saldo.includes('8.257.500'), saldo);

  const stat = await page.locator('.ringkas__angka').allTextContents();
  cek('pemasukan terisi', /5,01 jt/.test(stat[0] || ''), stat[0]);
  cek('pengeluaran terisi', /6,76 jt/.test(stat[1] || ''), stat[1]);
  cek('rincian saldo per rekening tampil', (await page.locator('.saldo-akun__nilai').count()) > 0);
  cek('grafik arus kas bersih tergambar', (await page.locator('.grafik svg rect').count()) > 0);
  cek('pengeluaran terbesar terisi', (await page.locator('.kat-baris__isi').count()) > 0);
  await page.screenshot({ path: join(SHOT, 'dashboard-mobile.png'), fullPage: true });

  // Duplikat: berkas yang sama diunggah lagi
  await unggah(page, 'bca-juli-2025.pdf');
  cek('upload ulang terdeteksi duplikat',
    (await page.locator('text=sudah ada di pembukuan').count()) > 0);
  cek('tombol simpan nonaktif saat semua duplikat', await tombolSimpan(page).isDisabled());

  // Statement bulan berikutnya harus menambah data
  await unggah(page, 'bca-agustus-2025.pdf');
  const teksAgustus = await tombolSimpan(page).textContent();
  cek('statement Agustus menambah 3 transaksi baru', /3 transaksi/.test(teksAgustus), teksAgustus.trim());
  await tombolSimpan(page).click();
  await page.waitForSelector('text=transaksi masuk ke pembukuan', { timeout: 15000 });

  await page.goto(`${BASE}#/transaksi`, { waitUntil: 'load' });
  await page.waitForSelector('.kpi__nilai', { timeout: 10000 });
  const jumlah = await page.locator('.kpi__nilai').first().textContent();
  cek('pembukuan terakumulasi jadi 13 transaksi', jumlah.trim() === '13', jumlah.trim());

  // Statement bank lain, adapter generik
  await unggah(page, 'bank-lain-juli-2025.pdf');
  cek('statement bank lain terbaca adapter umum',
    (await page.locator('button:has-text("Simpan 5 transaksi")').count()) > 0);

  cek('tidak ada galat JavaScript', galat.length === 0, galat.slice(0, 3).join(' | '));
  await ctx.close();
}

/* ==========================================================================
   2. PDF ber-password
   ========================================================================== */

console.log('\n== PDF ber-password ==');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}#/upload`, { waitUntil: 'load' });
  await page.setInputFiles('.dropzone input[type=file]', join(FIXTURE, 'bca-juli-2025-terkunci.pdf'));

  await page.waitForSelector('text=PDF terkunci password', { timeout: 20000 });
  cek('kotak password muncul', true);

  await page.locator('.modal input[type=password]').fill('salah');
  await page.locator('.modal button:has-text("Buka")').click();
  await page.waitForSelector('text=tidak cocok', { timeout: 15000 });
  cek('password salah ditolak', true);

  await page.locator('.modal input[type=password]').fill('rahasia123');
  await page.locator('.modal button:has-text("Buka")').click();
  await page.waitForSelector('text=Tinjau sebelum disimpan', { timeout: 20000 });
  cek('password benar membuka berkas',
    (await page.locator('button:has-text("Simpan 10 transaksi")').count()) > 0);

  await ctx.close();
}

/* ==========================================================================
   3. Responsivitas di empat ukuran layar
   ========================================================================== */

console.log('\n== Responsivitas ==');
for (const v of VIEWPORT) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height } });
  const page = await ctx.newPage();

  await unggah(page, 'bca-juli-2025.pdf');
  await tombolSimpan(page).click();
  await page.waitForSelector('text=transaksi masuk ke pembukuan', { timeout: 15000 });

  await page.goto(`${BASE}#/transaksi`, { waitUntil: 'load' });
  await page.waitForSelector('.kpi__nilai', { timeout: 10000 });

  const tabelTampak = await page.locator('.dv__gulir').first().isVisible();
  const kartuTampak = await page.locator('.dv__kartu-list').first().isVisible();
  cek(`${v.nama}: tampil sebagai ${v.bentuk}`,
    v.bentuk === 'kartu' ? (kartuTampak && !tabelTampak) : (tabelTampak && !kartuTampak));

  const bottomNav = await page.locator('.bottomnav').isVisible();
  const sidebar = await page.locator('.sidebar').isVisible();
  cek(`${v.nama}: navigasi ${v.width < 768 ? 'bawah' : 'samping'}`,
    v.width < 768 ? (bottomNav && !sidebar) : (sidebar && !bottomNav));

  // Halaman tidak boleh bisa digeser ke samping.
  const meluber = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  cek(`${v.nama}: tidak ada gulir mendatar`, !meluber);

  // Target sentuh minimal 44px pada navigasi.
  // Yang diukur harus tombol navigasi yang benar-benar tampil di lebar ini.
  const tinggiNav = await page.evaluate((mobil) => {
    const tombol = document.querySelector(mobil ? '.bottomnav__btn' : '.sidebar__btn');
    return tombol ? Math.round(tombol.getBoundingClientRect().height) : 0;
  }, v.width < 768);
  cek(`${v.nama}: target sentuh >= 44px`, tinggiNav >= 44, `${tinggiNav}px`);

  await page.screenshot({ path: join(SHOT, `transaksi-${v.nama}.png`), fullPage: false });

  await page.goto(`${BASE}#/analitik`, { waitUntil: 'load' });
  await page.waitForSelector('.grafik svg', { timeout: 10000 });
  await page.screenshot({ path: join(SHOT, `analitik-${v.nama}.png`), fullPage: false });

  await ctx.close();
}

/* ==========================================================================
   4. Mode gelap
   ========================================================================== */

console.log('\n== Mode gelap ==');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await ctx.newPage();

  await unggah(page, 'bca-juli-2025.pdf');
  await tombolSimpan(page).click();
  await page.waitForSelector('text=transaksi masuk ke pembukuan', { timeout: 15000 });

  await page.goto(`${BASE}#/dashboard`, { waitUntil: 'load' });
  await page.waitForSelector('.ringkas__nilai', { timeout: 10000 });

  const latar = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const gelap = /rgb\((\d+), (\d+), (\d+)\)/.exec(latar);
  const terang = gelap ? Number(gelap[1]) + Number(gelap[2]) + Number(gelap[3]) : 999;
  cek('mode gelap mengikuti preferensi sistem', terang < 200, latar);
  await page.screenshot({ path: join(SHOT, 'dashboard-gelap.png'), fullPage: true });

  await page.goto(`${BASE}#/laporan`, { waitUntil: 'load' });
  await page.waitForSelector('.kpi__nilai', { timeout: 10000 });
  await page.screenshot({ path: join(SHOT, 'laporan-gelap.png'), fullPage: true });

  await ctx.close();
}

await browser.close();

console.log(`\n${gagal === 0 ? 'Semua pemeriksaan lolos.' : `${gagal} pemeriksaan gagal.`}`);
console.log(`Screenshot: ${SHOT}`);
process.exit(gagal === 0 ? 0 : 1);
