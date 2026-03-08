const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    try {
        await page.goto('https://edabu.bpjs-kesehatan.go.id/Edabu/Home/Login', { timeout: 15000 }).catch(e => console.log('goto timeout'));
        console.log('Wait 5s');
        await new Promise(r => setTimeout(r, 5000));
        console.log('Dumping HTML');
        const fs = require('fs');
        fs.writeFileSync('g:/EDABU/edabu_dump.html', await page.content());
        console.log('Done mapping dom.');
    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
})();
