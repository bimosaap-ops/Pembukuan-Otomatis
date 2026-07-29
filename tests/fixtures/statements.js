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

/* ==========================================================================
   Permata — kolom Debet dan Kredit terpisah, tanggal lengkap
   ========================================================================== */

export const PERMATA_KOLOM = { tanggal: 40, keterangan: 130, debet: 330, kredit: 420, saldo: 510 };

export function statementPermata() {
  const K = PERMATA_KOLOM;
  return halaman([
    [[200, 'PermataBank']],
    [[200, 'PT Bank Permata Tbk']],
    [[40, 'Nomor Rekening'], [160, ': 0987654321']],
    [[40, 'Nama'], [160, ': SITI RAHAYU']],
    [[40, 'Periode'], [160, ': 01/07/2025 s/d 31/07/2025']],
    null,
    [[K.tanggal, 'Tanggal'], [K.keterangan, 'Keterangan'], [K.debet, 'Debet'], [K.kredit, 'Kredit'], [K.saldo, 'Saldo']],
    [[K.tanggal, '01/07/2025'], [K.keterangan, 'SALDO AWAL'], [K.saldo, '25.000.000,00']],
    [[K.tanggal, '03/07/2025'], [K.keterangan, 'TRANSFER MASUK DARI PT ABC'], [K.kredit, '7.500.000,00'], [K.saldo, '32.500.000,00']],
    [[K.tanggal, '08/07/2025'], [K.keterangan, 'PEMBAYARAN INDIHOME'], [K.debet, '450.000,00'], [K.saldo, '32.050.000,00']],
    [[K.keterangan, 'NO PELANGGAN 1234567890']],
    [[K.tanggal, '15/07/2025'], [K.keterangan, 'BIAYA ADMINISTRASI'], [K.debet, '11.000,00'], [K.saldo, '32.039.000,00']],
    [[K.tanggal, '20/07/2025'], [K.keterangan, 'TOKOPEDIA MARKETPLACE'], [K.debet, '1.250.000,00'], [K.saldo, '30.789.000,00']],
    [[K.tanggal, '31/07/2025'], [K.keterangan, 'BUNGA TABUNGAN'], [K.kredit, '12.500,00'], [K.saldo, '30.801.500,00']],
    null,
    [[K.keterangan, 'SALDO AKHIR'], [K.saldo, ': 30.801.500,00']],
  ]);
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
