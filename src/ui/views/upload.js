/**
 * Halaman Upload e-Statement: dropzone, stepper tujuh langkah per berkas,
 * dan layar Review sebelum data masuk pembukuan.
 *
 * Tidak ada satu baris pun yang tersimpan tanpa dilihat pengguna lebih dulu —
 * parser PDF menebak struktur dari posisi teks, jadi hasilnya harus bisa dikoreksi.
 */

import { h, ikon, ganti } from '../../core/dom.js';
import { rupiah, angka, toNum } from '../../core/format.js';
import { tanggalTampil } from '../../core/dates.js';
import { LANGKAH, prosesFile, simpanDraft } from '../../services/ingest.js';
import { paksaSimpan } from '../../domain/dedupe.js';
import { pesanMasalah } from '../../domain/validate.js';
import { tentukanKategori } from '../../domain/categorize.js';
import * as akunRepo from '../../data/repo/accounts.js';
import * as kategoriRepo from '../../data/repo/categories.js';
import { dropzone } from '../components/dropzone.js';
import { dataView } from '../components/data-view.js';
import { tanyaTeks, konfirmasi, bukaModal } from '../components/modal.js';
import { toastSukses, toastGagal, toastWarning } from '../components/toast.js';
import { pergiKe } from '../router.js';

export async function mount(wadah) {
  const halaman = h('.halaman');
  const daftarProses = h('.tumpuk');
  const areaReview = h('.tumpuk');

  halaman.append(
    h('.halaman__kepala', null, h('div', null, [
      h('.halaman__judul', { text: 'Upload e-Statement' }),
      h('.halaman__ket', { text: 'Seret berkas PDF rekening koran. Data akan ditambahkan ke pembukuan yang sudah ada, bukan menimpanya.' }),
    ])),
    dropzone({
      onFile: (files, pesan) => {
        if (pesan) { toastWarning(pesan); return; }
        files.forEach((f) => tanganiFile(f, daftarProses, areaReview));
      },
    }),
    h('.info-kotak', null, [
      ikon('cek', 18),
      h('div', null, [
        h('b', { text: 'Berkas tidak dikirim ke mana pun. ' }),
        'Seluruh pembacaan PDF berjalan di dalam HP Anda dan hasilnya disimpan di penyimpanan browser perangkat ini.',
      ]),
    ]),
    daftarProses,
    areaReview,
  );

  wadah.appendChild(halaman);
  return { unmount() { /* tidak ada langganan yang perlu dilepas */ } };
}

/* ==========================================================================
   Stepper per berkas
   ========================================================================== */

function tanganiFile(file, daftarProses, areaReview) {
  const langkahEl = new Map();
  const stepper = h('.stepper', null, LANGKAH.map((l) => {
    const bulat = h('.step__bulat', { text: String(LANGKAH.indexOf(l) + 1) });
    const ket = h('.step__ket');
    const el = h('.step', null, [bulat, h('div', null, [h('div', { text: l.label }), ket])]);
    langkahEl.set(l.id, { el, bulat, ket });
    return el;
  }));

  const kartu = h('.kartu', null, [
    h('.kartu__kepala', null, [
      h('div', null, [
        h('.kartu__judul.putus', { text: file.name }),
        h('.kartu__ket', { text: `${(file.size / 1024).toFixed(0)} KB` }),
      ]),
      h('span.lencana.lencana--info', { text: 'Memproses' }),
    ]),
    stepper,
  ]);
  daftarProses.appendChild(kartu);

  const setStatus = (teks, jenis) => {
    const lencana = kartu.querySelector('.lencana');
    lencana.className = `lencana lencana--${jenis}`;
    lencana.textContent = teks;
  };

  const onLangkah = (id, status, ket) => {
    const item = langkahEl.get(id);
    if (!item) return;
    item.el.classList.remove('step--jalan', 'step--selesai', 'step--gagal');
    item.el.classList.add(`step--${status === 'jalan' ? 'jalan' : status === 'gagal' ? 'gagal' : 'selesai'}`);
    if (ket) item.ket.textContent = ket;
    if (status === 'selesai') item.bulat.replaceChildren(ikon('cek', 13));
    if (status === 'gagal') item.bulat.replaceChildren(ikon('peringatan', 13));
  };

  prosesFile(file, {
    onLangkah,
    mintaPassword: (salah) => tanyaTeks({
      judul: 'PDF terkunci password',
      pesan: salah
        ? 'Password yang tadi dimasukkan tidak cocok. Coba lagi.'
        : `Berkas "${file.name}" dilindungi password. Password hanya dipakai untuk membuka berkas ini dan tidak disimpan.`,
      label: 'Password PDF',
      tipe: 'password',
      tombol: 'Buka',
    }),
  })
    .then(async (draft) => {
      if (!draft.baris.length) {
        setStatus('Gagal dibaca', 'keluar');
        kartu.appendChild(kotakGagalBaca(draft));
        return;
      }
      setStatus('Perlu ditinjau', 'warning');
      ganti(areaReview, await layarReview(draft, kartu, areaReview));
      areaReview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    })
    .catch((e) => {
      console.error(e);
      setStatus('Gagal', 'keluar');
      kartu.appendChild(h('.info-kotak.info-kotak--bahaya.mt-3', null, [
        ikon('peringatan', 18),
        h('div', { text: e.message || 'Berkas gagal diproses.' }),
      ]));
    });
}

function kotakGagalBaca(draft) {
  return h('.tumpuk.mt-3', null, [
    h('.info-kotak.info-kotak--bahaya', null, [
      ikon('peringatan', 18),
      h('div', null, [
        h('b', { text: 'Tidak ada transaksi yang terbaca. ' }),
        'Kemungkinan berkas ini hasil pindaian (gambar) atau formatnya belum dikenali. Lihat teks mentah di bawah untuk memastikan.',
      ]),
    ]),
    panelTeksMentah(draft.teksMentah),
  ]);
}

function panelTeksMentah(teks) {
  return h('details.lipat', null, [
    h('summary', { text: 'Lihat teks mentah hasil pembacaan PDF' }),
    h('.teks-mentah.mt-2', { text: teks || '(kosong)' }),
  ]);
}

/* ==========================================================================
   Layar Review
   ========================================================================== */

async function layarReview(draft, kartuProses, areaReview) {
  const akun = await akunRepo.daftar();
  const kategori = await kategoriRepo.daftar();
  const petaKategori = new Map(kategori.map((k) => [k.id, k]));

  // Salinan yang bisa disunting; draft aslinya dibiarkan utuh.
  let baris = draft.baris.map((b) => ({ ...b, dibuang: false }));
  let accountId = draft.akunCocok?.id || '';

  const isi = h('.tumpuk');
  const kartu = h('.kartu', null, [
    h('.kartu__kepala', null, [
      h('div', null, [
        h('.kartu__judul', { text: 'Tinjau sebelum disimpan' }),
        h('.kartu__ket', { text: `${draft.file.nama} · ${draft.hasil.namaAdapter}` }),
      ]),
      h('span.lencana.lencana--warning', { text: 'Belum tersimpan' }),
    ]),
    isi,
  ]);

  function hitungTerpilih() {
    return baris.filter((b) => !b.dibuang && !b.duplikat);
  }

  function render() {
    const terpilih = hitungTerpilih();
    const masuk = terpilih.reduce((s, b) => s + (b.nominal > 0 ? b.nominal : 0), 0);
    const keluar = terpilih.reduce((s, b) => s + (b.nominal < 0 ? -b.nominal : 0), 0);

    ganti(isi, [
      peringatan(draft, baris),
      pilihRekening(draft, akun, accountId, (id) => { accountId = id; render(); }),

      h('.grid-kpi', null, [
        kpi('Baris terbaca', String(draft.baris.length), 'netral'),
        kpi('Akan disimpan', String(terpilih.length), 'netral'),
        kpi('Total masuk', rupiah(masuk), 'masuk'),
        kpi('Total keluar', rupiah(keluar), 'keluar'),
      ]),

      draft.cekTotal ? kotakCekTotal(draft.cekTotal) : null,

      dataView({
        kolom: kolomReview(petaKategori, kategori, (b, kategoriId) => {
          b.kategoriId = kategoriId;
          render();
        }),
        baris,
        kelasBaris: (b) => [
          b.curiga ? 'baris--curiga' : '',
          (b.duplikat || b.dibuang) ? 'baris--duplikat' : '',
        ].filter(Boolean).join(' '),
        aksi: (b) => aksiBaris(b, baris, draft, kategori, render),
        kunciBaris: (b) => b.hash,
      }),

      panelTeksMentah(draft.teksMentah),

      h('.baris.bungkus.mt-2', null, [
        h('button.btn-primary', {
          type: 'button',
          disabled: terpilih.length === 0,
          onclick: () => simpan(),
        }, [ikon('cek', 18), h('span', { text: `Simpan ${terpilih.length} transaksi ke pembukuan` })]),
        h('button', { type: 'button', onclick: () => batal() }, 'Batalkan berkas ini'),
      ]),
    ]);
  }

  async function simpan() {
    const terpilih = hitungTerpilih();
    if (!terpilih.length) return;

    if (draft.pernahAda) {
      const lanjut = await konfirmasi({
        judul: 'Berkas ini pernah di-upload',
        pesan: `Berkas dengan isi yang sama persis sudah pernah diproses pada ${tanggalTampil(String(draft.pernahAda.tanggalUpload).slice(0, 10))}. Transaksi yang sama tidak akan digandakan, tapi riwayat upload akan bertambah satu baris. Lanjutkan?`,
        tombolYa: 'Lanjutkan simpan',
      });
      if (!lanjut) return;
    }

    try {
      const hasil = await simpanDraft(draft, { accountId, barisDipilih: terpilih });
      toastSukses(`${hasil.jumlah} transaksi tersimpan ke ${hasil.akun.bank} ${hasil.akun.nomorRekening || ''}`.trim());
      kartuProses.querySelector('.lencana').className = 'lencana lencana--masuk';
      kartuProses.querySelector('.lencana').textContent = 'Tersimpan';
      ganti(areaReview, h('.kartu', null, [
        h('.baris.bungkus', null, [
          h('span.lencana.lencana--masuk', { text: 'Selesai' }),
          h('div.isi-penuh', { text: `${hasil.jumlah} transaksi masuk ke pembukuan.` }),
          h('button.btn-primary.btn-kecil', { type: 'button', onclick: () => pergiKe('dashboard') }, 'Lihat Dashboard'),
          h('button.btn-kecil', { type: 'button', onclick: () => pergiKe('transaksi') }, 'Lihat Transaksi'),
        ]),
      ]));
    } catch (e) {
      console.error(e);
      toastGagal(`Gagal menyimpan: ${e.message}`);
    }
  }

  async function batal() {
    const ya = await konfirmasi({
      judul: 'Batalkan berkas ini?',
      pesan: 'Hasil pembacaan akan dibuang dan tidak ada yang tersimpan.',
      tombolYa: 'Ya, batalkan',
      bahaya: true,
    });
    if (ya) ganti(areaReview, null);
  }

  render();
  return kartu;
}

function peringatan(draft, baris) {
  const kotak = [];
  const curiga = baris.filter((b) => b.curiga && !b.dibuang).length;

  if (curiga) {
    kotak.push(h('.info-kotak.info-kotak--warning', null, [
      ikon('peringatan', 18),
      h('div', null, [
        h('b', { text: `${curiga} baris perlu diperiksa. ` }),
        'Baris bertanda kuning tidak cocok dengan saldo berjalan di statement — biasanya karena angka terbaca kurang tepat. Perbaiki atau buang baris tersebut sebelum menyimpan.',
      ]),
    ]));
  }

  if (draft.ringkasDup.duplikat) {
    kotak.push(h('.info-kotak', null, [
      ikon('cek', 18),
      h('div', null, [
        h('b', { text: `${draft.ringkasDup.duplikat} baris sudah ada di pembukuan. ` }),
        'Baris itu dilewati supaya data tidak dobel. Kalau memang transaksi berbeda, tekan "Tetap simpan" pada barisnya.',
      ]),
    ]));
  }

  (draft.catatan || []).forEach((c) => {
    kotak.push(h('.info-kotak.info-kotak--warning', null, [ikon('peringatan', 18), h('div', { text: c })]));
  });

  return kotak.length ? h('.tumpuk', null, kotak) : null;
}

function pilihRekening(draft, akun, accountId, onGanti) {
  const select = h('select', {
    onchange: (e) => onGanti(e.target.value),
  }, [
    h('option', { value: '', text: draft.identitas.nomorRekening
      ? `Buat rekening baru: ${draft.identitas.bank || 'Bank'} ${draft.identitas.nomorRekening}`
      : `Buat rekening baru: ${draft.identitas.bank || 'Bank tidak dikenali'}` }),
    ...akun.map((a) => h('option', {
      value: a.id,
      selected: a.id === accountId,
      text: `${a.bank} ${a.nomorRekening || ''} ${a.namaPemilik ? `— ${a.namaPemilik}` : ''}`.replace(/\s+/g, ' ').trim(),
    })),
  ]);

  return h('.kartu.kartu--rapat', null, [
    h('label', { text: 'Simpan ke rekening' }),
    select,
    h('.kartu__ket.mt-2', {
      text: draft.akunCocok
        ? `Rekening ${draft.akunCocok.bank} ${draft.akunCocok.nomorRekening} cocok dengan kepala statement dan dipilih otomatis.`
        : 'Nomor rekening pada statement belum terdaftar, jadi rekening baru akan dibuat.',
    }),
  ]);
}

function kotakCekTotal(cek) {
  return h(`.info-kotak${cek.semuaCocok ? '.info-kotak--sukses' : '.info-kotak--warning'}`, null, [
    ikon(cek.semuaCocok ? 'cek' : 'peringatan', 18),
    h('div', null, [
      h('b', { text: cek.semuaCocok ? 'Total cocok dengan ringkasan statement. ' : 'Total belum cocok dengan ringkasan statement. ' }),
      cek.cek.map((c) => `${c.nama}: ${rupiah(c.hasil)} vs ${rupiah(c.statement)}`).join(' · '),
    ]),
  ]);
}

function kpi(label, nilai, jenis) {
  return h(`.kpi.kpi--${jenis}`, null, [
    h('.kpi__label', { text: label }),
    h('.kpi__nilai', { text: nilai }),
  ]);
}

function kolomReview(petaKategori, daftarKategori, onGantiKategori) {
  return [
    {
      kunci: 'tanggal',
      judul: 'Tanggal',
      lebar: '110px',
      render: (b) => tanggalTampil(b.tanggal) || '—',
    },
    {
      kunci: 'deskripsi',
      judul: 'Deskripsi',
      kartu: 'utama',
      lebar: '240px',
      render: (b) => h('div', null, [
        h('div.putus', { text: b.deskripsi || '(tanpa keterangan)' }),
        b.masalah?.length
          ? h('div.redup-2', { style: { fontSize: '.76rem' }, text: b.masalah.map(pesanMasalah).join(' · ') })
          : null,
      ]),
    },
    {
      kunci: 'debit', judul: 'Debit', kanan: true, angka: true, lebar: '120px', kartu: false,
      render: (b) => (b.nominal < 0 ? h('span.keluar', { text: rupiah(-b.nominal) }) : ''),
    },
    {
      kunci: 'kredit', judul: 'Kredit', kanan: true, angka: true, lebar: '120px', kartu: 'nilai',
      render: (b) => (b.nominal > 0 ? h('span.masuk', { text: rupiah(b.nominal) }) : ''),
      renderKartu: (b) => h(`span.${b.nominal >= 0 ? 'masuk' : 'keluar'}`, {
        text: rupiah(b.nominal, { tanda: true }),
      }),
    },
    {
      kunci: 'saldo', judul: 'Saldo', kanan: true, angka: true, lebar: '130px',
      render: (b) => (b.saldo === null || b.saldo === undefined ? '—' : rupiah(b.saldo)),
    },
    {
      kunci: 'kategori', judul: 'Kategori', lebar: '190px',
      render: (b) => h('select.btn-kecil', {
        style: { minHeight: '34px', fontSize: '.82rem' },
        onchange: (e) => onGantiKategori(b, e.target.value),
      }, daftarKategori
        .filter((k) => (b.nominal >= 0 ? k.tipe === 'pemasukan' : k.tipe === 'pengeluaran'))
        .map((k) => h('option', { value: k.id, selected: k.id === b.kategoriId, text: `${k.ikon} ${k.nama}` }))),
    },
    {
      kunci: 'status', judul: 'Status', lebar: '110px',
      render: (b) => {
        if (b.dibuang) return h('span.lencana', { text: 'Dibuang' });
        if (b.duplikat) return h('span.lencana.lencana--warning', { text: 'Duplikat' });
        if (b.curiga) return h('span.lencana.lencana--warning', { text: 'Perlu cek' });
        return h('span.lencana.lencana--masuk', { text: 'Baru' });
      },
    },
  ];
}

function aksiBaris(b, semua, draft, daftarKategori, render) {
  const tombol = [];

  if (b.duplikat && !b.dibuang) {
    tombol.push(h('button.btn-kecil', {
      type: 'button',
      title: 'Simpan walaupun terdeteksi sama dengan transaksi yang sudah ada',
      onclick: () => {
        const baru = paksaSimpan(b, semua, draft.jumlahLama);
        Object.assign(b, baru);
        render();
      },
    }, 'Tetap simpan'));
  }

  tombol.push(h('button.btn-kecil', {
    type: 'button',
    onclick: () => bukaEditBaris(b, daftarKategori, render),
  }, [ikon('edit', 15), 'Ubah']));

  tombol.push(h('button.btn-kecil.btn-bahaya', {
    type: 'button',
    onclick: () => { b.dibuang = !b.dibuang; render(); },
  }, b.dibuang ? 'Pulihkan' : 'Buang'));

  return tombol;
}

function bukaEditBaris(b, daftarKategori, render) {
  const fTanggal = h('input', { type: 'date', value: b.tanggal || '' });
  const fDeskripsi = h('input', { type: 'text', value: b.deskripsi || '' });
  const fArah = h('select', null, [
    h('option', { value: 'keluar', selected: b.nominal < 0, text: 'Keluar (debit)' }),
    h('option', { value: 'masuk', selected: b.nominal >= 0, text: 'Masuk (kredit)' }),
  ]);
  const fNominal = h('input', { type: 'text', inputmode: 'decimal', value: angka(Math.abs(b.nominal), 2) });

  const m = bukaModal({
    judul: 'Ubah baris',
    isi: h('.form-grid', null, [
      h('div', null, [h('label', { text: 'Tanggal' }), fTanggal]),
      h('div', null, [h('label', { text: 'Arah' }), fArah]),
      h('div.penuh', null, [h('label', { text: 'Deskripsi' }), fDeskripsi]),
      h('div', null, [h('label', { text: 'Nominal' }), fNominal]),
    ]),
    aksi: [
      h('button', { type: 'button', onclick: () => m.tutup() }, 'Batal'),
      h('button.btn-primary', {
        type: 'button',
        onclick: () => {
          const besar = Math.abs(toNum(fNominal.value));
          b.tanggal = fTanggal.value || b.tanggal;
          b.deskripsi = fDeskripsi.value.trim();
          b.nominal = fArah.value === 'masuk' ? besar : -besar;
          // Deskripsi atau arah yang berubah bisa mengubah kategori yang tepat.
          b.kategoriId = tentukanKategori(b.deskripsi, b.nominal, daftarKategori);
          // Baris yang sudah dikoreksi manual tidak lagi ditandai mencurigakan.
          b.masalah = [];
          b.curiga = false;
          m.tutup();
          render();
        },
      }, 'Simpan perubahan'),
    ],
  });
}
