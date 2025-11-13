const Admin = require('../models/Admin');
const AdminGroup = require('../models/AdminGroup');
const Manager = require('../models/Manager');
const Investor = require('../models/Investor');
const Sale = require('../models/Sale');
const PurchaseOrder = require('../models/PurchaseOrder');
const Lead = require('../models/Lead');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const { logUserManagement } = require('../utils/auditLogger');
const { generateInviteToken } = require('../utils/otpHelper');
const { sendMailtrapEmail } = require('../services/mailtrapService');

/**
 * @desc    Get dashboard statistics
 * @route   GET /api/v1/admin/dashboard
 * @access  Private (Admin only)
 */
exports.getDashboard = async (req, res, next) => {
    try {
        // Get counts
        const totalManagers = await Manager.countDocuments({ status: 'active' });
        const totalInvestors = await Investor.countDocuments({ status: 'active' });
        const totalVehicles = await Lead.countDocuments({ status: 'inventory' });
        const totalLeads = await Lead.countDocuments();
        const totalSales = await Sale.countDocuments({ status: { $in: ['approved', 'completed'] } });

        // Inventory breakdown - count leads with inventory status
        const inventoryByStatus = [{ _id: 'inventory', count: await Lead.countDocuments({ status: 'inventory' }) }];

        // Sales metrics
        const salesData = await Sale.find({ status: { $in: ['approved', 'completed'] } });
        const totalRevenue = salesData.reduce((sum, sale) => sum + sale.sellingPrice, 0);
        const totalProfit = salesData.reduce((sum, sale) => sum + sale.profit, 0);

        // Pending approvals
        const pendingPOApprovals = await PurchaseOrder.countDocuments({
            status: { $in: ['draft', 'pending_approval'] },
            'approvedBy.1': { $exists: false }
        });
        const pendingSalesApprovals = await Sale.countDocuments({
            status: { $in: ['draft', 'pending_approval'] },
            'approvedBy.1': { $exists: false }
        });

        // Pending dual approvals (leads that need approval from the other group)
        // Count leads where approval.status is 'pending' and they don't have approvals from 2 different groups yet
        const pendingDualApprovalLeads = await Lead.find({
            'approval.status': 'pending'
        });

        let pendingDualApprovals = 0;
        for (const lead of pendingDualApprovalLeads) {
            if (lead.approval && lead.approval.approvals) {
                const groupsCovered = new Set(lead.approval.approvals.map(a => a.groupName).filter(Boolean));
                if (groupsCovered.size < 2) {
                    pendingDualApprovals++;
                }
            }
        }

        // Investor utilization
        const investors = await Investor.find({ status: 'active' });
        const totalCreditLimit = investors.reduce((sum, inv) => sum + inv.creditLimit, 0);
        const totalUtilized = investors.reduce((sum, inv) => sum + inv.utilizedAmount, 0);
        const utilizationPercentage = totalCreditLimit > 0 ? (totalUtilized / totalCreditLimit) * 100 : 0;

        // Get recent inventory items (last 10)
        const recentInventory = await Lead.find({ status: 'inventory' })
            .populate('investorAllocations.investorId', 'name email')
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 })
            .limit(10);

        const recentInventoryData = recentInventory.map(lead => {
            const primaryAllocation = Array.isArray(lead.investorAllocations) ? lead.investorAllocations[0] : null;
            const investorDoc = primaryAllocation?.investorId;
            const investorSummary = investorDoc ? {
                _id: investorDoc._id || investorDoc,
                name: investorDoc.name,
                email: investorDoc.email
            } : null;

            return {
                _id: lead._id,
                leadId: lead.leadId,
                vehicleId: lead.leadId,
                vehicleDetails: lead.vehicleInfo ? `${lead.vehicleInfo.make} ${lead.vehicleInfo.model} ${lead.vehicleInfo.year}` : 'N/A',
                vehicleInfo: {
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
                },
                images: (lead.attachments || []).filter(a => a.category === 'carPictures').map(img => ({
                    url: img.url,
                    publicId: img.publicId
                })),
                investor: investorSummary,
                status: lead.status,
                createdAt: lead.createdAt
            };
        });

        res.status(200).json({
            success: true,
            data: {
                users: {
                    totalManagers,
                    totalInvestors
                },
                inventory: {
                    totalVehicles,
                    byStatus: inventoryByStatus,
                    recentItems: recentInventoryData
                },
                leads: {
                    totalLeads
                },
                sales: {
                    totalSales,
                    totalRevenue,
                    totalProfit
                },
                approvals: {
                    pendingPOApprovals,
                    pendingSalesApprovals,
                    pendingDualApprovals
                },
                investors: {
                    totalCreditLimit,
                    totalUtilized,
                    utilizationPercentage: Math.round(utilizationPercentage * 100) / 100
                }
            }
        });
    } catch (error) {
        logger.error('Get admin dashboard error:', error);
        next(error);
    }
};

/**
 * @desc    Get all managers
 * @route   GET /api/v1/admin/managers
 * @access  Private (Admin only)
 */
exports.getManagers = async (req, res, next) => {
    try {
        const managers = await Manager.find()
            .select('-otpMeta -inviteToken -inviteTokenExpiry')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: managers.length,
            data: managers
        });
    } catch (error) {
        logger.error('Get managers error:', error);
        next(error);
    }
};

/**
 * @desc    Update manager status
 * @route   PUT /api/v1/admin/managers/:id/status
 * @access  Private (Admin only)
 */
exports.updateManagerStatus = async (req, res, next) => {
    try {
        const { status } = req.body;

        const manager = await Manager.findById(req.params.id);

        if (!manager) {
            return res.status(404).json({
                success: false,
                message: 'Manager not found'
            });
        }

        const oldStatus = manager.status;
        manager.status = status;
        await manager.save();

        logger.info(`Manager ${manager.email} status updated to ${status}`);

        // Audit log
        await logUserManagement(req, 'manager_status_updated', `Updated manager ${manager.email} status from ${oldStatus} to ${status}`, manager, {
            oldStatus,
            newStatus: status
        });

        res.status(200).json({
            success: true,
            message: 'Manager status updated',
            data: manager
        });
    } catch (error) {
        logger.error('Update manager status error:', error);
        next(error);
    }
};

/**
 * @desc    Get all admins
 * @route   GET /api/v1/admin/admins
 * @access  Private (Admin only)
 */
exports.getAdmins = async (req, res, next) => {
    try {
        const admins = await Admin.find()
            .select('-passwordHash')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: admins.length,
            data: admins
        });
    } catch (error) {
        logger.error('Get admins error:', error);
        next(error);
    }
};

/**
 * @desc    Create new admin (super admin action)
 * @route   POST /api/v1/admin/create-admin
 * @access  Private (Admin only)
 */
exports.createAdmin = async (req, res, next) => {
    try {
        const { name, email, password } = req.body;

        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ email });
        if (existingAdmin) {
            return res.status(400).json({
                success: false,
                message: 'Admin with this email already exists'
            });
        }

        // Generate activation token
        const activationToken = generateInviteToken();
        const activationTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        const admin = await Admin.create({
            name,
            email,
            passwordHash: password, // Will be hashed by pre-save hook
            role: 'admin',
            isActive: false, // Require activation
            activationToken,
            activationTokenExpiry,
            createdBy: req.userId
        });

        // Generate activation link
        const activationLink = `${process.env.DOMAIN_FRONTEND || process.env.DOMAIN_BACKEND || 'http://localhost:3000'}/activate/${activationToken}`;

        // Send activation email via Mailtrap
        try {
            await sendMailtrapEmail({
                templateUuid: process.env.USER_ACCOUNT_ACTIVATION_ID,
                templateVariables: {
                    name: admin.name,
                    role: 'Admin',
                    activation_link: activationLink,
                    year: new Date().getFullYear().toString()
                },
                recipients: [admin.email]
            });
            logger.info(`Activation email sent to ${admin.email} for admin account`);
        } catch (emailError) {
            logger.error(`Failed to send activation email to ${admin.email}:`, emailError);
            // Continue even if email fails - account is still created
        }

        logger.info(`New admin created: ${email} by ${req.user.email}`);

        // Audit log
        await logUserManagement(req, 'admin_created', `Created admin account for ${admin.email}`, admin, {
            createdBy: req.user.email
        });

        res.status(201).json({
            success: true,
            message: 'Admin created successfully. Activation email has been sent.',
            data: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role
            }
        });
    } catch (error) {
        logger.error('Create admin error:', error);
        next(error);
    }
};

/**
 * @desc    Get system audit logs
 * @route   GET /api/v1/admin/audit-logs
 * @access  Private (Admin only)
 */
exports.getAuditLogs = async (req, res, next) => {
    try {
        const { category, action, startDate, endDate, userId, limit = 100 } = req.query;

        // Build query
        const query = {};
        if (category) query.category = category;
        if (action) query.action = action;
        if (userId) query['performedBy.userId'] = userId;

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        // Fetch audit logs
        const auditLogs = await AuditLog.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit));

        // Group by category for better UI display
        const groupedLogs = auditLogs.reduce((acc, log) => {
            if (!acc[log.category]) {
                acc[log.category] = [];
            }
            acc[log.category].push(log);
            return acc;
        }, {});

        res.status(200).json({
            success: true,
            count: auditLogs.length,
            data: auditLogs,
            grouped: groupedLogs
        });
    } catch (error) {
        logger.error('Get audit logs error:', error);
        next(error);
    }
};

/**
 * @desc    Search leads (all statuses) for admin dashboard
 * @route   GET /api/v1/admin/search/leads
 * @access  Private (Admin only)
 */
exports.searchLeads = async (req, res, next) => {
    try {
        const { q } = req.query;

        if (!q || q.trim().length < 2) {
            return res.status(200).json({
                success: true,
                count: 0,
                data: []
            });
        }

        const searchQuery = q.trim();
        const searchRegex = { $regex: searchQuery, $options: 'i' };

        // Build search conditions - separate text and numeric fields
        const searchConditions = [
            // leadId (text field)
            { leadId: searchRegex },
            // contactInfo (text fields)
            { 'contactInfo.name': searchRegex },
            { 'contactInfo.phone': searchRegex },
            { 'contactInfo.email': searchRegex },
            { 'contactInfo.passportOrEmiratesId': searchRegex },
            // vehicleInfo (text fields)
            { 'vehicleInfo.make': searchRegex },
            { 'vehicleInfo.model': searchRegex },
            { 'vehicleInfo.color': searchRegex },
            { 'vehicleInfo.trim': searchRegex },
            { 'vehicleInfo.region': searchRegex },
            { 'vehicleInfo.vin': searchRegex },
            { 'vehicleInfo.description': searchRegex }
        ];

        // Handle numeric fields - only search if query is numeric
        const isNumeric = /^\d+$/.test(searchQuery);
        if (isNumeric) {
            const numericValue = parseFloat(searchQuery);
            // Search in numeric fields as strings (converted to string for comparison)
            // We'll search for exact match or partial match by converting to string
            searchConditions.push(
                { 'vehicleInfo.year': numericValue },
                { 'vehicleInfo.mileage': numericValue },
                { 'vehicleInfo.askingPrice': numericValue },
                { 'vehicleInfo.expectedPrice': numericValue }
            );
        } else {
            // For non-numeric queries, search numeric fields as strings using regex
            // But we need to convert numbers to strings for regex matching
            // Since Mongoose can't do this directly, we'll exclude exact numeric matches
            // and only search text representation
            // Note: For year, mileage, and prices, we can't use regex on numbers
            // So we'll skip them for non-numeric queries or handle them differently
            // Actually, we can use $expr with $toString to convert numbers to strings for regex
            const numericFieldsRegex = [
                { $expr: { $regexMatch: { input: { $toString: '$vehicleInfo.year' }, regex: searchQuery, options: 'i' } } },
                { $expr: { $regexMatch: { input: { $toString: '$vehicleInfo.mileage' }, regex: searchQuery, options: 'i' } } },
                { $expr: { $regexMatch: { input: { $toString: '$vehicleInfo.askingPrice' }, regex: searchQuery, options: 'i' } } },
                { $expr: { $regexMatch: { input: { $toString: '$vehicleInfo.expectedPrice' }, regex: searchQuery, options: 'i' } } }
            ];
            searchConditions.push(...numericFieldsRegex);
        }

        // Search across all lead fields specified by user
        const leads = await Lead.find({
            $or: searchConditions
        })
            .select('leadId contactInfo vehicleInfo attachments status type')
            .limit(20)
            .sort({ createdAt: -1 });

        // Format results with image URL
        const formattedLeads = leads.map(lead => {
            const carPictures = (lead.attachments || []).filter(a => a.category === 'carPictures');
            const firstImage = carPictures.length > 0 ? carPictures[0].url : null;

            return {
                _id: lead._id,
                leadId: lead.leadId,
                contactInfo: lead.contactInfo,
                vehicleInfo: lead.vehicleInfo,
                status: lead.status,
                type: lead.type,
                imageUrl: firstImage
            };
        });

        res.status(200).json({
            success: true,
            count: formattedLeads.length,
            data: formattedLeads
        });
    } catch (error) {
        logger.error('Search leads error:', error);
        next(error);
    }
};

module.exports = exports;

/**
 * @desc    Get admin approval groups, auto-initialize with default names if missing
 * @route   GET /api/v1/admin/groups
 * @access  Private (Admin only)
 */
exports.getAdminGroups = async (req, res, next) => {
    try {
        // Ensure two groups exist with default names if none exist
        const existing = await AdminGroup.find({});
        if (existing.length === 0) {
            await AdminGroup.insertMany([
                { name: 'Group A', members: [] },
                { name: 'Group B', members: [] }
            ]);
        }

        const groups = await AdminGroup.find({})
            .sort({ name: 1 })
            .populate('members', 'name email');

        res.status(200).json({ success: true, data: groups });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Update admin approval groups (names and members)
 * @route   PUT /api/v1/admin/groups
 * @access  Private (Admin only)
 */
exports.updateAdminGroups = async (req, res, next) => {
    try {
        const { groups } = req.body; // array of { id, name, members }

        // Basic validations
        if (!Array.isArray(groups) || groups.length !== 2) {
            return res.status(400).json({ success: false, message: 'Must provide exactly 2 groups' });
        }

        // Validate each group
        for (const group of groups) {
            if (!group.name || !group.name.trim()) {
                return res.status(400).json({ success: false, message: 'Group name is required' });
            }
            if (group.name.length > 50) {
                return res.status(400).json({ success: false, message: 'Group name too long (max 50 characters)' });
            }
            if (!Array.isArray(group.members)) {
                return res.status(400).json({ success: false, message: 'Group members must be an array' });
            }
            if (group.members.length > 2) {
                return res.status(400).json({ success: false, message: 'Each group can have at most 2 members' });
            }
        }

        // Check for duplicate group names
        const groupNames = groups.map(g => g.name.trim());
        if (new Set(groupNames).size !== groupNames.length) {
            return res.status(400).json({ success: false, message: 'Group names must be unique' });
        }

        // Check for duplicate members across groups
        const allMembers = groups.flatMap(g => g.members);
        if (new Set(allMembers).size !== allMembers.length) {
            return res.status(400).json({ success: false, message: 'An admin cannot be in multiple groups' });
        }

        // Verify admins exist
        if (allMembers.length > 0) {
            const admins = await Admin.find({ _id: { $in: allMembers } });
            if (admins.length !== allMembers.length) {
                return res.status(400).json({ success: false, message: 'One or more admins not found' });
            }
        }

        // Update or create groups
        for (const group of groups) {
            if (group.id) {
                // Update existing group
                await AdminGroup.findByIdAndUpdate(group.id, {
                    name: group.name.trim(),
                    members: group.members
                });
            } else {
                // Create new group
                await AdminGroup.create({
                    name: group.name.trim(),
                    members: group.members
                });
            }
        }

        const updatedGroups = await AdminGroup.find({}).populate('members', 'name email');

        res.status(200).json({ success: true, message: 'Groups updated', data: updatedGroups });
    } catch (error) {
        next(error);
    }
};

