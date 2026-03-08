require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Variabel global untuk menyimpan state
let browserInstance = null;
let pageInstance = null;
let pesanErrorAlert = null; // Variabel penampung pesan modal/alert Edabu

// Fungsi bantuan untuk menutup HTML modal dialogs/Notifikasi (misal: SweetAlert, Bootstrap Modal)
async function autoCloseHtmlModals(page) {
    try {
        await page.evaluate(() => {
            const closeButtons = document.querySelectorAll('.swal2-confirm, button[data-dismiss="modal"], .btn-close, .close');
            closeButtons.forEach(btn => {
                if (btn.offsetParent !== null) {
                    btn.click();
                }
            });
        });
    } catch (e) {
        console.error("Gagal menutup modal:", e);
    }
}

// Endpoint Init Session
app.get('/api/init-session', async (req, res) => {
    try {
        if (!browserInstance) {
            console.log('Menyiapkan instance browser...');
            browserInstance = await puppeteer.launch({
                headless: process.env.NODE_ENV === 'production' ? "new" : false,
                slowMo: 30,
                defaultViewport: null,
                args: ['--start-maximized']
            });
            pageInstance = await browserInstance.newPage();

            // OPTIMASI: Blokir aset yang bikin lambat (PRD Kebutuhan Non-Fungsional)
            await pageInstance.setRequestInterception(true);
            pageInstance.on('request', (req) => {
                const resourceType = req.resourceType();
                // Blokir font, stylesheet, media, dan gambar yang bukan captcha
                if (['font', 'stylesheet', 'media'].includes(resourceType)) {
                    req.abort();
                } else if (resourceType === 'image') {
                    if (req.url().includes('BotDetectCaptcha') || req.url().includes('captcha')) {
                        req.continue();
                    } else {
                        req.abort();
                    }
                } else {
                    req.continue();
                }
            });

            // PASANG TELINGA: Tangkap semua popup dialog/alert dari Edabu
            pageInstance.on('dialog', async dialog => {
                pesanErrorAlert = dialog.message();
                console.log('Tertangkap Alert dari Edabu:', pesanErrorAlert);
                await dialog.accept(); // Otomatis klik OK supaya browser gak nyangkut
            });
        }

        console.log('Menuju halaman login Edabu...');
        // Ubah dari networkidle2 menjadi domcontentloaded biar cepat kelar loading utamanya
        await pageInstance.goto('https://edabu.bpjs-kesehatan.go.id/Edabu/Home/Login', {
            waitUntil: 'domcontentloaded'
        });

        console.log('Mencari elemen Captcha...');
        await pageInstance.waitForSelector('#edabuCaptcha_CaptchaImage');

        const captchaElement = await pageInstance.$('#edabuCaptcha_CaptchaImage');
        const captchaBase64 = await captchaElement.screenshot({ encoding: 'base64' });

        console.log('Captcha berhasil ditangkap!');

        return res.status(200).json({
            status: 'success',
            message: 'Sesi login siap.',
            captchaImage: `data:image/png;base64,${captchaBase64}`
        });

    } catch (error) {
        console.error('Error saat inisiasi sesi:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Endpoint Eksekusi Login
app.post('/api/execute-login', async (req, res) => {
    const { username, password, captcha } = req.body;

    if (!username || !password || !captcha) {
        return res.status(400).json({ status: 'error', message: 'Kredensial atau Captcha tidak lengkap!' });
    }

    if (!pageInstance) {
        return res.status(400).json({ status: 'error', message: 'Sesi browser belum diinisiasi. Panggil /api/init-session dulu.' });
    }

    try {
        pesanErrorAlert = null; // Reset pesan error sebelum klik

        console.log('Mengisi form login...');
        await pageInstance.type('#txtusername', username);
        await pageInstance.type('#txtpassword', password);
        await pageInstance.type('#txtcaptcha', captcha);

        console.log('Klik tombol login...');
        await pageInstance.click('#btnlogin');

        // Tunggu 2 detik untuk memastikan apakah ada Alert muncul atau halaman pindah
        await new Promise(r => setTimeout(r, 2000));
        await autoCloseHtmlModals(pageInstance); // Coba tutup dialog HTML (notifikasi gagal)

        // Jika ada alert tertangkap (misal: "Captcha tidak sesuai")
        if (pesanErrorAlert) {
            console.log('Login gagal karena alert:', pesanErrorAlert);
            return res.status(401).json({ status: 'error', message: pesanErrorAlert });
        }

        // Jika tidak ada alert, pastikan halaman benar-benar pindah ke Index
        const currentUrl = pageInstance.url();
        if (currentUrl.includes('/Edabu/Home/Index') || currentUrl.includes('/Edabu/Peserta/Index')) {
            console.log('Login Sukses! Mengarahkan ke halaman pencarian...');
            await autoCloseHtmlModals(pageInstance); // Menutup popup informasi pasca login misal ada


            await pageInstance.goto('https://edabu.bpjs-kesehatan.go.id/Edabu/Peserta/Index#pencarian', {
                waitUntil: 'networkidle2'
            });

            await pageInstance.waitForSelector('#edabuCaptcha_CaptchaImage');
            const newCaptchaElement = await pageInstance.$('#edabuCaptcha_CaptchaImage');
            const newCaptchaBase64 = await newCaptchaElement.screenshot({ encoding: 'base64' });

            return res.status(200).json({
                status: 'success',
                message: 'Login berhasil!',
                nextCaptchaImage: `data:image/png;base64,${newCaptchaBase64}`
            });
        } else {
            return res.status(401).json({ status: 'error', message: 'Login gagal, pastikan kredensial benar.' });
        }

    } catch (error) {
        console.error('Error saat eksekusi login:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Endpoint Pencarian NIK & Scraping Data
app.post('/api/search-nik', async (req, res) => {
    const { nik, captcha } = req.body;

    if (!nik || !captcha) {
        return res.status(400).json({ status: 'error', message: 'NIK dan Captcha pencarian harus diisi!' });
    }

    if (!pageInstance) {
        return res.status(400).json({ status: 'error', message: 'Sesi browser belum siap.' });
    }

    try {
        pesanErrorAlert = null; // Reset pesan alert

        console.log(`\nMemulai pencarian untuk NIK: ${nik}`);
        await pageInstance.evaluate(() => {
            document.querySelector('#txtParam').value = '';
            document.querySelector('#txtcaptcha').value = '';
        });

        await pageInstance.type('#txtParam', nik);
        await pageInstance.type('#txtcaptcha', captcha);

        console.log('Klik tombol Selanjutnya...');
        await pageInstance.click('.sw-btn-next');

        // Tunggu sebentar untuk nangkep kalau tiba-tiba ada alert captcha salah
        await new Promise(r => setTimeout(r, 1500));
        await autoCloseHtmlModals(pageInstance); // Tutup html notifikasi error misal ada (SweetAlert dll)

        if (pesanErrorAlert) {
            console.log('Pencarian gagal karena alert:', pesanErrorAlert);
            return res.status(400).json({ status: 'error', message: pesanErrorAlert });
        }

        // Tunggu tabel hasil muncul
        await pageInstance.waitForFunction(() => {
            const hasilPanel = document.querySelector('#hasil-pencarian');
            return hasilPanel && hasilPanel.style.display === 'block';
        }, { timeout: 15000 });

        await new Promise(r => setTimeout(r, 1000)); // Render delay

        const hasilScraping = await pageInstance.evaluate((searchNik) => {
            const rows = document.querySelectorAll('#tblPencarian tbody tr');
            const dataKeluarga = [];

            rows.forEach(row => {
                const columns = row.querySelectorAll('td');
                if (columns.length >= 7 && !columns[0].classList.contains('dataTables_empty')) {
                    const nikBaris = columns[0].innerText.trim();
                    dataKeluarga.push({
                        nik: nikBaris,
                        no_jkn: columns[1].innerText.trim(),
                        nama: columns[2].innerText.trim(),
                        hubungan: columns[3].innerText.trim(),
                        jenis_kepesertaan: columns[4].innerText.trim(),
                        jabatan: columns[5].innerText.trim(),
                        status: columns[6].innerText.trim(),
                        mutasi: columns[7] ? Array.from(columns[7].querySelectorAll('option')).filter(o => o.value !== '').map(o => o.innerText.trim()).join(', ') : '-',
                        is_target: nikBaris === searchNik
                    });
                }
            });
            return dataKeluarga;
        }, nik);

        if (hasilScraping.length === 0) {
            return res.status(404).json({ status: 'warning', message: 'Data tidak ditemukan.', data: [] });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Data berhasil ditarik.',
            data: hasilScraping
        });

    } catch (error) {
        console.error('Error saat pencarian NIK:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Endpoint Refresh Captcha
app.get('/api/refresh-captcha', async (req, res) => {
    if (!pageInstance) return res.status(400).json({ status: 'error', message: 'Sesi belum ada.' });

    try {
        await pageInstance.click('#edabuCaptcha_ReloadLink');
        await new Promise(r => setTimeout(r, 1500));
        const captchaElement = await pageInstance.$('#edabuCaptcha_CaptchaImage');
        const newCaptchaBase64 = await captchaElement.screenshot({ encoding: 'base64' });

        return res.status(200).json({ status: 'success', captchaImage: `data:image/png;base64,${newCaptchaBase64}` });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Gagal me-refresh Captcha.' });
    }
});

// Endpoint Refresh Halaman Browser
app.get('/api/reload-page', async (req, res) => {
    if (!pageInstance) return res.status(400).json({ status: 'error', message: 'Sesi belum ada.' });

    try {
        await pageInstance.reload({ waitUntil: 'networkidle2' });
        await pageInstance.waitForSelector('#edabuCaptcha_CaptchaImage', { timeout: 10000 });
        const captchaElement = await pageInstance.$('#edabuCaptcha_CaptchaImage');
        const captchaBase64 = await captchaElement.screenshot({ encoding: 'base64' });

        return res.status(200).json({ status: 'success', message: 'Halaman dimuat ulang!', captchaImage: `data:image/png;base64,${captchaBase64}` });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Gagal memuat ulang halaman.' });
    }
});

app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 Proxy Edabu berjalan di http://localhost:${PORT}`);
    console.log(`🔧 Mode: ${process.env.NODE_ENV}`);
    console.log(`=========================================`);
});