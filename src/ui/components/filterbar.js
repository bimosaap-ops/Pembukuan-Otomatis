/**
 * Pemilih periode dan rekening, dipakai bersama oleh Dashboard, Analitik, dan Laporan.
 */

import { h } from '../../core/dom.js';
import { periodePreset, hariIni } from '../../core/dates.js';

export const PRESET = [
  { id: 'bulan-ini', label: 'Bulan ini' },
  { id: 'bulan-lalu', label: 'Bulan lalu' },
  { id: '3-bulan', label: '3 bulan' },
  { id: '6-bulan', label: '6 bulan' },
  { id: '12-bulan', label: '12 bulan' },
  { id: 'tahun-ini', label: 'Tahun ini' },
  { id: 'semua', label: 'Semua' },
];

/**
 * @param {{preset:string, dari:string, sampai:string}} nilai
 * @param {(nilai)=>void} onUbah
 */
export function filterPeriode(nilai, onUbah) {
  const segment = h('.segment', { role: 'group', 'aria-label': 'Pilih periode' },
    PRESET.map((p) => h('button.segment__btn', {
      type: 'button',
      'aria-pressed': p.id === nilai.preset ? 'true' : 'false',
      onclick: () => {
        const rentang = periodePreset(p.id, hariIni());
        onUbah({ preset: p.id, ...rentang });
      },
    }, p.label)));

  const dari = h('input', {
    type: 'date',
    value: nilai.dari || '',
    'aria-label': 'Tanggal awal',
    onchange: (e) => onUbah({ preset: 'kustom', dari: e.target.value, sampai: nilai.sampai }),
  });
  const sampai = h('input', {
    type: 'date',
    value: nilai.sampai || '',
    'aria-label': 'Tanggal akhir',
    onchange: (e) => onUbah({ preset: 'kustom', dari: nilai.dari, sampai: e.target.value }),
  });

  return h('.tumpuk', null, [
    segment,
    h('.filter__baris', null, [
      h('div', null, [h('label', { text: 'Dari tanggal' }), dari]),
      h('div', null, [h('label', { text: 'Sampai tanggal' }), sampai]),
    ]),
  ]);
}

/** Dropdown rekening dengan pilihan "semua rekening". */
export function pilihRekening(akun, nilai, onUbah, label = 'Rekening') {
  return h('div', null, [
    h('label', { text: label }),
    h('select', {
      onchange: (e) => onUbah(e.target.value),
    }, [
      h('option', { value: '', selected: !nilai, text: 'Semua rekening' }),
      ...akun.map((a) => h('option', {
        value: a.id,
        selected: a.id === nilai,
        text: `${a.bank} ${a.nomorRekening || ''}`.trim(),
      })),
    ]),
  ]);
}

/** Nilai awal filter bila belum ada data sama sekali. */
export function periodeAwal(preset = '12-bulan') {
  return { preset, ...periodePreset(preset, hariIni()) };
}

/**
 * Periode awal yang mengikuti data, bukan tanggal hari ini.
 *
 * E-statement yang di-upload sering berumur beberapa bulan. Kalau filter selalu
 * dihitung dari hari ini, layar bisa tampil kosong tepat setelah upload berhasil —
 * seolah datanya tidak masuk. Karena itu jendela dua belas bulan diakhiri pada
 * transaksi terbaru yang benar-benar ada.
 */
export function periodeIkutData({ min, maks }, bulan = 12) {
  if (!maks) return periodeAwal('12-bulan');
  const rentang = periodePreset(`${bulan}-bulan`, maks);
  // Kalau seluruh data lebih pendek dari jendelanya, ambil semua sekalian.
  if (min && min < rentang.dari) return { preset: `${bulan}-bulan`, ...rentang };
  return { preset: 'semua', dari: '', sampai: '' };
}

/**
 * Filter ringkas untuk Dashboard.
 *
 * Versi lengkap (`filterPeriode`) memakan hampir sepertiga layar pertama sebelum
 * satu angka pun terlihat. Di sini hanya deretan preset yang tampil; rentang
 * tanggal khusus dan pemilihan rekening dilipat, karena keduanya jarang dipakai
 * dibanding sekadar berpindah periode.
 */
export function filterRingkas(nilai, akun, onUbah) {
  const segment = h('.segment', { role: 'group', 'aria-label': 'Pilih periode' },
    PRESET.map((p) => h('button.segment__btn', {
      type: 'button',
      'aria-pressed': p.id === nilai.preset ? 'true' : 'false',
      onclick: () => onUbah({ preset: p.id, ...periodePreset(p.id, hariIni()) }),
    }, p.label)));

  const rincian = h('details.lipat.mt-3', null, [
    h('summary', { text: 'Rentang tanggal & rekening' }),
    h('.filter__baris.mt-3', null, [
      h('div', null, [h('label', { text: 'Dari tanggal' }), h('input', {
        type: 'date', value: nilai.dari || '',
        onchange: (e) => onUbah({ preset: 'kustom', dari: e.target.value, sampai: nilai.sampai }),
      })]),
      h('div', null, [h('label', { text: 'Sampai tanggal' }), h('input', {
        type: 'date', value: nilai.sampai || '',
        onchange: (e) => onUbah({ preset: 'kustom', dari: nilai.dari, sampai: e.target.value }),
      })]),
      pilihRekening(akun, nilai.accountId, (id) => onUbah({ accountId: id })),
    ]),
  ]);

  return h('div', null, [segment, akun.length ? rincian : null]);
}
