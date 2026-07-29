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

export function terapkanTema(tema) {
  const root = document.documentElement;
  if (tema === TEMA.OTOMATIS) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', tema);

  const gelap = tema === TEMA.GELAP
    || (tema === TEMA.OTOMATIS && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', gelap ? '#0b1120' : '#0a58ca');

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
