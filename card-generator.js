// card-generator.js — PDF generation for BPJS card (ported from CETAKIN)
// CommonJS module for Electron main process

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const bwipjs = require('bwip-js');
const fs = require('fs');
const path = require('path');

// Konversi mm ke points (1 mm = 2.83465 points)
function mmToPoints(mm) {
    return mm * 2.83465;
}

// Konfigurasi posisi dan style text (dari CETAKIN singleCard.ts)
const textConfig = {
    nama: { x: 78, y: 77, size: 6 },
    nik: { x: 78, y: 107.9, size: 6 },
    tglLahir: { x: 78, y: 100.1, size: 6 },
    alamatBaris1: { x: 78, y: 85.1, size: 6 },
    alamatBaris2: { x: 78, y: 92.6, size: 6 },
    faskes: { x: 78, y: 115.5, size: 6 },
    nomorKartu: { x: 78, y: 69, size: 6.5 },
    barcode: { x: 29, y: 58 },
    barcodeWidth: 31.5,
    barcodeHeight: 4,
};

function toUpperCase(text) {
    return text ? text.toUpperCase() : '';
}

// Format alamat menjadi 2 baris
function formatAlamat(alamatJalan, rt, rw, desaInfo) {
    var baris1 = '';
    if (alamatJalan) {
        baris1 += toUpperCase(alamatJalan) + ' ';
    }
    if (rt || rw) {
        baris1 += toUpperCase(rt || '-') + '/' + toUpperCase(rw || '-') + ' ';
    }
    if (desaInfo && desaInfo.nama_desa) {
        baris1 += toUpperCase(desaInfo.nama_desa);
    }

    var baris2 = '';
    if (desaInfo) {
        var parts = [];
        if (desaInfo.kecamatan) parts.push(toUpperCase(desaInfo.kecamatan));
        if (desaInfo.kabupaten_kota) parts.push(toUpperCase(desaInfo.kabupaten_kota));
        baris2 = parts.join(', ');
    }

    return { baris1: baris1.trim(), baris2: baris2 };
}

// Format tanggal dari YYYY-MM-DD ke DD-MM-YYYY
function formatDate(dateString) {
    if (!dateString) return '';
    var parts = dateString.split('-');
    if (parts.length !== 3) return dateString;
    return parts[2] + '-' + parts[1] + '-' + parts[0];
}

// Generate barcode PNG buffer using bwip-js (Node.js native, no Canvas needed)
async function generateBarcodePng(text) {
    var pngBuffer = await bwipjs.toBuffer({
        bcid: 'code128',
        text: text,
        scale: 3,
        height: 4,
        includetext: false,
    });
    return pngBuffer;
}

/**
 * Generate a BPJS card PDF.
 * @param {Object} data
 * @param {string} data.nomor_kartu - No Kartu JKN
 * @param {string} data.nik
 * @param {string} data.nama
 * @param {string} data.tgl_lahir - YYYY-MM-DD
 * @param {string} data.alamat_jalan
 * @param {string} data.rt
 * @param {string} data.rw
 * @param {string} data.faskes
 * @param {Object|null} data.desaInfo - { nama_desa, kecamatan, kabupaten_kota }
 * @returns {Promise<Buffer>} PDF file buffer
 */
async function generateCardPDF(data) {
    // Create PDF
    var pdfDoc = await PDFDocument.create();

    var pageWidth = mmToPoints(182);
    var pageHeight = mmToPoints(55.98);
    var page = pdfDoc.addPage([pageWidth, pageHeight]);

    // Embed fonts
    var font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    var boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Load template image
    var templatePath = path.join(__dirname, 'templates', 'template.png');
    var templateBytes = fs.readFileSync(templatePath);
    var templateImage = await pdfDoc.embedPng(templateBytes);

    // Draw template as background
    page.drawImage(templateImage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
    });

    // Generate and draw barcode
    if (data.nomor_kartu) {
        var barcodePng = await generateBarcodePng(data.nomor_kartu);
        var barcodeImage = await pdfDoc.embedPng(barcodePng);
        var barcodeWidth = mmToPoints(textConfig.barcodeWidth);
        var barcodeHeight = mmToPoints(textConfig.barcodeHeight);

        page.drawImage(barcodeImage, {
            x: textConfig.barcode.x,
            y: pageHeight - textConfig.barcode.y,
            width: barcodeWidth,
            height: barcodeHeight,
        });
    }

    // Draw nomor kartu
    if (data.nomor_kartu) {
        page.drawText(toUpperCase(data.nomor_kartu), {
            x: textConfig.nomorKartu.x,
            y: pageHeight - textConfig.nomorKartu.y,
            size: textConfig.nomorKartu.size,
            font: boldFont,
            color: rgb(0, 0, 0),
        });
    }

    // Draw nama
    if (data.nama) {
        page.drawText(toUpperCase(data.nama), {
            x: textConfig.nama.x,
            y: pageHeight - textConfig.nama.y,
            size: textConfig.nama.size,
            font: boldFont,
            color: rgb(0, 0, 0),
        });
    }

    // Draw NIK
    if (data.nik) {
        page.drawText(toUpperCase(data.nik), {
            x: textConfig.nik.x,
            y: pageHeight - textConfig.nik.y,
            size: textConfig.nik.size,
            font: font,
            color: rgb(0, 0, 0),
        });
    }

    // Draw tanggal lahir (convert YYYY-MM-DD to DD-MM-YYYY)
    if (data.tgl_lahir) {
        page.drawText(toUpperCase(formatDate(data.tgl_lahir)), {
            x: textConfig.tglLahir.x,
            y: pageHeight - textConfig.tglLahir.y,
            size: textConfig.tglLahir.size,
            font: font,
            color: rgb(0, 0, 0),
        });
    }

    // Draw alamat (2 baris)
    var alamat = formatAlamat(data.alamat_jalan, data.rt, data.rw, data.desaInfo);

    if (alamat.baris1) {
        page.drawText(alamat.baris1, {
            x: textConfig.alamatBaris1.x,
            y: pageHeight - textConfig.alamatBaris1.y,
            size: textConfig.alamatBaris1.size,
            font: font,
            color: rgb(0, 0, 0),
        });
    }

    if (alamat.baris2) {
        page.drawText(alamat.baris2, {
            x: textConfig.alamatBaris2.x,
            y: pageHeight - textConfig.alamatBaris2.y,
            size: textConfig.alamatBaris2.size,
            font: font,
            color: rgb(0, 0, 0),
        });
    }

    // Draw faskes
    if (data.faskes) {
        page.drawText(toUpperCase(data.faskes), {
            x: textConfig.faskes.x,
            y: pageHeight - textConfig.faskes.y,
            size: textConfig.faskes.size,
            font: font,
            color: rgb(0, 0, 0),
        });
    }

    // Save PDF and return as Buffer
    var pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
}

module.exports = { generateCardPDF };
