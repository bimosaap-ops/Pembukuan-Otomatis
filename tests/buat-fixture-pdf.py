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
# Permata Rekening Koran bulanan (unduhan Permata ME / Permata Net).
# Meniru berkas sungguhan: halaman lebar, judul kolom dua bahasa yang berulang,
# dua kolom tanggal, tanggal DD/MM tanpa tahun, SALDO AWAL, dan baris Total.
# Halaman sampul dan disclaimer disertakan karena keduanya tidak boleh
# ikut terbaca sebagai transaksi.
# ==========================================================================

RK_LEBAR, RK_TINGGI = 2008, 1420
RK_X = {"tanggal": 91, "valuta": 296, "uraian": 431}
RK_KANAN = {"debet": 1240, "kredit": 1580, "saldo": 1940}

# (tanggal, uraian, [baris sambungan], debet, kredit, saldo)
RK_TRANSAKSI = [
    ("02/07", "PAY TOKOPEDIA 750888291177279 Perma",
     ["ta ME 00:36:08 750888291177279"], "189.500,00", "", "646.862,00"),
    ("07/07", "PB DARI PT CONTOH PUTRA MANDIRI D",
     ["CMS 10:15:08 BIMO CONTOH Bonus", "Periode 2024 0897188808600101"],
     "", "18.360.430,00", "19.007.292,00"),
    ("08/07", "PB KE GIANI CONTOH 1238840550 Perm ata",
     ["ME 09:33:46 -"], "107.100,00", "", "18.900.192,00"),
    ("13/07", "TRF BIFAST KE BIMO CONTOH 60903789",
     ["94 BANK CENTRAL ASIA Permata ME", "03:44:46 - 000105945190"],
     "17.000.000,00", "", "1.900.192,00"),
    ("31/07", "PENDAPATAN BUNGA", [], "", "2.719,00", "1.902.911,00"),
    ("31/07", "PAJAK ATAS BUNGA", [], "544,00", "", "1.902.367,00"),
]


def _rk_kop(c, halaman_ke, dari):
    """Kop dan kaki halaman, muncul sama di setiap halaman."""
    c.setFont("Helvetica-Bold", 15)
    c.drawString(1601, RK_TINGGI - 60, "Rekening Koran")
    c.setFont("Helvetica", 10)
    c.drawString(1782, RK_TINGGI - 78, "Account Statement")

    y = RK_TINGGI - 120
    for kiri, label, nilai in [
        ("BIMO CONTOH", "Periode Laporan", "01 JULI 2025 - 31 JULI 2025"),
        ("PT CONTOH HUTAMA LINTAS NUSANTARA", "Statement Period", ""),
        ("JL CONTOH SERIBU RUKO SEKTOR VII", "Tanggal Laporan", "1 AGUSTUS 2025"),
        ("KOTA TANGERANG SELATAN 15322", "Statement Date", ""),
        ("", "No.CIF", "B0024WQ"),
    ]:
        c.setFont("Helvetica", 10)
        if kiri:
            c.drawString(60, y, kiri)
        if label:
            c.drawString(895, y, label)
        if nilai:
            c.drawString(1245, y, nilai)
        y -= 22

    y -= 14
    for label, sub, nilai in [
        ("No. Rekening", "Account No.", "1238847210"),
        ("Cabang", "Branch", "PermataBank KB.JERUK AKR"),
        ("Nama Produk", "Product Name", "Permata Payroll"),
        ("Mata Uang", "Currency", "IDR"),
    ]:
        c.setFont("Helvetica", 10)
        c.drawString(60, y, label)
        c.drawString(370, y, nilai)
        y -= 16
        c.setFont("Helvetica", 8)
        c.drawString(60, y, sub)
        y -= 20

    c.setFont("Helvetica", 8)
    c.drawString(1786, 96, "Halaman/")
    c.drawString(1905, 96, "Page")
    c.drawString(1955, 96, "%02d/%02d" % (halaman_ke, dari))
    c.setFont("Helvetica", 7)
    c.drawString(1045, 77, "PT Bank Permata, Tbk. berizin dan diawasi oleh Otoritas Jasa Keuangan dan Bank Indonesia")
    c.drawString(1045, 68, "serta merupakan peserta penjaminan Lembaga Penjamin Simpanan.")
    c.drawString(60, 71, "PermataBank.com | Permata Tel 1500-111 atau (021) 2985-0611")
    return y


def _rk_judul(c, y):
    """Tiga baris judul kolom, persis seperti aslinya."""
    c.setFont("Helvetica-Bold", 10)
    c.drawString(90, y, "Tgl Trx.")
    c.drawString(260, y, "Tgl Valuta")
    c.drawString(430, y, "Uraian Trx.")
    c.drawString(1216, y, "Debet")
    c.drawString(1550, y, "Kredit")
    c.drawString(1916, y, "Saldo")
    y -= 16
    c.setFont("Helvetica", 8)
    c.drawString(90, y, "Trx. Date")
    c.drawString(270, y, "Val. Date")
    c.drawString(430, y, "Trx. Description")
    c.drawString(1229, y, "Debit")
    c.drawString(1552, y, "Credit")
    c.drawString(1883, y, "Balance")
    y -= 14
    c.drawString(90, y, "(dd/mm)")
    c.drawString(270, y, "(dd/mm)")
    return y - 26


def buat_permata_rekening_koran(nama="permata-rekening-koran-juli-2025.pdf"):
    c = canvas.Canvas(str(KELUARAN / nama), pagesize=(RK_LEBAR, RK_TINGGI))

    # --- Halaman 1: sampul / ringkasan rekening, tanpa judul kolom ----------
    y = _rk_kop(c, 1, 3)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(60, y, "Ringkasan Rekening")
    c.drawString(1281, y, "Ekuivalen Saldo Rupiah - 31 Juli 2025")
    y -= 30
    c.setFont("Helvetica", 10)
    c.drawString(91, y, "Rekening Simpanan")
    c.drawString(1324, y, "Total")
    c.drawRightString(RK_KANAN["saldo"], y, "1.902.367,00")
    y -= 26
    c.drawString(90, y, "Nama Produk")
    c.drawString(603, y, "Mata Uang")
    c.drawString(842, y, "Jumlah Rekening")
    c.drawString(1451, y, "Saldo")
    c.drawString(1803, y, "Saldo Rupiah")
    y -= 22
    c.drawString(91, y, "Permata Payroll")
    c.drawString(668, y, "IDR")
    c.drawString(972, y, "1")
    c.drawRightString(1420, y, "1.902.367,00")
    c.drawRightString(RK_KANAN["saldo"], y, "1.902.367,00")
    c.showPage()

    # --- Halaman 2: tabel transaksi ----------------------------------------
    y = _rk_kop(c, 2, 3)
    y = _rk_judul(c, y)

    c.setFont("Helvetica", 10)
    c.drawString(RK_X["uraian"], y, "SALDO AWAL")
    c.drawRightString(RK_KANAN["saldo"], y, "836.362,00")
    y -= 24

    for tgl, uraian, sambungan, debet, kredit, saldo in RK_TRANSAKSI:
        c.setFont("Helvetica", 10)
        c.drawString(RK_X["tanggal"], y, tgl)
        c.drawString(RK_X["valuta"], y, tgl)
        c.drawString(RK_X["uraian"], y, uraian)
        if debet:
            c.drawRightString(RK_KANAN["debet"], y, debet)
        if kredit:
            c.drawRightString(RK_KANAN["kredit"], y, kredit)
        if saldo:
            c.drawRightString(RK_KANAN["saldo"], y, saldo)
        y -= 18
        for teks in sambungan:
            c.drawString(RK_X["uraian"], y, teks)
            y -= 18
        y -= 8

    # Baris penutup: nominal total dulu, kata "Total" di baris berikutnya.
    y -= 12
    c.drawRightString(RK_KANAN["debet"], y, "17.297.144,00")
    c.drawRightString(RK_KANAN["kredit"], y, "18.363.149,00")
    y -= 20
    c.setFont("Helvetica-Bold", 10)
    c.drawString(91, y, "Total")
    c.showPage()

    # --- Halaman 3: disclaimer, tanpa judul kolom --------------------------
    y = _rk_kop(c, 3, 3)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(60, y, "Disclaimer :")
    y -= 22
    c.setFont("Helvetica", 9)
    for i, teks in enumerate([
        "Laporan transaksi ini sah dan tidak memerlukan tanda tangan pejabat dari PT Bank Permata, Tbk.",
        "This statement is valid without authorized signature of PT Bank Permata, Tbk.",
        "File eStatement yang di unduh melalui Permata ME / Permata Net sudah tidak menggunakan password.",
    ]):
        c.drawString(60, y, "%d." % (i + 1))
        c.drawString(120, y, teks)
        y -= 20
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
        buat_permata_rekening_koran(),
        buat_generik(),
        buat_permata_mutasi(),
        buat_permata_mutasi("permata-mutasi-hitam-putih.pdf", berwarna=False),
    ]
    for d in dibuat:
        print(f"  {KELUARAN / d}")
