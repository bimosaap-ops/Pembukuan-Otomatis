/**
 * Tema terang/gelap.
 *
 * Pilihan disimpan di IndexedDB bersama pengaturan lain, tapi juga dicerminkan ke
 * localStorage: berkas HTML membacanya secara sinkron sebelum halaman digambar,
 * sehingga tidak ada kedipan putih saat membuka aplikasi dalam mode gelap.
 */

import { emit, EVENT } from '../core/events.js';
import * as pengaturan from '../data/repo/settings.js';

const KUNCI_LOKAL = 'pembukuan_tema';
export const TEMA = { OTOMATIS: 'auto', TERANG: 'light', GELAP: 'dark' };

export function temaTersimpan() {
  try {
    return localStorage.getItem(KUNCI_LOKAL) || TEMA.OTOMATIS;
  } catch {
    return TEMA.OTOMATIS;
  }
}

/** Apakah tampilan sedang gelap, entah karena dipilih atau karena ikut sistem. */
export function modeGelapAktif() {
  const dipilih = document.documentElement.getAttribute('data-theme');
  if (dipilih === TEMA.GELAP) return true;
  if (dipilih === TEMA.TERANG) return false;
  return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

export function terapkanTema(tema) {
  const root = document.documentElement;
  if (tema === TEMA.OTOMATIS) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', tema);

  /* Warna bilah status disamakan dengan sudut kiri atas gradien, bukan dengan
     warna aksen: yang menempel di bawah bilah itu memang latar halaman. */
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', modeGelapAktif() ? '#191320' : '#f8e6dd');

  try { localStorage.setItem(KUNCI_LOKAL, tema); } catch { /* mode privat */ }
  emit(EVENT.TEMA_BERUBAH, tema);
}

export async function muatTema() {
  const tersimpan = await pengaturan.baca(pengaturan.KUNCI.TEMA, null);
  const tema = tersimpan || temaTersimpan();
  terapkanTema(tema);
  return tema;
}

export async function setTema(tema) {
  await pengaturan.tulis(pengaturan.KUNCI.TEMA, tema);
  terapkanTema(tema);
  return tema;
}

/** Saat mode otomatis, ikut berubah ketika sistem berganti tema. */
export function pantauSistem() {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (temaTersimpan() === TEMA.OTOMATIS) terapkanTema(TEMA.OTOMATIS);
  });
}
