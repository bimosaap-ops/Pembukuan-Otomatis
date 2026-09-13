/**
 * Tes untuk bagian entitas-sync.js yang murni (tanpa IndexedDB maupun
 * jaringan) — resolusi konflik last-updated-wins. Fungsi yang menyentuh
 * repo/accounts.js & repo/categories.js (tarikDanGabungEntitas) sengaja
 * tidak diuji di sini, konsisten dengan seluruh tes lain di repo ini yang
 * membatasi diri ke lapisan domain/parser murni.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { remoteLebihBaru } from '../src/services/entitas-sync.js';

test('remoteLebihBaru: remote menang kalau lokal belum ada sama sekali (restore/bootstrap)', () => {
  assert.equal(remoteLebihBaru(null, { diubahPada: '2026-01-01T00:00:00.000Z' }), true);
  assert.equal(remoteLebihBaru(undefined, {}), true);
});

test('remoteLebihBaru: remote menang kalau diubahPada-nya lebih baru', () => {
  const lokal = { diubahPada: '2026-01-01T00:00:00.000Z' };
  const remote = { diubahPada: '2026-01-02T00:00:00.000Z' };
  assert.equal(remoteLebihBaru(lokal, remote), true);
});

test('remoteLebihBaru: lokal menang kalau diubahPada-nya lebih baru', () => {
  const lokal = { diubahPada: '2026-01-05T00:00:00.000Z' };
  const remote = { diubahPada: '2026-01-02T00:00:00.000Z' };
  assert.equal(remoteLebihBaru(lokal, remote), false);
});

test('remoteLebihBaru: waktu sama -> lokal menang (tidak ada aksi)', () => {
  const t = '2026-01-01T00:00:00.000Z';
  assert.equal(remoteLebihBaru({ diubahPada: t }, { diubahPada: t }), false);
});

test('remoteLebihBaru: jatuh ke dibuatPada kalau diubahPada kosong (belum pernah diedit ulang)', () => {
  const lokal = { dibuatPada: '2026-01-01T00:00:00.000Z' };
  const remoteLebihBaruDrpDibuat = { dibuatPada: '2026-01-03T00:00:00.000Z' };
  assert.equal(remoteLebihBaru(lokal, remoteLebihBaruDrpDibuat), true);

  const remoteLebihLama = { dibuatPada: '2025-01-01T00:00:00.000Z' };
  assert.equal(remoteLebihBaru(lokal, remoteLebihLama), false);
});

test('remoteLebihBaru: tidak melempar error bila kedua timestamp kosong', () => {
  assert.doesNotThrow(() => remoteLebihBaru({}, {}));
  // Sama-sama string kosong -> tidak ada yang "lebih baru", lokal menang (aman).
  assert.equal(remoteLebihBaru({}, {}), false);
});
