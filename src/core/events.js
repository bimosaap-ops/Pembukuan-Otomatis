/**
 * Event bus sederhana. Dipakai agar view tidak saling memanggil langsung:
 * upload selesai -> emit('data:berubah') -> dashboard, transaksi, dan rekening
 * memuat ulang datanya masing-masing.
 */

const pendengar = new Map();

export function on(nama, fn) {
  if (!pendengar.has(nama)) pendengar.set(nama, new Set());
  pendengar.get(nama).add(fn);
  return () => off(nama, fn);
}

export function off(nama, fn) {
  pendengar.get(nama)?.delete(fn);
}

export function emit(nama, data) {
  const set = pendengar.get(nama);
  if (!set) return;
  [...set].forEach((fn) => {
    try {
      fn(data);
    } catch (e) {
      console.error(`Pendengar event "${nama}" gagal:`, e);
    }
  });
}

export const EVENT = {
  DATA_BERUBAH: 'data:berubah',
  TEMA_BERUBAH: 'tema:berubah',
  RUTE_BERUBAH: 'rute:berubah',
};
