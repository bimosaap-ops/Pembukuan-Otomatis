/**
 * Statement tiruan untuk pengujian.
 *
 * Yang dibuat di sini adalah potongan teks ber-koordinat — bentuk yang sama persis
 * dengan keluaran pdf.js. Dengan begitu logika penyusunan baris dan seluruh adapter
 * bisa diuji tanpa membuka berkas PDF sungguhan.
 */

/** Membuat satu baris: daftar [x, teks] pada ketinggian y yang sama. */
export function baris(y, sel, h = 8) {
  return sel.map(([x, str]) => ({
    str: String(str),
    x,
    y,
    // Lebar diperkirakan dari jumlah karakter, cukup untuk menentukan band kolom.
    w: String(str).length * (h * 0.5),
    h,
  }));
}

/** y dalam PDF menurun ke bawah; helper ini menyusun baris berurutan dari atas. */
export function halaman(daftarBaris, yAwal = 800, jarak = 14) {
  return daftarBaris.flatMap((sel, i) => (sel === null ? [] : baris(yAwal - i * jarak, sel)));
}

/* ==========================================================================
   BCA — satu kolom MUTASI dengan akhiran DB, tanggal DD/MM tanpa tahun
   ========================================================================== */

export const BCA_KOLOM = { tanggal: 40, keterangan: 95, cabang: 300, mutasi: 350, saldo: 470 };

export function statementBCA({ tahun = 2025, bulan = '07' } = {}) {
  const K = BCA_KOLOM;
  return halaman([
    [[200, 'PT. BANK CENTRAL ASIA Tbk']],
    [[200, 'KCU JAKARTA PUSAT']],
    [[40, 'REKENING'], [150, ': TAHAPAN']],
    [[40, 'NO. REKENING'], [150, ': 1234567890']],
    [[40, 'NAMA'], [150, ': BUDI SANTOSO']],
    [[40, 'PERIODE'], [150, ': JULI 2025']],
    [[40, 'MATA UANG'], [150, ': IDR']],
    null,
    [[K.tanggal, 'TANGGAL'], [K.keterangan, 'KETERANGAN'], [K.cabang, 'CBG'], [K.mutasi, 'MUTASI'], [K.saldo, 'SALDO']],
    [[K.tanggal, `01/${bulan}`], [K.keterangan, 'SALDO AWAL'], [K.saldo, '10.000.000,00']],
    [[K.tanggal, `02/${bulan}`], [K.keterangan, 'TRSF E-BANKING CR'], [K.cabang, '0308'], [K.mutasi, '5.000.000,00'], [K.saldo, '15.000.000,00']],
    [[K.keterangan, `02/${bulan} WSID:98765 PT MAJU`]],
    [[K.keterangan, 'JAYA KONSTRUKSI']],
    [[K.tanggal, `03/${bulan}`], [K.keterangan, 'BIAYA ADM'], [K.mutasi, '15.000,00'], [K.mutasi + 60, 'DB'], [K.saldo, '14.985.000,00']],
    [[K.tanggal, `05/${bulan}`], [K.keterangan, 'QRIS DEBIT ALFAMART'], [K.mutasi, '20.000,00'], [K.mutasi + 60, 'DB'], [K.saldo, '14.965.000,00']],
    [[K.tanggal, `05/${bulan}`], [K.keterangan, 'QRIS DEBIT ALFAMART'], [K.mutasi, '20.000,00'], [K.mutasi + 60, 'DB'], [K.saldo, '14.945.000,00']],
    [[K.tanggal, `10/${bulan}`], [K.keterangan, 'TRSF E-BANKING DB'], [K.mutasi, '1.500.000,00'], [K.mutasi + 60, 'DB'], [K.saldo, '13.445.000,00']],
    [[K.keterangan, 'SUPPLIER BESI']],
    [[K.tanggal, `25/${bulan}`], [K.keterangan, 'GAJI KARYAWAN'], [K.mutasi, '3.000.000,00'], [K.mutasi + 60, 'DB'], [K.saldo, '10.445.000,00']],
    null,
    [[K.cabang, 'SALDO AWAL'], [K.saldo, ': 10.000.000,00']],
    [[K.cabang, 'MUTASI CR'], [K.saldo, ': 5.000.000,00']],
    [[K.cabang, 'MUTASI DB'], [K.saldo, ': 4.555.000,00']],
    [[K.cabang, 'SALDO AKHIR'], [K.saldo, ': 10.445.000,00']],
    [[40, 'Halaman 1 dari 1']],
  ]).map((it) => ({ ...it, y: it.y, tahun }));
}

/** Statement BCA bulan berikutnya — dipakai menguji akumulasi antar upload. */
export function statementBCAAgustus() {
  const K = BCA_KOLOM;
  return halaman([
    [[200, 'PT. BANK CENTRAL ASIA Tbk']],
    [[40, 'NO. REKENING'], [150, ': 1234567890']],
    [[40, 'NAMA'], [150, ': BUDI SANTOSO']],
    [[40, 'PERIODE'], [150, ': AGUSTUS 2025']],
    null,
    [[K.tanggal, 'TANGGAL'], [K.keterangan, 'KETERANGAN'], [K.cabang, 'CBG'], [K.mutasi, 'MUTASI'], [K.saldo, 'SALDO']],
    [[K.tanggal, '01/08'], [K.keterangan, 'SALDO AWAL'], [K.saldo, '10.445.000,00']],
    [[K.tanggal, '04/08'], [K.keterangan, 'TRSF E-BANKING CR'], [K.mutasi, '2.000.000,00'], [K.saldo, '12.445.000,00']],
    [[K.tanggal, '06/08'], [K.keterangan, 'PEMBAYARAN PLN'], [K.mutasi, '450.000,00'], [K.mutasi + 60, 'DB'], [K.saldo, '11.995.000,00']],
  ]);
}

/** Statement yang melewati pergantian tahun: Desember lalu Januari. */
export function statementBCAAkhirTahun() {
  const K = BCA_KOLOM;
  return halaman([
    [[200, 'PT. BANK CENTRAL ASIA Tbk']],
    [[40, 'PERIODE'], [150, ': DESEMBER 2024']],
    null,
    [[K.tanggal, 'TANGGAL'], [K.keterangan, 'KETERANGAN'], [K.cabang, 'CBG'], [K.mutasi, 'MUTASI'], [K.saldo, 'SALDO']],
    [[K.tanggal, '30/12'], [K.keterangan, 'TRSF E-BANKING CR'], [K.mutasi, '1.000.000,00'], [K.saldo, '5.000.000,00']],
    [[K.tanggal, '02/01'], [K.keterangan, 'BIAYA ADM'], [K.mutasi, '15.000,00'], [K.mutasi + 60, 'DB'], [K.saldo, '4.985.000,00']],
  ]);
}

/**
 * Statement BCA dua halaman — meniru berkas sungguhan yang mencetak ulang kop
 * dan paragraf semacam disclaimer di kepala SETIAP halaman, bukan hanya
 * halaman pertama. Dipakai membuktikan transaksi terakhir halaman pertama
 * tidak tersambung dengan baris kop/disclaimer di awal halaman kedua.
 */
export function statementBCADuaHalaman() {
  const K = BCA_KOLOM;

  const hal1 = halaman([
    [[200, 'PT. BANK CENTRAL ASIA Tbk']],
    [[40, 'NO. REKENING'], [150, ': 1234567890']],
    [[40, 'PERIODE'], [150, ': JULI 2025']],
    null,
    [[K.tanggal, 'TANGGAL'], [K.keterangan, 'KETERANGAN'], [K.cabang, 'CBG'], [K.mutasi, 'MUTASI'], [K.saldo, 'SALDO']],
    [[K.tanggal, '01/07'], [K.keterangan, 'SALDO AWAL'], [K.saldo, '10.000.000,00']],
    [[K.tanggal, '02/07'], [K.keterangan, 'TRSF E-BANKING DB'], [K.mutasi, '50.000,00'], [K.mutasi + 60, 'DB'], [K.saldo, '9.950.000,00']],
    [[K.keterangan, 'PEMBAYARAN GRAB']],
    [[40, 'Bersambung ke halaman berikut']],
  ]);

  const hal2 = halaman([
    [[200, 'PT. BANK CENTRAL ASIA Tbk']],
    [[40, 'HALAMAN'], [150, ': 2/2']],
    // Baris ini meniru paragraf disclaimer yang dicetak ulang di kepala tiap
    // halaman pada statement sungguhan — bukan judul kolom, bukan baris
    // ringkasan, dan posisinya bertumpuk dengan pita kolom KETERANGAN, persis
    // seperti paragraf disclaimer BCA yang sebagian tumpang tindih pita itu.
    [[K.keterangan, 'KETENTUAN UMUM BERLAKU SESUAI SYARAT']],
    [[K.tanggal, 'TANGGAL'], [K.keterangan, 'KETERANGAN'], [K.cabang, 'CBG'], [K.mutasi, 'MUTASI'], [K.saldo, 'SALDO']],
    [[K.tanggal, '10/07'], [K.keterangan, 'BIAYA ADM'], [K.mutasi, '15.000,00'], [K.mutasi + 60, 'DB'], [K.saldo, '9.935.000,00']],
    null,
    [[K.cabang, 'SALDO AWAL'], [K.saldo, ': 10.000.000,00']],
    [[K.cabang, 'MUTASI DB'], [K.saldo, ': 65.000,00']],
    [[K.cabang, 'SALDO AKHIR'], [K.saldo, ': 9.935.000,00']],
  ]);

  return [hal1, hal2];
}

/* ==========================================================================
   Permata Rekening Koran bulanan — meniru berkas sungguhan:
   judul kolom dua bahasa yang berulang tiap halaman, dua kolom tanggal,
   tanggal DD/MM tanpa tahun, SALDO AWAL, dan baris Total penutup.
   Halaman sampul dan halaman disclaimer sengaja disertakan karena keduanya
   tidak boleh ikut terbaca sebagai transaksi.
   ========================================================================== */

export const PERMATA_KOLOM = {
  tanggal: 90, valuta: 296, uraian: 431, debet: 1111, kredit: 1454, saldo: 1810,
};

/** Tiga baris judul yang selalu muncul di atas tabel transaksi. */
function judulPermata() {
  return [
    [[90, 'Tgl Trx.'], [260, 'Tgl Valuta'], [430, 'Uraian Trx.'], [1216, 'Debet'], [1550, 'Kredit'], [1916, 'Saldo']],
    [[90, 'Trx. Date'], [270, 'Val. Date'], [430, 'Trx. Description'], [1229, 'Debit'], [1552, 'Credit'], [1883, 'Balance']],
    [[90, '(dd/mm)'], [270, '(dd/mm)']],
  ];
}

function kopPermata() {
  return [
    [[1601, 'Rekening Koran'], [1782, 'Account Statement']],
    [[60, 'BIMO CONTOH'], [895, 'Periode Laporan'], [1245, '01 JULI 2025 - 31 JULI 2025']],
    [[60, 'PT CONTOH HUTAMA LINTAS NUSANTARA'], [895, 'Statement Period']],
    [[895, 'Tanggal Laporan'], [1245, '1 AGUSTUS 2025']],
    [[895, 'No.CIF'], [1245, 'B0024WQ']],
    [[60, 'No. Rekening'], [370, '1238847210']],
    [[60, 'Account No.']],
    [[60, 'Nama Produk'], [370, 'Permata Payroll']],
    [[60, 'Mata Uang'], [370, 'IDR']],
  ];
}

function kakiPermata() {
  return [
    [[1786, 'Halaman/'], [1905, 'Page'], [1971, '02/03']],
    [[1045, 'PT Bank Permata, Tbk. berizin dan diawasi oleh Otoritas Jasa Keuangan dan Bank Indonesia']],
    [[60, 'PermataBank.com | Permata Tel 1500-111 atau (021) 2985-0611']],
  ];
}

const K = { tanggal: 91, valuta: 296, uraian: 431, debet: 1111, kredit: 1454, saldo: 1810 };

/** [tanggal, uraian, [baris sambungan], debet, kredit, saldo] */
const PERMATA_TRANSAKSI = [
  ['02/07', 'PAY TOKOPEDIA 750888291177279 Perma', ['ta ME 00:36:08 750888291177279'], '189.500,00', '', '646.862,00'],
  ['07/07', 'PB DARI PT CONTOH PUTRA MANDIRI D', ['CMS 10:15:08 BIMO CONTOH Bonus', 'Periode 2024 0897188808600101'], '', '18.360.430,00', '19.007.292,00'],
  ['08/07', 'PB KE GIANI CONTOH 1238840550 Perm ata', ['ME 09:33:46 -'], '107.100,00', '', '18.900.192,00'],
  ['13/07', 'TRF BIFAST KE BIMO CONTOH 60903789', ['94 BANK CENTRAL ASIA Permata ME', '03:44:46 - 000105945190'], '17.000.000,00', '', '1.900.192,00'],
  ['31/07', 'PENDAPATAN BUNGA', [], '', '2.719,00', '1.902.911,00'],
  ['31/07', 'PAJAK ATAS BUNGA', [], '544,00', '', '1.902.367,00'],
];

function halamanTransaksiPermata() {
  const isi = [];
  isi.push([[K.uraian, 'SALDO AWAL'], [K.saldo, '836.362,00']]);

  PERMATA_TRANSAKSI.forEach(([tgl, uraian, sambungan, debet, kredit, saldo]) => {
    const sel = [[K.tanggal, tgl], [K.valuta, tgl], [K.uraian, uraian]];
    if (debet) sel.push([K.debet, debet]);
    if (kredit) sel.push([K.kredit, kredit]);
    if (saldo) sel.push([K.saldo, saldo]);
    isi.push(sel);
    sambungan.forEach((teks) => isi.push([[K.uraian, teks]]));
  });

  // Baris penutup: nominal total dulu, kata "Total" di baris berikutnya.
  isi.push([[K.debet, '17.297.144,00'], [K.kredit, '18.363.149,00']]);
  isi.push([[K.tanggal, 'Total']]);
  return isi;
}

/**
 * Statement tiga halaman: sampul, tabel transaksi, lalu disclaimer.
 * Setiap halaman dikembalikan terpisah, seperti keluaran pdf.js.
 */
export function statementPermataRekeningKoran() {
  const sampul = halaman([
    ...kopPermata(),
    [[60, 'Ringkasan Rekening'], [1281, 'Ekuivalen Saldo Rupiah – 31 Juli 2025']],
    [[91, 'Rekening Simpanan'], [1324, 'Total'], [1767, '1.902.367,00']],
    [[90, 'Nama Produk'], [603, 'Mata Uang'], [842, 'Jumlah Rekening'], [1451, 'Saldo'], [1803, 'Saldo Rupiah']],
    [[91, 'Permata Payroll'], [668, 'IDR'], [972, '1'], [1358, '1.902.367,00'], [1823, '1.902.367,00']],
    ...kakiPermata(),
  ]);

  const tabel = halaman([
    ...kopPermata(),
    ...judulPermata(),
    ...halamanTransaksiPermata(),
    ...kakiPermata(),
  ]);

  const disclaimer = halaman([
    ...kopPermata(),
    [[60, 'Disclaimer :']],
    [[60, '1.'], [120, 'Laporan transaksi ini sah dan tidak memerlukan tanda tangan pejabat dari PT Bank Permata, Tbk.']],
    [[120, 'File eStatement yang di unduh melalui Permata ME / Permata Net sudah tidak menggunakan password.']],
    ...kakiPermata(),
  ]);

  return [sampul, tabel, disclaimer];
}

/* ==========================================================================
   Bank lain — tanpa judul kolom sama sekali, hanya susunan angka
   ========================================================================== */

export function statementGenerikTanpaHeader() {
  return halaman([
    [[200, 'BANK SEJAHTERA MANDIRI']],
    [[40, 'Nomor Rekening'], [160, ': 5566778899']],
    null,
    [[40, '02-07-2025'], [120, 'SETORAN TUNAI'], [330, '1.000.000,00'], [430, '3.000.000,00']],
    [[40, '04-07-2025'], [120, 'PEMBAYARAN LISTRIK'], [330, '250.000,00'], [430, '2.750.000,00']],
    [[40, '09-07-2025'], [120, 'TARIKAN TUNAI ATM'], [330, '500.000,00'], [430, '2.250.000,00']],
    [[40, '18-07-2025'], [120, 'TRANSFER DARI ANDI'], [330, '750.000,00'], [430, '3.000.000,00']],
  ]);
}
