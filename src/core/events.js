/**
 * Event bus sederhana. Dipakai agar view tidak saling memanggil langsung:
 * upload selesai -> emit('data:berubah') -> dashboard, transaksi, dan rekening
 * memuat ulang datanya masing-masing. Pendengar yang galat dilaporkan browser
 * dan tidak menghentikan pendengar lain.
 */

const bus = new EventTarget();

export function on(nama, fn) {
  const l = (e) => fn(e.detail);
  bus.addEventListener(nama, l);
  return () => bus.removeEventListener(nama, l);
}

export function emit(nama, data) {
  bus.dispatchEvent(new CustomEvent(nama, { detail: data }));
}

export const EVENT = {
  DATA_BERUBAH: 'data:berubah',
  TEMA_BERUBAH: 'tema:berubah',
  RUTE_BERUBAH: 'rute:berubah',
};
