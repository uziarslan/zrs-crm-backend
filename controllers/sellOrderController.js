const Lead = require('../models/Lead');
const SellOrder = require('../models/SellOrder');
const { generateSellOrderPdf } = require('../services/sellOrderPdfService');
const logger = require('../utils/logger');

const formatUserName = (user) => {
    if (!user) return 'ZRS Admin';
    if (user.name) return user.name;
    if (user.email) return user.email;
    return 'ZRS Admin';
};

const getNextSalesOrderNumber = async () => {
    const lastOrder = await SellOrder.findOne({}, {}, { sort: { createdAt: -1 } });
    let next = 1;
    if (lastOrder?.salesOrderNumber) {
        const match = lastOrder.salesOrderNumber.match(/SO(\d+)/);
        if (match) {
            next = parseInt(match[1], 10) + 1;
        }
    }
    return `SO${String(next).padStart(5, '0')}`;
};

const parseAmount = (value, fallback = 0) => {
    if (value === undefined || value === null || value === '') return fallback;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        throw new Error('Amounts must be positive numbers');
    }
    return numeric;
};

exports.createSellOrder = async (req, res, next) => {
    try {
        const { leadId } = req.params;
        const {
            customerName,
            customerContact,
            customerEmail,
            customerIdDocument,
            customerAddress,
            sellingPrice,
            transferCostInclusion,
            transferCostAmount,
            insuranceInclusion,
            insuranceAmount,
            bankFinanceFee,
            inspectionCost,
            paymentMode,
            bookingAmount
        } = req.body;

        const lead = await Lead.findById(leadId).populate('sellOrder');

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        if (lead.sellOrder) {
            return res.status(400).json({
                success: false,
                message: 'Sell Order already exists for this lead. Please cancel the existing order before creating a new one.'
            });
        }

        const missingFields = [];
        if (!customerName) missingFields.push('customerName');
        if (!customerContact) missingFields.push('customerContact');
        if (!customerIdDocument) missingFields.push('customerIdDocument');
        if (!customerAddress) missingFields.push('customerAddress');
        if (!sellingPrice && sellingPrice !== 0) missingFields.push('sellingPrice');
        if (!paymentMode) missingFields.push('paymentMode');

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missingFields.join(', ')}`
            });
        }

        let parsedSellingPrice;
        let parsedTransferCost;
        let parsedInsurance;
        let parsedBankFinanceFee;
        let parsedInspectionCost;
        let parsedBookingAmount;

        try {
            parsedSellingPrice = parseAmount(sellingPrice);
            parsedTransferCost = parseAmount(transferCostAmount);
            parsedInsurance = parseAmount(insuranceAmount);
            parsedBankFinanceFee = parseAmount(bankFinanceFee);
            parsedInspectionCost = parseAmount(inspectionCost);
            parsedBookingAmount = parseAmount(bookingAmount);
        } catch (err) {
            return res.status(400).json({
                success: false,
                message: err.message
            });
        }

        const totalPayable = parsedSellingPrice + parsedTransferCost + parsedInsurance + parsedBankFinanceFee + parsedInspectionCost;
        const balanceAmount = Math.max(totalPayable - parsedBookingAmount, 0);

        const vehicleInfo = lead.vehicleInfo || {};
        const vehicleSnapshot = {
            make: vehicleInfo.make || '',
            model: vehicleInfo.model || '',
            trim: vehicleInfo.trim || '',
            year: vehicleInfo.year || null,
            mileage: vehicleInfo.mileage || null,
            chassisNo: vehicleInfo.vin || '',
            color: vehicleInfo.color || ''
        };

        const salesOrderNumber = await getNextSalesOrderNumber();

        const pdfBuffer = await generateSellOrderPdf({
            salesOrderNumber,
            orderDate: new Date(),
            preparedByName: formatUserName(req.user),
            customerDetails: {
                name: customerName,
                contact: customerContact,
                email: customerEmail,
                idDocument: customerIdDocument,
                address: customerAddress
            },
            vehicle: vehicleSnapshot,
            sellingPrice: parsedSellingPrice,
            transferCost: {
                inclusion: transferCostInclusion === 'excluded' ? 'excluded' : 'included',
                amount: parsedTransferCost
            },
            insurance: {
                inclusion: insuranceInclusion === 'excluded' ? 'excluded' : 'included',
                amount: parsedInsurance
            },
            bankFinanceFee: parsedBankFinanceFee,
            inspectionCost: parsedInspectionCost,
            totalPayable,
            paymentMode,
            bookingAmount: parsedBookingAmount,
            balanceAmount
        });

        const pdfBase64 = pdfBuffer.toString('base64');

        const sellOrder = await SellOrder.create({
            lead: lead._id,
            salesOrderNumber,
            preparedBy: req.userId,
            preparedByModel: req.userRole === 'manager' ? 'Manager' : 'Admin',
            preparedByName: formatUserName(req.user),
            customerName,
            customerContact,
            customerEmail,
            customerIdDocument,
            customerAddress,
            vehicle: vehicleSnapshot,
            sellingPrice: parsedSellingPrice,
            transferCost: {
                inclusion: transferCostInclusion === 'excluded' ? 'excluded' : 'included',
                amount: parsedTransferCost
            },
            insurance: {
                inclusion: insuranceInclusion === 'excluded' ? 'excluded' : 'included',
                amount: parsedInsurance
            },
            bankFinanceFee: parsedBankFinanceFee,
            inspectionCost: parsedInspectionCost,
            totalPayable,
            paymentMode,
            bookingAmount: parsedBookingAmount,
            balanceAmount,
            pdfContent: pdfBase64,
            pdfSize: pdfBuffer.length
        });

        lead.sellOrder = sellOrder._id;
        await lead.save();

        const downloadPath = `/api/v1/sell-order/${sellOrder._id}/download`;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const absoluteDownloadUrl = `${baseUrl}${downloadPath}`;

        logger.info(`Sell Order ${sellOrder.salesOrderNumber} generated for lead ${lead.leadId}`);

        return res.status(201).json({
            success: true,
            message: 'Sell Order generated successfully',
            sellOrder: {
                id: sellOrder._id,
                salesOrderNumber: sellOrder.salesOrderNumber
            },
            downloadUrl: absoluteDownloadUrl
        });
    } catch (error) {
        logger.error('Create Sell Order error:', error);
        return next(error);
    }
};

exports.downloadSellOrder = async (req, res, next) => {
    try {
        const { orderId } = req.params;
        const sellOrder = await SellOrder.findById(orderId);

        if (!sellOrder) {
            return res.status(404).json({
                success: false,
                message: 'Sell Order not found'
            });
        }

        if (!sellOrder.pdfContent) {
            return res.status(404).json({
                success: false,
                message: 'Sell Order PDF is not available'
            });
        }

        const fileName = `${sellOrder.salesOrderNumber || 'Sales_Order'}.pdf`;
        res.setHeader('Content-Type', sellOrder.pdfMimeType || 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        const pdfBuffer = Buffer.from(sellOrder.pdfContent, 'base64');
        return res.send(pdfBuffer);
    } catch (error) {
        logger.error('Download Sell Order error:', error);
        return next(error);
    }
};

exports.deleteSellOrder = async (req, res, next) => {
    try {
        const { leadId } = req.params;
        const lead = await Lead.findById(leadId);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        if (!lead.sellOrder) {
            return res.status(400).json({
                success: false,
                message: 'No Sell Order is attached to this lead'
            });
        }

        await SellOrder.findByIdAndDelete(lead.sellOrder);
        lead.sellOrder = null;
        await lead.save();

        logger.info(`Sell Order removed for lead ${lead.leadId}`);

        return res.status(200).json({
            success: true,
            message: 'Sell Order cancelled successfully'
        });
    } catch (error) {
        logger.error('Delete Sell Order error:', error);
        return next(error);
    }
};


