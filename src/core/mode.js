/**
 * "Fase A": Google Sheets jadi editor utama untuk Transaksi/Akun/Kategori —
 * PWA hanya untuk lihat data, dashboard, dan upload e-statement. Satu flag
 * terpusat supaya gampang di-rollback (ubah nilai ini, bukan menghapus kode
 * form/CRUD yang masih ada tapi tidak lagi dipanggil dari UI).
 */
export const MODE_BACA_SAJA_SHEETS = true;
