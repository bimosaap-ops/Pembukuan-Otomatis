/**
 * Menanyakan versi aplikasi yang benar-benar sedang berjalan.
 *
 * Nomor versi ini datang dari service worker, bukan dari berkas yang dimuat
 * halaman, karena justru service worker-lah yang menentukan berkas mana yang
 * sampai ke pengguna. Menampilkannya di Pengaturan membuat pertanyaan
 * "apakah pembaruannya sudah masuk?" bisa dijawab dengan melihat, bukan menebak.
 */

export function versiBerjalan(batasMs = 1500) {
  return new Promise((resolve) => {
    const sw = navigator.serviceWorker?.controller;
    if (!sw) { resolve(null); return; }

    const kanal = new MessageChannel();
    const waktuHabis = setTimeout(() => resolve(null), batasMs);
    kanal.port1.onmessage = (e) => {
      clearTimeout(waktuHabis);
      resolve(String(e.data || '') || null);
    };

    try {
      sw.postMessage('versi', [kanal.port2]);
    } catch {
      clearTimeout(waktuHabis);
      resolve(null);
    }
  });
}

/**
 * Memaksa pemeriksaan pembaruan.
 * @returns {Promise<boolean>} true bila ada versi baru yang sedang dipasang
 */
export async function periksaPembaruan() {
  const registrasi = await navigator.serviceWorker?.getRegistration?.();
  if (!registrasi) return false;
  await registrasi.update();
  return Boolean(registrasi.installing || registrasi.waiting);
}
