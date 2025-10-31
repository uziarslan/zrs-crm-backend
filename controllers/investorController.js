const Investor = require('../models/Investor');
const InvestorSOA = require('../models/InvestorSOA');
const Lead = require('../models/Lead');
const Sale = require('../models/Sale');
const PurchaseOrder = require('../models/PurchaseOrder');
const logger = require('../utils/logger');
const { logInvestor } = require('../utils/auditLogger');

/**
 * @desc    Get investor Statement of Accounts (SOA)
 * @route   GET /api/v1/investors/:id/soa
 * @access  Private (Admin, or Investor viewing their own)
 */
exports.getInvestorSOA = async (req, res, next) => {
    try {
        const investorId = req.params.id;

        // Investors can only view their own SOA
        if (req.userRole === 'investor' && investorId !== req.userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const investor = await Investor.findById(investorId);

        if (!investor) {
            return res.status(404).json({
                success: false,
                message: 'Investor not found'
            });
        }

        // Get all investments
        const investments = [];
        for (const investment of investor.investments) {
            const lead = await Lead.findById(investment.leadId);
            let sale = null;

            if (lead && lead.status === 'sold') {
                sale = await Sale.findOne({ leadId: lead._id });
            }

            investments.push({
                leadId: lead?._id,
                vehicleId: lead?.leadId, // Use leadId for compatibility
                vehicleDetails: lead ? `${lead.vehicleInfo?.make} ${lead.vehicleInfo?.model} ${lead.vehicleInfo?.year}` : 'N/A',
                // Full vehicle information
                vehicleInfo: lead ? {
                    make: lead.vehicleInfo?.make,
                    model: lead.vehicleInfo?.model,
                    year: lead.vehicleInfo?.year,
                    trim: lead.vehicleInfo?.trim,
                    color: lead.vehicleInfo?.color,
                    region: lead.vehicleInfo?.region,
                    mileage: lead.vehicleInfo?.mileage,
                    vin: lead.vehicleInfo?.vin,
                    askingPrice: lead.vehicleInfo?.askingPrice,
                    purchasePrice: lead.priceAnalysis?.purchasedFinalPrice,
                    minSellingPrice: lead.priceAnalysis?.minSellingPrice,
                    maxSellingPrice: lead.priceAnalysis?.maxSellingPrice
                } : null,
                images: lead?.attachments?.filter(a => a.category === 'carPictures').map(img => ({
                    url: img.url,
                    publicId: img.publicId
                })) || [],
                investmentDate: investment.date,
                investmentAmount: investment.amount,
                investmentPercentage: investment.percentage,
                status: investment.status,
                saleDate: sale?.createdAt,
                saleAmount: sale?.sellingPrice,
                profitAmount: sale?.investorBreakdown?.find(b => b.investorId.toString() === investorId)?.profitAmount,
                profitPercentage: sale?.investorBreakdown?.find(b => b.investorId.toString() === investorId)?.profitPercentage,
                totalReturn: sale?.investorBreakdown?.find(b => b.investorId.toString() === investorId)?.totalPayout
            });
        }

        // Calculate summary
        const totalActiveInvestments = investments.filter(i => i.status === 'active').length;
        const totalSettledInvestments = investments.filter(i => i.status === 'settled').length;
        const totalProfit = investments.reduce((sum, i) => sum + (i.profitAmount || 0), 0);
        const totalInvestmentAmount = investments.reduce((sum, i) => sum + i.investmentAmount, 0);
        const averageROI = totalInvestmentAmount > 0 ? (totalProfit / totalInvestmentAmount) * 100 : 0;

        const soaData = {
            investor: {
                id: investor._id,
                name: investor.name,
                email: investor.email
            },
            creditLimit: investor.creditLimit,
            utilizedAmount: investor.utilizedAmount,
            remainingCredit: investor.remainingCredit,
            investments,
            summary: {
                totalActiveInvestments,
                totalSettledInvestments,
                totalProfit,
                averageROI
            }
        };

        res.status(200).json({
            success: true,
            data: soaData
        });
    } catch (error) {
        logger.error('Get investor SOA error:', error);
        next(error);
    }
};

/**
 * @desc    Get investor's inventory (vehicles they invested in)
 * @route   GET /api/v1/investors/:id/inventory
 * @access  Private (Admin, or Investor viewing their own)
 */
exports.getInvestorInventory = async (req, res, next) => {
    try {
        const investorId = req.params.id;

        // Investors can only view their own inventory
        if (req.userRole === 'investor' && investorId !== req.userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const investor = await Investor.findById(investorId);
        if (!investor) {
            return res.status(404).json({
                success: false,
                message: 'Investor not found'
            });
        }

        const leads = await Lead.find({
            status: 'inventory',
            investor: investorId
        }).populate('investor', 'name email');

        const inventory = leads.map(lead => {
            // Find investment for this lead
            const investment = investor.investments.find(
                inv => inv.leadId && inv.leadId.toString() === lead._id.toString()
            );

            return {
                vehicleId: lead.leadId,
                make: lead.vehicleInfo?.make,
                model: lead.vehicleInfo?.model,
                year: lead.vehicleInfo?.year,
                status: lead.status,
                purchasePrice: lead.priceAnalysis?.purchasedFinalPrice,
                sellingPrice: null,
                investmentAmount: investment?.amount,
                investmentPercentage: investment?.percentage || 100,
                images: (lead.attachments || []).filter(a => a.category === 'carPictures').map(img => ({
                    url: img.url,
                    publicId: img.publicId
                }))
            };
        });

        res.status(200).json({
            success: true,
            count: inventory.length,
            data: inventory
        });
    } catch (error) {
        logger.error('Get investor inventory error:', error);
        next(error);
    }
};

/**
 * @desc    Get all investors (Admin only)
 * @route   GET /api/v1/investors
 * @access  Private (Admin only)
 */
exports.getAllInvestors = async (req, res, next) => {
    try {
        const investors = await Investor.find()
            .select('-otpMeta -inviteToken -inviteTokenExpiry')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: investors.length,
            data: investors
        });
    } catch (error) {
        logger.error('Get all investors error:', error);
        next(error);
    }
};

/**
 * @desc    Update investor credit limit (Admin only)
 * @route   PUT /api/v1/investors/:id/credit-limit
 * @access  Private (Admin only)
 */
exports.updateCreditLimit = async (req, res, next) => {
    try {
        const { creditLimit } = req.body;

        const investor = await Investor.findById(req.params.id);

        if (!investor) {
            return res.status(404).json({
                success: false,
                message: 'Investor not found'
            });
        }

        // Check if new limit is less than utilized amount
        if (creditLimit < investor.utilizedAmount) {
            return res.status(400).json({
                success: false,
                message: `Credit limit cannot be less than utilized amount (${investor.utilizedAmount})`
            });
        }

        const oldLimit = investor.creditLimit;
        investor.creditLimit = creditLimit;
        await investor.save();

        logger.info(`Credit limit updated for investor ${investor.email} to ${creditLimit}`);

        // Audit log - HIGH severity for financial changes
        await logInvestor(req, 'credit_limit_updated',
            `Updated credit limit for ${investor.name} from AED ${oldLimit.toLocaleString()} to AED ${creditLimit.toLocaleString()}`,
            investor, {
            oldLimit,
            newLimit: creditLimit,
            difference: creditLimit - oldLimit
        }
        );

        res.status(200).json({
            success: true,
            message: 'Credit limit updated successfully',
            data: investor
        });
    } catch (error) {
        logger.error('Update credit limit error:', error);
        next(error);
    }
};

/**
 * @desc    Generate and email SOA report for investor
 * @route   POST /api/v1/investors/:id/generate-soa
 * @access  Private (Admin only)
 */
exports.generateSOA = async (req, res, next) => {
    try {
        const investorId = req.params.id;
        const { periodStart, periodEnd } = req.body;

        const investor = await Investor.findById(investorId);

        if (!investor) {
            return res.status(404).json({
                success: false,
                message: 'Investor not found'
            });
        }

        // Get transactions within period
        const purchases = await PurchaseOrder.find({
            'investorAllocations.investorId': investorId,
            createdAt: { $gte: new Date(periodStart), $lte: new Date(periodEnd) }
        }).populate('vehicleId');

        const sales = await Sale.find({
            'investorBreakdown.investorId': investorId,
            createdAt: { $gte: new Date(periodStart), $lte: new Date(periodEnd) }
        }).populate('vehicleId');

        const transactions = [];
        let balance = 0;

        // Add purchase transactions
        for (const po of purchases) {
            const allocation = po.investorAllocations.find(
                a => a.investorId.toString() === investorId
            );
            if (allocation) {
                balance += allocation.amount;
                transactions.push({
                    date: po.createdAt,
                    type: 'investment',
                    description: `Investment in ${po.vehicleId?.vehicleId || 'vehicle'}`,
                    vehicleId: po.vehicleId?._id,
                    purchaseOrderId: po._id,
                    debit: allocation.amount,
                    credit: 0,
                    balance
                });
            }
        }

        // Add sale transactions
        for (const sale of sales) {
            const breakdown = sale.investorBreakdown.find(
                b => b.investorId.toString() === investorId
            );
            if (breakdown) {
                balance -= breakdown.totalPayout;
                transactions.push({
                    date: sale.createdAt,
                    type: 'return',
                    description: `Return from ${sale.vehicleId?.vehicleId || 'vehicle'} sale`,
                    vehicleId: sale.vehicleId?._id,
                    saleId: sale._id,
                    debit: 0,
                    credit: breakdown.totalPayout,
                    balance
                });
            }
        }

        // Create SOA document
        const soa = await InvestorSOA.create({
            investorId,
            periodStart: new Date(periodStart),
            periodEnd: new Date(periodEnd),
            creditLimit: investor.creditLimit,
            utilizedAmount: investor.utilizedAmount,
            remainingCredit: investor.remainingCredit,
            transactions: transactions.sort((a, b) => a.date - b.date),
            generatedBy: req.userId
        });

        logger.info(`SOA ${soa.soaId} generated for investor ${investor.email}`);

        res.status(201).json({
            success: true,
            message: 'SOA generated successfully',
            data: soa
        });
    } catch (error) {
        logger.error('Generate SOA error:', error);
        next(error);
    }
};

module.exports = exports;

