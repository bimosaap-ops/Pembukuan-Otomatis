/**
 * Pembungkus IndexedDB. Satu-satunya modul yang benar-benar menyentuh IndexedDB;
 * repository di atasnya bekerja dengan objek biasa, dan lapisan domain sama sekali
 * tidak tahu database ini ada.
 *
 * IndexedDB dipilih (bukan localStorage) karena pembukuan bertahun-tahun bisa
 * berisi puluhan ribu transaksi — jauh di atas batas ~5 MB localStorage.
 */

export const NAMA_DB = 'pembukuan_v1';
export const VERSI_DB = 3;

export const STORE = {
  ACCOUNTS: 'accounts',
  UPLOADED_FILES: 'uploaded_files',
  TRANSACTIONS: 'transactions',
  CATEGORIES: 'categories',
  SETTINGS: 'settings',
  /** Realtime Email Transaction Feed — lihat rencana implementasi & entities.js buatTransaksiEmail. */
  EMAIL_TRANSACTIONS: 'email_transactions',
  MERCHANT_DICTIONARY: 'merchant_dictionary',
};

let dbPromise = null;

function bukaDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Browser ini tidak mendukung IndexedDB.'));
      return;
    }

    const req = indexedDB.open(NAMA_DB, VERSI_DB);

    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const versiLama = ev.oldVersion;

      if (versiLama < 1) {
        const acc = db.createObjectStore(STORE.ACCOUNTS, { keyPath: 'id' });
        acc.createIndex('bank', 'bank');
        acc.createIndex('nomorRekening', 'nomorRekening');

        const up = db.createObjectStore(STORE.UPLOADED_FILES, { keyPath: 'id' });
        up.createIndex('accountId', 'accountId');
        up.createIndex('tanggalUpload', 'tanggalUpload');
        up.createIndex('fileHash', 'fileHash');

        const trx = db.createObjectStore(STORE.TRANSACTIONS, { keyPath: 'id' });
        trx.createIndex('hash', 'hash', { unique: true });
        /* baseHash sengaja tidak unik: transaksi kembar yang memang asli punya
           baseHash sama dan dibedakan oleh nomor urut di dalam `hash`. */
        trx.createIndex('baseHash', 'baseHash');
        trx.createIndex('accountId', 'accountId');
        trx.createIndex('tanggal', 'tanggal');
        trx.createIndex('kategoriId', 'kategoriId');
        trx.createIndex('uploadedFileId', 'uploadedFileId');
        trx.createIndex('akun_tanggal', ['accountId', 'tanggal']);

        const kat = db.createObjectStore(STORE.CATEGORIES, { keyPath: 'id' });
        kat.createIndex('tipe', 'tipe');

        db.createObjectStore(STORE.SETTINGS, { keyPath: 'key' });
      }

      if (versiLama < 2) {
        // Realtime Email Transaction Feed — transaksi hasil parse email bank,
        // ditarik dari tab "Transaksi Email" di Sheet (lihat email-feed-sync.js,
        // fase berikutnya). gmailMessageId unik: satu email tidak boleh jadi
        // dua transaksi walau ditarik ulang dari checkpoint yang sama.
        const trxe = db.createObjectStore(STORE.EMAIL_TRANSACTIONS, { keyPath: 'id' });
        trxe.createIndex('gmailMessageId', 'gmailMessageId', { unique: true });
        trxe.createIndex('statusCocok', 'statusCocok');

        // Kamus merchant -> kategori, dipelajari dari override pengguna saat
        // menyelesaikan transaksi email "Perlu Ditinjau" (fase berikutnya).
        // Bukan konsep yang sudah ada di categorize.js — lihat rencana
        // implementasi soal kenapa ini genuinely baru, bukan perluasan
        // polaKataKunci kategori.
        db.createObjectStore(STORE.MERCHANT_DICTIONARY, { keyPath: 'merchantKey' });
      }

      if (versiLama < 3) {
        // "Fase C" (gabung ledger email+e-statement, lihat email-ledger-merge.js):
        // `emailTrxId` mencari baris ledger provisional milik satu transaksi
        // email tertentu (upsert/hapus saat e-statement datang); `sumber`
        // dipakai memfilter baris email_provisional keluar dari kandidat
        // rekonsiliasi transaksi email BARU (lihat requirement wajib di
        // email-feed-sync.js) supaya dua transaksi provisional yang belum
        // sama-sama dikonfirmasi bank tidak saling "cocok" satu sama lain.
        //
        // Store TRANSACTIONS sudah ada (dibuat versi 1) — indeks baru pada
        // store lama HARUS lewat transaksi upgrade (req.transaction), beda
        // dari db.createObjectStore(...).createIndex(...) di atas yang
        // berlaku untuk store yang BARU dibuat di blok yang sama.
        const trx = req.transaction.objectStore(STORE.TRANSACTIONS);
        trx.createIndex('emailTrxId', 'emailTrxId');
        trx.createIndex('sumber', 'sumber');
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    req.onerror = () => reject(req.error || new Error('Gagal membuka database.'));
    req.onblocked = () => reject(new Error('Database sedang dipakai tab lain. Tutup tab lain lalu muat ulang.'));
  });

  return dbPromise;
}

export async function siapkanDb() {
  return bukaDb();
}

function bungkus(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Menjalankan sebuah transaksi IndexedDB. `fn` menerima objek store
 * (satu store, atau map nama->store bila `nama` berupa array).
 * Promise baru selesai setelah transaksi benar-benar di-commit.
 */
export async function jalankan(nama, mode, fn) {
  const db = await bukaDb();
  const daftar = Array.isArray(nama) ? nama : [nama];
  const tx = db.transaction(daftar, mode);

  const stores = Array.isArray(nama)
    ? Object.fromEntries(daftar.map((n) => [n, tx.objectStore(n)]))
    : tx.objectStore(nama);

  // `fn` harus dipanggil sinkron: sebuah transaksi IndexedDB menjadi tidak aktif
  // begitu kendali kembali ke event loop, jadi semua request wajib diajukan di sini.
  let hasil;
  try {
    hasil = fn(stores, tx);
  } catch (e) {
    try { tx.abort(); } catch { /* transaksi sudah selesai */ }
    throw e;
  }

  const selesai = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaksi database dibatalkan.'));
  });

  await selesai;
  return hasil;
}

export async function ambilSemua(nama) {
  return jalankan(nama, 'readonly', (store) => bungkus(store.getAll()));
}

export async function ambil(nama, key) {
  return jalankan(nama, 'readonly', (store) => bungkus(store.get(key)));
}

export async function simpan(nama, nilai) {
  return jalankan(nama, 'readwrite', (store) => bungkus(store.put(nilai)));
}

export async function simpanBanyak(nama, daftar) {
  if (!daftar.length) return 0;
  return jalankan(nama, 'readwrite', (store) => {
    daftar.forEach((d) => store.put(d));
    return daftar.length;
  });
}

export async function hapus(nama, key) {
  return jalankan(nama, 'readwrite', (store) => bungkus(store.delete(key)));
}

export async function hapusBanyak(nama, keys) {
  if (!keys.length) return 0;
  return jalankan(nama, 'readwrite', (store) => {
    keys.forEach((k) => store.delete(k));
    return keys.length;
  });
}

export async function kosongkanStore(nama) {
  return jalankan(nama, 'readwrite', (store) => bungkus(store.clear()));
}

export async function hitung(nama) {
  return jalankan(nama, 'readonly', (store) => bungkus(store.count()));
}

/** Ambil semua record yang nilai indeksnya sama dengan `nilai`. */
export async function ambilLewatIndex(nama, indexNama, nilai) {
  return jalankan(nama, 'readonly', (store) => bungkus(store.index(indexNama).getAll(nilai)));
}

/**
 * Menelusuri sebuah indeks dengan rentang tertentu.
 * `fn(record)` boleh mengembalikan false untuk menghentikan penelusuran lebih awal.
 */
export async function telusuriIndex(nama, indexNama, range, fn, arah = 'next') {
  return jalankan(nama, 'readonly', (store) => new Promise((resolve, reject) => {
    const req = store.index(indexNama).openCursor(range ?? null, arah);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) { resolve(); return; }
      if (fn(cur.value) === false) { resolve(); return; }
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

/** Menghapus seluruh isi database — dipakai fitur Restore. */
export async function kosongkanSemua() {
  const semua = Object.values(STORE);
  return jalankan(semua, 'readwrite', (stores) => {
    semua.forEach((n) => stores[n].clear());
    return true;
  });
}

/** Perkiraan pemakaian penyimpanan, ditampilkan di Pengaturan. */
export async function infoPenyimpanan() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { terpakai: usage ?? 0, kuota: quota ?? 0 };
  } catch {
    return null;
  }
}
