const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const currency = (value = 0) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return '0.00';
    return amount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const contentWidth = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

const drawTable = (doc, startX, startY, columnWidths, rows, options = {}) => {
    const {
        rowHeight = 22,
        lineColor = '#D8D8D8',
        lineWidth = 0.5,
        header = null,
        align = 'left',
        padding = 6
    } = options;

    let y = startY;
    let x = startX;
    const bottomLimit = doc.page.height - doc.page.margins.bottom;

    const ensureSpace = () => {
        if (y + rowHeight > bottomLimit) {
            doc.addPage();
            y = doc.page.margins.top;
        }
    };

    if (header) {
        ensureSpace();
        doc.font('Helvetica-Bold').fontSize(10);
        header.forEach((cell, index) => {
            const width = columnWidths[index] || 100;
            doc.lineWidth(lineWidth).rect(x, y, width, rowHeight).strokeColor(lineColor).stroke();
            doc.text(cell, x + padding, y + padding, {
                width: width - padding * 2,
                align
            });
            x += width;
        });
        doc.font('Helvetica').fontSize(10);
        y += rowHeight;
        x = startX;
    }

    rows.forEach((row) => {
        ensureSpace();
        row.forEach((cell, index) => {
            const width = columnWidths[index] || 100;
            doc.lineWidth(lineWidth).rect(x, y, width, rowHeight).strokeColor(lineColor).stroke();
            doc.text(String(cell ?? ''), x + padding, y + padding, {
                width: width - padding * 2,
                align
            });
            x += width;
        });
        y += rowHeight;
        x = startX;
    });

    return y;
};

exports.generateSellOrderPdf = async (data) => {
    const {
        salesOrderNumber,
        orderDate,
        preparedByName,
        customerDetails,
        vehicle,
        sellingPrice,
        transferCost,
        insurance,
        bankFinanceFee,
        otherCharges,
        totalPayable,
        paymentMode,
        bookingAmount,
        balanceAmount
    } = data;

    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 170, right: 28, bottom: 120, left: 28 }
    });

    const chunks = [];

    return await new Promise((resolve, reject) => {
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('error', reject);
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        const drawBackground = () => {
            try {
                const bgPath = path.join(__dirname, '../templates/assets/letterhead.jpg');
                if (fs.existsSync(bgPath)) {
                    doc.save();
                    doc.image(bgPath, 0, 0, { width: doc.page.width, height: doc.page.height });
                    doc.restore();
                }
            } catch (_) {
                // ignore background failures
            }
        };

        drawBackground();
        doc.on('pageAdded', drawBackground);

        const availableWidth = contentWidth(doc);

        const leftMargin = doc.page.margins.left;

        doc.font('Helvetica-Bold')
            .fontSize(16)
            .text('SALES ORDER / SELLING AGREEMENT', leftMargin, doc.y, {
                width: availableWidth,
                align: 'center'
            });
        doc.moveDown(0.8);

        const metaY = doc.y;
        const halfWidth = availableWidth / 2;
        const formattedDate = new Date(orderDate || Date.now()).toLocaleDateString('en-GB');

        doc.font('Helvetica-Bold')
            .fontSize(11)
            .text(`Sales Order No: ${salesOrderNumber || ''}`, doc.page.margins.left, metaY, {
                width: halfWidth,
                align: 'left'
            });
        doc.font('Helvetica-Bold')
            .fontSize(11)
            .text(`Date: ${formattedDate}`, doc.page.margins.left + halfWidth, metaY, {
                width: halfWidth,
                align: 'right'
            });
        doc.moveDown(0.2);
        doc.font('Helvetica')
            .fontSize(10.5)
            .text(`Prepared By: ${preparedByName || '________________'}`, doc.page.margins.left, doc.y, {
                width: availableWidth,
                align: 'left'
            });
        doc.moveDown(1);

        // Customer details section
        const heading = (text) => {
            doc.font('Helvetica-Bold')
                .fontSize(12)
                .text(text, leftMargin, doc.y, {
                    width: availableWidth,
                    align: 'left'
                });
            doc.moveDown(0.3);
        };

        heading('Customer Details');
        doc.moveDown(0.3);

        const customerRows = [
            ['Customer Name', customerDetails?.name || ''],
            ['Contact Number', customerDetails?.contact || ''],
            ['Email', customerDetails?.email || ''],
            ['Emirates ID / Passport', customerDetails?.idDocument || ''],
            ['Address', customerDetails?.address || '']
        ];

        let currentY = drawTable(
            doc,
            doc.page.margins.left,
            doc.y,
            [availableWidth * 0.35, availableWidth * 0.65],
            customerRows,
            {
                header: ['Field', 'Information'],
                align: 'left'
            }
        );
        doc.y = currentY + 16;

        // Vehicle details section
        heading('Vehicle Details');

        const vehicleRows = [
            ['Car Make', vehicle?.make || ''],
            ['Car Model', vehicle?.model || ''],
            ['Trim', vehicle?.trim || ''],
            ['Year', vehicle?.year ? String(vehicle.year) : ''],
            ['Mileage', vehicle?.mileage ? `${vehicle.mileage.toLocaleString()} km` : ''],
            ['Chassis No.', vehicle?.chassisNo || ''],
            ['Color', vehicle?.color || '']
        ];

        currentY = drawTable(
            doc,
            doc.page.margins.left,
            doc.y,
            [availableWidth * 0.35, availableWidth * 0.65],
            vehicleRows,
            {
                header: ['Field', 'Information'],
                align: 'left'
            }
        );
        doc.y = currentY + 16;
        doc.moveDown(8);

        // Transaction summary
        heading('Transaction Summary');

        const transferLabel = transferCost?.inclusion === 'excluded' ? 'Transfer Cost (Excluded)' : 'Transfer Cost (Included)';
        const insuranceLabel = insurance?.inclusion === 'excluded' ? 'Insurance (Excluded)' : 'Insurance (Included)';

        const summaryRows = [
            ['Selling Price', currency(sellingPrice)],
            [transferLabel, currency(transferCost?.amount)],
            [insuranceLabel, currency(insurance?.amount)],
            ['Bank Finance Fee', currency(bankFinanceFee)],
            ['Other Charges', currency(otherCharges)],
            ['Total Payable', currency(totalPayable)]
        ];

        currentY = drawTable(
            doc,
            doc.page.margins.left,
            doc.y,
            [availableWidth * 0.5, availableWidth * 0.5],
            summaryRows,
            {
                header: ['Description', 'Amount (AED)'],
                align: 'center'
            }
        );
        doc.y = currentY + 12;

        doc.font('Helvetica').fontSize(10.5);
        const writeInline = (text) => {
            doc.text(text, leftMargin, doc.y, {
                width: availableWidth,
                align: 'left'
            });
        };

        writeInline(`Payment Mode: ${paymentMode || '________________'}`);
        doc.moveDown(0.2);
        writeInline(`Booking Amount Received: AED ${currency(bookingAmount)}`);
        doc.moveDown(0.2);
        writeInline(`Balance Amount: AED ${currency(balanceAmount)}`);
        doc.moveDown(1);

        // Terms & Conditions
        heading('Terms & Conditions');
        doc.moveDown(0.3);
        doc.font('Helvetica').fontSize(10.5);

        const terms = [
            'The vehicle is sold on an “as-is, where-is” basis. ZRS Cars Trading is not liable for undisclosed mechanical, electrical, or cosmetic issues discovered after delivery.',
            'The booking amount is non-refundable unless ZRS Cars Trading is unable to complete the sale for reasons within its control.',
            'The customer agrees to settle the balance amount before RTA transfer. Delayed payments may incur additional holding or storage charges.',
            'Transfer, insurance, and bank finance arrangements are coordinated as per the selections above. Any third-party fees are payable by the customer.',
            'ZRS Cars Trading reserves the right to cancel this agreement if documentation provided by the customer is incomplete, invalid, or results in financial/legal complications.',
            'By signing below, both parties acknowledge that the information provided is accurate and that the terms of this agreement are accepted in full.'
        ];

        terms.forEach((term, index) => {
            doc.text(`${index + 1}. ${term}`, leftMargin, doc.y, {
                width: availableWidth,
                align: 'left',
                lineGap: 2
            });
            doc.moveDown(0.2);
        });

        // Signatures
        const requiredSignatureHeight = 160;
        const bottomLimit = doc.page.height - doc.page.margins.bottom;
        if (doc.y + requiredSignatureHeight > bottomLimit) {
            doc.addPage();
        }

        const signatureStartY = doc.y + 12;
        const signatureColumnWidth = (availableWidth - 40) / 2;
        const leftX = doc.page.margins.left;
        const rightX = leftX + signatureColumnWidth + 40;

        doc.font('Helvetica-Bold').fontSize(11).text('For ZRS Cars Trading', leftX, signatureStartY, {
            width: signatureColumnWidth
        });
        doc.font('Helvetica').fontSize(10.5).text('Authorized Signatory: _______________________', leftX, signatureStartY + 18, {
            width: signatureColumnWidth
        });
        doc.text('Date: _______________________', leftX, signatureStartY + 38, {
            width: signatureColumnWidth
        });

        doc.font('Helvetica-Bold').fontSize(11).text('Customer (Buyer)', rightX, signatureStartY, {
            width: signatureColumnWidth
        });
        doc.font('Helvetica').fontSize(10.5).text(`Name: ${customerDetails?.name || '________________'}`, rightX, signatureStartY + 18, {
            width: signatureColumnWidth
        });
        doc.text('Signature: _______________________', rightX, signatureStartY + 34, {
            width: signatureColumnWidth
        });
        doc.text('Date: _______________________', rightX, signatureStartY + 50, {
            width: signatureColumnWidth
        });

        try {
            const stampPath = path.join(__dirname, '../templates/assets/stamp.png');
            if (fs.existsSync(stampPath)) {
                doc.image(stampPath, leftX + 10, signatureStartY + 60, { width: 110, opacity: 0.95 });
            }
        } catch (_) {
            // ignore stamp issues
        }

        doc.end();
    });
};


