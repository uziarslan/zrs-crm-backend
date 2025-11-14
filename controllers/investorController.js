const Investor = require('../models/Investor');
const InvestorSOA = require('../models/InvestorSOA');
const InvestorAgreement = require('../models/InvestorAgreement');
const Admin = require('../models/Admin');
const Lead = require('../models/Lead');
const Sale = require('../models/Sale');
const PurchaseOrder = require('../models/PurchaseOrder');
const logger = require('../utils/logger');
const { logInvestor, logUserManagement } = require('../utils/auditLogger');
const { sendMailtrapEmail } = require('../services/mailtrapService');
const { generateInviteToken } = require('../utils/otpHelper');
const docusignService = require('../services/docusignService');

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
            'investorAllocations.investorId': investorId
        }).populate('investorAllocations.investorId', 'name email');

        const inventory = leads.map(lead => {
            // Find investment for this lead
            const investment = investor.investments.find(
                inv => inv.leadId && inv.leadId.toString() === lead._id.toString()
            );
            const allocation = (lead.investorAllocations || []).find(
                alloc => alloc.investorId && alloc.investorId.toString() === investorId
            );

            return {
                vehicleId: lead.leadId,
                make: lead.vehicleInfo?.make,
                model: lead.vehicleInfo?.model,
                year: lead.vehicleInfo?.year,
                status: lead.status,
                purchasePrice: lead.priceAnalysis?.purchasedFinalPrice,
                sellingPrice: null,
                investmentAmount: allocation?.amount ?? investment?.amount,
                investmentPercentage: allocation?.percentage ?? investment?.percentage ?? 100,
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
            .sort({ createdAt: -1 })
            .lean();

        // Get all investor agreements to map status
        const investorAgreements = await InvestorAgreement.find({})
            .select('investorId envelopeId status docuSignStatus completedAt signedDocuments')
            .lean();

        const agreementMap = new Map();
        investorAgreements.forEach(agreement => {
            const investorIdStr = agreement.investorId?.toString() || agreement.investorId;
            if (investorIdStr && !agreementMap.has(investorIdStr)) {
                agreementMap.set(investorIdStr, {
                    envelopeId: agreement.envelopeId,
                    status: agreement.status,
                    docuSignStatus: agreement.docuSignStatus,
                    completedAt: agreement.completedAt,
                    hasDocuments: agreement.signedDocuments && agreement.signedDocuments.length > 0
                });
            }
        });

        const normalizedInvestors = investors.map((investor) => {
            const legacyPercentage = typeof investor.decidedPercentage === 'number'
                ? investor.decidedPercentage
                : null;

            let min = typeof investor.decidedPercentageMin === 'number'
                ? investor.decidedPercentageMin
                : null;
            let max = typeof investor.decidedPercentageMax === 'number'
                ? investor.decidedPercentageMax
                : null;

            if (min === null && legacyPercentage !== null) {
                min = legacyPercentage;
            }

            if (max === null && legacyPercentage !== null) {
                max = legacyPercentage;
            }

            if (min === null && max !== null) {
                min = max;
            }

            if (max === null && min !== null) {
                max = min;
            }

            if (typeof min === 'number' && typeof max === 'number' && min > max) {
                const temp = min;
                min = max;
                max = temp;
            }

            const investorIdStr = investor._id.toString();
            const agreement = agreementMap.get(investorIdStr);

            return {
                ...investor,
                decidedPercentageMin: typeof min === 'number' ? min : 0,
                decidedPercentageMax: typeof max === 'number' ? max : (typeof min === 'number' ? min : 0),
                agreement: agreement || null
            };
        });

        res.status(200).json({
            success: true,
            count: normalizedInvestors.length,
            data: normalizedInvestors
        });
    } catch (error) {
        logger.error('Get all investors error:', error);
        next(error);
    }
};

/**
 * @desc    Create new investor (Admin only)
 * @route   POST /api/v1/investors
 * @access  Private (Admin only)
 */
exports.createInvestor = async (req, res, next) => {
    try {
        const {
            name,
            email,
            creditLimit,
            decidedPercentageMin,
            decidedPercentageMax,
            decidedPercentage,
            status,
            investorEid,
            adminDesignation
        } = req.body;
        const allowedStatuses = ['invited', 'active', 'inactive'];

        if (!name || !email) {
            return res.status(400).json({
                success: false,
                message: 'Name and email are required'
            });
        }

        if (!investorEid) {
            return res.status(400).json({
                success: false,
                message: 'Investor Emirates ID is required'
            });
        }

        // Get admin info - always fetch fresh from database
        const admin = await Admin.findById(req.userId);
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Admin not found'
            });
        }

        // Check if admin has designation, if not require it from request
        let finalAdminDesignation = admin.designation;
        if (!finalAdminDesignation || finalAdminDesignation.trim() === '') {
            if (!adminDesignation || adminDesignation.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Admin designation is required. Please provide designation.'
                });
            }
            // Save designation to admin
            admin.designation = adminDesignation.trim();
            await admin.save();
            // Refresh admin from database to ensure we have the latest data
            const refreshedAdmin = await Admin.findById(req.userId);
            finalAdminDesignation = refreshedAdmin.designation;
            logger.info(`Admin ${admin.email} designation saved: ${finalAdminDesignation}`);
        }

        const parsedCreditLimit = Number(creditLimit);
        if (Number.isNaN(parsedCreditLimit) || parsedCreditLimit < 0) {
            return res.status(400).json({
                success: false,
                message: 'Credit limit must be a non-negative number'
            });
        }

        let parsedDecidedPercentageMin = decidedPercentageMin !== undefined && decidedPercentageMin !== null
            ? Number(decidedPercentageMin)
            : undefined;
        let parsedDecidedPercentageMax = decidedPercentageMax !== undefined && decidedPercentageMax !== null
            ? Number(decidedPercentageMax)
            : undefined;

        if (parsedDecidedPercentageMin === undefined && parsedDecidedPercentageMax === undefined && decidedPercentage !== undefined) {
            const fallback = Number(decidedPercentage);
            parsedDecidedPercentageMin = fallback;
            parsedDecidedPercentageMax = fallback;
        }

        if (parsedDecidedPercentageMin === undefined) parsedDecidedPercentageMin = 0;
        if (parsedDecidedPercentageMax === undefined) parsedDecidedPercentageMax = parsedDecidedPercentageMin;

        if (
            Number.isNaN(parsedDecidedPercentageMin) ||
            Number.isNaN(parsedDecidedPercentageMax) ||
            parsedDecidedPercentageMin < 0 ||
            parsedDecidedPercentageMin > 100 ||
            parsedDecidedPercentageMax < 0 ||
            parsedDecidedPercentageMax > 100
        ) {
            return res.status(400).json({
                success: false,
                message: 'Decided percentage must be between 0 and 100'
            });
        }

        if (parsedDecidedPercentageMin > parsedDecidedPercentageMax) {
            return res.status(400).json({
                success: false,
                message: 'Minimum decided percentage cannot be greater than maximum decided percentage'
            });
        }

        const existingInvestor = await Investor.findOne({ email: email.toLowerCase() });
        if (existingInvestor) {
            return res.status(400).json({
                success: false,
                message: 'An investor with this email already exists'
            });
        }

        if (status && !allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status value'
            });
        }

        const inviteToken = generateInviteToken();
        const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const investor = await Investor.create({
            name,
            email: email.toLowerCase(),
            investorEid,
            creditLimit: parsedCreditLimit,
            decidedPercentageMin: parsedDecidedPercentageMin,
            decidedPercentageMax: parsedDecidedPercentageMax,
            status: status || 'invited',
            inviteToken,
            inviteTokenExpiry,
            createdBy: req.userId
        });

        // Send DocuSign Investor Agreement
        if (!process.env.DOCUSIGN_PURCHASE_INVESTMENT_AGREEMENT_TEMPLATE_ID) {
            throw new Error('DOCUSIGN_PURCHASE_INVESTMENT_AGREEMENT_TEMPLATE_ID not configured in environment variables.');
        }

        let envelopeResult;
        try {
            envelopeResult = await docusignService.createInvestorAgreement({
                adminName: admin.name,
                adminDesignation: finalAdminDesignation,
                adminEmail: admin.email,
                investorName: investor.name,
                investorEmail: investor.email,
                investorEid: investorEid,
                decidedPercentageMin: parsedDecidedPercentageMin,
                decidedPercentageMax: parsedDecidedPercentageMax,
                investmentAmount: parsedCreditLimit,
                date: new Date()
            });
            logger.info(`DocuSign Investor Agreement sent for investor ${investor.email}: ${envelopeResult.envelopeId}`);
        } catch (docuSignError) {
            logger.error(`Failed to send DocuSign Investor Agreement to ${investor.email}:`, docuSignError);
            throw new Error(`Failed to send Investor Agreement via DocuSign: ${docuSignError.message}`);
        }

        // Create InvestorAgreement record
        const investorAgreement = await InvestorAgreement.create({
            investorId: investor._id,
            adminId: admin._id,
            envelopeId: envelopeResult.envelopeId,
            status: 'sent',
            docuSignStatus: envelopeResult.status || 'sent',
            sentAt: new Date(),
            agreementData: {
                adminName: admin.name,
                adminDesignation: finalAdminDesignation,
                investorName: investor.name,
                investorEmail: investor.email,
                investorEid: investorEid,
                decidedPercentageMin: parsedDecidedPercentageMin,
                decidedPercentageMax: parsedDecidedPercentageMax,
                investmentAmount: parsedCreditLimit,
                date: new Date()
            }
        });

        logger.info(`Investor Agreement record created: ${investorAgreement._id}`);

        // Note: Activation email will be sent automatically after both parties sign via webhook

        await logUserManagement(req, 'investor_invited', `Invited ${investor.email} as investor`, investor, {
            creditLimit: parsedCreditLimit,
            decidedPercentageMin: parsedDecidedPercentageMin,
            decidedPercentageMax: parsedDecidedPercentageMax
        });

        await logInvestor(req, 'investor_created', `Created investor ${investor.email}`, investor, {
            creditLimit: parsedCreditLimit,
            decidedPercentageMin: parsedDecidedPercentageMin,
            decidedPercentageMax: parsedDecidedPercentageMax
        });

        logger.info(`Investor created: ${investor.email}`);

        res.status(201).json({
            success: true,
            message: 'Investor created and invite email sent successfully',
            data: investor
        });
    } catch (error) {
        logger.error('Create investor error:', error);
        next(error);
    }
};

/**
 * @desc    Update investor details (Admin only)
 * @route   PUT /api/v1/investors/:id
 * @access  Private (Admin only)
 */
exports.updateInvestor = async (req, res, next) => {
    try {
        const {
            name,
            email,
            creditLimit,
            decidedPercentageMin,
            decidedPercentageMax,
            decidedPercentage,
            status
        } = req.body;
        const investor = await Investor.findById(req.params.id);

        if (!investor) {
            return res.status(404).json({
                success: false,
                message: 'Investor not found'
            });
        }

        if (email && email.toLowerCase() !== investor.email) {
            const emailExists = await Investor.findOne({ email: email.toLowerCase() });
            if (emailExists) {
                return res.status(400).json({
                    success: false,
                    message: 'Another investor with this email already exists'
                });
            }
            investor.email = email.toLowerCase();
        }

        if (name !== undefined) {
            investor.name = name;
        }

        if (creditLimit !== undefined) {
            const parsedCreditLimit = Number(creditLimit);
            if (Number.isNaN(parsedCreditLimit) || parsedCreditLimit < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Credit limit must be a non-negative number'
                });
            }
            if (parsedCreditLimit < investor.utilizedAmount) {
                return res.status(400).json({
                    success: false,
                    message: `Credit limit cannot be less than utilized amount (${investor.utilizedAmount})`
                });
            }
            investor.creditLimit = parsedCreditLimit;
        }

        if (
            decidedPercentage !== undefined ||
            decidedPercentageMin !== undefined ||
            decidedPercentageMax !== undefined
        ) {
            let parsedMin = decidedPercentageMin !== undefined && decidedPercentageMin !== null
                ? Number(decidedPercentageMin)
                : undefined;
            let parsedMax = decidedPercentageMax !== undefined && decidedPercentageMax !== null
                ? Number(decidedPercentageMax)
                : undefined;

            if (parsedMin === undefined && parsedMax === undefined && decidedPercentage !== undefined) {
                const fallback = Number(decidedPercentage);
                parsedMin = fallback;
                parsedMax = fallback;
            }

            if (parsedMin === undefined) parsedMin = investor.decidedPercentageMin ?? 0;
            if (parsedMax === undefined) parsedMax = investor.decidedPercentageMax ?? parsedMin;

            if (
                Number.isNaN(parsedMin) ||
                Number.isNaN(parsedMax) ||
                parsedMin < 0 ||
                parsedMin > 100 ||
                parsedMax < 0 ||
                parsedMax > 100
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Decided percentage must be between 0 and 100'
                });
            }

            if (parsedMin > parsedMax) {
                return res.status(400).json({
                    success: false,
                    message: 'Minimum decided percentage cannot be greater than maximum decided percentage'
                });
            }

            investor.decidedPercentageMin = parsedMin;
            investor.decidedPercentageMax = parsedMax;
        }

        if (status !== undefined) {
            const allowedStatuses = ['invited', 'active', 'inactive'];
            if (!allowedStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid status value'
                });
            }
            investor.status = status;
        }

        await investor.save();

        logger.info(`Investor updated: ${investor.email}`);

        res.status(200).json({
            success: true,
            message: 'Investor updated successfully',
            data: investor
        });
    } catch (error) {
        logger.error('Update investor error:', error);
        next(error);
    }
};

/**
 * @desc    Delete investor (Admin only)
 * @route   DELETE /api/v1/investors/:id
 * @access  Private (Admin only)
 */
exports.deleteInvestor = async (req, res, next) => {
    try {
        const investor = await Investor.findById(req.params.id);

        if (!investor) {
            return res.status(404).json({
                success: false,
                message: 'Investor not found'
            });
        }

        if (investor.utilizedAmount > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete investor with utilized amount remaining'
            });
        }

        await investor.deleteOne();

        logger.info(`Investor deleted: ${investor.email}`);

        res.status(200).json({
            success: true,
            message: 'Investor deleted successfully'
        });
    } catch (error) {
        logger.error('Delete investor error:', error);
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

/**
 * @desc    Get investor agreement document
 * @route   GET /api/v1/investors/:id/agreement/document
 * @access  Private (Admin only)
 */
exports.getInvestorAgreementDocument = async (req, res, next) => {
    try {
        const investorId = req.params.id;

        const investorAgreement = await InvestorAgreement.findOne({ investorId })
            .select('signedDocuments')
            .lean();

        if (!investorAgreement || !investorAgreement.signedDocuments || investorAgreement.signedDocuments.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No signed documents found for this investor agreement'
            });
        }

        // Return the first signed document
        const document = investorAgreement.signedDocuments[0];

        res.status(200).json({
            success: true,
            data: {
                documentId: document.documentId,
                name: document.name,
                fileType: document.fileType,
                fileSize: document.fileSize,
                content: document.content, // Base64 encoded PDF
                uri: document.uri
            }
        });
    } catch (error) {
        logger.error('Get investor agreement document error:', error);
        next(error);
    }
};

module.exports = exports;

