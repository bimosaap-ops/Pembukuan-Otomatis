/**
 * Validasi hasil parsing sebelum data masuk pembukuan.
 *
 * Parser PDF pada dasarnya menebak struktur dari posisi teks, jadi hasilnya harus
 * dibuktikan. Statement bank menyediakan dua bukti yang bisa dipakai:
 * kolom saldo berjalan, dan ringkasan mutasi di akhir halaman.
 *
 * Modul murni.
 */

/** Selisih di bawah satu rupiah dianggap pembulatan, bukan kesalahan baca. */
const TOLERANSI = 0.999;

export const MASALAH = {
  SALDO_LONCAT: 'saldo-loncat',
  TANGGAL_MUNDUR: 'tanggal-mundur',
  NOMINAL_KOSONG: 'nominal-kosong',
  TANGGAL_KOSONG: 'tanggal-kosong',
};

const PESAN = {
  [MASALAH.SALDO_LONCAT]: 'Saldo tidak nyambung dengan baris sebelumnya',
  [MASALAH.TANGGAL_MUNDUR]: 'Tanggal mundur dari baris sebelumnya',
  [MASALAH.NOMINAL_KOSONG]: 'Nominal tidak terbaca',
  [MASALAH.TANGGAL_KOSONG]: 'Tanggal tidak terbaca',
};

export function pesanMasalah(kode) {
  return PESAN[kode] || kode;
}

/**
 * Memeriksa tiap baris dan menandai yang mencurigakan.
 * Baris tetap dikembalikan seluruhnya — keputusan membuang ada di tangan pengguna.
 *
 * @returns {{baris: Array, ringkas: {total:number, curiga:number, adaKolomSaldo:boolean}}}
 */
export function validasiBaris(daftar) {
  const adaKolomSaldo = daftar.some((b) => b.saldo !== null && b.saldo !== undefined);
  let saldoAcuan = null;
  // Sebagian bank (mis. BCA) hanya mencetak saldo berjalan pada sebagian baris,
  // bukan di setiap baris. Mutasi baris-baris yang tidak bersaldo di antara dua
  // baris bersaldo tetap harus ikut dijumlahkan sebelum dibandingkan — kalau
  // hanya mutasi baris terakhir yang dibandingkan, hampir setiap baris sesudah
  // baris tak-bersaldo akan salah ditandai padahal angkanya benar.
  let akumulasi = 0;
  let tanggalSebelumnya = null;

  const baris = daftar.map((b) => {
    const masalah = [];

    if (!b.tanggal) masalah.push(MASALAH.TANGGAL_KOSONG);
    if (!Number.isFinite(b.nominal) || b.nominal === 0) masalah.push(MASALAH.NOMINAL_KOSONG);

    if (b.tanggal && tanggalSebelumnya && b.tanggal < tanggalSebelumnya) {
      masalah.push(MASALAH.TANGGAL_MUNDUR);
    }
    if (b.tanggal) tanggalSebelumnya = b.tanggal;

    if (adaKolomSaldo) {
      akumulasi += Number(b.nominal) || 0;
      const saldo = b.saldo;
      if (saldo !== null && saldo !== undefined) {
        if (saldoAcuan !== null && Math.abs(saldoAcuan + akumulasi - saldo) > TOLERANSI) {
          masalah.push(MASALAH.SALDO_LONCAT);
        }
        // Nilai tercetak selalu dipercaya sebagai acuan berikutnya, supaya satu
        // baris yang salah baca tidak ikut menandai seluruh baris sesudahnya.
        saldoAcuan = saldo;
        akumulasi = 0;
      }
    }

    return { ...b, masalah, curiga: masalah.length > 0 };
  });

  return {
    baris,
    ringkas: {
      total: baris.length,
      curiga: baris.filter((b) => b.curiga).length,
      adaKolomSaldo,
    },
  };
}

/**
 * Membandingkan hasil parsing dengan ringkasan yang tercetak di statement
 * (SALDO AWAL, MUTASI CR/DB, SALDO AKHIR). Ini bukti terkuat bahwa seluruh
 * halaman terbaca utuh — kalau totalnya pas, tidak ada baris yang terlewat.
 *
 * @returns null bila statement tidak memuat ringkasan yang bisa dibandingkan.
 */
export function cocokkanRingkasan(daftar, ringkasan) {
  if (!ringkasan) return null;

  const totalKredit = daftar.reduce((s, b) => s + (b.nominal > 0 ? b.nominal : 0), 0);
  const totalDebet = daftar.reduce((s, b) => s + (b.nominal < 0 ? -b.nominal : 0), 0);

  const cek = [];

  if (Number.isFinite(ringkasan.mutasiKredit)) {
    const selisih = totalKredit - ringkasan.mutasiKredit;
    cek.push({
      nama: 'Mutasi kredit', hasil: totalKredit, statement: ringkasan.mutasiKredit,
      selisih, cocok: Math.abs(selisih) <= TOLERANSI,
    });
  }
  if (Number.isFinite(ringkasan.mutasiDebet)) {
    const selisih = totalDebet - ringkasan.mutasiDebet;
    cek.push({
      nama: 'Mutasi debet', hasil: totalDebet, statement: ringkasan.mutasiDebet,
      selisih, cocok: Math.abs(selisih) <= TOLERANSI,
    });
  }
  if (Number.isFinite(ringkasan.saldoAwal) && Number.isFinite(ringkasan.saldoAkhir)) {
    const hitung = ringkasan.saldoAwal + totalKredit - totalDebet;
    const selisih = hitung - ringkasan.saldoAkhir;
    cek.push({
      nama: 'Saldo akhir', hasil: hitung, statement: ringkasan.saldoAkhir,
      selisih, cocok: Math.abs(selisih) <= TOLERANSI,
    });
  }

  if (!cek.length) return null;
  return { cek, semuaCocok: cek.every((c) => c.cocok) };
}

/** Periode statement dari tanggal paling awal dan paling akhir yang terbaca. */
export function periodeDariBaris(daftar) {
  const tanggal = daftar.map((b) => b.tanggal).filter(Boolean).sort();
  return { periodeAwal: tanggal[0] || '', periodeAkhir: tanggal[tanggal.length - 1] || '' };
}

/**
 * Upload mana yang periodenya beririsan dengan upload lain pada rekening yang
 * sama — tanda satu e-statement ter-upload dua kali.
 *
 * Ini kesalahan yang mahal justru karena tidak terlihat: transaksinya masuk
 * semua dengan hash berbeda (hasil baca ulang bisa sedikit berbeda), jadi
 * dedupe tidak menangkapnya, dan pembukuan menggelembung diam-diam sampai
 * ketahuan berbulan-bulan kemudian saat angkanya dibandingkan dengan rekening
 * koran. Menandainya di Riwayat membuatnya ketahuan saat kejadian.
 *
 * Tanggal ISO ("2025-08-01") dibandingkan langsung sebagai teks: urutan
 * leksikalnya sama dengan urutan kronologisnya.
 *
 * @param {Array} daftar rekaman upload (butuh accountId, periodeAwal, periodeAkhir)
 * @returns {Set<string>} id upload yang beririsan dengan setidaknya satu upload lain
 */
export function uploadTumpangTindih(daftar) {
  const bertanda = new Set();
  // Upload yang tidak menghasilkan transaksi tidak menambah apa pun ke
  // pembukuan, jadi tidak mungkin jadi sumber penggelembungan.
  const layak = (daftar || []).filter(
    (u) => u && u.accountId && u.periodeAwal && u.periodeAkhir && (u.berhasil || 0) > 0,
  );

  for (let i = 0; i < layak.length; i += 1) {
    for (let j = i + 1; j < layak.length; j += 1) {
      const a = layak[i];
      const b = layak[j];
      if (a.accountId !== b.accountId) continue;
      if (a.periodeAwal <= b.periodeAkhir && b.periodeAwal <= a.periodeAkhir) {
        bertanda.add(a.id);
        bertanda.add(b.id);
      }
    }
  }
  return bertanda;
}

/**
 * Saldo Awal rekening menurut e-statement PALING AWAL yang pernah di-upload
 * untuk rekening itu.
 *
 * Hanya dikembalikan bila statement itu memang yang paling awal untuk rekening
 * itu — lihat catatan di dalam fungsi soal kenapa statement bulan tengah tidak
 * boleh dipakai sebagai titik berangkat.
 *
 * @param {Array} uploads rekaman upload milik SATU rekening
 * @returns {{nilai:number, periodeAwal:string, id:string}|null} null bila tidak
 *   ada satu pun upload yang menyimpan angka Saldo Awal cetakan bank, atau bila
 *   yang menyimpannya bukan statement terawal rekening itu
 */
export function statementTerawalBersaldo(uploads) {
  const daftar = (uploads || []).filter((u) => u && u.periodeAwal);
  const layak = daftar
    .filter((u) => Number.isFinite(Number(u.saldoAwalStatement))
      && u.saldoAwalStatement !== null && u.saldoAwalStatement !== '')
    .sort((a, b) => String(a.periodeAwal).localeCompare(String(b.periodeAwal)));

  if (!layak.length) return null;
  const t = layak[0];

  // Angka ini cuma berlaku sebagai titik berangkat SELURUH pembukuan rekening
  // bila tidak ada statement lain yang periodenya lebih awal. Kalau ada — dan
  // kebetulan statement itulah yang tidak menyimpan angka saldo cetakan bank —
  // maka saldo sebelum periode ini memang tidak diketahui, dan memakai angka
  // ini berarti seluruh mutasi di bulan-bulan sebelumnya terhitung dua kali.
  //
  // Bukan kasus karangan: pada satu rekening BCA di data produksi, 23 dari 23
  // statement tidak menyimpan angka saldo sama sekali. Meng-upload ulang SATU
  // statement bulan tengah akan membuat statement itu jadi "yang terawal
  // bersaldo" — dan tanpa penjagaan ini, Saldo Awal rekening akan dipindahkan
  // ke saldo awal bulan itu, menggeser pembukuan sebesar netto sebelas bulan
  // sebelumnya.
  const adaYangLebihAwal = daftar.some((u) => String(u.periodeAwal) < String(t.periodeAwal));
  if (adaYangLebihAwal) return null;

  return { nilai: Number(t.saldoAwalStatement), periodeAwal: t.periodeAwal, id: t.id || '' };
}

/**
 * Nilai Saldo Awal yang SEHARUSNYA dipakai rekening, atau null bila yang
 * tersimpan sekarang sudah benar / tidak bisa ditentukan.
 *
 * Kenapa ini perlu: Saldo Awal rekening dulu diisi dari statement yang
 * KEBETULAN di-upload lebih dulu, bukan dari statement yang periodenya paling
 * awal — dan sekali terisi tidak pernah dikoreksi. Meng-upload statement yang
 * lebih tua sesudahnya menambahkan transaksinya ke pembukuan tanpa memundurkan
 * titik berangkatnya, sehingga SELURUH saldo hitungan rekening itu bergeser
 * sebesar mutasi yang terlewat — diam-diam, dan untuk selamanya. Terlihat di
 * data produksi pada DUA rekening sekaligus: satu bergeser Rp 8.012.650 (tab
 * "Kontrol Saldo" melaporkan selisih yang sama persis di SEMUA 21 bulannya),
 * satu lagi Rp 2.769.511.
 *
 * Angka cetakan bank pada statement TERAWAL menang atas apa pun yang tersimpan:
 * untuk rekening bank, "saldo sebelum transaksi pertama yang diimpor" justru
 * itulah yang dicetak bank di situ, jadi nilai lain yang bertentangan dengannya
 * memang salah. Yang menjaga pengguna bukan menebak-nebak dari mana angka lama
 * berasal, melainkan dua syarat yang jauh lebih tegas:
 *
 *   - rekening tanpa statement bersaldo sama sekali tidak pernah disentuh —
 *     termasuk seluruh akun kas/tunai, yang Saldo Awalnya memang hanya bisa
 *     datang dari pengguna;
 *   - statement bulan tengah tidak pernah dipakai sebagai titik berangkat
 *     (lihat statementTerawalBersaldo).
 *
 * @param {number|null|undefined} saldoAwalSekarang nilai di record rekening
 * @param {Array} uploads rekaman upload milik rekening itu, termasuk yang baru
 * @returns {number|null} nilai baru, atau null bila tidak ada yang perlu diubah
 */
export function koreksiSaldoAwalAkun(saldoAwalSekarang, uploads) {
  const terawal = statementTerawalBersaldo(uploads);
  if (!terawal) return null;

  const sekarang = Number(saldoAwalSekarang);
  const kosong = saldoAwalSekarang === null || saldoAwalSekarang === undefined
    || saldoAwalSekarang === '' || !Number.isFinite(sekarang);

  if (kosong) return terawal.nilai === 0 ? null : terawal.nilai;
  if (Math.abs(sekarang - terawal.nilai) <= TOLERANSI) return null;
  return terawal.nilai;
}

/**
 * Transaksi kembar yang datang dari BERKAS BERBEDA.
 *
 * Dua pembayaran QRIS Rp 20.000 di hari yang sama memang bisa benar-benar
 * terjadi dua kali — dan keduanya akan berasal dari satu statement yang sama.
 * Penggandaan karena kunci duplikat yang meleset selalu datang dari dua berkas
 * berbeda. Pembedaan itulah yang membuat peringatan ini layak ditampilkan:
 * tanpanya, setiap transaksi kembar yang sah ikut tertuduh dan peringatannya
 * jadi bising sampai tidak dibaca lagi.
 *
 * Transaksi manual (tanpa `uploadedFileId`) tidak ikut dinilai: pengguna
 * memasukkannya sendiri, jadi kembarannya memang disengaja.
 *
 * @param {Array} transaksi
 * @returns {{jumlah:number, nilai:number, hash:string[]}} baris berlebih —
 *   yaitu seluruh anggota kelompok DIKURANGI satu yang memang seharusnya ada.
 */
export function transaksiKembarAntarUpload(transaksi) {
  const perBase = new Map();
  (transaksi || []).forEach((t) => {
    if (!t || !t.baseHash || !t.uploadedFileId) return;
    if (!perBase.has(t.baseHash)) perBase.set(t.baseHash, []);
    perBase.get(t.baseHash).push(t);
  });

  let jumlah = 0;
  let nilai = 0;
  const hash = [];

  perBase.forEach((anggota) => {
    if (anggota.length < 2) return;
    const berkas = new Set(anggota.map((t) => t.uploadedFileId));
    if (berkas.size < 2) return;

    // Satu di antaranya memang seharusnya ada; sisanya berlebih.
    const berlebih = anggota.slice(1);
    jumlah += berlebih.length;
    berlebih.forEach((t) => {
      nilai += Math.abs(Number(t.nominal) || 0);
      if (t.hash) hash.push(t.hash);
    });
  });

  return { jumlah, nilai, hash };
}
