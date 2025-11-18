const Lead = require('../models/Lead');
const SellOrder = require('../models/SellOrder');
const SellInvoice = require('../models/SellInvoice');
const Investor = require('../models/Investor');
const { generateSellInvoicePdf } = require('../services/sellInvoicePdfService');
const logger = require('../utils/logger');

const formatUserName = (user) => {
    if (!user) return 'ZRS Admin';
    if (user.name) return user.name;
    if (user.email) return user.email;
    return 'ZRS Admin';
};

const getNextInvoiceNumber = async () => {
    const lastInvoice = await SellInvoice.findOne({}, {}, { sort: { createdAt: -1 } });
    let next = 1;
    if (lastInvoice?.invoiceNumber) {
        const match = lastInvoice.invoiceNumber.match(/INV(\d+)/);
        if (match) {
            next = parseInt(match[1], 10) + 1;
        }
    }
    return `INV${String(next).padStart(5, '0')}`;
};

const parseAmount = (value, fallback = 0) => {
    if (value === undefined || value === null || value === '') return fallback;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        throw new Error('Amounts must be positive numbers');
    }
    return numeric;
};

const roundToCurrency = (num) => {
    return Math.round((num + Number.EPSILON) * 100) / 100;
};

exports.createSellInvoice = async (req, res, next) => {
    try {
        const { leadId } = req.params;
        const {
            balancePaymentReceived,
            paymentMode
        } = req.body;

        const lead = await Lead.findById(leadId)
            .populate('sellOrder')
            .populate('investorAllocations.investorId');

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        if (!lead.sellOrder) {
            return res.status(400).json({
                success: false,
                message: 'Sell Order must be generated before creating an invoice'
            });
        }

        if (lead.sellInvoice) {
            return res.status(400).json({
                success: false,
                message: 'Sell Invoice already exists for this lead'
            });
        }

        if (lead.status === 'sold') {
            return res.status(400).json({
                success: false,
                message: 'This vehicle has already been marked as sold'
            });
        }

        let sellOrder = lead.sellOrder;
        if (!sellOrder || (typeof sellOrder === 'object' && !sellOrder._id)) {
            // Need to fetch
            sellOrder = await SellOrder.findById(lead.sellOrder);
            if (!sellOrder) {
                return res.status(404).json({
                    success: false,
                    message: 'Sell Order not found'
                });
            }
        }

        // Automatically set receivedBy to the logged-in user
        const receivedBy = formatUserName(req.user);
        // Automatically set dateOfFinalPayment to current date
        const dateOfFinalPayment = new Date();

        let parsedBalancePayment;
        try {
            parsedBalancePayment = parseAmount(balancePaymentReceived);
        } catch (err) {
            return res.status(400).json({
                success: false,
                message: err.message
            });
        }

        const bookingAmount = sellOrder.bookingAmount || 0;
        const totalAmountReceived = bookingAmount + parsedBalancePayment;

        // Calculate total cost (purchase price + all job costing)
        const purchasedFinalPrice = lead.priceAnalysis?.purchasedFinalPrice || 0;
        const jobCosting = lead.jobCosting || {};
        const totalCost = purchasedFinalPrice +
            (jobCosting.transferCost || 0) +
            (jobCosting.detailing_inspection_cost || 0) +
            (jobCosting.agent_commision || 0) +
            (jobCosting.car_recovery_cost || 0) +
            (jobCosting.other_charges || 0);

        // Calculate total profit
        const sellingPrice = sellOrder.sellingPrice;
        const totalProfit = sellingPrice - totalCost;

        // Calculate profit breakdown based on lead type
        const investorBreakdown = [];
        let totalInvestorProfit = 0;
        let ownerProfit = 0;
        let zrsProfit = 0;

        if (lead.type === 'consignment') {
            // For consignment: Total Cost goes to owner, remainder is ZRS profit
            ownerProfit = roundToCurrency(totalCost);
            zrsProfit = roundToCurrency(totalProfit); // All profit goes to ZRS (sellingPrice - totalCost)

            logger.info(`Consignment lead ${lead.leadId}. Owner Profit: ${ownerProfit}, ZRS Profit: ${zrsProfit}, Total Profit: ${totalProfit}`);
        } else {
            // For purchase: Calculate investor breakdown based on profit percentage
            logger.info(`Calculating profits for purchase lead ${lead.leadId}. Total Profit: ${totalProfit}, Investor Allocations: ${lead.investorAllocations?.length || 0}`);

            if (lead.investorAllocations && lead.investorAllocations.length > 0) {
                for (const allocation of lead.investorAllocations) {
                    const investorId = allocation.investorId?._id || allocation.investorId;
                    const ownershipPercentage = allocation.ownershipPercentage || allocation.percentage || 0;
                    const investmentAmount = allocation.amount || 0;
                    const profitPercentage = allocation.profitPercentage || 0; // Use profitPercentage from allocation

                    // Calculate investor's share of profit based on profit percentage (NOT ownership percentage)
                    const profitAmount = roundToCurrency((totalProfit * profitPercentage) / 100);
                    const profitPercentageOnInvestment = investmentAmount > 0
                        ? roundToCurrency((profitAmount / investmentAmount) * 100)
                        : 0;
                    const totalPayout = roundToCurrency(investmentAmount + profitAmount);

                    logger.info(`Investor ${investorId}: Ownership ${ownershipPercentage}%, Profit % ${profitPercentage}%, Investment ${investmentAmount}, Profit Amount ${profitAmount}`);

                    investorBreakdown.push({
                        investorId,
                        investmentAmount,
                        ownershipPercentage,
                        profitAmount,
                        profitPercentage: profitPercentageOnInvestment, // This is profit % on investment
                        totalPayout
                    });

                    totalInvestorProfit += profitAmount;
                }
            } else {
                logger.info(`No investor allocations found for lead ${lead.leadId}`);
            }

            // Calculate ZRS profit (showroom profit) = Total Profit - Investor Profit
            zrsProfit = roundToCurrency(totalProfit - totalInvestorProfit);

            logger.info(`Profit Summary - Total: ${totalProfit}, Investor Total: ${totalInvestorProfit}, ZRS: ${zrsProfit}`);
        }

        // Generate invoice number
        const invoiceNumber = await getNextInvoiceNumber();

        // Prepare PDF data
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

        // Get transfer cost and insurance amounts (not inclusion status for invoice)
        const transferCostAmount = sellOrder.transferCost?.amount || 0;
        const insuranceAmount = sellOrder.insurance?.amount || 0;

        const pdfBuffer = await generateSellInvoicePdf({
            invoiceNumber,
            invoiceDate: new Date(),
            preparedByName: formatUserName(req.user),
            salesOrderNumber: sellOrder.salesOrderNumber,
            customerDetails: {
                name: sellOrder.customerName,
                contact: sellOrder.customerContact,
                email: sellOrder.customerEmail,
                idDocument: sellOrder.customerIdDocument,
                address: sellOrder.customerAddress
            },
            vehicle: vehicleSnapshot,
            sellingPrice,
            transferCost: transferCostAmount,
            insurance: insuranceAmount,
            bankFinanceFee: sellOrder.bankFinanceFee || 0,
            otherCharges: sellOrder.otherCharges || 0,
            totalInvoiceValue: sellOrder.totalPayable,
            paymentMode: paymentMode || sellOrder.paymentMode,
            bookingAmountReceived: bookingAmount,
            balancePaymentReceived: parsedBalancePayment,
            totalAmountReceived,
            dateOfFinalPayment,
            receivedBy
        });

        const pdfBase64 = pdfBuffer.toString('base64');

        // Create SellInvoice record
        const sellInvoice = await SellInvoice.create({
            lead: lead._id,
            sellOrder: sellOrder._id,
            invoiceNumber,
            preparedBy: req.userId,
            preparedByModel: req.userRole === 'manager' ? 'Manager' : 'Admin',
            preparedByName: formatUserName(req.user),
            salesOrderNumber: sellOrder.salesOrderNumber,
            customerName: sellOrder.customerName,
            customerContact: sellOrder.customerContact,
            customerEmail: sellOrder.customerEmail,
            customerIdDocument: sellOrder.customerIdDocument,
            customerAddress: sellOrder.customerAddress,
            vehicle: vehicleSnapshot,
            sellingPrice,
            transferCost: transferCostAmount,
            insurance: insuranceAmount,
            bankFinanceFee: sellOrder.bankFinanceFee || 0,
            otherCharges: sellOrder.otherCharges || 0,
            totalInvoiceValue: sellOrder.totalPayable,
            paymentMode: paymentMode || sellOrder.paymentMode,
            bookingAmountReceived: bookingAmount,
            balancePaymentReceived: parsedBalancePayment,
            totalAmountReceived,
            dateOfFinalPayment,
            receivedBy,
            purchasePrice: purchasedFinalPrice,
            totalCost,
            totalProfit,
            zrsProfit,
            ownerProfit,
            investorBreakdown,
            pdfContent: pdfBase64,
            pdfSize: pdfBuffer.length
        });

        // Update lead: mark as sold, save soldPrice, and link invoice
        lead.status = 'sold';
        lead.soldPrice = sellingPrice;
        lead.sellInvoice = sellInvoice._id;
        await lead.save();

        // Update investor utilized amounts (reduce by their investment amount since car is sold)
        for (const breakdown of investorBreakdown) {
            const investor = await Investor.findById(breakdown.investorId);
            if (investor) {
                investor.utilizedAmount = Math.max(0, (investor.utilizedAmount || 0) - breakdown.investmentAmount);
                await investor.save();
            }
        }

        const downloadPath = `/api/v1/sell-invoice/${sellInvoice._id}/download`;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const absoluteDownloadUrl = `${baseUrl}${downloadPath}`;

        logger.info(`Sell Invoice ${sellInvoice.invoiceNumber} generated for lead ${lead.leadId}. Total Profit: AED ${totalProfit}, ZRS Profit: AED ${zrsProfit}, Investor Profit: AED ${totalInvestorProfit}, Investor Count: ${investorBreakdown.length}`);

        return res.status(201).json({
            success: true,
            message: 'Sell Invoice generated successfully. Vehicle marked as sold.',
            sellInvoice: {
                id: sellInvoice._id,
                invoiceNumber: sellInvoice.invoiceNumber
            },
            profitSummary: {
                totalProfit: roundToCurrency(totalProfit),
                zrsProfit: roundToCurrency(zrsProfit),
                investorBreakdown: investorBreakdown.map(b => ({
                    investorId: b.investorId,
                    profitAmount: b.profitAmount,
                    totalPayout: b.totalPayout
                }))
            },
            downloadUrl: absoluteDownloadUrl
        });
    } catch (error) {
        logger.error('Create Sell Invoice error:', error);
        return next(error);
    }
};

exports.downloadSellInvoice = async (req, res, next) => {
    try {
        const { invoiceId } = req.params;
        const sellInvoice = await SellInvoice.findById(invoiceId);

        if (!sellInvoice) {
            return res.status(404).json({
                success: false,
                message: 'Sell Invoice not found'
            });
        }

        if (!sellInvoice.pdfContent) {
            return res.status(404).json({
                success: false,
                message: 'Sell Invoice PDF is not available'
            });
        }

        const fileName = `${sellInvoice.invoiceNumber || 'Sales_Invoice'}.pdf`;
        res.setHeader('Content-Type', sellInvoice.pdfMimeType || 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        const pdfBuffer = Buffer.from(sellInvoice.pdfContent, 'base64');
        return res.send(pdfBuffer);
    } catch (error) {
        logger.error('Download Sell Invoice error:', error);
        return next(error);
    }
};

