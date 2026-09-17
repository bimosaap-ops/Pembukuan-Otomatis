/**
 * Tes untuk bagian sheets-sync.js yang murni (tanpa database maupun jaringan).
 *
 * `bacaKonfigSheets`, `syncKeSheets`, `syncAtauAntri`, dan antrean-nya menyentuh
 * IndexedDB lewat data/repo, dan aplikasi ini sengaja tidak memakai pustaka luar
 * (termasuk pemalsu IndexedDB) untuk pengujian — konsisten dengan seluruh tes
 * lain di sini yang menguji lapisan domain/parser murni, bukan lapisan
 * data/repo. Karena itu yang diuji di sini dibatasi pada dua fungsi yang justru
 * paling rawan salah diam-diam: pembentukan baris untuk Sheet, dan validasi URL
 * webhook (kesalahan paling sering: menempel URL Sheet biasa, bukan Web App).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  barisUntukSheet, validasiUrlWebhook, post, kirimBaris, kirimHapus, UKURAN_BONGKAH,
  barisAkunUntukSheet, barisKategoriUntukSheet, akunDariBarisSheet, kategoriDariBarisSheet,
  transaksiDariBarisSheet, barisStatementUntukSheet,
} from '../src/services/sheets-sync.js';
import { buatTransaksi, buatAkun, buatKategori, buatFileUpload } from '../src/domain/entities.js';

/* ==========================================================================
   barisUntukSheet
   ========================================================================== */

test('barisUntukSheet memisah nominal masuk/keluar ke debit dan kredit', () => {
  const masuk = buatTransaksi({ hash: 'h1', tanggal: '2025-07-01', deskripsi: 'Gaji', nominal: 5000000 });
  const keluar = buatTransaksi({ hash: 'h2', tanggal: '2025-07-02', deskripsi: 'Kopi', nominal: -25000 });

  const baris1 = barisUntukSheet(masuk, new Map());
  assert.equal(baris1.nominal, 5000000);
  assert.equal(baris1.kredit, 5000000);
  assert.equal(baris1.debit, 0);

  const baris2 = barisUntukSheet(keluar, new Map());
  assert.equal(baris2.nominal, -25000);
  assert.equal(baris2.debit, 25000, 'debit harus angka positif walau nominalnya negatif');
  assert.equal(baris2.kredit, 0);
});

test('barisUntukSheet mengisi data rekening dari akunMap berdasarkan accountId', () => {
  const t = buatTransaksi({ hash: 'h3', accountId: 'acc1', tanggal: '2025-07-01', deskripsi: 'Tes', nominal: 1000 });
  const akunMap = new Map([['acc1', { bank: 'BCA', nomorRekening: '1234567890', namaPemilik: 'BUDI' }]]);

  const baris = barisUntukSheet(t, akunMap);
  assert.equal(baris.bank, 'BCA');
  assert.equal(baris.nomorRekening, '1234567890');
  assert.equal(baris.namaPemilik, 'BUDI');
});

test('barisUntukSheet tidak melempar error saat rekening tidak ada di akunMap', () => {
  const t = buatTransaksi({ hash: 'h4', accountId: 'acc-tak-dikenal', tanggal: '2025-07-01', deskripsi: 'Tes', nominal: 1000 });

  const baris = barisUntukSheet(t, new Map());
  assert.equal(baris.bank, '');
  assert.equal(baris.nomorRekening, '');
  assert.equal(baris.namaPemilik, '');

  // akunMap kosong/undefined sama sekali juga tidak boleh melempar error.
  assert.doesNotThrow(() => barisUntukSheet(t, undefined));
});

test('barisUntukSheet menyertakan hash, kategoriId, sumber, dan uploadedFileId apa adanya', () => {
  const t = buatTransaksi({
    hash: 'h5', tanggal: '2025-07-03', deskripsi: 'ALFAMART', nominal: -15000,
    kategoriId: 'kat_belanja', sumber: 'pdf', uploadedFileId: 'upl1',
  });
  const baris = barisUntukSheet(t, new Map());
  assert.equal(baris.hash, 'h5');
  assert.equal(baris.kategoriId, 'kat_belanja');
  assert.equal(baris.sumber, 'pdf');
  assert.equal(baris.uploadedFileId, 'upl1');
});

test('barisUntukSheet mengisi kategoriNama dari kategoriMap berdasarkan kategoriId', () => {
  const t = buatTransaksi({ hash: 'h6', tanggal: '2025-07-04', deskripsi: 'Warteg', nominal: -20000, kategoriId: 'kat_makan' });
  const kategoriMap = new Map([['kat_makan', { id: 'kat_makan', nama: 'Makan & Minum' }]]);

  const baris = barisUntukSheet(t, new Map(), kategoriMap);
  assert.equal(baris.kategoriNama, 'Makan & Minum');
});

test('barisUntukSheet mengisi kategoriNama string kosong bila kategoriId tidak ada di kategoriMap, tanpa error', () => {
  const t = buatTransaksi({ hash: 'h7', tanggal: '2025-07-05', deskripsi: 'Tes', nominal: -1000, kategoriId: 'kat-tak-dikenal' });

  const baris = barisUntukSheet(t, new Map(), new Map());
  assert.equal(baris.kategoriNama, '');

  // kategoriMap kosong/undefined sama sekali juga tidak boleh melempar error.
  assert.doesNotThrow(() => barisUntukSheet(t, new Map(), undefined));
});

test('barisUntukSheet mengirim penanda transfer internal, dan defaultnya false', () => {
  const pindah = buatTransaksi({
    hash: 'h8', tanggal: '2025-07-06', deskripsi: 'TRF KE REKENING SENDIRI',
    nominal: -5000000, transferInternal: true,
  });
  assert.equal(barisUntukSheet(pindah, new Map()).transferInternal, true);

  // Transaksi biasa tidak boleh ikut tertandai: kalau ini bocor jadi true,
  // Dashboard akan membuang transaksi asli dari total gabungan.
  const biasa = buatTransaksi({ hash: 'h9', tanggal: '2025-07-06', deskripsi: 'ALFAMART', nominal: -15000 });
  assert.equal(barisUntukSheet(biasa, new Map()).transferInternal, false);

  // Nilai yang tidak pernah diisi harus jadi false, bukan undefined — sel
  // kosong di Sheet tidak bisa dibedakan dari "bukan transfer".
  assert.equal(typeof barisUntukSheet(biasa, new Map()).transferInternal, 'boolean');
});

test('barisUntukSheet membawa id dan diubahPada apa adanya (dipakai pull, bukan upsert)', () => {
  const t = buatTransaksi({
    id: 'trx1', hash: 'h10', tanggal: '2025-07-01', deskripsi: 'Tes', nominal: 1000,
    diubahPada: '2026-01-01T00:00:00.000Z',
  });
  const baris = barisUntukSheet(t, new Map());
  assert.equal(baris.id, 'trx1');
  assert.equal(baris.diubahPada, '2026-01-01T00:00:00.000Z');
});

/* ==========================================================================
   transaksiDariBarisSheet — kebalikan dari barisUntukSheet, dipakai saat
   menerapkan hasil tarik dari Sheets (lihat transaksi-sync.js)
   ========================================================================== */

test('transaksiDariBarisSheet memetakan field inti apa adanya', () => {
  const row = {
    id: 'trx1', hash: 'h1', tanggal: '2025-07-01', deskripsi: 'Gaji', nominal: 5000000,
    kategoriId: 'kat1', sumber: 'manual', transferInternal: false, saldo: 2000000,
    diubahPada: '2026-01-01T00:00:00.000Z',
  };
  const trx = transaksiDariBarisSheet(row);
  assert.equal(trx.id, 'trx1');
  assert.equal(trx.hash, 'h1');
  assert.equal(trx.nominal, 5000000);
  assert.equal(trx.kategoriId, 'kat1');
  assert.equal(trx.saldo, 2000000);
  assert.equal(trx.diubahPada, '2026-01-01T00:00:00.000Z');
  assert.equal('accountId' in trx, false, 'accountId sengaja tidak dipetakan -- itu tanggung jawab pemanggil');
});

test('transaksiDariBarisSheet mengubah saldo kosong jadi null, bukan 0 atau string kosong', () => {
  assert.equal(transaksiDariBarisSheet({ id: 'trx2', saldo: '' }).saldo, null);
  assert.equal(transaksiDariBarisSheet({ id: 'trx3' }).saldo, null);
});

test('transaksiDariBarisSheet lalu barisUntukSheet pulang-pergi tanpa kehilangan id/nominal/diubahPada', () => {
  const asli = buatTransaksi({
    id: 'trx9', hash: 'h9', tanggal: '2025-08-01', deskripsi: 'Kopi', nominal: -25000,
    diubahPada: '2026-03-03T00:00:00.000Z',
  });
  const balik = transaksiDariBarisSheet(barisUntukSheet(asli, new Map()));
  assert.equal(balik.id, 'trx9');
  assert.equal(balik.nominal, -25000);
  assert.equal(balik.diubahPada, '2026-03-03T00:00:00.000Z');
});

/* ==========================================================================
   barisAkunUntukSheet / barisKategoriUntukSheet
   ========================================================================== */

test('barisAkunUntukSheet membawa id dan field rekening apa adanya', () => {
  const a = buatAkun({
    id: 'acc1', bank: 'BCA', nomorRekening: '1234567890', namaPemilik: 'BUDI',
    saldoAwal: 1000000, saldo: 2500000, jumlahTransaksi: 12,
  });
  const baris = barisAkunUntukSheet(a);
  assert.equal(baris.id, 'acc1');
  assert.equal(baris.bank, 'BCA');
  assert.equal(baris.saldoAwal, 1000000);
  assert.equal(baris.saldo, 2500000);
  assert.equal(baris.jumlahTransaksi, 12);
});

test('barisAkunUntukSheet tidak melempar error untuk akun kosong', () => {
  assert.doesNotThrow(() => barisAkunUntukSheet(buatAkun()));
});

test('barisKategoriUntukSheet menggabung polaKataKunci jadi satu string', () => {
  const k = buatKategori({ id: 'kat1', nama: 'Makanan', polaKataKunci: ['ALFAMART', 'INDOMARET'] });
  const baris = barisKategoriUntukSheet(k);
  assert.equal(baris.polaKataKunci, 'ALFAMART, INDOMARET');
});

test('barisKategoriUntukSheet mengisi string kosong bila polaKataKunci bukan array', () => {
  const baris = barisKategoriUntukSheet({ id: 'kat2', nama: 'Lain-lain' });
  assert.equal(baris.polaKataKunci, '');
});

test('barisKategoriUntukSheet membawa bawaan sebagai boolean sungguhan', () => {
  const k = buatKategori({ id: 'kat3', nama: 'Gaji', bawaan: true });
  assert.equal(barisKategoriUntukSheet(k).bawaan, true);
  assert.equal(typeof barisKategoriUntukSheet(buatKategori({ id: 'kat4' })).bawaan, 'boolean');
});

test('barisAkunUntukSheet dan barisKategoriUntukSheet membawa diubahPada apa adanya', () => {
  const a = buatAkun({ id: 'acc5', diubahPada: '2026-01-01T00:00:00.000Z' });
  assert.equal(barisAkunUntukSheet(a).diubahPada, '2026-01-01T00:00:00.000Z');

  const k = buatKategori({ id: 'kat5', diubahPada: '2026-02-02T00:00:00.000Z' });
  assert.equal(barisKategoriUntukSheet(k).diubahPada, '2026-02-02T00:00:00.000Z');
});

/* ==========================================================================
   akunDariBarisSheet / kategoriDariBarisSheet — kebalikan dari di atas,
   dipakai saat menerapkan hasil tarik dari Sheets (lihat entitas-sync.js)
   ========================================================================== */

test('kategoriDariBarisSheet memecah polaKataKunci balik jadi array', () => {
  const kat = kategoriDariBarisSheet({ id: 'kat1', nama: 'Makanan', polaKataKunci: 'ALFAMART, INDOMARET' });
  assert.deepEqual(kat.polaKataKunci, ['ALFAMART', 'INDOMARET']);
});

test('kategoriDariBarisSheet menghasilkan array kosong bila polaKataKunci kosong, bukan [""]', () => {
  const kat = kategoriDariBarisSheet({ id: 'kat2', nama: 'Lain-lain', polaKataKunci: '' });
  assert.deepEqual(kat.polaKataKunci, []);
});

test('akunDariBarisSheet TIDAK ikut memetakan saldo/jumlahTransaksi dari baris remote', () => {
  const akun = akunDariBarisSheet({
    id: 'acc1', bank: 'BCA', saldoAwal: 1000000, saldo: 999999999, jumlahTransaksi: 42,
  });
  assert.equal(akun.saldoAwal, 1000000);
  assert.equal(akun.saldo, undefined);
  assert.equal(akun.jumlahTransaksi, undefined);
});

test('barisKategoriUntukSheet lalu kategoriDariBarisSheet pulang-pergi tanpa kehilangan kata kunci', () => {
  const asli = buatKategori({ id: 'kat9', nama: 'Transportasi', polaKataKunci: ['GRAB', 'GOJEK', 'MRT'] });
  const balik = kategoriDariBarisSheet(barisKategoriUntukSheet(asli));
  assert.deepEqual(balik.polaKataKunci, ['GRAB', 'GOJEK', 'MRT']);
});

test('kategoriDariBarisSheet menormalkan Tipe tanpa peduli huruf besar/kecil atau spasi', () => {
  assert.equal(kategoriDariBarisSheet({ id: 'k1', tipe: 'Pemasukan' }).tipe, 'pemasukan');
  assert.equal(kategoriDariBarisSheet({ id: 'k2', tipe: '  PEMASUKAN  ' }).tipe, 'pemasukan');
  assert.equal(kategoriDariBarisSheet({ id: 'k3', tipe: 'pengeluaran' }).tipe, 'pengeluaran');
});

test('kategoriDariBarisSheet jatuh ke pengeluaran kalau Tipe kosong/tidak dikenali', () => {
  assert.equal(kategoriDariBarisSheet({ id: 'k4', tipe: '' }).tipe, 'pengeluaran');
  assert.equal(kategoriDariBarisSheet({ id: 'k5', tipe: 'ngasal' }).tipe, 'pengeluaran');
});

/* ==========================================================================
   validasiUrlWebhook
   ========================================================================== */

test('validasiUrlWebhook menerima string kosong tanpa error (fitur nonaktif)', () => {
  assert.equal(validasiUrlWebhook(''), '');
  assert.equal(validasiUrlWebhook(null), '');
  assert.equal(validasiUrlWebhook(undefined), '');
});

test('validasiUrlWebhook menolak URL yang bukan https', () => {
  assert.throws(
    () => validasiUrlWebhook('http://script.google.com/macros/s/xxx/exec'),
    /https/i,
  );
});

test('validasiUrlWebhook menolak URL Sheet biasa dan mengarahkan ke Web App', () => {
  assert.throws(
    () => validasiUrlWebhook('https://docs.google.com/spreadsheets/d/xxxxx/edit'),
    /Web App/,
  );
});

test('validasiUrlWebhook menerima URL Web App yang benar dan merapikan spasi', () => {
  const url = validasiUrlWebhook('  https://script.google.com/macros/s/AKfycb.../exec  ');
  assert.equal(url, 'https://script.google.com/macros/s/AKfycb.../exec');
});

/* ==========================================================================
   post — menilai apakah webhook benar-benar menerima data

   Salah menilai di sini pernah membuat aplikasi melaporkan "Terkirim 1938
   baris" padahal tab Sheet-nya kosong: balasan yang tidak bisa diurai dulu
   dibiarkan lolos sebagai sukses.
   ========================================================================== */

function palsukanFetch(balasan) {
  const asli = globalThis.fetch;
  globalThis.fetch = async () => balasan;
  return () => { globalThis.fetch = asli; };
}

const balasanTeks = (teks, ok = true, status = 200) => ({
  ok, status, text: async () => teks,
});

test('post menolak balasan HTML, tidak menganggapnya sukses', async () => {
  // Web App yang tidak dapat diakses publik membalas halaman login: status 200,
  // isinya HTML. Ini persis kegagalan yang menyamar jadi keberhasilan.
  const pulihkan = palsukanFetch(balasanTeks('<!DOCTYPE html><html>Sign in</html>'));
  try {
    await assert.rejects(
      () => post('https://script.google.com/x/exec', { rows: [] }),
      /tidak membalas JSON/i,
    );
  } finally { pulihkan(); }
});

test('post menolak balasan kosong', async () => {
  const pulihkan = palsukanFetch(balasanTeks(''));
  try {
    await assert.rejects(() => post('https://x/exec', {}), /tidak membalas JSON/i);
  } finally { pulihkan(); }
});

test('post meneruskan pesan galat dari server', async () => {
  const pulihkan = palsukanFetch(balasanTeks(JSON.stringify({ ok: false, error: 'Sheet sedang dipakai' })));
  try {
    await assert.rejects(() => post('https://x/exec', {}), /Sheet sedang dipakai/);
  } finally { pulihkan(); }
});

test('post mengembalikan hitungan dan identitas tujuan dari server apa adanya', async () => {
  const pulihkan = palsukanFetch(balasanTeks(JSON.stringify({
    ok: true, inserted: 5, updated: 2, dihapus: 1, total: 7, spreadsheet: 'catatan keuangan',
  })));
  try {
    const j = await post('https://x/exec', {});
    assert.equal(j.inserted, 5);
    assert.equal(j.total, 7);
    assert.equal(j.spreadsheet, 'catatan keuangan');
  } finally { pulihkan(); }
});

test('post menolak status HTTP yang bukan sukses', async () => {
  const pulihkan = palsukanFetch(balasanTeks('Not Found', false, 404));
  try {
    await assert.rejects(() => post('https://x/exec', {}), /404/);
  } finally { pulihkan(); }
});

/* ==========================================================================
   kirimBaris — pemotongan bongkah

   Seluruh pembukuan dulu dikirim dalam satu POST, dan pada ribuan baris
   permintaan itu tidak pernah selesai tepat waktu: yang terlihat pengguna cuma
   "Sheets tidak merespons dalam 60 detik", tanpa satu baris pun terselamatkan.
   Yang diuji di sini adalah invarian yang menggantikannya — tiap bongkah pendek,
   TIDAK ADA baris yang hilang di antara bongkah, dan yang gagal bisa diulang.
   ========================================================================== */

/** Rekam tiap payload yang dikirim, dan izinkan balasan yang berbeda per POST. */
function rekamFetch(jawab) {
  const asli = globalThis.fetch;
  const dikirim = [];
  globalThis.fetch = async (url, opsi) => {
    const payload = JSON.parse(opsi.body);
    dikirim.push(payload);
    const hasil = typeof jawab === 'function' ? jawab(payload, dikirim.length) : jawab;
    if (hasil instanceof Error) throw hasil;
    return balasanTeks(JSON.stringify(hasil));
  };
  return { dikirim, pulihkan: () => { globalThis.fetch = asli; } };
}

const barisUji = (n) => Array.from({ length: n }, (_, i) => ({
  hash: `h${i}`, tanggal: '2025-07-01', deskripsi: `Uji ${i}`, nominal: -1000,
  debit: 1000, kredit: 0, bank: 'BCA', nomorRekening: '1234567890',
}));

/** Hanya POST yang benar-benar membawa data (bukan selaras/rapikan). */
const bongkahData = (dikirim) => dikirim.filter((p) => p.rows?.length && !p.selaras && !p.rapikan);

test('kirimBaris memecah kiriman besar jadi beberapa POST, tidak satu pun melebihi UKURAN_BONGKAH', async () => {
  const { dikirim, pulihkan } = rekamFetch({ ok: true, inserted: 1, total: 600, spreadsheet: 'catatan keuangan' });
  try {
    await kirimBaris('https://x/exec', barisUji(600));
  } finally { pulihkan(); }

  const data = bongkahData(dikirim);
  assert.equal(data.length, 3, '600 baris / 250 per bongkah = 3 permintaan');
  for (const p of data) {
    assert.ok(p.rows.length <= UKURAN_BONGKAH, `bongkah ${p.rows.length} baris melebihi ${UKURAN_BONGKAH}`);
    // Apps Script menolak payload yang `jumlah`-nya tidak cocok — kalau ini
    // dihitung dari daftar penuh alih-alih dari bongkahnya, penyelarasan akan
    // diam-diam berhenti bekerja.
    assert.equal(p.jumlah, p.rows.length, 'jumlah harus mengikuti bongkahnya, bukan total kiriman');
  }
});

test('kirimBaris tidak menghilangkan atau menggandakan satu baris pun di antara bongkah', async () => {
  const { dikirim, pulihkan } = rekamFetch({ ok: true, inserted: 1, total: 0 });
  const rows = barisUji(600);
  try {
    await kirimBaris('https://x/exec', rows);
  } finally { pulihkan(); }

  const terkirim = bongkahData(dikirim).flatMap((p) => p.rows.map((r) => r.hash));
  assert.equal(terkirim.length, 600, 'jumlah baris terkirim harus sama persis');
  assert.deepEqual(terkirim, rows.map((r) => r.hash), 'isi dan urutannya harus utuh');
});

test('kirimBaris menjumlahkan hitungan server, tapi mengambil total dari balasan TERAKHIR', async () => {
  // `total` adalah keadaan Sheet sesudah tiap permintaan, bukan sumbangan
  // permintaan itu. Menjumlahkannya akan melaporkan 900 untuk Sheet berisi 600.
  const { pulihkan } = rekamFetch((_p, ke) => ({
    ok: true, inserted: 200, updated: 50, total: ke * 200, spreadsheet: 'catatan keuangan', sheet: 'Transaksi',
  }));
  let r;
  try {
    r = await kirimBaris('https://x/exec', barisUji(600));
  } finally { pulihkan(); }

  assert.equal(r.baru, 600, 'inserted dijumlahkan');
  assert.equal(r.diperbarui, 150, 'updated dijumlahkan');
  assert.equal(r.total, 600, 'total diambil dari balasan terakhir, bukan dijumlahkan');
  assert.equal(r.spreadsheet, 'catatan keuangan');
  assert.equal(r.dikirim, 600);
});

test('kirimBaris mengulang bongkah yang kehabisan waktu, dan tidak melewatkan barisnya', async () => {
  let gagalSekali = false;
  const { dikirim, pulihkan } = rekamFetch((p) => {
    if (p.rows?.length && !gagalSekali) {
      gagalSekali = true;
      return new Error('Sheets tidak merespons dalam 45 detik');
    }
    return { ok: true, inserted: p.rows?.length || 0, total: 300 };
  });
  let r;
  try {
    r = await kirimBaris('https://x/exec', barisUji(300));
  } finally { pulihkan(); }

  const data = bongkahData(dikirim);
  assert.equal(data.length, 3, '2 bongkah + 1 pengulangan');
  const terkirim = new Set(data.flatMap((p) => p.rows.map((x) => x.hash)));
  assert.equal(terkirim.size, 300, 'seluruh baris tetap terkirim walau ada yang diulang');
  assert.equal(r.ok, true);
});

test('kirimBaris TIDAK mengulang penolakan server — itu akan gagal sama saja', async () => {
  // URL salah atau deployment tidak publik gagal dengan cara yang persis sama
  // berapa kali pun dicoba. Mengulangnya hanya memperlama kegagalan yang sudah
  // pasti, dan menyembunyikan pesannya di balik penungguan.
  const { dikirim, pulihkan } = rekamFetch({ ok: false, error: 'Sheets menolak data' });
  try {
    await assert.rejects(() => kirimBaris('https://x/exec', barisUji(100)), /menolak data/);
  } finally { pulihkan(); }
  assert.equal(bongkahData(dikirim).length, 1, 'hanya dicoba sekali');
});

test('kirimBaris yang putus melaporkan berapa baris yang sudah benar-benar mendarat', async () => {
  const { pulihkan } = rekamFetch((p, ke) => (ke > 1
    ? new Error('Sheets tidak merespons dalam 45 detik')
    : { ok: true, inserted: p.rows.length, total: 250 }));
  try {
    await assert.rejects(
      () => kirimBaris('https://x/exec', barisUji(600)),
      (e) => {
        // Tanpa angka ini, pengiriman yang putus di tengah tidak bisa dibedakan
        // dari yang tidak pernah dimulai.
        assert.equal(e.terkirim, 250, 'bongkah pertama sudah mendarat');
        assert.equal(e.total, 600);
        return true;
      },
    );
  } finally { pulihkan(); }
});

test('kirimBaris melaporkan kemajuan yang menaik sampai jumlah penuh', async () => {
  const { pulihkan } = rekamFetch({ ok: true, inserted: 0, total: 0 });
  const kemajuan = [];
  try {
    await kirimBaris('https://x/exec', barisUji(600), {
      onProgress: (k) => kemajuan.push(k),
    });
  } finally { pulihkan(); }

  assert.deepEqual(kemajuan.map((k) => k.terkirim), [250, 500, 600]);
  assert.ok(kemajuan.every((k) => k.total === 600));
});

/* ==========================================================================
   Permintaan penutup: penyelarasan ringan + rapikan
   ========================================================================== */

test('permintaan selaras hanya membawa identitas baris, dan ditandai hanyaSelaras', async () => {
  const { dikirim, pulihkan } = rekamFetch({ ok: true, inserted: 0, dihapus: 3, total: 600 });
  try {
    await kirimBaris('https://x/exec', barisUji(600), { selaras: true });
  } finally { pulihkan(); }

  const penutup = dikirim[dikirim.length - 1];
  assert.equal(penutup.selaras, true);
  // Tanpa penanda ini Apps Script memperlakukan baris identitas sebagai data
  // dan menuliskannya — mengosongkan tanggal, nominal, dan kategori.
  assert.equal(penutup.hanyaSelaras, true, 'penanda hanyaSelaras wajib ikut');
  assert.equal(penutup.rapikan, true, 'Dashboard dibangun di permintaan penutup');
  assert.equal(penutup.rows.length, 600);
  assert.equal(penutup.jumlah, 600, 'jumlah harus cocok, kalau tidak penyelarasan diabaikan server');
  assert.deepEqual(Object.keys(penutup.rows[0]).sort(), ['bank', 'hash', 'nomorRekening']);
  assert.ok(!('nominal' in penutup.rows[0]), 'isi baris tidak perlu dikirim ulang');
});

test('tanpa selaras, Dashboard diminta lewat permintaan terpisah tanpa baris data', async () => {
  // Memisahkannya adalah intinya: membangun Dashboard berarti membaca seluruh
  // tab data, dan selama itu menumpang permintaan yang membawa data, hiasan ikut
  // menentukan apakah transaksinya terlihat tersimpan.
  const { dikirim, pulihkan } = rekamFetch({ ok: true, inserted: 10, total: 10 });
  try {
    await kirimBaris('https://x/exec', barisUji(10));
    await new Promise((r) => setTimeout(r, 0)); // permintaan rapikan tidak ditunggu
  } finally { pulihkan(); }

  const rapikan = dikirim.filter((p) => p.rapikan === true);
  assert.equal(rapikan.length, 1);
  assert.deepEqual(rapikan[0].rows, [], 'permintaan rapikan tidak membawa data sama sekali');
  assert.ok(!rapikan[0].selaras, 'rapikan tidak boleh ikut menghapus apa pun');
});

/* ==========================================================================
   kirimHapus — penghapusan juga harus dipecah

   Menghapus satu rekening mengirim SELURUH hash miliknya. Selama itu muat satu
   permintaan berbatas 8 detik, menghapus rekening berisi ribuan transaksi tidak
   pernah bisa selesai — jalur yang tertinggal waktu jalur kirim dipecah.
   ========================================================================== */

const hashUji = (n) => Array.from({ length: n }, (_, i) => `h${i}`);

test('kirimHapus memecah daftar hash jadi beberapa permintaan', async () => {
  const { dikirim, pulihkan } = rekamFetch({ ok: true, dihapus: 250, total: 0 });
  let r;
  try {
    r = await kirimHapus('https://x/exec', hashUji(600));
  } finally { pulihkan(); }

  assert.equal(dikirim.length, 3);
  for (const p of dikirim) assert.ok(p.hapus.length <= UKURAN_BONGKAH, `${p.hapus.length} > ${UKURAN_BONGKAH}`);
  assert.deepEqual(dikirim.flatMap((p) => p.hapus), hashUji(600), 'tidak boleh ada hash yang terlewat');
  assert.deepEqual(r.sisa, []);
});

test('kirimHapus menyisakan hanya yang belum terkirim, bukan seluruh daftar', async () => {
  // Mengantrekan ulang bongkah yang server sudah konfirmasi berarti setiap
  // simpan berikutnya membayar ongkos pekerjaan yang jelas sudah selesai.
  const { pulihkan } = rekamFetch((p, ke) => (ke > 1
    ? new Error('Sheets menolak data')
    : { ok: true, dihapus: p.hapus.length, total: 0 }));
  let r;
  try {
    r = await kirimHapus('https://x/exec', hashUji(600));
  } finally { pulihkan(); }

  assert.equal(r.dihapus, 250, 'bongkah pertama sudah dikonfirmasi server');
  assert.equal(r.sisa.length, 350, 'hanya sisanya yang diantrekan lagi');
  assert.equal(r.sisa[0], 'h250');
});

test('kirimHapus mengulang bongkah yang kehabisan waktu', async () => {
  let gagalSekali = false;
  const { dikirim, pulihkan } = rekamFetch(() => {
    if (!gagalSekali) { gagalSekali = true; return new Error('Sheets tidak merespons dalam 45 detik'); }
    return { ok: true, dihapus: 1, total: 0 };
  });
  let r;
  try {
    r = await kirimHapus('https://x/exec', hashUji(300));
  } finally { pulihkan(); }

  assert.equal(dikirim.length, 3, '2 bongkah + 1 pengulangan');
  assert.deepEqual(r.sisa, [], 'tidak ada yang tertinggal');
});

/* ==========================================================================
   barisStatementUntukSheet — bahan tab "Kontrol Saldo"
   ========================================================================== */

test('barisStatementUntukSheet mengambil bulan dari periode AKHIR statement', () => {
  // Mutasi tanggal 31 Juni yang tercetak di statement Juli adalah kasus
  // nyatanya: kalau bulan diambil dari transaksi pertama, statement Juli
  // masuk sebagai statement Juni dan dibandingkan dengan bulan yang salah.
  const row = barisStatementUntukSheet(buatFileUpload({
    id: 'upl1', bank: 'BCA', nomorRekening: '123',
    periodeAwal: '2025-06-30', periodeAkhir: '2025-07-29',
  }));
  assert.equal(row.bulan, '2025-07');
});

test('barisStatementUntukSheet membedakan nol dari "tidak tercetak di statement"', () => {
  const adaAngka = barisStatementUntukSheet(buatFileUpload({
    id: 'upl1', saldoAwalStatement: 0, saldoAkhirStatement: 1500000,
    mutasiDebetStatement: 0, mutasiKreditStatement: 1500000,
  }));
  assert.equal(adaAngka.saldoAwalStatement, 0, 'nol adalah saldo yang sah, harus terkirim sebagai nol');
  assert.equal(adaAngka.mutasiDebetStatement, 0);

  // Statement yang blok ringkasannya tidak terbaca sama sekali. Dikirim
  // kosong, BUKAN nol: nol akan dilaporkan tab Kontrol Saldo sebagai selisih
  // sebesar seluruh saldo rekening.
  const tanpaAngka = barisStatementUntukSheet(buatFileUpload({ id: 'upl2' }));
  assert.equal(tanpaAngka.saldoAwalStatement, '');
  assert.equal(tanpaAngka.saldoAkhirStatement, '');
  assert.equal(tanpaAngka.mutasiDebetStatement, '');
  assert.equal(tanpaAngka.mutasiKreditStatement, '');
});

test('barisStatementUntukSheet memakai jumlah yang BENAR-BENAR tersimpan, bukan yang terbaca di PDF', () => {
  // 12 baris terbaca, 2 di antaranya duplikat yang ditolak saat simpan. Yang
  // ada di pembukuan cuma 10 — membandingkan 12 dengan hitungan Sheet akan
  // selalu melaporkan selisih yang tidak pernah bisa ditutup.
  const row = barisStatementUntukSheet(buatFileUpload({
    id: 'upl1', jumlahTransaksi: 12, berhasil: 10, duplikat: 2,
  }));
  assert.equal(row.jumlahTransaksi, 10);
});
