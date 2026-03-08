# Edabu Tools

Desktop tools berbasis Electron untuk membantu operator melakukan login, pengecekan data BPJS/Edabu berbasis NIK, pengelolaan sesi, dan pembuatan kartu PDF dari hasil pencarian.

## Ringkasan

- UI desktop memakai Electron.
- Otomasi portal Edabu dijalankan dengan Puppeteer.
- Aplikasi menjaga satu sesi browser aktif untuk operator tunggal.
- Hasil pencarian dapat dipakai untuk preview dan simpan kartu PDF.
- Penyimpanan kunci API lokal memakai enkripsi di sisi aplikasi.

## Fitur Utama

- Login Edabu dengan captcha.
- Inisiasi dan pemeliharaan sesi browser background.
- Pencarian data peserta berdasarkan NIK.
- Preview PDF kartu sebelum disimpan.
- Generate kartu PDF dengan template lokal.
- Indikator status koneksi browser/Puppeteer di UI.

## Struktur Penting

- `main.js` - proses utama Electron, IPC, sesi browser, dan automasi Edabu.
- `preload.js` - bridge aman antara renderer dan main process.
- `index.html` - antarmuka utama aplikasi.
- `card-generator.js` - generate PDF kartu.
- `captcha-solver.js` - helper pemrosesan captcha.
- `crypto-utils.js` - utilitas enkripsi lokal.
- `templates/` - aset template kartu.
- `dok/` - catatan produk, referensi alur, dan dokumentasi pendukung.

## Kebutuhan Sistem

- Windows.
- Node.js dan npm.
- Google Chrome atau Microsoft Edge terpasang di komputer, karena aplikasi mencari browser sistem untuk automasi.

## Instalasi

```bash
npm install
```

Jika memakai konfigurasi environment lokal, siapkan file `.env` sesuai kebutuhan pengembangan dan jangan commit isinya.

## Menjalankan Aplikasi

```bash
npm start
```

Script ini menjalankan Electron dengan entry utama `main.js`.

## Build

Build portable Windows:

```bash
npm run build
```

Build folder unpacked alternatif:

```bash
npm run build:folder
```

Output build utama diarahkan ke folder `release/`.

## Catatan Repo

- File sensitif seperti `.env`, `.master-key`, dan file terenkripsi lokal tidak ikut dibackup ke Git.
- `node_modules/`, `dist/`, `release/`, cache, dan log build diabaikan dari repository.
- Repository ini berisi source project dan dokumen pendukung, bukan artifact hasil build.

## Catatan Pengembangan

- Saat ini packaging masih memasukkan banyak dependency runtime sehingga ukuran build Windows cukup besar.
- Audit awal menunjukkan ada beberapa dependency yang berpotensi dirapikan untuk mengecilkan ukuran build.
- Jika ingin migrasi ke Tauri, bagian UI relatif mudah dipindah, tetapi backend automasi Puppeteer perlu penyesuaian arsitektur.

## Referensi

- Dokumen produk: `dok/PRD.md`
- Alur login: `dok/login.md`
- Dashboard/pencarian: `dok/dashboard.md`, `dok/hasil_pencarian.md`
