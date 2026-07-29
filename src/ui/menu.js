/**
 * Definisi menu — satu sumber untuk sidebar desktop, rail tablet,
 * bottom navigation, dan sheet menu di HP.
 *
 * `utama: true` menandai menu yang muncul langsung di bottom navigation HP;
 * sisanya masuk ke sheet di balik tombol "Menu".
 */

export const MENU = [
  { id: 'dashboard', label: 'Dashboard', labelPanjang: 'Dashboard', emoji: '🏠', ikon: 'dashboard', utama: true },
  { id: 'upload', label: 'Upload', labelPanjang: 'Upload e-Statement', emoji: '📄', ikon: 'upload', utama: true },
  { id: 'rekening', label: 'Rekening', labelPanjang: 'Rekening', emoji: '💳', ikon: 'rekening', utama: false },
  { id: 'transaksi', label: 'Transaksi', labelPanjang: 'Transaksi', emoji: '💸', ikon: 'transaksi', utama: true },
  { id: 'analitik', label: 'Analitik', labelPanjang: 'Analitik', emoji: '📊', ikon: 'analitik', utama: true },
  { id: 'laporan', label: 'Laporan', labelPanjang: 'Laporan', emoji: '📑', ikon: 'laporan', utama: false },
  { id: 'riwayat', label: 'Riwayat', labelPanjang: 'Riwayat Upload', emoji: '📂', ikon: 'riwayat', utama: false },
  { id: 'kategori', label: 'Kategori', labelPanjang: 'Kategori', emoji: '🏷', ikon: 'kategori', utama: false },
  { id: 'pengaturan', label: 'Pengaturan', labelPanjang: 'Pengaturan', emoji: '⚙️', ikon: 'pengaturan', utama: false },
];

export const RUTE_AWAL = 'dashboard';

export const menuUtama = () => MENU.filter((m) => m.utama);
export const menuTambahan = () => MENU.filter((m) => !m.utama);
export const cariMenu = (id) => MENU.find((m) => m.id === id) || null;
