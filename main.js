process.on('uncaughtException', (err) => console.error('UNCAUGHT:', err));
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let dotenvConfigured = false;
let puppeteer = null;
let generateCardPDF = null;
let solveCaptchaImage = null;
let generateMasterKey = null;
let encrypt = null;
let decrypt = null;
let keyToHex = null;
let hexToKey = null;

const API_KEY_STORE_DIR = 'bootstrap-secrets';
const MIN_SPLASH_MS = 1200;

function ensureDotenvConfigured() {
    if (!dotenvConfigured) {
        require('dotenv').config();
        dotenvConfigured = true;
    }
}

function ensureCryptoUtils() {
    if (!generateMasterKey || !encrypt || !decrypt || !keyToHex || !hexToKey) {
        ({ generateMasterKey, encrypt, decrypt, keyToHex, hexToKey } = require('./crypto-utils'));
    }
}

function ensureAutomationModules() {
    if (!puppeteer) {
        puppeteer = require('puppeteer-core');
    }

    if (!solveCaptchaImage) {
        ({ solveCaptchaImage } = require('./captcha-solver'));
    }
}

function ensurePdfModule() {
    if (!generateCardPDF) {
        ({ generateCardPDF } = require('./card-generator'));
    }
}

function getWritableApiKeyPaths() {
    const baseDir = app.getPath('userData');
    return {
        baseDir,
        encryptedEnvPath: path.join(baseDir, '.env.encrypted'),
        masterKeyPath: path.join(baseDir, '.master-key')
    };
}

function getBundledApiKeyPaths() {
    const baseDir = app.isPackaged ? path.join(process.resourcesPath, API_KEY_STORE_DIR) : __dirname;
    return {
        encryptedEnvPath: path.join(baseDir, '.env.encrypted'),
        masterKeyPath: path.join(baseDir, '.master-key')
    };
}

function ensureApiKeyStoreInitialized() {
    const writablePaths = getWritableApiKeyPaths();
    const bundledPaths = getBundledApiKeyPaths();

    fs.mkdirSync(writablePaths.baseDir, { recursive: true });

    if (!fs.existsSync(writablePaths.encryptedEnvPath) && fs.existsSync(bundledPaths.encryptedEnvPath)) {
        fs.copyFileSync(bundledPaths.encryptedEnvPath, writablePaths.encryptedEnvPath);
    }

    if (!fs.existsSync(writablePaths.masterKeyPath) && fs.existsSync(bundledPaths.masterKeyPath)) {
        fs.copyFileSync(bundledPaths.masterKeyPath, writablePaths.masterKeyPath);
    }

    return writablePaths;
}

function readStoredApiKeys() {
    ensureCryptoUtils();
    const writablePaths = ensureApiKeyStoreInitialized();

    if (fs.existsSync(writablePaths.encryptedEnvPath) && fs.existsSync(writablePaths.masterKeyPath)) {
        const masterKey = hexToKey(fs.readFileSync(writablePaths.masterKeyPath, 'utf-8').trim());
        const envContent = fs.readFileSync(writablePaths.encryptedEnvPath, 'utf-8');
        const openrouterMatch = envContent.match(/ENCRYPTED_OPENROUTER=(.+)/);
        const groqMatch = envContent.match(/ENCRYPTED_GROQ=(.+)/);

        return {
            openrouterKey: openrouterMatch?.[1] ? decrypt(openrouterMatch[1], masterKey) : '',
            groqKey: groqMatch?.[1] ? decrypt(groqMatch[1], masterKey) : '',
            writablePaths
        };
    }

    return {
        openrouterKey: process.env.OPENROUTER_API_KEY || '',
        groqKey: process.env.GROQ_API_KEY || '',
        writablePaths
    };
}

function hydrateStoredApiKeysToProcessEnv() {
    const keys = readStoredApiKeys();

    process.env.OPENROUTER_API_KEY = keys.openrouterKey || '';
    process.env.GROQ_API_KEY = keys.groqKey || '';

    return keys;
}

function upsertEncryptedValue(envContent, key, value) {
    if (envContent.includes(`${key}=`)) {
        return envContent.replace(new RegExp(`${key}=.*`, 'g'), `${key}=${value}`);
    }

    const trimmed = envContent.trimEnd();
    return `${trimmed}${trimmed ? '\n' : ''}${key}=${value}\n`;
}

function getSystemChromePath() {
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// ============================================
// CAPTCHA ICON HIDE HELPER
// ============================================
// Only hide icons on search page, NOT on login page
// Login page needs reload button to be clickable

const BOTDETECT_HIDE_SELECTORS = [
    '#edabuCaptcha_CaptchaIconsDiv',
    '#edabuCaptcha_ReloadLink',
    '#edabuCaptcha_ReloadIcon',
    '#edabuCaptcha_SoundLink',
    '#edabuCaptcha_SoundIcon',
    '#edabuCaptcha_AudioPlaceholder'
];

async function hideCaptchaIconsIfNeeded(page) {
    const currentUrl = page.url();
    const isSearchPage = currentUrl.includes('/Peserta/Index') || currentUrl.includes('#pencarian');
    
    if (isSearchPage) {
        const hideCSS = `${BOTDETECT_HIDE_SELECTORS.join(', ')} { display: none !important; }`;
        await page.addStyleTag({ content: hideCSS });
        await new Promise(r => setTimeout(r, 300)); // Wait for CSS to apply
    }
    // Login page: do NOT hide icons - keep reload button clickable
}

let mainWindow;
let splashWindow = null;
let browserInstance = null;
let pageInstance = null;
let pesanErrorAlert = null;
let splashShownAt = 0;
let splashStatusTitle = 'Memulai aplikasi';
let splashStatusDetail = 'Menyiapkan komponen dasar...';
let isMainWindowReady = false;
let isRendererStartupComplete = false;

function getSplashHtml() {
    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Edabu Tools - Startup</title>
  <style>
    :root {
      color-scheme: light;
      --bg-1: #eff7f2;
      --bg-2: #d8efe1;
      --card: rgba(255,255,255,0.88);
      --line: rgba(15, 23, 42, 0.08);
      --text: #0f172a;
      --muted: #526072;
      --accent: #138a5b;
      --accent-soft: rgba(19, 138, 91, 0.14);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", Tahoma, sans-serif;
      background:
        radial-gradient(circle at top left, rgba(19, 138, 91, 0.18), transparent 45%),
        linear-gradient(135deg, var(--bg-1), var(--bg-2));
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .shell {
      width: 100%;
      height: 100vh;
      padding: 28px;
      position: relative;
    }

    .card {
      width: 100%;
      height: 100%;
      border-radius: 24px;
      background: var(--card);
      border: 1px solid var(--line);
      box-shadow: 0 22px 60px rgba(15, 23, 42, 0.12);
      padding: 28px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      backdrop-filter: blur(10px);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 0 rgba(19, 138, 91, 0.45);
      animation: pulse 1.8s infinite;
    }

    .title {
      margin: 18px 0 10px;
      font-size: 34px;
      font-weight: 800;
      letter-spacing: -0.04em;
    }

    .subtitle {
      margin: 0;
      max-width: 440px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
    }

    .status-wrap {
      display: grid;
      gap: 10px;
    }

    .status-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .status-detail {
      min-height: 22px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }

    .progress {
      height: 8px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(15, 23, 42, 0.08);
    }

    .progress > span {
      display: block;
      width: 42%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #1a9c67, #45c08a, #1a9c67);
      background-size: 200% 100%;
      animation: loading 1.5s linear infinite;
    }

    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      font-size: 12px;
      color: var(--muted);
    }

    @keyframes loading {
      from { transform: translateX(-70%); background-position: 0 0; }
      to { transform: translateX(220%); background-position: 100% 0; }
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(19, 138, 91, 0.45); }
      70% { box-shadow: 0 0 0 12px rgba(19, 138, 91, 0); }
      100% { box-shadow: 0 0 0 0 rgba(19, 138, 91, 0); }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <div>
        <div class="badge"><span class="dot"></span> Edabu Tools</div>
        <h1 class="title">Aplikasi sedang disiapkan</h1>
        <p class="subtitle">Mohon tunggu sebentar. Sistem sedang memuat modul inti, konfigurasi aman, dan antarmuka utama aplikasi.</p>
      </div>

      <div class="status-wrap">
        <div id="statusTitle" class="status-title">${splashStatusTitle}</div>
        <div id="statusDetail" class="status-detail">${splashStatusDetail}</div>
        <div class="progress"><span></span></div>
      </div>

      <div class="footer">
        <span>Jika startup sedikit lebih lama, aplikasi tetap berjalan normal.</span>
        <span>Version 1.0.0</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function createSplashWindow() {
    splashShownAt = Date.now();
    splashWindow = new BrowserWindow({
        width: 640,
        height: 380,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: true,
        center: true,
        title: 'Edabu Tools - Startup',
        backgroundColor: '#eff7f2',
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            sandbox: true
        }
    });

    splashWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(getSplashHtml())}`);
    splashWindow.on('closed', () => {
        splashWindow = null;
    });
}

function setSplashStatus(title, detail) {
    splashStatusTitle = title;
    splashStatusDetail = detail;

    if (!splashWindow || splashWindow.isDestroyed()) {
        return;
    }

    const script = `
        (() => {
            const titleEl = document.getElementById('statusTitle');
            const detailEl = document.getElementById('statusDetail');
            if (titleEl) titleEl.textContent = ${JSON.stringify(title)};
            if (detailEl) detailEl.textContent = ${JSON.stringify(detail)};
        })();
    `;

    splashWindow.webContents.executeJavaScript(script).catch(() => {});
}

async function maybeRevealMainWindow() {
    if (!isMainWindowReady || !isRendererStartupComplete) {
        return;
    }

    await revealMainWindow();
}

async function closeSplashWindow() {
    if (!splashWindow || splashWindow.isDestroyed()) {
        return;
    }

    const elapsed = Date.now() - splashShownAt;
    if (elapsed < MIN_SPLASH_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_SPLASH_MS - elapsed));
    }

    splashWindow.close();
}

async function revealMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    setSplashStatus('Hampir siap', 'Membuka dashboard utama...');
    await closeSplashWindow();
    if (!mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
    }
}

// Fungsi bantuan untuk menangkap pesan dan menutup HTML modal dialogs/Notifikasi
// Menunggu modal muncul (dengan timeout), membaca pesannya, lalu menutupnya.
async function autoCloseHtmlModals(page, waitMs = 2000) {
    try {
        // Tunggu sampai modal SweetAlert benar-benar muncul di layar, atau timeout
        await page.waitForSelector('.swal-overlay--show-modal, .swal2-popup, .modal.show, .modal.in', {
            visible: true,
            timeout: waitMs
        }).catch(() => { }); // Tidak masalah jika tidak muncul (artinya tidak ada error)

        const modalMessage = await page.evaluate(() => {
            let message = '';

            // SweetAlert 1 (swal) - yang digunakan Edabu
            const swalOverlay = document.querySelector('.swal-overlay--show-modal');
            if (swalOverlay) {
                const swalTitle = swalOverlay.querySelector('.swal-title');
                const swalText = swalOverlay.querySelector('.swal-text');
                if (swalTitle) message = swalTitle.innerText.trim();
                if (swalText && swalText.innerText.trim()) {
                    message += (message ? ' - ' : '') + swalText.innerText.trim();
                }
                // Klik tombol OK/Confirm untuk menutup
                const swalBtn = swalOverlay.querySelector('.swal-button--confirm, .swal-button');
                if (swalBtn) swalBtn.click();
            }

            // SweetAlert 2 (Swal.fire)
            const swal2Popup = document.querySelector('.swal2-popup');
            if (!message && swal2Popup) {
                const s2Title = swal2Popup.querySelector('.swal2-title');
                const s2Content = swal2Popup.querySelector('.swal2-html-container, .swal2-content');
                if (s2Title) message = s2Title.innerText.trim();
                if (s2Content && s2Content.innerText.trim()) {
                    message += (message ? ' - ' : '') + s2Content.innerText.trim();
                }
                const s2Btn = swal2Popup.querySelector('.swal2-confirm');
                if (s2Btn) s2Btn.click();
            }

            // Bootstrap Modal 
            const bsModal = document.querySelector('.modal.show, .modal.in');
            if (!message && bsModal) {
                const bsBody = bsModal.querySelector('.modal-body');
                if (bsBody) message = bsBody.innerText.trim();
                const bsClose = bsModal.querySelector('button[data-dismiss="modal"], .btn-close, .close');
                if (bsClose) bsClose.click();
            }

            return message;
        });

        if (modalMessage) {
            console.log('Pesan dari Modal Edabu:', modalMessage);
            pesanErrorAlert = modalMessage;
        }
    } catch (e) {
        console.error("Gagal menutup modal:", e);
    }
}

function createWindow() {
    isMainWindowReady = false;
    isRendererStartupComplete = false;

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 850,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        title: 'Edabu Tools',
        autoHideMenuBar: true
    });

    setSplashStatus('Menyiapkan antarmuka', 'Memuat jendela utama aplikasi...');

    mainWindow.webContents.on('did-start-loading', () => {
        setSplashStatus('Menyiapkan antarmuka', 'Memuat aset utama aplikasi...');
    });

    mainWindow.webContents.once('did-finish-load', () => {
        setSplashStatus('Menyiapkan data awal', 'Memuat preferensi lokal dan sesi awal aplikasi...');
    });

    mainWindow.once('ready-to-show', () => {
        isMainWindowReady = true;
        setSplashStatus('Menjalankan startup aplikasi', 'Menunggu sesi browser awal dan captcha login siap...');
        maybeRevealMainWindow().catch((error) => {
            console.error('Gagal menampilkan window utama:', error);
        });
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        console.error('Gagal memuat window utama:', errorCode, errorDescription);
        setSplashStatus('Startup gagal', 'Terjadi kendala saat memuat antarmuka aplikasi.');
    });

    mainWindow.loadFile('index.html');

    // Cegah close saat masih login — paksa user logout dulu
    mainWindow.on('close', (e) => {
        if (pageInstance) {
            const currentUrl = pageInstance.url();
            // Jika sedang di halaman login awal, boleh langsung quit tanpa logout
            if (currentUrl.includes('/Edabu/Home/Login') || currentUrl === 'about:blank') {
                pageInstance = null;
                return;
            }

            // Jika sudah login, cegah quit dan munculkan dialog logout
            e.preventDefault();
            mainWindow.webContents.send('force-logout-prompt');
        }
    });

    // Pengecekan real-time status browser untuk indikator UI
    setInterval(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const isConnected = browserInstance && browserInstance.isConnected();
            mainWindow.webContents.send('puppeteer-status', {
                status: isConnected ? 'connected' : 'disconnected'
            });
        }
    }, 2000);
}

app.whenReady().then(() => {
    createSplashWindow();

    try {
        setSplashStatus('Memuat konfigurasi aman', 'Menyelaraskan API key dan data awal aplikasi...');
        ensureDotenvConfigured();
        hydrateStoredApiKeysToProcessEnv();
    } catch (error) {
        console.error('[Settings] Gagal memuat API keys awal:', error);
        setSplashStatus('Startup tetap berjalan', 'Konfigurasi awal belum sempurna, aplikasi akan tetap dibuka.');
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

ipcMain.on('startup-status', (_event, payload) => {
    if (!payload) return;

    const title = payload.title || splashStatusTitle;
    const detail = payload.detail || splashStatusDetail;
    setSplashStatus(title, detail);
});

ipcMain.on('startup-ready', async (_event, payload) => {
    isRendererStartupComplete = true;

    if (payload?.title || payload?.detail) {
        setSplashStatus(payload.title || 'Aplikasi siap', payload.detail || 'Membuka dashboard utama...');
    }

    try {
        await maybeRevealMainWindow();
    } catch (error) {
        console.error('Gagal menyelesaikan transisi splash:', error);
    }
});

// IPC: Quit app setelah logout dari tombol X
ipcMain.on('quit-app', () => {
    // Set pageInstance null agar close handler tidak memblokir
    pageInstance = null;
    // Destroy window secara paksa agar frontend tidak sempat re-init
    if (mainWindow) {
        mainWindow.destroy();
        mainWindow = null;
    }
    app.quit();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', async () => {
    if (browserInstance) {
        await browserInstance.close();
    }
});

// ==================== IPC HANDLERS ====================

// Endpoint Init Session
ipcMain.handle('init-session', async () => {
    try {
        if (!browserInstance) {
            setSplashStatus('Menyiapkan engine browser', 'Memuat modul automasi dan membuka browser latar belakang...');
            ensureAutomationModules();

            console.log('Menyiapkan instance browser...');

            const execPath = getSystemChromePath();
            if (!execPath) {
                return { status: 'error', message: 'Browser Chrome atau Edge tidak ditemukan di komputer ini. Silakan install Chrome.' };
            }

            browserInstance = await puppeteer.launch({
                executablePath: execPath,
                headless: 'new', // Selalu sembunyikan browser di background
                slowMo: 10, // Dikurangi untuk speed up (fix 11)
                defaultViewport: null,
                args: [
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--disable-setuid-sandbox',
                    '--no-sandbox',
                    '--window-size=1280,720'
                ]
            });
            pageInstance = await browserInstance.newPage();

            // OPTIMASI: Blokir aset yang bikin lambat (jangan blokir stylesheet supaya layout tidak rusak)
            const BLOCKED_TYPES = ['image', 'font', 'media', 'websocket'];
            const WHITELIST_DOMAINS = ['bpjs-kesehatan.go.id'];

            await pageInstance.setRequestInterception(true);
            pageInstance.on('request', (req) => {
                const resourceType = req.resourceType();
                const url = req.url();
                
                // Don't block resources from whitelist domains
                if (WHITELIST_DOMAINS.some(domain => url.includes(domain))) {
                    req.continue();
                    return;
                }
                
                if (BLOCKED_TYPES.includes(resourceType)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            // PASANG TELINGA
            pageInstance.on('dialog', async dialog => {
                pesanErrorAlert = dialog.message();
                console.log('Tertangkap Alert dari Edabu:', pesanErrorAlert);
                await dialog.accept();
            });
        }

        console.log('Menuju halaman login Edabu...');
        setSplashStatus('Menghubungkan ke Edabu', 'Membuka halaman login dan menyiapkan captcha awal...');
        // Fix 11: Gunakan domcontentloaded agar jauh lebih cepat dan bypass t/o
        await pageInstance.goto('https://edabu.bpjs-kesehatan.go.id/Edabu/Home/Login', {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        }).catch(e => console.log('Goto login timeout, continuing to waitForSelector...'));

        console.log('Mencari elemen Captcha...');
        await pageInstance.waitForSelector('#edabuCaptcha_CaptchaImage', { timeout: 15000 });
        console.log('Elemen Captcha ditemukan. Menunggu gambar termuat penuh...');

        // Pastikan gambar sudah benar-benar ter-render untuk mencegah screenshot hang
        await pageInstance.waitForFunction(() => {
            const img = document.querySelector('#edabuCaptcha_CaptchaImage');
            return img && img.complete && img.naturalWidth > 0;
        }, { timeout: 15000 }).catch(e => console.log('Image complete check timeout, trying anyway'));

        // Note: Captcha icons NOT hidden on login page - reload button must remain clickable
        // Icons will only be hidden on search page via hideCaptchaIconsIfNeeded()

        console.log('Mengambil screenshot captcha...');
        setSplashStatus('Menyiapkan login', 'Mengambil captcha pertama agar aplikasi siap digunakan...');
        const captchaElement = await pageInstance.$('#edabuCaptcha_CaptchaImage');
        const captchaBase64 = await captchaElement.screenshot({ encoding: 'base64' });
        console.log('Screenshot berhasil.');

        return {
            status: 'success',
            message: 'Sesi login siap.',
            captchaImage: `data:image/png;base64,${captchaBase64}`
        };

    } catch (error) {
        console.error('Error saat inisiasi sesi:', error);
        return { status: 'error', message: error.message };
    }
});

// Endpoint Eksekusi Login
ipcMain.handle('execute-login', async (event, data) => {
    const { username, password, captcha } = data;

    if (!username || !password || !captcha) {
        return { status: 'error', message: 'Kredensial atau Captcha tidak lengkap!' };
    }
    if (!pageInstance) {
        return { status: 'error', message: 'Sesi browser belum diinisiasi.' };
    }

    try {
        pesanErrorAlert = null;
        console.log('Mengisi form login...');
        await pageInstance.type('#txtusername', username);
        await pageInstance.type('#txtpassword', password);
        await pageInstance.type('#txtcaptcha', captcha);

        console.log('Klik tombol login...');
        await Promise.all([
            pageInstance.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => console.log('No navigation just dialog')),
            pageInstance.click('#btnlogin')
        ]);

        // Menunggu dan menangkap pesan modal/notifikasi dari Edabu
        await autoCloseHtmlModals(pageInstance);

        if (pesanErrorAlert) {
            console.log('Login gagal karena alert:', pesanErrorAlert);
            // Edabu otomatis refresh captcha setelah error, tunggu captcha baru
            await new Promise(r => setTimeout(r, 1000));
            await pageInstance.waitForFunction(() => {
                const img = document.querySelector('#edabuCaptcha_CaptchaImage');
                return img && img.complete && img.naturalWidth > 0;
            }, { timeout: 10000 }).catch(e => console.log('Captcha refresh after login error timeout'));

            const errCaptchaEl = await pageInstance.$('#edabuCaptcha_CaptchaImage');
            let errCaptcha = null;
            if (errCaptchaEl) {
                errCaptcha = await errCaptchaEl.screenshot({ encoding: 'base64' });
            }
            return {
                status: 'error',
                message: pesanErrorAlert,
                captchaImage: errCaptcha ? `data:image/png;base64,${errCaptcha}` : null
            };
        }

        const currentUrl = pageInstance.url();
        if (currentUrl.includes('/Edabu/Home/Index') || currentUrl.includes('/Edabu/Peserta/Index')) {
            console.log('Login Sukses! Mengarahkan ke halaman pencarian...');
            await autoCloseHtmlModals(pageInstance);

            await pageInstance.goto('https://edabu.bpjs-kesehatan.go.id/Edabu/Peserta/Index#pencarian', {
                waitUntil: 'domcontentloaded', // Fix 11
                timeout: 15000
            }).catch(e => console.log('Goto pencarian timeout, continuing...'));

            console.log('Menunggu captcha halaman pencarian...');
            await pageInstance.waitForSelector('#edabuCaptcha_CaptchaImage', { timeout: 15000 });

            await pageInstance.waitForFunction(() => {
                const img = document.querySelector('#edabuCaptcha_CaptchaImage');
                return img && img.complete && img.naturalWidth > 0;
            }, { timeout: 15000 }).catch(e => console.log('Image complete check timeout'));

            console.log('Mengambil screenshot captcha pencarian...');
            await hideCaptchaIconsIfNeeded(pageInstance);
            const newCaptchaElement = await pageInstance.$('#edabuCaptcha_CaptchaImage');
            const newCaptchaBase64 = await newCaptchaElement.screenshot({ encoding: 'base64' });
            console.log('Screenshot pencarian berhasil.');

            return {
                status: 'success',
                message: 'Login berhasil!',
                nextCaptchaImage: `data:image/png;base64,${newCaptchaBase64}`
            };
        } else {
            return { status: 'error', message: 'Login gagal, pastikan kredensial benar.' };
        }

    } catch (error) {
        console.error('Error saat eksekusi login:', error);
        return { status: 'error', message: error.message };
    }
});

// Endpoint Pencarian NIK
ipcMain.handle('search-nik', async (event, data) => {
    const { nik, captcha } = data;
    if (!nik || !captcha) return { status: 'error', message: 'NIK dan Captcha pencarian harus diisi!' };
    if (!pageInstance) return { status: 'error', message: 'Sesi browser belum siap.' };

    try {
        pesanErrorAlert = null;
        console.log(`\nMemulai pencarian untuk NIK: ${nik}`);
        await pageInstance.evaluate(() => {
            document.querySelector('#txtParam').value = '';
            document.querySelector('#txtcaptcha').value = '';
        });

        await pageInstance.type('#txtParam', nik);
        await pageInstance.type('#txtcaptcha', captcha);

        console.log('Klik tombol Selanjutnya...');
        await pageInstance.click('.sw-btn-next');

        // Menunggu dan menangkap pesan modal/notifikasi dari Edabu
        await autoCloseHtmlModals(pageInstance);

        if (pesanErrorAlert) {
            console.log('Pencarian gagal karena alert:', pesanErrorAlert);
            // Edabu otomatis refresh captcha setelah error, tunggu captcha baru
            await new Promise(r => setTimeout(r, 1000));
            await pageInstance.waitForFunction(() => {
                const img = document.querySelector('#edabuCaptcha_CaptchaImage');
                return img && img.complete && img.naturalWidth > 0;
            }, { timeout: 10000 }).catch(e => console.log('Captcha refresh after error timeout'));

            const errCaptchaEl = await pageInstance.$('#edabuCaptcha_CaptchaImage');
            let errCaptcha = null;
            if (errCaptchaEl) {
                await hideCaptchaIconsIfNeeded(pageInstance);
                errCaptcha = await errCaptchaEl.screenshot({ encoding: 'base64' });
            }
            return {
                status: 'error',
                message: pesanErrorAlert,
                nextCaptchaImage: errCaptcha ? `data:image/png;base64,${errCaptcha}` : null
            };
        }

        // Tunggu sampai tabel berisi data riil (bukan "No data available") ATAU timeout
        console.log('Menunggu data muncul di tabel...');
        await pageInstance.waitForFunction(() => {
            const rows = document.querySelectorAll('#tblPencarian tbody tr');
            if (rows.length === 0) return false;
            // Cek apakah baris pertama BUKAN "No data available"
            if (rows.length === 1 && rows[0].querySelector('.dataTables_empty')) return false;
            return true;
        }, { timeout: 15000 }).catch(e => console.log('Data table timeout'));

        console.log('Data muncul, scraping...');
        const hasilScraping = await pageInstance.evaluate((searchNik) => {
            const rows = document.querySelectorAll('#tblPencarian tbody tr');
            const dataKeluarga = [];

            if (rows.length === 1 && rows[0].querySelector('.dataTables_empty')) {
                return dataKeluarga;
            }

            rows.forEach(row => {
                const columns = row.querySelectorAll('td');
                if (columns.length >= 7) {
                    const nikBaris = columns[0].innerText.trim();
                    dataKeluarga.push({
                        nik: nikBaris,
                        no_jkn: columns[1].innerText.trim(),
                        nama: columns[2].innerText.trim(),
                        hubungan: columns[3].innerText.trim(),
                        jenis_kepesertaan: columns[4].innerText.trim(),
                        jabatan: columns[5].innerText.trim(),
                        status: columns[6].innerText.trim(),
                        is_target: nikBaris === searchNik
                    });
                }
            });
            return dataKeluarga;
        }, nik);

        // Setelah scraping, kembali ke halaman pencarian dengan captcha baru
        console.log('Kembali ke halaman pencarian...');
        await pageInstance.goto('https://edabu.bpjs-kesehatan.go.id/Edabu/Peserta/Index#pencarian', {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        }).catch(e => console.log('Goto pencarian timeout'));

        await pageInstance.waitForSelector('#edabuCaptcha_CaptchaImage', { timeout: 15000 });
        await pageInstance.waitForFunction(() => {
            const img = document.querySelector('#edabuCaptcha_CaptchaImage');
            return img && img.complete && img.naturalWidth > 0;
        }, { timeout: 15000 }).catch(e => console.log('Captcha load timeout'));

        const captchaElement = await pageInstance.$('#edabuCaptcha_CaptchaImage');
        await hideCaptchaIconsIfNeeded(pageInstance);
        const nextCaptchaBase64 = await captchaElement.screenshot({ encoding: 'base64' });
        console.log('Captcha baru siap.');

        if (hasilScraping.length === 0) {
            return {
                status: 'warning',
                message: 'Data tidak ditemukan.',
                data: [],
                nextCaptchaImage: `data:image/png;base64,${nextCaptchaBase64}`
            };
        }

        return {
            status: 'success',
            message: 'Data berhasil ditarik.',
            data: hasilScraping,
            nextCaptchaImage: `data:image/png;base64,${nextCaptchaBase64}`
        };

    } catch (error) {
        console.error('Error saat pencarian NIK:', error);
        return { status: 'error', message: error.message };
    }
});

// Endpoint Refresh Captcha
ipcMain.handle('refresh-captcha', async () => {
    if (!pageInstance) return { status: 'error', message: 'Sesi belum ada.' };
    try {
        // Click via JavaScript to bypass CSS visibility issues
        await pageInstance.evaluate(() => {
            const reloadBtn = document.querySelector('#edabuCaptcha_ReloadLink');
            if (reloadBtn) reloadBtn.click();
        });
        // Fix 11: Tunggu network request ganti gambar saja daripada sleep
        console.log('Refresh Captcha: menunggu network selesai...');
        await new Promise(r => setTimeout(r, 800));

console.log('Refresh Captcha: mengambil screenshot...');
        await pageInstance.waitForFunction(() => {
            const img = document.querySelector('#edabuCaptcha_CaptchaImage');
            return img && img.complete && img.naturalWidth > 0;
        }, { timeout: 15000 }).catch(e => console.log('Image complete check timeout'));

        const captchaElement = await pageInstance.$('#edabuCaptcha_CaptchaImage');
        await hideCaptchaIconsIfNeeded(pageInstance);
        const newCaptchaBase64 = await captchaElement.screenshot({ encoding: 'base64' });
        console.log('Refresh Captcha: berhasil.');

        return { status: 'success', captchaImage: `data:image/png;base64,${newCaptchaBase64}` };
    } catch (error) {
        return { status: 'error', message: 'Gagal me-refresh Captcha.' };
    }
});

// Endpoint Reload
ipcMain.handle('reload-page', async () => {
    if (!pageInstance) return { status: 'error', message: 'Sesi belum ada.' };
    try {
        await pageInstance.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => console.log('Reload timeout, continuing...')); // Fix 11
        console.log('Reload Page: waiting for selector...');
        await pageInstance.waitForSelector('#edabuCaptcha_CaptchaImage', { timeout: 15000 });

        await pageInstance.waitForFunction(() => {
            const img = document.querySelector('#edabuCaptcha_CaptchaImage');
            return img && img.complete && img.naturalWidth > 0;
        }, { timeout: 15000 }).catch(e => console.log('Image complete check timeout'));

        console.log('Reload Page: screenshotting...');
        const captchaElement = await pageInstance.$('#edabuCaptcha_CaptchaImage');
        await hideCaptchaIconsIfNeeded(pageInstance);
        const captchaBase64 = await captchaElement.screenshot({ encoding: 'base64' });
        console.log('Reload Page: screenshot berhasil.');

        return { status: 'success', message: 'Halaman dimuat ulang!', captchaImage: `data:image/png;base64,${captchaBase64}` };
    } catch (error) {
        return { status: 'error', message: 'Gagal memuat ulang halaman.' };
    }
});

// Endpoint Logout (Fix 10)
ipcMain.handle('logout', async () => {
    if (!pageInstance) return { status: 'success', message: 'Sudah logout.' };
    try {
        // Arahkan puppeteer ke url logout
        await pageInstance.goto('https://edabu.bpjs-kesehatan.go.id/Edabu/Home/Logout', { waitUntil: 'domcontentloaded' }).catch(e => console.log(e));

        // Tutup puppeteer sepenuhnya
        await browserInstance.close();
        browserInstance = null;
        pageInstance = null;
        pesanErrorAlert = null;

        return { status: 'success', message: 'Berhasil Logout.' };
    } catch (error) {
        return { status: 'error', message: 'Kesalahan saat logout.' };
    }
});

// ==================== SOLVE CAPTCHA (FAILOVER: OpenRouter → Groq) ====================

// Endpoint Solve Captcha dengan failover otomatis
ipcMain.handle('solve-captcha', async () => {
    if (!pageInstance) return { status: 'error', message: 'Sesi browser belum ada.' };

    try {
        ensureAutomationModules();
        const { openrouterKey, groqKey } = hydrateStoredApiKeysToProcessEnv();

        if (!openrouterKey && !groqKey) {
            return { status: 'error', message: 'Tidak ada API key yang terkonfigurasi.' };
        }

        console.log('[Captcha Solver] Mengambil screenshot captcha...');

        const captchaElement = await pageInstance.$('#edabuCaptcha_CaptchaImage');
        if (!captchaElement) {
            return { status: 'error', message: 'Elemen captcha tidak ditemukan.' };
        }

        await hideCaptchaIconsIfNeeded(pageInstance);
        const captchaBase64 = await captchaElement.screenshot({ encoding: 'base64' });
        const imageData = `data:image/png;base64,${captchaBase64}`;

        console.log('[Captcha Solver] Menjalankan solver dengan failover...');
        const result = await solveCaptchaImage(imageData, openrouterKey, groqKey);

        console.log(`[Captcha Solver] Berhasil via ${result.provider} (${result.model}): ${result.text}`);

        return {
            status: 'success',
            text: result.text,
            provider: result.provider,
            model: result.model,
            message: `Captcha solved via ${result.provider}`
        };

    } catch (error) {
        console.error('[Captcha Solver] Error:', error);
        return { status: 'error', message: 'Gagal solve captcha: ' + error.message };
    }
});

// Endpoint Save API Keys (OpenRouter + Groq)
ipcMain.handle('save-api-keys', async (event, { openrouterKey, groqKey }) => {
    try {
        const existingKeys = readStoredApiKeys();
        const { encryptedEnvPath, masterKeyPath } = existingKeys.writablePaths;
        const nextOpenRouterKey = openrouterKey || existingKeys.openrouterKey || '';
        const nextGroqKey = groqKey || existingKeys.groqKey || '';
        
        // Generate master key if not exists
        let masterKey;
        if (fs.existsSync(masterKeyPath)) {
            masterKey = hexToKey(fs.readFileSync(masterKeyPath, 'utf-8').trim());
        } else {
            masterKey = generateMasterKey();
            fs.writeFileSync(masterKeyPath, keyToHex(masterKey), 'utf-8');
        }
        
        // Read existing encrypted env if exists
        let envContent = '';
        if (fs.existsSync(encryptedEnvPath)) {
            envContent = fs.readFileSync(encryptedEnvPath, 'utf-8');
        }
        
        // Encrypt both API keys
        const encryptedOpenRouter = encrypt(nextOpenRouterKey, masterKey);
        const encryptedGroq = encrypt(nextGroqKey, masterKey);
        
        // Update or add encrypted keys
        envContent = upsertEncryptedValue(envContent, 'ENCRYPTED_OPENROUTER', encryptedOpenRouter);
        envContent = upsertEncryptedValue(envContent, 'ENCRYPTED_GROQ', encryptedGroq);
        
        fs.writeFileSync(encryptedEnvPath, envContent, 'utf-8');
        
        // Update process.env for current session
        process.env.OPENROUTER_API_KEY = nextOpenRouterKey;
        process.env.GROQ_API_KEY = nextGroqKey;
        
        console.log('[Settings] API keys dienkripsi dan disimpan (.env.encrypted + .master-key).');
        return { status: 'success' };
    } catch (error) {
        return { status: 'error', message: error.message };
    }
});

// Endpoint Get API Keys
ipcMain.handle('get-api-keys', async () => {
    try {
        const { openrouterKey, groqKey } = hydrateStoredApiKeysToProcessEnv();
        return { openrouterKey, groqKey };
    } catch (error) {
        console.error('[Settings] Gagal mendekripsi API keys:', error);
        // Fallback to process.env on error
        return {
            openrouterKey: process.env.OPENROUTER_API_KEY || '',
            groqKey: process.env.GROQ_API_KEY || ''
        };
    }
});

// ==================== CETAK KARTU BPJS ====================

// Endpoint Generate PDF Kartu BPJS
ipcMain.handle('generate-card-pdf', async (event, data) => {
    try {
        ensurePdfModule();
        console.log('[Main] Menerima request generate kartu BPJS:', data.nama);
        const pdfBuffer = await generateCardPDF(data);

        // Tampilkan dialog Save As
        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Simpan Kartu BPJS',
            defaultPath: `${data.nama || 'kartu'} ${data.nik || ''}.pdf`.trim(),
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
        });

        if (result.canceled || !result.filePath) {
            return { status: 'cancelled', message: 'Penyimpanan dibatalkan.' };
        }

        fs.writeFileSync(result.filePath, pdfBuffer);
        console.log('[Main] PDF kartu disimpan ke:', result.filePath);

        return { status: 'success', message: `Kartu BPJS berhasil disimpan!`, filePath: result.filePath };
    } catch (error) {
        console.error('[Main] Error generate kartu BPJS:', error);
        return { status: 'error', message: error.message };
    }
});

// Endpoint Preview PDF Kartu BPJS (return base64)
ipcMain.handle('preview-card-pdf', async (event, data) => {
    try {
        ensurePdfModule();
        console.log('[Main] Menerima request preview kartu BPJS:', data.nama);
        const pdfBuffer = await generateCardPDF(data);
        const base64 = pdfBuffer.toString('base64');
        return { status: 'success', pdfBase64: base64 };
    } catch (error) {
        console.error('[Main] Error preview kartu BPJS:', error);
        return { status: 'error', message: error.message };
    }
});
