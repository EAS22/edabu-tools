const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    try {
        await page.goto('https://edabu.bpjs-kesehatan.go.id/Edabu/Home/Login', { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log('Page loaded');
        // Wait a bit
        await new Promise(r => setTimeout(r, 3000));

        const html = await page.content();
        const fs = require('fs');
        fs.writeFileSync('g:/EDABU/edabu_dump.html', html);
        console.log('Dumped to g:/EDABU/edabu_dump.html');

        const hasCaptcha = await page.$('#edabuCaptcha_CaptchaImage');
        console.log('Has #edabuCaptcha_CaptchaImage?', !!hasCaptcha);
    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
})();
