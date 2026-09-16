#!/usr/bin/env node
/**
 * CLI tipis untuk src/domain/tinjauanOtomatis.js -- baca berkas ekspor
 * "Ekspor untuk Ditinjau" dari halaman Transaksi Email, tulis berkas
 * keputusan siap-upload lewat "Terapkan Hasil Tinjauan".
 *
 * Pemakaian:
 *   1. Di aplikasi: halaman Transaksi Email -> "Ekspor untuk Ditinjau"
 *      -> unduh transaksi-email-tinjauan-YYYY-MM-DD.json
 *   2. node tools/analisa-tinjauan-email.mjs transaksi-email-tinjauan-....json
 *   3. Baca ringkasan yang dicetak -- kalau masuk akal, unggah
 *      keputusan-tinjauan.json lewat "Terapkan Hasil Tinjauan" di aplikasi.
 *      Aplikasi masih menampilkan ringkasan konfirmasi sebelum benar-benar
 *      menerapkannya, jadi ini bukan tindakan sekali-jalan tanpa kontrol.
 *
 * Lihat header src/domain/tinjauanOtomatis.js untuk kebijakan lengkapnya.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { analisaTinjauanAmbiguous } from '../src/domain/tinjauanOtomatis.js';

const [, , pathMasuk, pathKeluarArg] = process.argv;
if (!pathMasuk) {
  console.error('Pemakaian: node tools/analisa-tinjauan-email.mjs <berkas-ekspor.json> [berkas-keputusan-keluar.json]');
  process.exit(1);
}

const data = JSON.parse(readFileSync(pathMasuk, 'utf8'));
const { keputusan, catatan } = analisaTinjauanAmbiguous(data);

const label = { tautkan: 'TAUTKAN', abaikan: 'ABAIKAN', lewati: 'LEWATI ' };
const cariTrx = (id) => data.transaksiEmail.find((t) => t.gmailMessageId === id);
catatan.forEach((c) => {
  const trx = cariTrx(c.gmailMessageId);
  console.log(`${label[c.aksi]}  ${trx?.merchantMentah || c.gmailMessageId} (${trx?.bank}, ${trx?.waktuTransaksi}) -- ${c.ket}`);
});

const jumlahTautkan = keputusan.filter((k) => k.aksi === 'tautkan').length;
const jumlahAbaikan = keputusan.filter((k) => k.aksi === 'abaikan').length;
const jumlahLewati = catatan.length - keputusan.length;

console.log('');
console.log(`Total "Perlu Ditinjau" diperiksa : ${catatan.length}`);
console.log(`  - diusulkan TAUTKAN            : ${jumlahTautkan}`);
console.log(`  - diusulkan ABAIKAN            : ${jumlahAbaikan}`);
console.log(`  - tetap perlu tinjauan manual  : ${jumlahLewati}`);

const pathKeluar = pathKeluarArg || 'keputusan-tinjauan.json';
writeFileSync(pathKeluar, JSON.stringify(keputusan, null, 2));
console.log(`\nDitulis ${keputusan.length} keputusan ke ${pathKeluar}.`);
console.log('Periksa daftar di atas dulu -- baru unggah berkas ini lewat "Terapkan Hasil Tinjauan" di aplikasi.');
