# Vendor

Pustaka pihak ketiga disalin ke repo (bukan CDN) supaya aplikasi tetap jalan offline sebagai PWA.

| Pustaka | Versi | Lisensi | Sumber |
|---|---|---|---|
| pdf.js (`pdfjs-dist`, legacy build) | 3.11.174 | Apache-2.0 | npm `pdfjs-dist@3.11.174` → `legacy/build/` |
| SheetJS (`xlsx`, mini build) | 0.18.5 | Apache-2.0 | npm `xlsx@0.18.5` → `dist/xlsx.mini.min.js` |

Cara memperbarui:

```sh
npm pack pdfjs-dist@<versi>
tar xzf pdfjs-dist-<versi>.tgz package/legacy/build/pdf.min.js package/legacy/build/pdf.worker.min.js
cp package/legacy/build/pdf*.min.js keuangan/vendor/pdfjs/
```

Build `legacy` dipakai (bukan build modern ESM) agar kompatibel dengan browser HP yang lebih lama.
Setelah memperbarui, naikkan `CACHE_NAME` di `keuangan/service-worker.js`.
