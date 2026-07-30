/**
 * Satu komponen daftar untuk seluruh aplikasi.
 *
 * Aturan responsif "tabel di layar lebar, kartu di HP" ditulis sekali di sini:
 * kedua bentuk selalu dirender, dan CSS memilih mana yang tampil pada tiap
 * breakpoint. Tidak ada listener resize, sehingga tampilan langsung benar saat
 * layar diputar atau jendela diubah ukurannya.
 *
 * Definisi kolom:
 *   { kunci, judul, kanan, lebar, render(row), renderKartu(row),
 *     kartu: 'utama'|'nilai'|'meta'|false }
 *
 * `kartu` menentukan peran kolom saat tampil sebagai kartu di HP. `renderKartu`
 * dipakai bila bentuk kartu perlu isi yang berbeda dari tabel — misalnya kolom
 * Kredit yang di tabel dibiarkan kosong untuk transaksi keluar, sementara di
 * kartu justru harus menampilkan nominalnya lengkap dengan tanda.
 *
 * `lebar` diterapkan sebagai lebar minimum, bukan lebar tetap: tabel dengan
 * banyak kolom dibiarkan melebar dan digeser mendatar, daripada memaksa kolom
 * deskripsi menyempit sampai tulisannya terpotong per huruf.
 */

import { h, ikon } from '../../core/dom.js';

export function dataView({
  kolom,
  baris,
  kosong = 'Belum ada data.',
  kosongKet = '',
  kelasBaris = null,
  aksi = null,
  kunciBaris = (r, i) => r.id ?? i,
}) {
  const wadah = h('.dv');

  if (!baris.length) {
    wadah.appendChild(h('.kartu.dv__kosong', null, [
      ikon('riwayat', 28),
      h('strong', { text: kosong }),
      kosongKet ? h('div.redup-2', { text: kosongKet }) : null,
    ]));
    return wadah;
  }

  wadah.appendChild(bentukTabel({ kolom, baris, kelasBaris, aksi, kunciBaris }));
  wadah.appendChild(bentukKartu({ kolom, baris, kelasBaris, aksi, kunciBaris }));
  return wadah;
}

function bentukTabel({ kolom, baris, kelasBaris, aksi, kunciBaris }) {
  const thead = h('thead', null, h('tr', null, [
    ...kolom.map((k) => h(`th${k.kanan ? '.kanan' : ''}`, {
      text: k.judul,
      style: k.lebar ? { minWidth: k.lebar } : null,
    })),
    aksi ? h('th.kanan', { text: 'Aksi' }) : null,
  ]));

  const tbody = h('tbody', null, baris.map((row, i) => {
    const kelas = kelasBaris?.(row) || '';
    return h(`tr${kelas ? `.${kelas.split(' ').join('.')}` : ''}`, { dataset: { id: String(kunciBaris(row, i)) } }, [
      ...kolom.map((k) => {
        const td = h(`td${k.kanan ? '.kanan' : ''}${k.angka ? '.angka' : ''}`);
        isiSel(td, k, row);
        return td;
      }),
      aksi ? h('td.kanan', null, h('.baris', { style: { justifyContent: 'flex-end' } }, aksi(row))) : null,
    ]);
  }));

  return h('.dv__gulir', null, h('table.dv__tabel', null, [thead, tbody]));
}

function bentukKartu({ kolom, baris, kelasBaris, aksi, kunciBaris }) {
  const kolUtama = kolom.find((k) => k.kartu === 'utama') || kolom[0];
  const kolNilai = kolom.find((k) => k.kartu === 'nilai');
  // Kolom yang seluruh barisnya kosong tidak perlu muncul sebagai label tanpa isi
  // di bentuk kartu — mis. kolom Saldo pada statement yang tidak memuat saldo.
  const adaIsinya = (k) => baris.some((row) => {
    const v = k.render ? k.render(row) : row[k.kunci];
    if (v === null || v === undefined || v === '') return false;
    if (v instanceof Node) return Boolean(v.textContent.trim());
    return String(v).trim() !== '';
  });
  const kolMeta = kolom.filter((k) => k !== kolUtama && k !== kolNilai && k.kartu !== false && adaIsinya(k));

  return h('.dv__kartu-list', null, baris.map((row, i) => {
    const kelas = kelasBaris?.(row) || '';
    const utama = h('.dv__kartu-utama');
    isiSel(utama, kolUtama, row, true);

    const nilai = kolNilai ? h('.dv__kartu-nilai') : null;
    if (kolNilai) isiSel(nilai, kolNilai, row, true);

    return h(`.dv__kartu${kelas ? `.${kelas.split(' ').join('.')}` : ''}`, {
      dataset: { id: String(kunciBaris(row, i)) },
    }, [
      h('.dv__kartu-kepala', null, [utama, nilai]),
      kolMeta.length ? h('.dv__kartu-meta', null, kolMeta.map((k) => {
        const span = h('span', null, [h('b', { text: `${k.judul}: ` })]);
        const isi = h('span');
        isiSel(isi, k, row, true);
        span.appendChild(isi);
        return span;
      })) : null,
      aksi ? h('.dv__kartu-aksi', null, aksi(row)) : null,
    ]);
  }));
}

function isiSel(el, kolom, row, bentukKartu = false) {
  if (!kolom) return;
  const gambar = (bentukKartu && kolom.renderKartu) ? kolom.renderKartu : kolom.render;
  const isi = gambar ? gambar(row) : row[kolom.kunci];
  if (isi === null || isi === undefined) { el.textContent = '—'; return; }
  if (isi instanceof Node) { el.appendChild(isi); return; }
  if (Array.isArray(isi)) { isi.forEach((x) => el.appendChild(x instanceof Node ? x : document.createTextNode(String(x)))); return; }
  el.textContent = String(isi);
}

/** Baris ringkasan di bawah daftar (jumlah data, total, tombol tambahan). */
export function kakiDaftar(kiri, kanan = null) {
  return h('.dv__kaki', null, [
    h('div', null, kiri),
    kanan ? h('div', null, kanan) : null,
  ]);
}
