const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const currency = (value = 0) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return '0.00';
    return amount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const contentWidth = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const leftMargin = (doc) => doc.page.margins.left;

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

exports.generateSellInvoicePdf = async (data) => {
    const {
        invoiceNumber,
        invoiceDate,
        preparedByName,
        salesOrderNumber,
        customerDetails,
        vehicle,
        sellingPrice,
        transferCost,
        insurance,
        bankFinanceFee,
        otherCharges,
        totalInvoiceValue,
        paymentMode,
        bookingAmountReceived,
        balancePaymentReceived,
        totalAmountReceived,
        dateOfFinalPayment,
        receivedBy
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

        // Main heading
        doc.font('Helvetica-Bold')
            .fontSize(16)
            .text('SALES INVOICE (Customer Copy)', leftMargin(doc), doc.y, {
                width: availableWidth,
                align: 'center'
            });
        doc.moveDown(0.8);

        // Invoice metadata
        const metaY = doc.y;
        const halfWidth = availableWidth / 2;
        const formattedDate = new Date(invoiceDate || Date.now()).toLocaleDateString('en-GB');

        doc.font('Helvetica-Bold')
            .fontSize(11)
            .text(`Invoice No: ${invoiceNumber || ''}`, leftMargin(doc), metaY, {
                width: halfWidth,
                align: 'left'
            });
        doc.font('Helvetica-Bold')
            .fontSize(11)
            .text(`Date: ${formattedDate}`, leftMargin(doc) + halfWidth, metaY, {
                width: halfWidth,
                align: 'right'
            });
        doc.moveDown(0.2);
        doc.font('Helvetica')
            .fontSize(10.5)
            .text(`Prepared By: ${preparedByName || '________________'}`, leftMargin(doc), doc.y, {
                width: availableWidth,
                align: 'left'
            });
        doc.moveDown(0.2);
        doc.font('Helvetica')
            .fontSize(10.5)
            .text(`Sales Order No: ${salesOrderNumber || '________________'}`, leftMargin(doc), doc.y, {
                width: availableWidth,
                align: 'left'
            });
        doc.moveDown(1);

        // Helper function for section headings
        const heading = (text) => {
            doc.font('Helvetica-Bold')
                .fontSize(12)
                .text(text, leftMargin(doc), doc.y, {
                    width: availableWidth,
                    align: 'left'
                });
            doc.moveDown(0.3);
        };

        // Customer Details
        heading('Customer Details');

        const customerRows = [
            ['Customer Name', customerDetails?.name || ''],
            ['Contact Number', customerDetails?.contact || ''],
            ['Email Address', customerDetails?.email || ''],
            ['Emirates ID / Passport No.', customerDetails?.idDocument || ''],
            ['Address', customerDetails?.address || '']
        ];

        let currentY = drawTable(
            doc,
            leftMargin(doc),
            doc.y,
            [availableWidth * 0.35, availableWidth * 0.65],
            customerRows,
            {
                header: ['Field', 'Information'],
                align: 'left'
            }
        );
        doc.y = currentY + 16;

        // Vehicle Details
        heading('Vehicle Details');

        const vehicleRows = [
            ['Car Make', vehicle?.make || ''],
            ['Car Model', vehicle?.model || ''],
            ['Trim', vehicle?.trim || ''],
            ['Year Model', vehicle?.year ? String(vehicle.year) : ''],
            ['Chassis No.', vehicle?.chassisNo || ''],
            ['Mileage', vehicle?.mileage ? `${vehicle.mileage.toLocaleString()} km` : ''],
            ['Color', vehicle?.color || '']
        ];

        currentY = drawTable(
            doc,
            leftMargin(doc),
            doc.y,
            [availableWidth * 0.35, availableWidth * 0.65],
            vehicleRows,
            {
                header: ['Field', 'Information'],
                align: 'left'
            }
        );
        doc.y = currentY + 16;

        // Invoice Summary
        heading('Invoice Summary');

        const summaryRows = [
            ['Selling Price', currency(sellingPrice)],
            ['Transfer Cost (RTA)', currency(transferCost)],
            ['Insurance Assistance (if any)', currency(insurance)],
            ['Bank Finance Fee (if applicable)', currency(bankFinanceFee)],
            ['Other Charges (if any)', currency(otherCharges)],
            ['Total Invoice Value', currency(totalInvoiceValue)]
        ];

        currentY = drawTable(
            doc,
            leftMargin(doc),
            doc.y,
            [availableWidth * 0.6, availableWidth * 0.4],
            summaryRows,
            {
                header: ['Description', 'Amount (AED)'],
                align: 'left'
            }
        );
        doc.y = currentY + 16;

        // Payment Details
        heading('Payment Details');

        const paymentRows = [
            ['Mode of Payment', paymentMode || '________________'],
            ['Booking Amount Received', currency(bookingAmountReceived)],
            ['Balance Payment Received', currency(balancePaymentReceived)],
            ['Date of Final Payment', dateOfFinalPayment ? new Date(dateOfFinalPayment).toLocaleDateString('en-GB') : formattedDate],
            ['Received By', receivedBy || '________________']
        ];

        currentY = drawTable(
            doc,
            leftMargin(doc),
            doc.y,
            [availableWidth * 0.5, availableWidth * 0.5],
            paymentRows,
            {
                header: ['Field', 'Information'],
                align: 'left'
            }
        );
        doc.y = currentY + 12;

        // Total Amount Received
        doc.font('Helvetica-Bold')
            .fontSize(12)
            .text(`Total Amount Received: AED ${currency(totalAmountReceived)}`, leftMargin(doc), doc.y, {
                width: availableWidth,
                align: 'left'
            });
        doc.moveDown(1.5);

        // Notes & Declaration
        heading('Notes & Declaration');
        doc.font('Helvetica').fontSize(10.5);

        const notes = [
            'This invoice serves as proof of full payment for the above-mentioned vehicle.',
            'The vehicle ownership will be transferred through RTA to the customer upon issuance of this invoice.',
            'The customer confirms that the vehicle has been inspected and accepted in satisfactory condition.',
            'ZRS Cars Trading certifies that the sale was conducted transparently, and all details mentioned are accurate to the best of our knowledge.',
            'Any after-sale claims related to maintenance or performance are subject to manufacturer or third-party warranty (if applicable).',
            'This invoice is issued under ZRS Cars Trading\'s valid trade license and TRN registration in Dubai, UAE.'
        ];

        notes.forEach((note, index) => {
            doc.text(`${index + 1}. ${note}`, leftMargin(doc), doc.y, {
                width: availableWidth,
                align: 'left',
                lineGap: 2
            });
            doc.moveDown(0.2);
        });

        doc.moveDown(1);

        // Acknowledgment
        heading('Acknowledgment');
        doc.font('Helvetica').fontSize(10.5);
        doc.text('Both parties confirm that the above payment details are accurate and complete.', leftMargin(doc), doc.y, {
            width: availableWidth,
            align: 'left'
        });
        doc.moveDown(1);

        // Signatures
        const requiredSignatureHeight = 100;
        const bottomLimit = doc.page.height - doc.page.margins.bottom;
        if (doc.y + requiredSignatureHeight > bottomLimit) {
            doc.addPage();
        }

        const signatureStartY = doc.y + 12;
        const signatureColumnWidth = (availableWidth - 40) / 2;
        const leftX = leftMargin(doc);
        const rightX = leftX + signatureColumnWidth + 40;

        doc.font('Helvetica-Bold').fontSize(11).text('For ZRS Cars Trading', leftX, signatureStartY, {
            width: signatureColumnWidth
        });
        doc.font('Helvetica').fontSize(10.5).text('Authorized Signatory: _______________________', leftX, signatureStartY + 18, {
            width: signatureColumnWidth
        });
        doc.text('ZRS Cars Trading – DIP 1, Dubai', leftX, signatureStartY + 38, {
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

