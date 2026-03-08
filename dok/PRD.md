# Product Requirements Document (PRD)
**Nama Modul:** Proxy Pengecekan BPJS Edabu (Headless Browser)
**Versi:** 1.0

## 1. Ringkasan Proyek
Aplikasi web berbasis *headless browser* (Puppeteer) yang berfungsi sebagai perantara (*proxy*) untuk mengotomatiskan proses otentikasi dan pengecekan status BPJS warga melalui portal Edabu. Aplikasi ini dirancang khusus untuk penggunaan operator tunggal (*single-user/single-operator*) guna mempercepat pelayanan administrasi desa tanpa harus berhadapan langsung dengan sesi dan antarmuka Edabu yang kompleks.

## 2. Tujuan
1. Mem-*bypass* rutinitas input kredensial statis secara manual dengan sistem injeksi *real-time*.
2. Menyediakan antarmuka yang lebih bersih dan cepat bagi operator desa untuk mengecek status BPJS berdasarkan NIK.
3. Menarik (*scrape*) data seluruh anggota keluarga dalam satu Kartu Keluarga (KK) dari hasil pencarian NIK untuk kebutuhan pelayanan yang lebih komprehensif.

## 3. Struktur Halaman & Fungsi
Aplikasi ini hanya terdiri dari 2 (dua) halaman utama untuk menjaga kesederhanaan alur operasional:

### A. Halaman Inisiasi Sesi (Login Gate)
* **Fungsi:** Sebagai pintu gerbang untuk membuka dan mengotentikasi *instance browser* di sisi *backend*.
* **Komponen:**
  * Form input **Username Edabu**.
  * Form input **Password Edabu**.
  * Gambar **Captcha Login** (di-*relay* langsung dari tangkapan layar elemen Edabu di *backend*).
  * Form input **Kode Captcha**.
  * Tombol **Mulai Sesi / Login**.

### B. Halaman Pengecekan Warga (Dashboard Operasional)
* **Fungsi:** Halaman utama tempat operator melakukan pencarian NIK warga secara berulang tanpa putus sesi.
* **Komponen:**
  * Form input **NIK Warga**.
  * Gambar **Captcha Pencarian** (di-*relay* dinamis dari halaman pencarian Edabu).
  * Form input **Kode Captcha**.
  * Tombol **Cari Data**.
  * **Tabel Hasil Pencarian:** Menampilkan data JSON hasil ekstraksi *backend* (mencakup NIK, No JKN, Nama, Hubungan Keluarga, Jenis Kepesertaan, Jabatan, dan Status). Baris data yang NIK-nya sesuai dengan kata kunci pencarian akan diberikan *highlight* visual.

## 4. Kebutuhan Fungsional (Backend & Scraping)
* **Manajemen Sesi Tunggal:** *Backend* memelihara 1 (satu) *Tab/Page browser* yang terus menyala selama sesi aktif. Tidak ada konkurensi antar-*user*.
* **Relay Captcha Dinamis:** *Backend* harus menargetkan elemen ID Captcha, mengambil *screenshot* koordinat tersebut, dan mengirimkannya ke *frontend* (berlaku untuk fase Login maupun fase Pengecekan).
* **Ekstraksi Data Terstruktur (Option B):** *Backend* membaca `tbody` dari tabel `#tblPencarian` Edabu, mengekstrak semua baris (`<tr>`), dan merangkumnya menjadi *Array of Objects* (JSON) yang dikirim ke *frontend*.
* **Penanganan Captcha Gagal (Retry Mechanism):** Jika Edabu merespons *error* (Captcha tidak valid), *backend* harus membaca elemen pesan *error* tersebut, mengambil *screenshot* Captcha terbaru, dan memintanya kembali ke *frontend* tanpa merusak sesi utama.
* **Pemulihan Sesi (Session Timeout):** Sebelum mengeksekusi pencarian NIK, *backend* memvalidasi URL *browser* saat ini. Jika terlempar ke `.../Home/Login`, *backend* mengirimkan instruksi ke *frontend* untuk me-*redirect* operator kembali ke **Halaman Inisiasi Sesi**.

## 5. Kebutuhan Non-Fungsional & Keamanan
* **Volatile Credentials:** Username dan Password Edabu dari input operator **dilarang keras** disimpan di *Database*, *File Log*, maupun *Environment Variables* (`.env`). Data hanya boleh berada di memori RAM *server* selama eksekusi fungsi `login()`.
* **Developer Mode (Environment Toggle):** Skrip Puppeteer harus dikonfigurasi menggunakan variabel lingkungan (misal: `NODE_ENV=development`) untuk mematikan mode *headless* (`headless: false`). Ini memastikan *browser* fisik terbuka di layar PC untuk kebutuhan visualisasi dan *debugging* DOM selama masa pengembangan.
* **Efisiensi Resource:** *Browser instance* di *backend* harus memblokir muatan aset yang tidak penting (seperti *fonts*, *stylesheets* berat, atau *images* selain Captcha) melalui `page.setRequestInterception(true)` untuk menghemat penggunaan RAM server.

## 6. Referensi Pemetaan DOM Edabu (Target Script)
* **Login URL:** `https://edabu.bpjs-kesehatan.go.id/Edabu/Home/Login`
  * Username: `#txtusername`
  * Password: `#txtpassword`
  * Captcha Image: `#edabuCaptcha_CaptchaImage`
  * Captcha Input: `#txtcaptcha`
  * Submit Button: `#btnlogin`
* **Navigasi URL:** Setelah login sukses (`/Edabu/Home/Index`), *redirect* ke `/Edabu/Peserta/Index#pencarian`.
* **Pencarian NIK:**
  * Input NIK: `#txtParam`
  * Tombol Submit: `.sw-btn-next`
* **Target Scraping Data:** `#tblPencarian tbody tr` -> Ekstrak elemen `<td>` indeks 0 hingga 6.