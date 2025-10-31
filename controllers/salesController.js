const Lead = require('../models/Lead');
const Sale = require('../models/Sale');
const Investor = require('../models/Investor');
const FollowUp = require('../models/FollowUp');
const logger = require('../utils/logger');
const { sendInvestorSettlementEmail } = require('../utils/emailService');
const { logLead, logSale, logApproval } = require('../utils/auditLogger');

/**
 * @desc    Create a new sales lead
 * @route   POST /api/v1/sales/lead
 * @access  Private (Admin, Manager)
 */
exports.createSalesLead = async (req, res, next) => {
    try {
        const leadData = {
            ...req.body,
            type: 'sales',
            assignedTo: req.body.assignedTo || (req.userRole === 'manager' ? req.userId : null),
            createdBy: req.userId,
            createdByModel: req.userRole === 'admin' ? 'Admin' : 'Manager'
        };

        const lead = await Lead.create(leadData);

        logger.info(`Sales lead ${lead.leadId} created by ${req.user.email}`);

        // Audit log
        await logLead(req, 'sales_lead_created', `Created sales lead ${lead.leadId} for ${lead.contactInfo.name}`, lead, {
            source: lead.source,
            priority: lead.priority
        });

        res.status(201).json({
            success: true,
            message: 'Sales lead created successfully',
            data: lead
        });
    } catch (error) {
        logger.error('Create sales lead error:', error);
        next(error);
    }
};

/**
 * @desc    Get all sales leads
 * @route   GET /api/v1/sales/leads
 * @access  Private
 */
exports.getSalesLeads = async (req, res, next) => {
    try {
        const { status, assignedTo, priority, search } = req.query;

        const query = { type: 'sales' };

        if (status) query.status = status;
        if (priority) query.priority = priority;

        // Managers can only see their assigned leads
        if (req.userRole === 'manager') {
            query.assignedTo = req.userId;
        } else if (assignedTo) {
            query.assignedTo = assignedTo;
        }

        if (search) {
            query.$or = [
                { 'contactInfo.name': { $regex: search, $options: 'i' } },
                { leadId: { $regex: search, $options: 'i' } }
            ];
        }

        const leads = await Lead.find(query)
            .populate('assignedTo', 'name email')
            .populate('followUps')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: leads.length,
            data: leads
        });
    } catch (error) {
        logger.error('Get sales leads error:', error);
        next(error);
    }
};

/**
 * @desc    Close a sale
 * @route   POST /api/v1/sales/:vehicleId/close
 * @access  Private (Admin, Manager)
 */
exports.closeSale = async (req, res, next) => {
    try {
        const { vehicleId } = req.params;
        const { customerName, customerContact, sellingPrice, leadId, notes } = req.body;

        // Find vehicle
        const vehicle = await Vehicle.findById(vehicleId).populate('investorAllocation.investorId');

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found'
            });
        }

        if (vehicle.status !== 'ready_for_sale' && vehicle.status !== 'test_drive') {
            return res.status(400).json({
                success: false,
                message: 'Vehicle is not available for sale'
            });
        }

        // Calculate profit
        const purchasePrice = vehicle.purchasePrice || vehicle.askingPrice;
        const profit = sellingPrice - purchasePrice;
        const profitPercentage = (profit / purchasePrice) * 100;

        // Calculate investor breakdown
        const investorBreakdown = [];
        for (const allocation of vehicle.investorAllocation) {
            const investmentPercentage = allocation.percentage;
            const profitAmount = (profit * investmentPercentage) / 100;
            const profitPercent = (profitAmount / allocation.amount) * 100;
            const totalPayout = allocation.amount + profitAmount;

            investorBreakdown.push({
                investorId: allocation.investorId._id,
                investmentAmount: allocation.amount,
                investmentPercentage: allocation.percentage,
                profitAmount,
                profitPercentage: profitPercent,
                totalPayout
            });
        }

        // Create sale
        const sale = await Sale.create({
            vehicleId,
            customerName,
            customerContact,
            sellingPrice,
            purchasePrice,
            profit,
            profitPercentage,
            investorBreakdown,
            leadId,
            notes,
            status: 'pending_approval', // Automatically submit for approval
            createdBy: req.userId,
            createdByModel: req.userRole === 'admin' ? 'Admin' : 'Manager'
        });

        // Update vehicle
        vehicle.status = 'sold';
        vehicle.sellingPrice = sellingPrice;
        vehicle.salesMeta = {
            saleId: sale._id,
            customerName,
            customerContact: customerContact?.phone || customerContact?.email,
            saleDate: new Date(),
            profit,
            notes
        };
        await vehicle.save();

        logger.info(`Sale ${sale.saleId} created for vehicle ${vehicle.vehicleId}`);

        // Audit log
        await logSale(req, 'sale_created', `Created sale ${sale.saleId} for vehicle ${vehicle.vehicleId} - Profit: AED ${profit.toLocaleString()} (${profitPercentage.toFixed(2)}%)`, sale, {
            vehicle: `${vehicle.make} ${vehicle.model} ${vehicle.year}`,
            customerName,
            purchasePrice,
            sellingPrice,
            profit,
            profitPercentage: profitPercentage.toFixed(2),
            investorCount: investorBreakdown.length
        });

        res.status(201).json({
            success: true,
            message: 'Sale created successfully. Awaiting dual admin approval.',
            data: sale
        });
    } catch (error) {
        logger.error('Close sale error:', error);
        next(error);
    }
};

/**
 * @desc    Admin approve Sale (dual approval required)
 * @route   POST /api/v1/sales/:id/approve
 * @access  Private (Admin only)
 */
exports.approveSale = async (req, res, next) => {
    try {
        const { comments } = req.body;

        const sale = await Sale.findById(req.params.id)
            .populate('vehicleId')
            .populate('investorBreakdown.investorId');

        if (!sale) {
            return res.status(404).json({
                success: false,
                message: 'Sale not found'
            });
        }

        // Check if already approved by this admin
        if (sale.hasAdminApproved(req.userId)) {
            return res.status(400).json({
                success: false,
                message: 'You have already approved this Sale'
            });
        }

        // Add approval
        sale.approvedBy.push({
            adminId: req.userId,
            comments
        });

        // Check if dual approval is met (2 of 4)
        if (sale.isDualApprovalMet()) {
            sale.status = 'approved';

            // Send settlement emails to investors
            for (const breakdown of sale.investorBreakdown) {
                const investor = breakdown.investorId;

                // Update investor investments status
                await Investor.updateOne(
                    { _id: investor._id, 'investments.carId': sale.vehicleId },
                    {
                        $set: { 'investments.$.status': 'settled' },
                        $inc: { utilizedAmount: -breakdown.investmentAmount }
                    }
                );

                // Send settlement email
                await sendInvestorSettlementEmail(investor.email, {
                    investorName: investor.name,
                    vehicleDetails: `${sale.vehicleId.make} ${sale.vehicleId.model} ${sale.vehicleId.year}`,
                    investmentAmount: breakdown.investmentAmount,
                    investmentPercentage: breakdown.investmentPercentage,
                    profitAmount: breakdown.profitAmount,
                    profitPercentage: breakdown.profitPercentage,
                    totalPayout: breakdown.totalPayout,
                    saleDate: sale.createdAt
                });
            }

            logger.info(`Sale ${sale.saleId} approved with dual approval and investors notified`);
        } else {
            sale.status = 'pending_approval';
            logger.info(`Sale ${sale.saleId} received approval 1 of 2`);
        }

        await sale.save();

        // Audit log - CRITICAL approval event
        await logApproval(req, 'sale_approved',
            `Admin ${req.user.name} approved Sale ${sale.saleId} (${sale.approvedBy.length}/2) - Profit: AED ${sale.profit.toLocaleString()}`,
            sale, 'Sale', {
            approvalCount: sale.approvedBy.length,
            isDualApprovalMet: sale.isDualApprovalMet(),
            profit: sale.profit,
            profitPercentage: sale.profitPercentage,
            comments
        }
        );

        res.status(200).json({
            success: true,
            message: sale.isDualApprovalMet() ? 'Sale approved and investors notified' : 'Approval recorded. One more approval needed.',
            data: sale
        });
    } catch (error) {
        logger.error('Approve sale error:', error);
        next(error);
    }
};

/**
 * @desc    Get all sales
 * @route   GET /api/v1/sales
 * @access  Private
 */
exports.getSales = async (req, res, next) => {
    try {
        const { status, startDate, endDate } = req.query;

        const query = {};
        if (status) query.status = status;

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const sales = await Sale.find(query)
            .populate('vehicleId')
            .populate('investorBreakdown.investorId', 'name email')
            .populate('approvedBy.adminId', 'name email')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: sales.length,
            data: sales
        });
    } catch (error) {
        logger.error('Get sales error:', error);
        next(error);
    }
};

/**
 * @desc    Get sales report / KPIs
 * @route   GET /api/v1/sales/report
 * @access  Private
 */
exports.getSalesReport = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;

        const query = { status: { $in: ['approved', 'completed'] } };

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const sales = await Sale.find(query);

        // Calculate KPIs
        const totalSales = sales.length;
        const totalRevenue = sales.reduce((sum, sale) => sum + sale.sellingPrice, 0);
        const totalProfit = sales.reduce((sum, sale) => sum + sale.profit, 0);
        const averageProfit = totalSales > 0 ? totalProfit / totalSales : 0;
        const averageProfitPercentage = totalSales > 0
            ? sales.reduce((sum, sale) => sum + sale.profitPercentage, 0) / totalSales
            : 0;

        res.status(200).json({
            success: true,
            data: {
                totalSales,
                totalRevenue,
                totalProfit,
                averageProfit,
                averageProfitPercentage,
                sales
            }
        });
    } catch (error) {
        logger.error('Get sales report error:', error);
        next(error);
    }
};

/**
 * @desc    Create follow-up for sales lead
 * @route   POST /api/v1/sales/leads/:leadId/followup
 * @access  Private (Admin, Manager)
 */
exports.createFollowUp = async (req, res, next) => {
    try {
        const { leadId } = req.params;
        const { type, dueDate, priority, comments } = req.body;

        const lead = await Lead.findById(leadId);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        const followUp = await FollowUp.create({
            leadId,
            managerId: lead.assignedTo || req.userId,
            type,
            dueDate,
            priority,
            comments,
            createdBy: req.userId
        });

        lead.followUps.push(followUp._id);
        await lead.save();

        res.status(201).json({
            success: true,
            message: 'Follow-up created successfully',
            data: followUp
        });
    } catch (error) {
        logger.error('Create follow-up error:', error);
        next(error);
    }
};

/**
 * @desc    Complete a follow-up
 * @route   PUT /api/v1/sales/followup/:id/complete
 * @access  Private (Manager)
 */
exports.completeFollowUp = async (req, res, next) => {
    try {
        const { outcome } = req.body;

        const followUp = await FollowUp.findById(req.params.id);

        if (!followUp) {
            return res.status(404).json({
                success: false,
                message: 'Follow-up not found'
            });
        }

        // Managers can only complete their own follow-ups
        if (req.userRole === 'manager' && followUp.managerId.toString() !== req.userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        followUp.status = 'completed';
        followUp.completedAt = new Date();
        followUp.completedBy = req.userId;
        followUp.outcome = outcome;
        await followUp.save();

        res.status(200).json({
            success: true,
            message: 'Follow-up completed',
            data: followUp
        });
    } catch (error) {
        logger.error('Complete follow-up error:', error);
        next(error);
    }
};

module.exports = exports;

