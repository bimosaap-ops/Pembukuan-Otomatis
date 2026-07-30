/**
 * Service worker aplikasi Pembukuan.
 *
 * Cakupannya adalah /keuangan/ — lebih spesifik daripada service worker di root
 * repositori, sehingga halaman ini dikendalikan oleh berkas ini, bukan oleh
 * service worker Kalkulator BBS.
 *
 * Strategi:
 *   - Navigasi: jaringan dulu, jatuh ke cache bila offline.
 *   - Aset (skrip, gaya, pdf.js, ikon): cache dulu supaya aplikasi terbuka
 *     seketika dan tetap jalan tanpa internet.
 *
 * Naikkan CACHE_NAME setiap kali aset berubah agar versi lama dibersihkan.
 */

const CACHE_NAME = 'pembukuan-v3';

const ASET = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',

  './css/tokens.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/print.css',

  './src/ui/app.js',
  './src/ui/router.js',
  './src/ui/nav.js',
  './src/ui/menu.js',
  './src/ui/theme.js',
  './src/ui/components/toast.js',
  './src/ui/components/modal.js',
  './src/ui/components/data-view.js',
  './src/ui/components/dropzone.js',
  './src/ui/components/filterbar.js',
  './src/ui/views/dashboard.js',
  './src/ui/views/upload.js',
  './src/ui/views/rekening.js',
  './src/ui/views/transaksi.js',
  './src/ui/views/analitik.js',
  './src/ui/views/laporan.js',
  './src/ui/views/riwayat.js',
  './src/ui/views/kategori.js',
  './src/ui/views/pengaturan.js',

  './src/core/dom.js',
  './src/core/format.js',
  './src/core/dates.js',
  './src/core/hash.js',
  './src/core/events.js',

  './src/data/db.js',
  './src/data/repo/accounts.js',
  './src/data/repo/transactions.js',
  './src/data/repo/uploads.js',
  './src/data/repo/categories.js',
  './src/data/repo/settings.js',

  './src/domain/entities.js',
  './src/domain/dedupe.js',
  './src/domain/categorize.js',
  './src/domain/validate.js',
  './src/domain/analytics.js',
  './src/domain/reports.js',

  './src/parsers/layout.js',
  './src/parsers/pdf-loader.js',
  './src/parsers/detect.js',
  './src/parsers/registry.js',
  './src/parsers/util.js',
  './src/parsers/banks/bca.js',
  './src/parsers/banks/permata.js',
  './src/parsers/banks/permata-mutasi.js',
  './src/parsers/banks/generic.js',

  './src/services/ingest.js',
  './src/services/export.js',

  './src/charts/svg.js',
  './src/charts/bar.js',
  './src/charts/line.js',
  './src/charts/donut.js',

  './vendor/pdfjs/pdf.min.js',
  './vendor/pdfjs/pdf.worker.min.js',
  './vendor/xlsx/xlsx.mini.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll gagal seluruhnya bila satu berkas meleset; disimpan satu per satu
    // agar satu aset yang hilang tidak membatalkan pemasangan.
    await Promise.all(ASET.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const kunci = await caches.keys();
    await Promise.all(kunci.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const jaringan = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', jaringan.clone());
        return jaringan;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const tersimpan = await caches.match(request);
    if (tersimpan) return tersimpan;
    try {
      const jaringan = await fetch(request);
      if (jaringan.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, jaringan.clone());
      }
      return jaringan;
    } catch {
      return Response.error();
    }
  })());
});
