const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

function drawTable(doc, startX, startY, columnWidths, rows, opts = {}) {
    const lineColor = opts.lineColor || '#CCCCCC';
    const rowHeight = opts.rowHeight || 20;
    const header = opts.header || null;
    const textAlign = opts.textAlign || 'left';
    const padding = opts.padding || 6;
    const lineWidth = opts.lineWidth || 0.5;
    let x = startX;
    let y = startY;
    const pageHeight = doc.page.height;
    const bottomY = pageHeight - doc.page.margins.bottom;

    function ensureSpace() {
        if (y + rowHeight > bottomY) {
            doc.addPage();
            y = doc.page.margins.top;
        }
    }

    if (header) {
        ensureSpace();
        x = startX;
        doc.font('Helvetica-Bold').fontSize(10);
        header.forEach((cell, i) => {
            const w = columnWidths[i] || 60;
            doc.lineWidth(lineWidth).rect(x, y, w, rowHeight).strokeColor(lineColor).stroke();
            doc.text(String(cell || ''), x + padding, y + padding, {
                width: w - padding * 2,
                align: textAlign
            });
            x += w;
        });
        y += rowHeight;
        doc.font('Helvetica');
    }

    rows.forEach((row) => {
        ensureSpace();
        x = startX;
        row.forEach((cell, i) => {
            const w = columnWidths[i] || 60;
            doc.lineWidth(lineWidth).rect(x, y, w, rowHeight).strokeColor(lineColor).stroke();
            doc.text(String(cell ?? ''), x + padding, y + padding, {
                width: w - padding * 2,
                align: textAlign
            });
            x += w;
        });
        y += rowHeight;
    });

    return y;
}

const contentWidth = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

const heading = (doc, text) => {
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold')
        .fontSize(12)
        .text(text, doc.page.margins.left, doc.y, { width: contentWidth(doc), align: 'left' });
    doc.moveDown(0.2);
};

const paragraph = (doc, text) => {
    doc.font('Helvetica')
        .fontSize(10.5)
        .text(text, doc.page.margins.left, doc.y, {
            width: contentWidth(doc),
            align: 'left',
            lineGap: 2
        });
    doc.moveDown(0.4);
};

const bulletList = (doc, items) => {
    doc.font('Helvetica').fontSize(10.5);
    items.forEach((item) => {
        doc.text(`• ${item}`, doc.page.margins.left, doc.y, {
            width: contentWidth(doc),
            align: 'left',
            lineGap: 2
        });
    });
    doc.moveDown(0.4);
};

const numberList = (doc, items) => {
    doc.font('Helvetica').fontSize(10.5);
    items.forEach((item, index) => {
        doc.text(`${index + 1}. ${item}`, doc.page.margins.left, doc.y, {
            width: contentWidth(doc),
            align: 'left',
            lineGap: 2
        });
    });
    doc.moveDown(0.4);
};

exports.generateConsignmentAgreementPdf = async (agreementData) => {
    const {
        agreementNumber,
        agreementDate,
        ownerName,
        ownerContact,
        ownerEmiratesIdOrPassport,
        ownerAddress,
        vehicle,
        agreedAmount,
        duration
    } = agreementData;

    const formattedDate = agreementDate
        ? new Date(agreementDate).toLocaleDateString('en-GB')
        : new Date().toLocaleDateString('en-GB');

    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 170, right: 28, bottom: 120, left: 28 }
    });
    const chunks = [];

    return await new Promise((resolve, reject) => {
        doc.on('data', (d) => chunks.push(d));
        doc.on('error', reject);
        doc.on('end', () => {
            const buf = Buffer.concat(chunks);
            resolve(buf);
        });

        const drawBackground = () => {
            try {
                const bgPath = path.join(__dirname, '../templates/assets/letterhead.jpg');
                if (fs.existsSync(bgPath)) {
                    doc.save();
                    doc.image(bgPath, 0, 0, { width: doc.page.width, height: doc.page.height });
                    doc.restore();
                }
            } catch (_) {
                // ignore image errors
            }
        };

        drawBackground();
        doc.on('pageAdded', drawBackground);

        doc.font('Helvetica-Bold').fontSize(16).text('CONSIGNMENT AGREEMENT', {
            align: 'center'
        });
        doc.moveDown(1);

        const availableWidth = contentWidth(doc);
        const metaY = doc.y;
        const halfWidth = availableWidth / 2;
        doc.font('Helvetica-Bold')
            .fontSize(11)

            .text(`Agreement No : ${agreementNumber || ''}`, doc.page.margins.left, metaY, {
                width: halfWidth,
                align: 'left'
            });
        doc.font('Helvetica-Bold')
            .fontSize(11)
            .text(`Date: ${formattedDate || ''}`, doc.page.margins.left + halfWidth, metaY, {
                width: halfWidth,
                align: 'right'
            });
        doc.moveDown(0.8);

        heading(doc, '1. Party Details');

        const columnGap = 24;
        const columnWidth = (availableWidth - columnGap) / 2;
        const leftX = doc.page.margins.left;
        const rightX = leftX + columnWidth + columnGap;
        const columnsStartY = doc.y;

        const writeColumn = (x, startY, lines) => {
            let currentY = startY;
            lines.forEach((line, index) => {
                doc.font(line.bold ? 'Helvetica-Bold' : 'Helvetica')
                    .fontSize(line.fontSize || 10.5)
                    .text(line.text, x, currentY, { width: columnWidth, align: 'left' });
                currentY = doc.y;
            });
            return currentY - startY;
        };

        const leftLines = [
            { bold: true, fontSize: 11, text: 'Showroom:' },
            { text: 'ZRS Cars Trading L.L.C-FZ' },
            { text: 'Alyia & Almirah Complex, Shed 4' },
            { text: 'DIP-1, Dubai, UAE' },
            { text: 'TRN: 104624075800003' }
        ];

        const rightLines = [
            { bold: true, fontSize: 11, text: 'Vehicle Owner (Customer):' },
            { text: `Name: ${ownerName || '______________________________'}` },
            { text: `Contact Number: ${ownerContact || '_____________________'}` },
            { text: `Emirates ID / Passport: ${ownerEmiratesIdOrPassport || '______________'}` },
            { text: `Address: ${ownerAddress || '______________________________'}` }
        ];

        const leftHeight = writeColumn(leftX, columnsStartY, leftLines);
        const rightHeight = writeColumn(rightX, columnsStartY, rightLines);
        const columnHeight = Math.max(leftHeight, rightHeight);
        doc.y = columnsStartY + columnHeight;
        doc.moveDown(0.6);

        heading(doc, '2. Vehicle Details');

        const vehicleRows = [
            ['Make', vehicle.make || ''],
            ['Model', vehicle.model || ''],
            ['Trim', vehicle.trim || ''],
            ['Year', vehicle.year ? String(vehicle.year) : ''],
            ['Mileage', vehicle.mileage ? `${vehicle.mileage.toLocaleString()} km` : ''],
            ['Chassis No.', vehicle.chassisNo || ''],
            ['Color', vehicle.color || '']
        ];

        const vehicleColumnWidths = [
            contentWidth(doc) * 0.4,
            contentWidth(doc) * 0.6
        ];
        drawTable(
            doc,
            doc.page.margins.left,
            doc.y,
            vehicleColumnWidths,
            vehicleRows,
            {
                textAlign: 'center',
                lineWidth: 0.5
            }
        );

        heading(doc, '3. Purpose of Agreement');
        paragraph(doc, 'The vehicle owner (“Client”) hereby consigns the above-mentioned vehicle to ZRS Cars Trading for the purpose of marketing and selling the vehicle on their behalf.');

        heading(doc, '4. Consignment Price (Agreed Amount to Owner)');
        paragraph(doc, 'The agreed amount the owner will receive upon sale of the vehicle:');
        doc.font('Helvetica-Bold').fontSize(12).text(`AED ${Number(agreedAmount || 0).toLocaleString()}`);
        doc.moveDown(0.4);
        paragraph(doc, 'Any selling price achieved above this amount will be retained by ZRS Cars Trading as showroom profit.');

        heading(doc, '5. Consignment Duration');
        bulletList(doc, [
            `Consignment period: ${duration || '30 to 45 days'}`,
            'If the car does not sell within the agreed period, the owner must collect the vehicle from the showroom.'
        ]);

        heading(doc, '6. Marketing & Promotion Fees');
        paragraph(doc, 'ZRS Cars Trading will professionally market the vehicle across premium platforms, including:');
        bulletList(doc, [
            'Photography & videography',
            'Paid advertising',
            'Detailing (if required)',
            'Platform listings & online promotions'
        ]);
        paragraph(doc, `If the vehicle does not sell within the ${duration} period, the owner agrees to pay a AED 1,500 marketing fee to cover these promotional expenses when collecting the vehicle.`);

        heading(doc, '7. Vehicle Condition & Ownership');
        numberList(doc, [
            'The owner confirms full legal ownership of the vehicle and guarantees it is free from major accidents, tampering, or undisclosed financial/legal issues.',
            'The owner authorizes ZRS Cars Trading to present the vehicle to prospective buyers and allow test drives under showroom supervision.',
            'ZRS Cars Trading will not be responsible for any mechanical faults or internal issues discovered during the consignment period.'
        ]);

        heading(doc, '8. Liability Clause');
        bulletList(doc, [
            'Mechanical or electrical failures during the consignment period',
            'Bank or legal issues related to the vehicle',
            'Market fluctuations affecting the expected selling price'
        ]);
        paragraph(doc, 'The vehicle is kept at the owner’s risk, although ZRS Cars Trading will take reasonable care of the vehicle while in its custody.');

        heading(doc, '9. Payment Terms');
        bulletList(doc, [
            'Upon sale of the vehicle, the owner will receive the agreed consignment amount (Section 4).',
            'Any amount above the agreed amount will be retained entirely by ZRS Cars Trading.',
            'Payment will be made within 1 working day after RTA transfer is completed.'
        ]);

        heading(doc, '10. Termination');
        bulletList(doc, [
            'The vehicle is not in the condition originally declared.',
            'Legal or financial issues are discovered.',
            `The owner requests removal before the ${duration} period (marketing fee still applies).`
        ]);

        heading(doc, '11. Acknowledgment & Signatures');
        paragraph(doc, 'By signing this agreement, both parties agree to all terms listed above.');

        const requiredSignatureHeight = 160;
        const pageBottom = doc.page.height - doc.page.margins.bottom;
        if (doc.y + requiredSignatureHeight > pageBottom) {
            doc.addPage();
        }

        const signatureStartY = doc.y + 10;
        const signatureColumnWidth = (availableWidth - 40) / 2;
        const signatureLeftX = doc.page.margins.left;
        const signatureRightX = signatureLeftX + signatureColumnWidth + 40;

        doc.font('Helvetica-Bold').text('For ZRS Cars Trading', signatureLeftX, signatureStartY, { width: signatureColumnWidth });
        doc.font('Helvetica').text('Authorized Signatory: _______________________', signatureLeftX, signatureStartY + 16, { width: signatureColumnWidth });
        doc.text('Date: _______________________', signatureLeftX, signatureStartY + 36, { width: signatureColumnWidth });

        doc.font('Helvetica-Bold').text('Vehicle Owner (Client)', signatureRightX, signatureStartY, { width: signatureColumnWidth });
        doc.font('Helvetica').text(`Name: ${ownerName || ''}`, signatureRightX, signatureStartY + 16, { width: signatureColumnWidth });
        doc.text('Signature: _______________________', signatureRightX, signatureStartY + 32, { width: signatureColumnWidth });
        doc.text('Date: _______________________', signatureRightX, signatureStartY + 48, { width: signatureColumnWidth });

        try {
            const stampPath = path.join(__dirname, '../templates/assets/stamp.png');
            if (fs.existsSync(stampPath)) {
                doc.image(stampPath, signatureLeftX + 10, signatureStartY + 55, { width: 110, opacity: 0.95 });
            }
        } catch (_) {
            // ignore stamp errors
        }

        doc.end();
    });
};


