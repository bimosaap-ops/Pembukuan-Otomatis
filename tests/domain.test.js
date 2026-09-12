import test from 'node:test';
import assert from 'node:assert/strict';

import { kunciDasar, bubuhiBaseHash, tandaiDuplikat, paksaSimpan, ringkasDuplikat } from '../src/domain/dedupe.js';
import { tentukanKategori, saranPola, tambahPola, KATEGORI_BAWAAN } from '../src/domain/categorize.js';
import { KATEGORI_LAINNYA_KELUAR, KATEGORI_LAINNYA_MASUK } from '../src/domain/entities.js';
import { uploadTumpangTindih, transaksiKembarAntarUpload } from '../src/domain/validate.js';
import { parseStatement } from '../src/parsers/registry.js';
import { statementBCA, statementBCAAgustus } from './fixtures/statements.js';

const AKUN = 'acc_bca_1';

/** Meniru database: menghitung berapa transaksi tersimpan per baseHash. */
function petaJumlah(tersimpan) {
  const peta = new Map();
  tersimpan.forEach((t) => peta.set(t.baseHash, (peta.get(t.baseHash) || 0) + 1));
  return peta;
}

/* ==========================================================================
   Kunci duplikat
   ========================================================================== */

test('kunci duplikat tahan beda penulisan deskripsi dan pembulatan nominal', () => {
  const a = kunciDasar({ accountId: AKUN, tanggal: '2025-07-02', deskripsi: 'TRSF  E-BANKING cr', nominal: 5000000 });
  const b = kunciDasar({ accountId: AKUN, tanggal: '2025-07-02', deskripsi: 'trsf e-banking CR', nominal: 5000000.0 });
  assert.equal(a, b, 'spasi ganda dan huruf besar-kecil tidak boleh membedakan');

  const beda = kunciDasar({ accountId: AKUN, tanggal: '2025-07-02', deskripsi: 'TRSF E-BANKING CR', nominal: 5000001 });
  assert.notEqual(a, beda, 'nominal berbeda harus menghasilkan kunci berbeda');
});

test('kunci duplikat memakai rekening, bukan teks bank/nomor dari dalam berkas', async () => {
  // Inti temuan audit. Dua berkas dari SATU rekening yang sama bisa menuliskan
  // identitasnya berbeda — label bank berbeda ("Permata" vs "PermataBank"),
  // nomor ber-nol-depan, atau nomornya tidak terbaca sama sekali di berkas
  // pertama. Pencocokan rekening sengaja menganggap perbedaan itu tidak
  // mengikat; selama kunci duplikat TIDAK ikut begitu, seluruh transaksi di
  // periode yang beririsan tersimpan dua kali.
  const baris = [{ tanggal: '2025-07-02', deskripsi: 'QRIS ALFAMART', nominal: -15000 }];

  const dariBerkasA = await bubuhiBaseHash(baris, 'acc_permata');
  const dariBerkasB = await bubuhiBaseHash(baris, 'acc_permata');
  assert.equal(dariBerkasA[0].baseHash, dariBerkasB[0].baseHash,
    'rekening sama harus menghasilkan kunci sama, apa pun tulisan di berkasnya');

  // Dan kebalikannya: baris identik di rekening BERBEDA tidak boleh bertabrakan.
  // Dengan kunci lama ini mustahil dibedakan — memindahkan statement ke rekening
  // lain sama sekali tidak mengubah kuncinya.
  const rekeningLain = await bubuhiBaseHash(baris, 'acc_bca');
  assert.notEqual(dariBerkasA[0].baseHash, rekeningLain[0].baseHash,
    'rekening berbeda harus terpisah');
});

/* ==========================================================================
   Akumulasi antar upload — inti kebutuhan pengguna
   ========================================================================== */

test('upload statement yang sama dua kali tidak menggandakan data', async () => {
  const hasil = parseStatement([statementBCA()]);
  const baris = await bubuhiBaseHash(hasil.transaksi, AKUN);

  const pertama = tandaiDuplikat(baris, new Map());
  assert.equal(ringkasDuplikat(pertama).baru, 6, 'upload pertama: semua transaksi masuk');
  assert.equal(ringkasDuplikat(pertama).duplikat, 0);

  const tersimpan = pertama.filter((b) => !b.duplikat);
  const kedua = tandaiDuplikat(baris, petaJumlah(tersimpan));

  assert.equal(ringkasDuplikat(kedua).baru, 0, 'upload kedua: tidak ada yang ditambahkan');
  assert.equal(ringkasDuplikat(kedua).duplikat, 6);
});

test('dua transaksi kembar yang memang asli tetap tersimpan dua-duanya', async () => {
  const hasil = parseStatement([statementBCA()]);
  const baris = await bubuhiBaseHash(hasil.transaksi, AKUN);

  // Statement contoh memuat dua QRIS ALFAMART Rp 20.000 pada tanggal yang sama.
  const kembar = baris.filter((b) => b.deskripsi.includes('ALFAMART'));
  assert.equal(kembar.length, 2);
  assert.equal(kembar[0].baseHash, kembar[1].baseHash, 'keduanya punya kunci dasar yang sama');

  const ditandai = tandaiDuplikat(baris, new Map());
  const hasilKembar = ditandai.filter((b) => b.deskripsi.includes('ALFAMART'));
  assert.equal(hasilKembar.filter((b) => !b.duplikat).length, 2, 'keduanya harus tetap masuk');
  assert.notEqual(hasilKembar[0].hash, hasilKembar[1].hash, 'hash akhir tetap unik');
});

test('statement bulan berikutnya menambah data, bukan menimpa', async () => {
  const juli = await bubuhiBaseHash(parseStatement([statementBCA()]).transaksi, AKUN);
  const agustus = await bubuhiBaseHash(parseStatement([statementBCAAgustus()]).transaksi, AKUN);

  const tersimpan = tandaiDuplikat(juli, new Map()).filter((b) => !b.duplikat);
  const hasilAgustus = tandaiDuplikat(agustus, petaJumlah(tersimpan));

  assert.equal(ringkasDuplikat(hasilAgustus).baru, 2, 'dua transaksi Agustus adalah data baru');
  const total = tersimpan.length + hasilAgustus.filter((b) => !b.duplikat).length;
  assert.equal(total, 8, 'pembukuan terakumulasi jadi 8 transaksi');
});

test('statement dengan periode tumpang tindih hanya menambahkan selisihnya', async () => {
  const juli = await bubuhiBaseHash(parseStatement([statementBCA()]).transaksi, AKUN);
  const tersimpan = tandaiDuplikat(juli, new Map()).filter((b) => !b.duplikat);

  // Unduhan ulang yang memuat seluruh Juli plus satu transaksi baru di akhir bulan.
  const ulang = [...juli, {
    tanggal: '2025-07-28', deskripsi: 'PEMBAYARAN PLN', nominal: -450000, saldo: 9995000,
    baseHash: 'hash-transaksi-baru',
  }];

  const hasil = tandaiDuplikat(ulang, petaJumlah(tersimpan));
  assert.equal(ringkasDuplikat(hasil).baru, 1);
  assert.equal(ringkasDuplikat(hasil).duplikat, 6);
});

test('baris duplikat bisa dipaksa simpan tanpa merusak keunikan hash', async () => {
  const juli = await bubuhiBaseHash(parseStatement([statementBCA()]).transaksi, AKUN);
  const tersimpan = tandaiDuplikat(juli, new Map()).filter((b) => !b.duplikat);
  const jumlah = petaJumlah(tersimpan);

  const kedua = tandaiDuplikat(juli, jumlah);
  const dipaksa = paksaSimpan(kedua[0], kedua, jumlah);

  assert.equal(dipaksa.duplikat, false);
  assert.equal(dipaksa.ordinal, 2, 'kejadian berikutnya sesudah yang sudah tersimpan');
  assert.ok(!tersimpan.some((t) => t.hash === dipaksa.hash), 'hash tidak bentrok dengan data lama');
});

/* ==========================================================================
   Kategorisasi
   ========================================================================== */

test('kategori otomatis mengenali pola khas transaksi Indonesia', () => {
  const uji = [
    ['QRIS DEBIT ALFAMART JAKARTA', -20000, 'kat_belanja'],
    ['PEMBAYARAN PLN PREPAID', -450000, 'kat_tagihan'],
    ['BIAYA ADM', -15000, 'kat_biaya_bank'],
    ['TARIKAN TUNAI ATM 0123', -500000, 'kat_tarik_tunai'],
    ['PEMBAYARAN TOKOPEDIA MARKETPLACE', -1250000, 'kat_belanja_online'],
    ['GOFOOD JAKARTA SELATAN', -75000, 'kat_makan'],
    ['SPBU PERTAMINA 34.123', -200000, 'kat_transport'],
    ['BUNGA TABUNGAN', 12500, 'kat_bunga'],
    ['GAJI BULAN JULI', 8000000, 'kat_gaji'],
    ['ZAKAT PENGHASILAN BAZNAS', -200000, 'kat_donasi'],
  ];

  uji.forEach(([deskripsi, nominal, harapan]) => {
    assert.equal(tentukanKategori(deskripsi, nominal, KATEGORI_BAWAAN), harapan, `"${deskripsi}" seharusnya masuk ${harapan}`);
  });
});

test('kata "GAJI" masuk kategori berbeda tergantung arah transaksi', () => {
  assert.equal(tentukanKategori('GAJI KARYAWAN JULI', 8000000, KATEGORI_BAWAAN), 'kat_gaji');
  assert.equal(tentukanKategori('GAJI KARYAWAN JULI', -8000000, KATEGORI_BAWAAN), 'kat_gaji_karyawan');
});

test('kata kunci spesifik mengalahkan kata kunci transfer yang umum', () => {
  // "TRANSFER" ada di kategori Transfer Keluar, tapi PLN jauh lebih khas.
  assert.equal(tentukanKategori('TRANSFER PEMBAYARAN PLN', -450000, KATEGORI_BAWAAN), 'kat_tagihan');
  assert.equal(tentukanKategori('TRSF E-BANKING DB 12345 BUDI', -1000000, KATEGORI_BAWAAN), 'kat_transfer_keluar');
});

test('transaksi tanpa pola yang dikenal jatuh ke kategori penampung', () => {
  assert.equal(tentukanKategori('XYZQW 8891', -100000, KATEGORI_BAWAAN), KATEGORI_LAINNYA_KELUAR);
  assert.equal(tentukanKategori('XYZQW 8891', 100000, KATEGORI_BAWAAN), KATEGORI_LAINNYA_MASUK);
});

test('koreksi manual menghasilkan kata kunci yang bisa dipakai ulang', () => {
  const pola = saranPola('PEMBAYARAN VIA MOBILE BANKING KLINIK SEHAT SENTOSA 0812');
  assert.ok(pola.length >= 4);
  assert.ok(!['PEMBAYARAN', 'MOBILE', 'BANKING', 'VIA'].includes(pola), `kata umum tidak boleh dipilih, dapat "${pola}"`);

  const kategori = tambahPola({ id: 'kat_kesehatan', polaKataKunci: ['APOTEK'] }, pola);
  assert.ok(kategori.polaKataKunci.includes(pola));

  const lagi = tambahPola(kategori, pola.toLowerCase());
  assert.equal(lagi.polaKataKunci.length, kategori.polaKataKunci.length, 'kata kunci yang sama tidak ditambah dua kali');
});


/* ==========================================================================
   Penyeragaman nomor rekening
   ========================================================================== */

test('nomor rekening yang ditulis berbeda tetap dianggap satu rekening', async () => {
  const { normalkanNomor } = await import('../src/data/repo/accounts.js');

  // Rekening koran menulis "1238847210", unduhan Mutasi Transaksi "0012-3884-7210".
  assert.equal(normalkanNomor('1238847210'), normalkanNomor('0012-3884-7210'));
  assert.equal(normalkanNomor('0012-3884-7210'), '1238847210');
  assert.equal(normalkanNomor(' 1238847210 '), '1238847210');
  assert.equal(normalkanNomor('001.238.847.210'), '1238847210');

  // Rekening yang memang berbeda tidak boleh menyatu.
  assert.notEqual(normalkanNomor('1238847210'), normalkanNomor('1238840550'));
  assert.equal(normalkanNomor(''), '');
  assert.equal(normalkanNomor(null), '');
});

test('kata kunci kategori tidak menangkap potongan nama orang', async () => {
  const { tentukanKategori: tentukan, KATEGORI_BAWAAN: bawaan } = await import('../src/domain/categorize.js');

  // "SAFITRI" memuat "TRI", "DANAMON" memuat "DANA" — keduanya nama, bukan merchant.
  assert.equal(tentukan('PB KE GIANI SAFITRI 1238840550 Permata ME', -107100, bawaan), 'kat_transfer_keluar');
  assert.equal(tentukan('TRF BIFAST KE TRI SATYANINGSIH 3430368264', -2950000, bawaan), 'kat_transfer_keluar');
  assert.equal(tentukan('TRF DARI BESTINDO BANK DANAMON Dana Dimuka', 5730000, bawaan), 'kat_transfer_masuk');

  // Bentuk yang tidak ambigu tetap harus kena.
  assert.equal(tentukan('PULSA TELKOMSEL 0812', -50000, bawaan), 'kat_pulsa');
  assert.equal(tentukan('ISI SALDO DANA 0812', -100000, bawaan), 'kat_dompet_digital');
});

test('kata kunci tetap cocok walau kode referensi menempel tanpa spasi ke nama merchant', () => {
  // Statement BCA sungguhan mencetak kode referensi QR menempel langsung ke nama
  // merchant tanpa spasi ("00000.00KOPI KLOTO") — batas kata `\b` bawaan regex
  // menganggap digit dan huruf sama-sama karakter kata, jadi transisi ini gagal
  // dianggap batas dan "KOPI" gagal cocok walau merchant-nya jelas.
  assert.equal(
    tentukanKategori('TRANSAKSI DEBIT TGL: 05/07 QR 002 00000.00KOPI KLOTO', -57800, KATEGORI_BAWAAN),
    'kat_makan',
  );
  assert.equal(
    tentukanKategori('TRANSAKSI DEBIT TGL: 12/07 QR 014 00000.00SPBU 31.13', -45000, KATEGORI_BAWAAN),
    'kat_transport',
  );

  // Proteksi lama tidak boleh melonggar: transisi huruf-ke-huruf tetap ditolak.
  assert.equal(tentukanKategori('PB KE GIANI SAFITRI 1238840550 Permata ME', -107100, KATEGORI_BAWAAN), 'kat_transfer_keluar');
  assert.equal(tentukanKategori('TRF DARI BESTINDO BANK DANAMON Dana Dimuka', 5730000, KATEGORI_BAWAAN), 'kat_transfer_masuk');
});

test('nama masakan jalanan Indonesia dikenali sebagai Makan & Minum, bukan jatuh ke penampung', () => {
  // Ditemukan lewat audit data nyata: ratusan transaksi QRIS warung dengan
  // format "TRANSAKSI DEBIT TGL: .. QR ### 00000.00[nama masakan]" (tanpa
  // spasi sebelum nama merchant — lihat catatan cocokKunci) jatuh ke
  // "Pengeluaran Lain" karena nama masakannya sendiri tidak dikenal, bukan
  // nama warung/resto generik seperti "WARUNG"/"CAFE"/"KFC" yang sudah ada.
  const uji = [
    'TRANSAKSI DEBIT TGL: 23/08 QR 008 00000.00Iga Bakar',
    'TRANSAKSI DEBIT TGL: 03/07 QR 008 00000.00BAKSO CIPTA',
    'TRANSAKSI DEBIT TGL: 06/07 QR 013 00000.00SATE MADURA',
    'TRANSAKSI DEBIT TGL: 25/07 QR 009 00000.00qr Warteg Aceh',
    'TRANSAKSI DEBIT TGL: 20/05 00000.00NASI GORENG SPESIAL',
    'TRANSAKSI DEBIT TGL: 08/07 QR 013 00000.00Pecel lele lamongan',
    'TRANSAKSI DEBIT TGL: 26/07 QR 014 00000.00SOTO MIE BOGOR',
    'TRANSAKSI DEBIT TGL: 16/11 QR 916 00000.00Mie Ayam Bang Jali',
  ];
  uji.forEach((deskripsi) => {
    assert.equal(tentukanKategori(deskripsi, -25000, KATEGORI_BAWAAN), 'kat_makan',
      `"${deskripsi}" seharusnya masuk Makan & Minum, bukan penampung`);
  });
});

test('singkatan BI-FAST "BIF TRANSFER DR" dikenali sebagai Transfer Masuk', () => {
  // Ditemukan lewat audit data nyata: ~75 juta rupiah dari ~19 pengirim
  // berbeda nyangkut di "Pemasukan Lain" karena kata kunci lama cuma
  // menangkap "TRANSFER DARI"/"BIFAST DARI" (kata penuh), bukan singkatan
  // "DR" yang dipakai statement BCA untuk notifikasi BI-FAST masuk.
  const uji = [
    'BIF TRANSFER DR FEBI SASTI RAHAYU',
    'BIF TRANSFER DR 028 FEBI SASTI RAHAYU',
    'BIF TRANSFER DR 013 PUTRI VIONA ROSSA',
  ];
  uji.forEach((deskripsi) => {
    assert.equal(tentukanKategori(deskripsi, 2000000, KATEGORI_BAWAAN), 'kat_transfer_masuk',
      `"${deskripsi}" seharusnya masuk Transfer Masuk, bukan penampung`);
  });
});

test('celah kata kunci lain yang ditemukan lewat audit data nyata', () => {
  const uji = [
    // Transfer sesama BCA lewat MyBCA tanpa kata "TRF"/"TRANSFER" sama sekali.
    ['KE 008 DIVA QUINTA MAHMUD /MYBCA 95271', -6000000, 'kat_transfer_keluar'],
    // "GO-PAY" bertanda hubung tidak match "GOPAY" tanpa tanda hubung.
    ['PAY GO-PAY CUSTOMER 8980XXXXXXX7279 Permata ME 13:05:08', -100000, 'kat_dompet_digital'],
    // "TOPUP" generik, dan nama merchant yang jadi Alfamidi/AEON di EDC.
    ['TOPUP088291177279 0145200311031084', -100000, 'kat_dompet_digital'],
    ['MIDI 088C PONDOK K 6019007586510332', -283700, 'kat_belanja'],
    ['PURCHASE ALTO 20:00:27 AEON STORE PAKUWON BKS BEKASI', -118500, 'kat_belanja'],
    // Kedai kopi dengan ejaan "COFFE" (tanpa E kedua), dan resto rantai Solaria.
    ['MONO MUSIC & COFFE 6019007586510332', -120000, 'kat_makan'],
    ['SOLARIA-SUNTER FRE 6019007586510332', -119000, 'kat_makan'],
    // Tarik tunai tanpa kata "ATM"/"CASH" di depannya.
    ['WITHDRAWAL DI LINK 305036145 JL. POND', -100000, 'kat_tarik_tunai'],
    // Tempat biliar -- hiburan, bukan dompet digital/penampung.
    ["D'PALACE BILLIARD 6019007586510332", -196400, 'kat_langganan'],
    // Reimbursement/penggantian dana, bukan sekadar transfer masuk biasa.
    ['LLG-DANAMON BESTINDO PUTRA MAN Penggantian dana Konsumsi PC', 2441000, 'kat_refund'],
  ];
  uji.forEach(([deskripsi, nominal, harapan]) => {
    assert.equal(tentukanKategori(deskripsi, nominal, KATEGORI_BAWAAN), harapan,
      `"${deskripsi}" seharusnya masuk ${harapan}`);
  });
});

/* ==========================================================================
   uploadTumpangTindih — deteksi e-statement yang ter-upload dua kali
   ========================================================================== */

const upl = (id, accountId, awal, akhir, berhasil = 10) => ({
  id, accountId, periodeAwal: awal, periodeAkhir: akhir, berhasil,
});

test('uploadTumpangTindih menandai dua upload untuk bulan yang sama pada rekening sama', () => {
  // Persis kasus nyata yang ditemukan saat audit: Agustus ter-upload dua kali
  // di satu rekening, hash-nya berbeda sehingga dedupe tidak menangkapnya.
  const hasil = uploadTumpangTindih([
    upl('a', 'acc1', '2025-07-01', '2025-07-31'),
    upl('b', 'acc1', '2025-08-01', '2025-08-31'),
    upl('c', 'acc1', '2025-08-01', '2025-08-31'),
  ]);
  assert.deepEqual([...hasil].sort(), ['b', 'c']);
});

test('uploadTumpangTindih tidak menandai rekening yang berbeda', () => {
  const hasil = uploadTumpangTindih([
    upl('a', 'acc1', '2025-08-01', '2025-08-31'),
    upl('b', 'acc2', '2025-08-01', '2025-08-31'),
  ]);
  assert.equal(hasil.size, 0);
});

test('uploadTumpangTindih tidak menandai periode yang bersambung tapi tidak beririsan', () => {
  const hasil = uploadTumpangTindih([
    upl('a', 'acc1', '2025-07-01', '2025-07-31'),
    upl('b', 'acc1', '2025-08-01', '2025-08-31'),
  ]);
  assert.equal(hasil.size, 0);
});

test('uploadTumpangTindih menandai irisan sebagian, bukan cuma periode identik', () => {
  const hasil = uploadTumpangTindih([
    upl('a', 'acc1', '2025-07-15', '2025-08-14'),
    upl('b', 'acc1', '2025-08-01', '2025-08-31'),
  ]);
  assert.deepEqual([...hasil].sort(), ['a', 'b']);
});

test('uploadTumpangTindih melewati upload tanpa periode atau tanpa transaksi', () => {
  // Periode kosong tidak bisa dibandingkan, dan upload yang gagal total tidak
  // menambah apa pun ke pembukuan sehingga tidak mungkin menggelembungkannya.
  assert.equal(uploadTumpangTindih([
    upl('a', 'acc1', '', ''),
    upl('b', 'acc1', '2025-08-01', '2025-08-31'),
  ]).size, 0);

  assert.equal(uploadTumpangTindih([
    upl('a', 'acc1', '2025-08-01', '2025-08-31', 0),
    upl('b', 'acc1', '2025-08-01', '2025-08-31'),
  ]).size, 0);

  assert.equal(uploadTumpangTindih([]).size, 0);
  assert.equal(uploadTumpangTindih(undefined).size, 0);
});

/* ==========================================================================
   transaksiKembarAntarUpload

   Pembedaan yang menentukan: kembar dari SATU berkas memang bisa asli, kembar
   dari DUA berkas adalah penggandaan. Kalau keduanya sama-sama ditandai,
   peringatannya jadi bising sampai tidak dibaca lagi.
   ========================================================================== */

const kembarUji = (i, uploadedFileId) => ({
  hash: `b1#${i}`, baseHash: 'b1', uploadedFileId, nominal: -20000,
});

test('kembar di dalam satu berkas TIDAK ditandai — dua QRIS sehari memang bisa terjadi', () => {
  const hasil = transaksiKembarAntarUpload([kembarUji(1, 'upl1'), kembarUji(2, 'upl1')]);
  assert.equal(hasil.jumlah, 0);
});

test('kembar dari dua berkas ditandai, beserta nilai rupiah kelebihannya', () => {
  const hasil = transaksiKembarAntarUpload([kembarUji(1, 'upl1'), kembarUji(2, 'upl2')]);
  assert.equal(hasil.jumlah, 1, 'satu di antaranya memang seharusnya ada; sisanya berlebih');
  assert.equal(hasil.nilai, 20000);
  assert.deepEqual(hasil.hash, ['b1#2']);
});

test('transaksi manual tidak ikut dinilai', () => {
  // Tanpa uploadedFileId: pengguna memasukkannya sendiri, jadi kembarannya
  // memang disengaja dan bukan urusan pemeriksaan ini.
  const hasil = transaksiKembarAntarUpload([
    { hash: 'm#1', baseHash: 'm', nominal: -5000 },
    { hash: 'm#2', baseHash: 'm', nominal: -5000 },
  ]);
  assert.equal(hasil.jumlah, 0);
});

test('baseHash berbeda tidak pernah dianggap kembar', () => {
  const hasil = transaksiKembarAntarUpload([
    { hash: 'a#1', baseHash: 'a', uploadedFileId: 'upl1', nominal: -1000 },
    { hash: 'c#1', baseHash: 'c', uploadedFileId: 'upl2', nominal: -1000 },
  ]);
  assert.equal(hasil.jumlah, 0);
});
