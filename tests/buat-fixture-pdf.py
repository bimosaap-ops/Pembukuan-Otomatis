#!/usr/bin/env python3
"""
Membuat e-statement PDF tiruan untuk pengujian.

Berkas yang dihasilkan memakai tata letak yang meniru rekening koran asli —
kolom yang disusun dengan posisi absolut, bukan tabel — sehingga menguji hal yang
sama dengan berkas sungguhan: apakah parser bisa menyusun ulang baris dan kolom
dari koordinat teks.

Jalankan:  python3 tests/buat-fixture-pdf.py
Keluaran:  tests/fixtures/*.pdf
"""

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

KELUARAN = Path(__file__).parent / "fixtures"
KELUARAN.mkdir(parents=True, exist_ok=True)

LEBAR, TINGGI = A4


def teks(c, x, y, isi, ukuran=8.5, tebal=False, rata="kiri"):
    c.setFont("Helvetica-Bold" if tebal else "Helvetica", ukuran)
    if rata == "kanan":
        c.drawRightString(x, y, isi)
    else:
        c.drawString(x, y, isi)


# ==========================================================================
# BCA — satu kolom MUTASI dengan akhiran DB, tanggal DD/MM tanpa tahun
# ==========================================================================

BCA_X = {"tanggal": 40, "keterangan": 90, "cabang": 300, "mutasi": 470, "saldo": 560}

BCA_BARIS = [
    ("01/07", "SALDO AWAL", "", "", "10.000.000,00"),
    ("02/07", "TRSF E-BANKING CR", "0308", "5.000.000,00", "15.000.000,00"),
    ("", "02/07 WSID:98765 PT MAJU", "", "", ""),
    ("", "JAYA KONSTRUKSI", "", "", ""),
    ("03/07", "BIAYA ADM", "", "15.000,00 DB", "14.985.000,00"),
    ("05/07", "QRIS DEBIT ALFAMART", "", "20.000,00 DB", "14.965.000,00"),
    ("05/07", "QRIS DEBIT ALFAMART", "", "20.000,00 DB", "14.945.000,00"),
    ("08/07", "PEMBAYARAN PLN PREPAID", "", "450.000,00 DB", "14.495.000,00"),
    ("10/07", "TRSF E-BANKING DB", "", "1.500.000,00 DB", "12.995.000,00"),
    ("", "SUPPLIER BESI BETON", "", "", ""),
    ("15/07", "TARIKAN TUNAI ATM 0123", "", "500.000,00 DB", "12.495.000,00"),
    ("20/07", "TOKOPEDIA MARKETPLACE", "", "1.250.000,00 DB", "11.245.000,00"),
    ("25/07", "GAJI KARYAWAN", "", "3.000.000,00 DB", "8.245.000,00"),
    ("31/07", "BUNGA", "", "12.500,00", "8.257.500,00"),
]


def buat_bca(nama="bca-juli-2025.pdf", password=None, periode="JULI 2025"):
    c = canvas.Canvas(str(KELUARAN / nama), pagesize=A4)
    if password:
        c.setEncrypt(password)

    y = TINGGI - 50
    teks(c, 200, y, "PT. BANK CENTRAL ASIA Tbk", 12, tebal=True)
    y -= 14
    teks(c, 200, y, "KCU JAKARTA PUSAT", 9)

    y -= 30
    for label, isi in [
        ("REKENING", "TAHAPAN"),
        ("NO. REKENING", "1234567890"),
        ("NAMA", "BUDI SANTOSO"),
        ("PERIODE", periode),
        ("MATA UANG", "IDR"),
    ]:
        teks(c, 40, y, label, 9)
        teks(c, 150, y, f": {isi}", 9)
        y -= 13

    y -= 12
    teks(c, BCA_X["tanggal"], y, "TANGGAL", 8.5, tebal=True)
    teks(c, BCA_X["keterangan"], y, "KETERANGAN", 8.5, tebal=True)
    teks(c, BCA_X["cabang"], y, "CBG", 8.5, tebal=True)
    teks(c, BCA_X["mutasi"], y, "MUTASI", 8.5, tebal=True, rata="kanan")
    teks(c, BCA_X["saldo"], y, "SALDO", 8.5, tebal=True, rata="kanan")

    y -= 6
    c.line(35, y, 565, y)
    y -= 14

    for tanggal, ket, cbg, mutasi, saldo in BCA_BARIS:
        if tanggal:
            teks(c, BCA_X["tanggal"], y, tanggal)
        if ket:
            teks(c, BCA_X["keterangan"], y, ket)
        if cbg:
            teks(c, BCA_X["cabang"], y, cbg)
        if mutasi:
            teks(c, BCA_X["mutasi"], y, mutasi, rata="kanan")
        if saldo:
            teks(c, BCA_X["saldo"], y, saldo, rata="kanan")
        y -= 13

    y -= 14
    c.line(300, y + 8, 565, y + 8)
    for label, nilai in [
        ("SALDO AWAL", "10.000.000,00"),
        ("MUTASI CR", "5.012.500,00"),
        ("MUTASI DB", "6.755.000,00"),
        ("SALDO AKHIR", "8.257.500,00"),
    ]:
        teks(c, 380, y, label, 8.5, tebal=True)
        teks(c, BCA_X["saldo"], y, f": {nilai}", 8.5, rata="kanan")
        y -= 13

    teks(c, 40, 40, "Halaman 1 dari 1", 7.5)
    c.save()
    return nama


def buat_bca_agustus(nama="bca-agustus-2025.pdf"):
    """Bulan berikutnya, untuk menguji akumulasi antar upload."""
    c = canvas.Canvas(str(KELUARAN / nama), pagesize=A4)

    y = TINGGI - 50
    teks(c, 200, y, "PT. BANK CENTRAL ASIA Tbk", 12, tebal=True)
    y -= 30
    for label, isi in [
        ("NO. REKENING", "1234567890"),
        ("NAMA", "BUDI SANTOSO"),
        ("PERIODE", "AGUSTUS 2025"),
    ]:
        teks(c, 40, y, label, 9)
        teks(c, 150, y, f": {isi}", 9)
        y -= 13

    y -= 12
    teks(c, BCA_X["tanggal"], y, "TANGGAL", 8.5, tebal=True)
    teks(c, BCA_X["keterangan"], y, "KETERANGAN", 8.5, tebal=True)
    teks(c, BCA_X["cabang"], y, "CBG", 8.5, tebal=True)
    teks(c, BCA_X["mutasi"], y, "MUTASI", 8.5, tebal=True, rata="kanan")
    teks(c, BCA_X["saldo"], y, "SALDO", 8.5, tebal=True, rata="kanan")
    y -= 20

    for tanggal, ket, mutasi, saldo in [
        ("01/08", "SALDO AWAL", "", "8.257.500,00"),
        ("04/08", "TRSF E-BANKING CR", "2.000.000,00", "10.257.500,00"),
        ("06/08", "PEMBAYARAN INDIHOME", "450.000,00 DB", "9.807.500,00"),
        ("12/08", "GOFOOD JAKARTA SELATAN", "75.000,00 DB", "9.732.500,00"),
    ]:
        if tanggal:
            teks(c, BCA_X["tanggal"], y, tanggal)
        teks(c, BCA_X["keterangan"], y, ket)
        if mutasi:
            teks(c, BCA_X["mutasi"], y, mutasi, rata="kanan")
        teks(c, BCA_X["saldo"], y, saldo, rata="kanan")
        y -= 13

    c.save()
    return nama


# ==========================================================================
# Permata — kolom Debet dan Kredit terpisah, tanggal lengkap
# ==========================================================================

PERMATA_X = {"tanggal": 40, "keterangan": 120, "debet": 380, "kredit": 470, "saldo": 560}

PERMATA_BARIS = [
    ("01/07/2025", "SALDO AWAL", "", "", "25.000.000,00"),
    ("03/07/2025", "TRANSFER MASUK DARI PT ABC", "", "7.500.000,00", "32.500.000,00"),
    ("08/07/2025", "PEMBAYARAN INDIHOME", "450.000,00", "", "32.050.000,00"),
    ("", "NO PELANGGAN 1234567890", "", "", ""),
    ("15/07/2025", "BIAYA ADMINISTRASI", "11.000,00", "", "32.039.000,00"),
    ("20/07/2025", "TOKOPEDIA MARKETPLACE", "1.250.000,00", "", "30.789.000,00"),
    ("22/07/2025", "SPBU PERTAMINA 34.123", "300.000,00", "", "30.489.000,00"),
    ("31/07/2025", "BUNGA TABUNGAN", "", "12.500,00", "30.501.500,00"),
]


def buat_permata(nama="permata-juli-2025.pdf"):
    c = canvas.Canvas(str(KELUARAN / nama), pagesize=A4)

    y = TINGGI - 50
    teks(c, 200, y, "PermataBank", 13, tebal=True)
    y -= 14
    teks(c, 200, y, "PT Bank Permata Tbk", 9)

    y -= 30
    for label, isi in [
        ("Nomor Rekening", "0987654321"),
        ("Nama", "SITI RAHAYU"),
        ("Periode", "01/07/2025 s/d 31/07/2025"),
        ("Mata Uang", "IDR"),
    ]:
        teks(c, 40, y, label, 9)
        teks(c, 160, y, f": {isi}", 9)
        y -= 13

    y -= 12
    teks(c, PERMATA_X["tanggal"], y, "Tanggal", 8.5, tebal=True)
    teks(c, PERMATA_X["keterangan"], y, "Keterangan", 8.5, tebal=True)
    teks(c, PERMATA_X["debet"], y, "Debet", 8.5, tebal=True, rata="kanan")
    teks(c, PERMATA_X["kredit"], y, "Kredit", 8.5, tebal=True, rata="kanan")
    teks(c, PERMATA_X["saldo"], y, "Saldo", 8.5, tebal=True, rata="kanan")

    y -= 6
    c.line(35, y, 565, y)
    y -= 14

    for tanggal, ket, debet, kredit, saldo in PERMATA_BARIS:
        if tanggal:
            teks(c, PERMATA_X["tanggal"], y, tanggal)
        teks(c, PERMATA_X["keterangan"], y, ket)
        if debet:
            teks(c, PERMATA_X["debet"], y, debet, rata="kanan")
        if kredit:
            teks(c, PERMATA_X["kredit"], y, kredit, rata="kanan")
        if saldo:
            teks(c, PERMATA_X["saldo"], y, saldo, rata="kanan")
        y -= 13

    y -= 14
    teks(c, PERMATA_X["keterangan"], y, "SALDO AKHIR", 8.5, tebal=True)
    teks(c, PERMATA_X["saldo"], y, ": 30.501.500,00", 8.5, rata="kanan")

    c.save()
    return nama


# ==========================================================================
# Bank lain — tanpa judul kolom, hanya susunan angka
# ==========================================================================

def buat_generik(nama="bank-lain-juli-2025.pdf"):
    c = canvas.Canvas(str(KELUARAN / nama), pagesize=A4)

    y = TINGGI - 50
    teks(c, 200, y, "BANK SEJAHTERA MANDIRI", 12, tebal=True)
    y -= 26
    teks(c, 40, y, "Nomor Rekening", 9)
    teks(c, 160, y, ": 5566778899", 9)
    y -= 30

    for tanggal, ket, nominal, saldo in [
        ("02-07-2025", "SETORAN TUNAI", "1.000.000,00", "3.000.000,00"),
        ("04-07-2025", "PEMBAYARAN LISTRIK", "250.000,00", "2.750.000,00"),
        ("09-07-2025", "TARIKAN TUNAI ATM", "500.000,00", "2.250.000,00"),
        ("18-07-2025", "TRANSFER DARI ANDI", "750.000,00", "3.000.000,00"),
        ("28-07-2025", "ZAKAT PENGHASILAN BAZNAS", "200.000,00", "2.800.000,00"),
    ]:
        teks(c, 40, y, tanggal)
        teks(c, 130, y, ket)
        teks(c, 430, y, nominal, rata="kanan")
        teks(c, 560, y, saldo, rata="kanan")
        y -= 14

    c.save()
    return nama


# ==========================================================================
# Permata "Mutasi Transaksi" — unduhan dari aplikasi PermataMobile.
# Tanpa judul kolom, tanpa kolom saldo, satu kolom nominal rata kanan,
# dan arah transaksi hanya dibedakan oleh warna: merah keluar, hijau masuk.
# ==========================================================================

MUTASI_LEBAR, MUTASI_TINGGI = 840, 1242
MERAH = (221 / 255, 12 / 255, 37 / 255)
HIJAU = (0 / 255, 136 / 255, 115 / 255)
TEPI_KANAN = 792

# (tanggal, [(baris deskripsi...), nominal, masuk?])
MUTASI_ISI = [
    ("23 Januari 2026", [
        (["TRF BIFAST KE BUDI SANTOSO 6090378994 BANK CENTRAL",
          "ASIA Permata ME 12:20:44 - 000125563819"], "Rp 12,000,000.00", False),
        (["PB DARI PT CONTOH PUTRA MANDIRI DCMS 07:39:55 BUDI",
          "SANTOSO Gaji Periode Januari2026 0897020670900098"], "Rp 12,282,427.00", True),
    ]),
    ("06 Januari 2026", [
        (["TRF BIFAST KE BUDI SANTOSO 6090378994 BANK CENTRAL",
          "ASIA Permata ME 23:53:26 - 000043500619"], "Rp 6,000,000.00", False),
    ]),
    ("01 Januari 2026", [
        (["Biaya adm. bulan JANUARI 2026"], "Rp 7,500.00", False),
    ]),
]


def buat_permata_mutasi(nama="permata-mutasi-januari-2026.pdf", berwarna=True):
    """`berwarna=False` meniru berkas hasil cetak hitam-putih, tempat arah
    transaksi terpaksa ditebak dari kata kunci."""
    c = canvas.Canvas(str(KELUARAN / nama), pagesize=(MUTASI_LEBAR, MUTASI_TINGGI))

    c.setFont("Helvetica", 17)
    c.drawString(616, 1166, "Mutasi Transaksi")
    c.setFont("Helvetica", 11)
    c.drawString(700, 1140, "Januari 2026")
    c.setFont("Helvetica", 17)
    c.drawString(139, 1074, "Payroll")
    c.setFont("Helvetica", 10)
    c.drawString(139, 1045, "0012-3884-7210")

    y = 991
    for tanggal, transaksi in MUTASI_ISI:
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica", 9)
        c.drawString(49, y, tanggal)
        y -= 40

        for baris_desk, nominal, masuk in transaksi:
            # Nominal digambar di tengah blok deskripsi, persis seperti aslinya.
            y_nominal = y - 10 if len(baris_desk) > 1 else y
            for i, teks_desk in enumerate(baris_desk):
                c.setFillColorRGB(0, 0, 0)
                c.setFont("Helvetica", 11)
                c.drawString(86, y - i * 19, teks_desk)

            if berwarna:
                c.setFillColorRGB(*(HIJAU if masuk else MERAH))
            else:
                c.setFillColorRGB(0, 0, 0)
            c.setFont("Helvetica", 11)
            c.drawRightString(TEPI_KANAN, y_nominal, nominal)

            y -= len(baris_desk) * 19 + 22
        y -= 20

    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 6)
    c.drawString(407, 77, "PT Bank Permata, Tbk. berizin dan diawasi oleh Otoritas Jasa Keuangan dan Bank Indonesia")
    c.drawString(407, 69, "serta merupakan peserta penjaminan Lembaga Penjamin Simpanan.")
    c.drawString(45, 71, "PermataBank.com | Permata Tel 1500-111 atau 021-2985-0611")
    c.setFont("Helvetica", 7)
    c.drawString(682, 96, "Halaman/ Page 1 / 1")

    c.save()
    return nama


if __name__ == "__main__":
    dibuat = [
        buat_bca(),
        buat_bca_agustus(),
        buat_bca("bca-juli-2025-terkunci.pdf", password="rahasia123"),
        buat_permata(),
        buat_generik(),
        buat_permata_mutasi(),
        buat_permata_mutasi("permata-mutasi-hitam-putih.pdf", berwarna=False),
    ]
    for d in dibuat:
        print(f"  {KELUARAN / d}")
