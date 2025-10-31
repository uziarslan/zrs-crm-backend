const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const PDFDocument = require('pdfkit');

async function renderInvoiceHtml(invoiceData) {
    const templatePath = path.join(__dirname, '../templates/invoice.hbs');
    const src = fs.readFileSync(templatePath, 'utf8');
    const template = Handlebars.compile(src, { noEscape: true });
    // Ensure numbers are formatted as strings
    const formatted = { ...invoiceData };
    const numFields = [
        'buying_price', 'transfer_cost', 'detailing_inspection_cost',
        'other_charges', 'total_amount_payable'
    ];
    for (const key of numFields) {
        if (formatted[key] != null && formatted[key] !== '') {
            const n = Number(formatted[key]);
            formatted[key] = isNaN(n) ? String(formatted[key]) : n.toLocaleString();
        }
    }
    return template(formatted);
}

// Helper: draw a simple table with borders that can span pages
function drawTable(doc, startX, startY, columnWidths, rows, opts = {}) {
    const lineColor = opts.lineColor || '#CCCCCC';
    const rowHeight = opts.rowHeight || 20;
    const header = opts.header || null; // optional header row (array)
    let x = startX;
    let y = startY;
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const bottomY = pageHeight - doc.page.margins.bottom;

    function ensureSpace() {
        if (y + rowHeight > bottomY) {
            doc.addPage();
            y = doc.page.margins.top;
        }
    }

    // Draw header if provided
    if (header) {
        ensureSpace();
        x = startX;
        doc.font('Helvetica-Bold').fontSize(10);
        header.forEach((cell, i) => {
            const w = columnWidths[i] || 60;
            doc.rect(x, y, w, rowHeight).strokeColor(lineColor).stroke();
            doc.text(String(cell || ''), x + 6, y + 6, { width: w - 12 });
            x += w;
        });
        y += rowHeight;
        doc.font('Helvetica');
    }

    // Draw rows (auto-page-break)
    rows.forEach((row) => {
        ensureSpace();
        x = startX;
        row.forEach((cell, i) => {
            const w = columnWidths[i] || 60;
            doc.rect(x, y, w, rowHeight).strokeColor(lineColor).stroke();
            const alignRight = opts.alignRightCols && opts.alignRightCols.includes(i);
            doc.text(String(cell ?? ''), x + 6, y + 6, { width: w - 12, align: alignRight ? 'right' : 'left' });
            x += w;
        });
        y += rowHeight;
    });

    return y; // return new y cursor
}

exports.generateInvoicePdfBuffer = async (invoiceData) => {
    // Render human-readable values (kept for future HTML usage if needed)
    const pretty = await renderInvoiceHtml(invoiceData);
    // Build a PDF with larger top margin (+20px) to avoid letterhead overlap
    const doc = new PDFDocument({ size: 'A4', margins: { top: 170, right: 28, bottom: 120, left: 28 } });
    const chunks = [];
    return await new Promise((resolve, reject) => {
        doc.on('data', (d) => chunks.push(d));
        doc.on('error', reject);
        doc.on('end', () => {
            const buf = Buffer.concat(chunks);
            if (!(Buffer.isBuffer(buf) && buf.slice(0, 4).toString() === '%PDF')) {
                return reject(new Error('Generated PDF did not have a valid %PDF header'));
            }
            resolve(buf);
        });
        // Draw letterhead background on every page
        const drawBackground = () => {
            try {
                const bgPath = path.join(__dirname, '../templates/assets/letterhead.jpg');
                if (fs.existsSync(bgPath)) {
                    const pageW = doc.page.width;
                    const pageH = doc.page.height;
                    doc.save();
                    doc.image(bgPath, 0, 0, { width: pageW, height: pageH });
                    doc.restore();
                }
            } catch (_) { /* ignore */ }
        };
        drawBackground();
        doc.on('pageAdded', drawBackground);

        // Start content cursor
        let y = doc.y;

        // Helper to force left-aligned headings at left margin
        const heading = (text) => {
            const xLeft = doc.page.margins.left;
            const yTop = doc.y;
            doc.font('Helvetica-Bold').fontSize(12);
            doc.text(text, xLeft, yTop, { align: 'left' });
            doc.moveDown(0.3);
        };

        // Title
        heading('ZRS CARS TRADING – INVOICE');

        // Meta table
        doc.moveDown(0.2); // extra spacing between heading and table
        heading('Invoice Details');
        doc.font('Helvetica');
        y = drawTable(doc, doc.page.margins.left, doc.y, [140, 350], [
            ['Invoice No', invoiceData.invoice_no || ''],
            ['Date', invoiceData.date || ''],
            ['Investor Name', invoiceData.investor_name || ''],
            ['Prepared By', invoiceData.prepared_by || ''],
            ['Reference PO No', invoiceData.reference_po_no || '']
        ]);

        doc.moveDown(0.8); // a bit more spacing before next section
        heading('Vehicle Details');
        doc.font('Helvetica');
        y = drawTable(doc, doc.page.margins.left, doc.y, [140, 350], [
            ['Car Make', invoiceData.car_make || ''],
            ['Car Model', invoiceData.car_model || ''],
            ['Trim', invoiceData.trim || ''],
            ['Year Model', invoiceData.year_model || ''],
            ['Chassis No.', invoiceData.chassis_no || '']
        ]);

        const money = (n) => (n == null || n === '') ? '0' : String(n);
        doc.moveDown(0.8);
        heading('Invoice Summary');
        doc.font('Helvetica');
        y = drawTable(doc, doc.page.margins.left, doc.y, [340, 150], [
            ['Buying Price', `AED ${money(invoiceData.buying_price)}`],
            ['Transfer Cost (RTA)', `AED ${money(invoiceData.transfer_cost)}`],
            ['Detailing / Inspection Cost', `AED ${money(invoiceData.detailing_inspection_cost)}`],
            ['Agent Commission (Optional)', `AED ${money(invoiceData.agent_commission)}`],
            ['Car Recovery Cost (Optional)', `AED ${money(invoiceData.car_recovery_cost)}`],
            ['Other Charges (if any)', `AED ${money(invoiceData.other_charges)}`],
            ['Total Amount Payable', `AED ${money(invoiceData.total_amount_payable)}`]
        ], { alignRightCols: [1] });

        doc.moveDown(0.8);
        heading('Payment Details');
        doc.font('Helvetica');
        y = drawTable(doc, doc.page.margins.left, doc.y, [200, 290], [
            ['Mode of Payment', invoiceData.mode_of_payment || ''],
            ['Payment Received By', invoiceData.payment_received_by || ''],
            ['Date of Payment', invoiceData.date_of_payment || '']
        ]);

        // Notes section (multi-page safe)
        doc.moveDown(0.8);
        heading('Notes');
        doc.font('Helvetica').fontSize(10);
        const bullets = [
            `This invoice is issued against the signed Purchase Order No. ${invoiceData.reference_po_no || ''}.`,
            'Payment confirms investor participation in the vehicle investment under ZRS Cars Trading.',
            'All amounts received are recorded under the investor’s account and will be settled upon vehicle sale as per the Investment Agreement.',
            'Any additional costs (inspection, recovery, or others) will be adjusted from the investor’s final proceeds.'
        ];
        const bottomY = doc.page.height - doc.page.margins.bottom;
        bullets.forEach((line) => {
            if (doc.y + 18 > bottomY) doc.addPage();
            doc.text(`• ${line}`);
        });

        // Signature area (optional)
        if (doc.y + 60 > bottomY) doc.addPage();
        doc.moveDown(0.8);
        doc.font('Helvetica').fontSize(10).text('For ZRS Cars Trading');
        doc.text('Authorized Signatory');

        // Optional company stamp if available
        try {
            const stampPath = path.join(__dirname, '../templates/assets/stamp.png');
            if (fs.existsSync(stampPath)) {
                // Position near lower-left of current cursor
                const yStamp = doc.y + 10;
                const xStamp = doc.page.margins.left + 20;
                doc.image(stampPath, xStamp, yStamp, { width: 110, opacity: 0.95 });
            }
        } catch (_) { /* ignore */ }

        doc.end();
    });
};


