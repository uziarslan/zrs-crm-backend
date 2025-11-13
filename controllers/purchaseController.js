const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const PurchaseOrder = require('../models/PurchaseOrder');
const Invoice = require('../models/Invoice');
/**
 * @desc    Upsert a draft Purchase Order for a Lead with required cost fields
 * @route   PUT /api/v1/purchases/leads/:id/purchase-order
 * @access  Private (Admin)
 */
exports.upsertLeadPurchaseOrder = async (req, res, next) => {
    try {
        const lead = await Lead.findById(req.params.id)
            .populate('investorAllocations.investorId', 'name email');
        if (!lead) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }

        // Upsert draft PO keyed by leadId
        let purchaseOrder = await PurchaseOrder.findOne({ leadId: lead._id });
        if (!purchaseOrder) {
            const allocations = Array.isArray(lead.investorAllocations)
                ? lead.investorAllocations
                : [];

            const baseAmount = Number(
                lead.priceAnalysis?.purchasedFinalPrice ||
                lead.priceAnalysis?.maxSellingPrice ||
                0
            );

            const normalizedAllocations = allocations.map((allocation) => {
                const percentage = Number(allocation.percentage || 0);
                const amount = allocation.amount != null && allocation.amount !== ''
                    ? Number(allocation.amount)
                    : Number(((percentage / 100) * baseAmount).toFixed(2));
                return {
                    investorId: allocation.investorId || allocation.investorId?._id || allocation,
                    percentage,
                    amount
                };
            }).filter(a => a.investorId);

            purchaseOrder = await PurchaseOrder.create({
                leadId: lead._id,
                investorId: normalizedAllocations[0]?.investorId || null,
                amount: baseAmount,
                investorAllocations: normalizedAllocations,
                status: 'draft',
                notes: `Purchase Order for lead ${lead.leadId}`,
                createdBy: req.userId,
                createdByModel: req.userRole === 'admin' ? 'Admin' : 'Manager'
            });
        }

        // Update cost fields
        const {
            transferCost,
            detailing_inspection_cost,
            agent_commision,
            car_recovery_cost,
            other_charges,
            transferCostInvestor,
            detailingInspectionCostInvestor,
            agentCommissionInvestor,
            carRecoveryCostInvestor,
            otherChargesInvestor
        } = req.body;

        const allowedInvestorIds = new Set(
            (lead.investorAllocations || [])
                .map((allocation) => {
                    const id = allocation?.investorId?._id || allocation?.investorId;
                    return id ? id.toString() : null;
                })
                .filter(Boolean)
        );

        const makeValidationError = (message) => {
            const error = new Error(message);
            error.statusCode = 400;
            return error;
        };

        const normalizeAssignment = (value, label) => {
            if (value == null || value === '') {
                return null;
            }

            const stringValue = value.toString();
            if (!mongoose.Types.ObjectId.isValid(stringValue)) {
                throw makeValidationError(`${label} must be a valid investor ID.`);
            }

            if (!allowedInvestorIds.has(stringValue)) {
                throw makeValidationError(`${label} must reference an investor assigned to this lead.`);
            }

            return stringValue;
        };

        purchaseOrder.transferCost = Number(transferCost);
        purchaseOrder.detailing_inspection_cost = Number(detailing_inspection_cost);
        if (agent_commision != null && agent_commision !== '') purchaseOrder.agent_commision = Number(agent_commision);
        if (car_recovery_cost != null && car_recovery_cost !== '') purchaseOrder.car_recovery_cost = Number(car_recovery_cost);
        if (other_charges != null && other_charges !== '') purchaseOrder.other_charges = Number(other_charges);

        purchaseOrder.transferCostInvestor = normalizeAssignment(transferCostInvestor, 'Transfer cost investor');
        purchaseOrder.detailingInspectionCostInvestor = normalizeAssignment(detailingInspectionCostInvestor, 'Detailing / inspection cost investor');
        purchaseOrder.agentCommissionInvestor = normalizeAssignment(agentCommissionInvestor, 'Agent commission investor');
        purchaseOrder.carRecoveryCostInvestor = normalizeAssignment(carRecoveryCostInvestor, 'Car recovery cost investor');
        purchaseOrder.otherChargesInvestor = normalizeAssignment(otherChargesInvestor, 'Other charges investor');

        // Auto-calculate total investment: buying price + all costs
        const buyingPrice = Number(lead.priceAnalysis?.purchasedFinalPrice || 0);
        const totalInvestment = buyingPrice
            + (purchaseOrder.transferCost || 0)
            + (purchaseOrder.detailing_inspection_cost || 0)
            + (purchaseOrder.agent_commision || 0)
            + (purchaseOrder.car_recovery_cost || 0)
            + (purchaseOrder.other_charges || 0);
        purchaseOrder.total_investment = totalInvestment;

        // Auto-set prepared_by from current admin
        if (req.userRole === 'admin') {
            try {
                const Admin = require('../models/Admin');
                const adminUser = await Admin.findById(req.userId).select('name email');
                if (adminUser) {
                    purchaseOrder.prepared_by = adminUser.name || adminUser.email || purchaseOrder.prepared_by;
                }
            } catch (_) {
                // no-op if admin lookup fails
            }
        }

        await purchaseOrder.save();

        // Link to lead if not linked
        if (!lead.purchaseOrder) {
            lead.purchaseOrder = purchaseOrder._id;
            await lead.save();
        }

        res.status(200).json({ success: true, message: 'Purchase Order saved', data: purchaseOrder });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        next(error);
    }
};
const Investor = require('../models/Investor');
const FollowUp = require('../models/FollowUp');
const logger = require('../utils/logger');
const { sendNotificationEmail } = require('../utils/emailService');
const { logLead, logPurchaseOrder, logInventory, logApproval } = require('../utils/auditLogger');
const AdminGroup = require('../models/AdminGroup');
const docusignService = require('../services/docusignService');
/**
 * @desc    Update Purchase Order fields to be used in DocuSign template
 * @route   PUT /api/v1/purchases/leads/:id/po-fields
 * @access  Private (Admin, Manager)
 */
exports.updatePOFields = async (req, res, next) => {
    try {
        return res.status(410).json({ success: false, message: 'Deprecated endpoint' });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Create a new purchase lead
 * @route   POST /api/v1/purchases/leads
 * @access  Private (Admin, Manager)
 */
exports.createLead = async (req, res, next) => {
    try {
        const leadData = {
            ...req.body,
            type: 'purchase',
            assignedTo: req.body.assignedTo || (req.userRole === 'manager' ? req.userId : null),
            createdBy: req.userId,
            createdByModel: req.userRole === 'admin' ? 'Admin' : 'Manager'
        };

        const lead = await Lead.create(leadData);

        // Auto-generate follow-ups if status is under_review
        if (lead.status === 'under_review') {
            await createAutoFollowUps(lead._id, lead.assignedTo);
        }

        logger.info(`Purchase lead ${lead.leadId} created by ${req.user.email}`);

        // Get assigned manager details if applicable
        let assignedManager = null;
        if (lead.assignedTo) {
            assignedManager = await require('../models/Manager').findById(lead.assignedTo).select('name email');
        }

        // Audit log
        await logLead(req, 'lead_created', `Created purchase lead ${lead.leadId} for ${lead.contactInfo.name}${assignedManager ? ` - Assigned to ${assignedManager.name}` : ' - Unassigned'}`, lead, {
            contactName: lead.contactInfo.name,
            contactPhone: lead.contactInfo.phone || 'N/A',
            contactEmail: lead.contactInfo.email || 'N/A',
            source: lead.source,
            vehicle: lead.vehicleInfo ? `${lead.vehicleInfo.make} ${lead.vehicleInfo.model} ${lead.vehicleInfo.year}` : 'N/A',
            askingPrice: lead.vehicleInfo?.askingPrice,
            priority: lead.priority,
            assignedManager: assignedManager ? {
                name: assignedManager.name,
                email: assignedManager.email
            } : 'Unassigned'
        });

        res.status(201).json({
            success: true,
            message: 'Lead created successfully',
            data: lead
        });
    } catch (error) {
        logger.error('Create lead error:', error);
        next(error);
    }
};

/**
 * @desc    Bulk create purchase leads
 * @route   POST /api/v1/purchases/leads/bulk
 * @access  Private (Admin only)
 */
exports.bulkCreateLeads = async (req, res, next) => {
    try {
        const { leads } = req.body;

        if (!Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Leads array is required and must not be empty'
            });
        }

        const Manager = require('../models/Manager');
        const createdLeads = [];
        const errors = [];

        for (let i = 0; i < leads.length; i++) {
            try {
                const leadData = leads[i];
                
                // Validate required fields
                if (!leadData.contactInfo?.name || !leadData.vehicleInfo?.make || !leadData.vehicleInfo?.model) {
                    errors.push({
                        index: i,
                        error: 'Missing required fields: name, make, or model'
                    });
                    continue;
                }

                // Validate assignedTo if provided
                if (leadData.assignedTo) {
                    const manager = await Manager.findById(leadData.assignedTo);
                    if (!manager || manager.status !== 'active') {
                        errors.push({
                            index: i,
                            error: `Invalid or inactive manager ID: ${leadData.assignedTo}`
                        });
                        continue;
                    }
                }

                const leadPayload = {
                    ...leadData,
                    type: 'purchase',
                    assignedTo: leadData.assignedTo || null,
                    createdBy: req.userId,
                    createdByModel: req.userRole === 'admin' ? 'Admin' : 'Manager'
                };

                const lead = await Lead.create(leadPayload);

                // Get assigned manager details if applicable
                let assignedManager = null;
                if (lead.assignedTo) {
                    assignedManager = await Manager.findById(lead.assignedTo).select('name email');
                }

                // Audit log
                await logLead(req, 'lead_created', `Bulk created purchase lead ${lead.leadId} for ${lead.contactInfo.name}${assignedManager ? ` - Assigned to ${assignedManager.name}` : ' - Unassigned'}`, lead, {
                    contactName: lead.contactInfo.name,
                    contactPhone: lead.contactInfo.phone || 'N/A',
                    contactEmail: lead.contactInfo.email || 'N/A',
                    source: lead.source,
                    vehicle: lead.vehicleInfo ? `${lead.vehicleInfo.make} ${lead.vehicleInfo.model} ${lead.vehicleInfo.year}` : 'N/A',
                    askingPrice: lead.vehicleInfo?.askingPrice,
                    priority: lead.priority,
                    assignedManager: assignedManager ? {
                        name: assignedManager.name,
                        email: assignedManager.email
                    } : 'Unassigned'
                });

                createdLeads.push(lead);
            } catch (error) {
                errors.push({
                    index: i,
                    error: error.message || 'Failed to create lead'
                });
                logger.error(`Bulk create lead error at index ${i}:`, error);
            }
        }

        logger.info(`Bulk created ${createdLeads.length} purchase lead(s) by ${req.user.email}`);

        res.status(201).json({
            success: true,
            message: `Successfully created ${createdLeads.length} lead(s)${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
            data: {
                created: createdLeads,
                errors: errors.length > 0 ? errors : undefined
            },
            stats: {
                total: leads.length,
                created: createdLeads.length,
                failed: errors.length
            }
        });
    } catch (error) {
        logger.error('Bulk create leads error:', error);
        next(error);
    }
};

/**
 * @desc    Get all purchase leads
 * @route   GET /api/v1/purchases/leads
 * @access  Private
 */
exports.getLeads = async (req, res, next) => {
    try {
        const { status, source, assignedTo, priority, search } = req.query;

        // Build query
        const query = { type: 'purchase' };

        if (status) query.status = status;
        if (source) query.source = source;
        if (priority) query.priority = priority;

        // Managers can only see their assigned leads (unless admin)
        if (req.userRole === 'manager') {
            query.assignedTo = req.userId;
        } else if (assignedTo) {
            query.assignedTo = assignedTo;
        }

        if (search) {
            query.$or = [
                { 'contactInfo.name': { $regex: search, $options: 'i' } },
                { 'vehicleInfo.make': { $regex: search, $options: 'i' } },
                { 'vehicleInfo.model': { $regex: search, $options: 'i' } },
                { leadId: { $regex: search, $options: 'i' } }
            ];
        }

        const leads = await Lead.find(query)
            .populate('assignedTo', 'name email')
            .populate('createdBy', 'name email')
            .populate('followUps')
            // Include minimal PurchaseOrder status so UI can reflect DocuSign completion
            .populate('purchaseOrder', 'docuSignStatus status')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: leads.length,
            data: leads
        });
    } catch (error) {
        logger.error('Get leads error:', error);
        next(error);
    }
};

/**
 * @desc    Get single lead by ID
 * @route   GET /api/v1/purchases/leads/:id
 * @access  Private
 */
exports.getLeadById = async (req, res, next) => {
    try {
        const lead = await Lead.findById(req.params.id)
            .populate('assignedTo', 'name email')
            .populate('createdBy', 'name email')
            .populate('notes.addedBy', 'name email')
            .populate('notes.editedBy', 'name email')
            .populate('followUps')
            .populate({
                path: 'purchaseOrder',
                populate: {
                    path: 'investorAllocations.investorId',
                    select: 'name email'
                }
            })
            .populate('invoice')
            .populate('investorAllocations.investorId', 'name email decidedPercentageMin decidedPercentageMax creditLimit utilizedAmount');

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Managers can view their own leads OR unassigned leads
        if (req.userRole === 'manager') {
            // Handle both populated and unpopulated assignedTo field
            const assignedToId = lead.assignedTo?._id || lead.assignedTo;
            const isAssignedToThisManager = assignedToId?.toString() === req.userId.toString();
            const isUnassigned = !assignedToId;

            // Debug logging in development
            if (process.env.NODE_ENV === 'development') {
                console.log('🔍 Lead Access Check (Manager):');
                console.log('   Lead ID:', lead._id);
                console.log('   Lead assignedTo (raw):', lead.assignedTo);
                console.log('   Lead assignedTo ID:', assignedToId);
                console.log('   Manager ID:', req.userId);
                console.log('   Is assigned to this manager?', isAssignedToThisManager);
                console.log('   Is unassigned?', isUnassigned);
            }

            if (!isAssignedToThisManager && !isUnassigned) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. This lead is assigned to another manager.'
                });
            }
        }

        // Transform attachment URLs for inline PDF viewing
        const { getInlineViewUrl } = require('../cloudinary');
        const leadObj = lead.toObject();
        if (leadObj.attachments && leadObj.attachments.length > 0) {
            leadObj.attachments = leadObj.attachments.map(doc => ({
                ...doc,
                viewUrl: getInlineViewUrl(doc.url, doc.fileType, leadObj._id, doc._id) // Add separate viewUrl for inline viewing
            }));
        }

        res.status(200).json({
            success: true,
            data: leadObj
        });
    } catch (error) {
        logger.error('Get lead by ID error:', error);
        next(error);
    }
};

/**
 * @desc    Update lead status
 * @route   PUT /api/v1/purchases/leads/:id/status
 * @access  Private (Admin can update status, Manager can only add notes)
 */
exports.updateLeadStatus = async (req, res, next) => {
    try {
        const { status, notes } = req.body;

        const lead = await Lead.findById(req.params.id)
            .populate({
                path: 'investorAllocations.investorId',
                select: 'name email decidingPercentageMin decidingPercentageMax creditLimit utilizedAmount status'
            });

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Managers can only add notes to their own leads or unassigned leads
        if (req.userRole === 'manager') {
            const assignedToId = lead.assignedTo?._id || lead.assignedTo;
            const isAssignedToThisManager = assignedToId?.toString() === req.userId.toString();
            const isUnassigned = !assignedToId;

            if (!isAssignedToThisManager && !isUnassigned) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. This lead is assigned to another manager.'
                });
            }

            // Managers cannot change status, only add notes
            if (status && status !== lead.status) {
                return res.status(403).json({
                    success: false,
                    message: 'Only admins can change lead status. You can only add notes.'
                });
            }
        }

        // Capture old status BEFORE making changes
        const oldStatus = lead.status;

        // Only update status if provided and user is admin
        if (status && req.userRole === 'admin') {
            lead.status = status;
        }

        // Only add notes if explicitly provided (for manual notes only, not system logs)
        if (notes && notes.trim()) {
            lead.notes.push({
                content: notes,
                addedBy: req.userId,
                addedByModel: req.userRole === 'admin' ? 'Admin' : 'Manager'
            });
        }

        await lead.save();

        // Auto-generate follow-ups if status is under_review
        if (status === 'under_review') {
            await createAutoFollowUps(lead._id, lead.assignedTo);
        }

        // Audit log only if status changed or note added
        if (lead.status !== oldStatus) {
            logger.info(`Lead ${lead.leadId} status updated from ${oldStatus} to ${lead.status}`);
            await logLead(req, 'lead_status_updated', `Updated lead ${lead.leadId} status from ${oldStatus} to ${lead.status}`, lead, {
                leadContact: lead.contactInfo.name,
                oldStatus: oldStatus,
                newStatus: lead.status,
                vehicle: lead.vehicleInfo ? `${lead.vehicleInfo.make} ${lead.vehicleInfo.model}` : 'N/A'
            });
        } else if (notes && notes.trim()) {
            logger.info(`Note added to lead ${lead.leadId} by ${req.user.email}`);
            await logLead(req, 'lead_note_added', `Added note to lead ${lead.leadId}`, lead, {
                leadContact: lead.contactInfo.name,
                noteContent: notes.substring(0, 100) + (notes.length > 100 ? '...' : ''),
                vehicle: lead.vehicleInfo ? `${lead.vehicleInfo.make} ${lead.vehicleInfo.model}` : 'N/A'
            });
        }

        res.status(200).json({
            success: true,
            message: lead.status !== oldStatus ? 'Lead status updated' : 'Note added successfully',
            data: lead
        });
    } catch (error) {
        logger.error('Update lead status error:', error);
        next(error);
    }
};

/**
 * @desc    Create Purchase Order
 * @route   POST /api/v1/purchases/po
 * @access  Private (Admin, Manager)
 */
exports.createPurchaseOrder = async (req, res, next) => {
    try {
        const { vehicleId, amount, investorAllocations, notes } = req.body;

        // Validate vehicle exists
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found'
            });
        }

        // Validate investor allocations
        let totalAllocation = 0;
        for (const allocation of investorAllocations) {
            const investor = await Investor.findById(allocation.investorId);
            if (!investor) {
                return res.status(404).json({
                    success: false,
                    message: `Investor not found: ${allocation.investorId}`
                });
            }

            // Check if investor has enough credit
            const remainingCredit = investor.creditLimit - investor.utilizedAmount;
            if (allocation.amount > remainingCredit) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient credit for investor ${investor.name}. Available: ${remainingCredit}, Required: ${allocation.amount}`
                });
            }

            totalAllocation += allocation.amount;
        }

        // Validate total allocation matches amount
        if (Math.abs(totalAllocation - amount) > 0.01) {
            return res.status(400).json({
                success: false,
                message: `Total investor allocation (${totalAllocation}) must equal PO amount (${amount})`
            });
        }

        // Create PO
        const po = await PurchaseOrder.create({
            vehicleId,
            amount,
            investorAllocations,
            notes,
            status: 'draft',
            createdBy: req.userId,
            createdByModel: req.userRole === 'admin' ? 'Admin' : 'Manager'
        });

        // Update vehicle
        vehicle.purchaseMeta = {
            purchaseOrderId: po._id,
            negotiatedPrice: amount
        };
        vehicle.investorAllocation = investorAllocations;
        vehicle.status = 'approved';
        await vehicle.save();

        // Update investor utilization (will be finalized on PO approval)
        for (const allocation of investorAllocations) {
            await Investor.findByIdAndUpdate(allocation.investorId, {
                $inc: { utilizedAmount: allocation.amount },
                $push: {
                    investments: {
                        carId: vehicleId,
                        amount: allocation.amount,
                        percentage: allocation.percentage,
                        status: 'active'
                    }
                }
            });
        }

        logger.info(`Purchase Order ${po.poId} created for vehicle ${vehicle.vehicleId}`);

        // Audit log with readable investor names
        const investorDetails = await Promise.all(
            investorAllocations.map(async (inv) => {
                const investor = await Investor.findById(inv.investorId).select('name email');
                return {
                    name: investor?.name,
                    email: investor?.email,
                    amount: inv.amount,
                    percentage: inv.percentage
                };
            })
        );

        await logPurchaseOrder(req, 'po_created', `Created Purchase Order ${po.poId} for vehicle ${vehicle.vehicleId} - Amount: AED ${amount.toLocaleString()}`, po, {
            vehicle: `${vehicle.make} ${vehicle.model} ${vehicle.year}`,
            totalAmount: amount,
            investorCount: investorAllocations.length,
            investors: investorDetails.map(inv => `${inv.name} (${inv.percentage}% - AED ${inv.amount.toLocaleString()})`).join(', ')
        });

        res.status(201).json({
            success: true,
            message: 'Purchase Order created successfully',
            data: po
        });
    } catch (error) {
        logger.error('Create PO error:', error);
        next(error);
    }
};

/**
 * @desc    Get all Purchase Orders
 * @route   GET /api/v1/purchases/po
 * @access  Private
 */
exports.getPurchaseOrders = async (req, res, next) => {
    try {
        const { status, vehicleId } = req.query;

        const query = {};
        if (status) query.status = status;
        if (vehicleId) query.vehicleId = vehicleId;

        const pos = await PurchaseOrder.find(query)
            .populate('vehicleId')
            .populate('investorAllocations.investorId', 'name email')
            .populate('approvedBy.adminId', 'name email')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: pos.length,
            data: pos
        });
    } catch (error) {
        logger.error('Get POs error:', error);
        next(error);
    }
};

/**
 * @desc    Admin approve Purchase Order (dual approval required)
 * @route   POST /api/v1/purchases/po/:id/approve
 * @access  Private (Admin only)
 */
exports.approvePurchaseOrder = async (req, res, next) => {
    try {
        const { comments } = req.body;

        const po = await PurchaseOrder.findById(req.params.id);

        if (!po) {
            return res.status(404).json({
                success: false,
                message: 'Purchase Order not found'
            });
        }

        // Check if already approved by this admin
        if (po.hasAdminApproved(req.userId)) {
            return res.status(400).json({
                success: false,
                message: 'You have already approved this Purchase Order'
            });
        }

        // Add approval
        po.approvedBy.push({
            adminId: req.userId,
            comments
        });

        // Check if dual approval is met (2 of 4)
        if (po.isDualApprovalMet()) {
            po.status = 'approved';
            logger.info(`Purchase Order ${po.poId} approved with dual approval`);
        } else {
            po.status = 'pending_approval';
            logger.info(`Purchase Order ${po.poId} received approval 1 of 2`);
        }

        await po.save();

        // Audit log - CRITICAL approval event
        await logApproval(req, 'po_approved',
            `Admin ${req.user.name} approved Purchase Order ${po.poId} (${po.approvedBy.length}/2)`,
            po, 'PurchaseOrder', {
            approvalCount: po.approvedBy.length,
            isDualApprovalMet: po.isDualApprovalMet(),
            amount: po.amount,
            comments
        }
        );

        res.status(200).json({
            success: true,
            message: po.isDualApprovalMet() ? 'Purchase Order approved' : 'Approval recorded. One more approval needed.',
            data: po
        });
    } catch (error) {
        logger.error('Approve PO error:', error);
        next(error);
    }
};

/**
 * @desc    Get single vehicle by ID
 * @route   GET /api/v1/purchases/inventory/:id
 * @access  Private
 */
exports.getVehicleById = async (req, res, next) => {
    try {
        const lead = await Lead.findById(req.params.id)
            .populate('createdBy', 'name email')
            .populate('investorAllocations.investorId', 'name email')
            .populate({
                path: 'purchaseOrder',
                populate: {
                    path: 'investorAllocations.investorId',
                    select: 'name email'
                }
            })
            .populate('invoice');

        if (!lead || (lead.status !== 'inventory' && lead.status !== 'consignment')) {
            return res.status(404).json({
                success: false,
                message: 'Inventory item not found'
            });
        }

        // Fetch all invoices for this purchase order (one per investor)
        const Invoice = require('../models/Invoice');
        const allInvoices = lead.purchaseOrder
            ? await Invoice.find({ purchaseOrderId: lead.purchaseOrder._id })
                .populate('investorId', 'name email')
                .sort({ createdAt: 1 })
            : [];

        // Transform attachment URLs for inline PDF viewing
        const { getInlineViewUrl } = require('../cloudinary');
        if (lead.attachments) {
            lead.attachments = lead.attachments.map(attachment => ({
                ...attachment.toObject(),
                viewUrl: getInlineViewUrl(attachment.url, attachment.fileType, lead._id, attachment._id)
            }));
        }

        const allocationSource = (lead.purchaseOrder?.investorAllocations && lead.purchaseOrder.investorAllocations.length > 0)
            ? lead.purchaseOrder.investorAllocations
            : lead.investorAllocations || [];
        const primaryAllocation = allocationSource?.[0];
        const primaryInvestorDoc = primaryAllocation?.investorId;
        const investorSummary = primaryInvestorDoc
            ? {
                _id: primaryInvestorDoc._id || primaryInvestorDoc,
                name: primaryInvestorDoc.name,
                email: primaryInvestorDoc.email
            }
            : null;

        // Transform to match expected format
        const vehicle = {
            _id: lead._id,
            leadId: lead.leadId,
            vehicleId: lead.leadId,
            make: lead.vehicleInfo?.make,
            model: lead.vehicleInfo?.model,
            year: lead.vehicleInfo?.year,
            mileage: lead.vehicleInfo?.mileage,
            color: lead.vehicleInfo?.color,
            trim: lead.vehicleInfo?.trim,
            region: lead.vehicleInfo?.region,
            vin: lead.vehicleInfo?.vin,
            status: lead.status,
            purchasePrice: lead.priceAnalysis?.purchasedFinalPrice,
            askingPrice: lead.vehicleInfo?.askingPrice,
            minSellingPrice: lead.priceAnalysis?.minSellingPrice,
            maxSellingPrice: lead.priceAnalysis?.maxSellingPrice,
            attachments: lead.attachments || [],
            contactInfo: lead.contactInfo || {},
            investor: investorSummary,
            investorAllocation: lead.purchaseOrder?.investorAllocations || [],
            purchaseOrder: lead.purchaseOrder,
            invoice: lead.invoice, // Keep for backward compatibility
            invoices: allInvoices, // Add all invoices array
            operationalChecklist: lead.operationalChecklist || {},
            createdBy: lead.createdBy,
            createdAt: lead.createdAt,
            updatedAt: lead.updatedAt
        };

        res.status(200).json({
            success: true,
            data: vehicle
        });
    } catch (error) {
        logger.error('Get vehicle by ID error:', error);
        next(error);
    }
};

/**
 * @desc    Get inventory
 * @route   GET /api/v1/purchases/inventory
 * @access  Private
 */
exports.getInventory = async (req, res, next) => {
    try {
        const { status, make, model, search } = req.query;

        // Include both inventory and consignment by default, or filter by provided status
        const query = {
            status: status && (status === 'inventory' || status === 'consignment')
                ? status
                : { $in: ['inventory', 'consignment'] }
        };

        if (make) query['vehicleInfo.make'] = { $regex: make, $options: 'i' };
        if (model) query['vehicleInfo.model'] = { $regex: model, $options: 'i' };

        if (search) {
            query.$or = [
                { leadId: { $regex: search, $options: 'i' } },
                { 'vehicleInfo.make': { $regex: search, $options: 'i' } },
                { 'vehicleInfo.model': { $regex: search, $options: 'i' } },
                { 'vehicleInfo.vin': { $regex: search, $options: 'i' } }
            ];
        }

        const inventory = await Lead.find(query)
            .populate('investorAllocations.investorId', 'name email')
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 });

        // Transform leads to match expected format
        const transformedInventory = inventory.map(lead => {
            const allocationSource = Array.isArray(lead.investorAllocations) ? lead.investorAllocations : [];
            const primaryAllocation = allocationSource[0];
            const investorDoc = primaryAllocation?.investorId;
            const investorSummary = investorDoc
                ? {
                    _id: investorDoc._id || investorDoc,
                    name: investorDoc.name,
                    email: investorDoc.email
                }
                : null;

            return {
                _id: lead._id,
                leadId: lead.leadId,
                vehicleId: lead.leadId, // Use leadId as vehicleId for compatibility
                make: lead.vehicleInfo?.make,
                model: lead.vehicleInfo?.model,
                year: lead.vehicleInfo?.year,
                mileage: lead.vehicleInfo?.mileage,
                color: lead.vehicleInfo?.color,
                trim: lead.vehicleInfo?.trim,
                region: lead.vehicleInfo?.region,
                vin: lead.vehicleInfo?.vin,
                status: lead.status,
                purchasePrice: lead.priceAnalysis?.purchasedFinalPrice,
                askingPrice: lead.vehicleInfo?.askingPrice,
                minSellingPrice: lead.priceAnalysis?.minSellingPrice,
                maxSellingPrice: lead.priceAnalysis?.maxSellingPrice,
                attachments: lead.attachments || [],
                operationalChecklist: lead.operationalChecklist || {},
                investor: investorSummary,
                createdBy: lead.createdBy,
                createdAt: lead.createdAt,
                updatedAt: lead.updatedAt
            };
        });

        res.status(200).json({
            success: true,
            count: transformedInventory.length,
            data: transformedInventory
        });
    } catch (error) {
        logger.error('Get inventory error:', error);
        next(error);
    }
};

/**
 * @desc    Mark vehicle as ready for sale (when operational checklist complete)
 * @route   PUT /api/v1/purchases/vehicles/:id/mark-ready
 * @access  Private (Admin, Manager)
 */
exports.markVehicleAsReady = async (req, res, next) => {
    try {
        const vehicle = await Vehicle.findById(req.params.id)
            .populate('investorAllocation.investorId', 'name email');

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found'
            });
        }

        // Check if checklist is complete
        if (!vehicle.isOperationalChecklistComplete()) {
            return res.status(400).json({
                success: false,
                message: 'All operational checklist items must be completed before marking as ready for sale'
            });
        }

        // Update vehicle status
        vehicle.status = 'ready_for_sale';
        await vehicle.save();

        // Update investor SOA and recent investments
        if (vehicle.investorAllocation && vehicle.investorAllocation.length > 0) {
            for (const allocation of vehicle.investorAllocation) {
                if (allocation.investorId) {
                    // Update investor SOA
                    await updateInvestorSOA(allocation.investorId._id, vehicle, allocation);

                    // Update recent investments
                    await updateRecentInvestments(allocation.investorId._id, vehicle, allocation);
                }
            }
        }

        logger.info(`Vehicle ${vehicle.vehicleId} marked as ready for sale`);

        res.status(200).json({
            success: true,
            message: 'Vehicle marked as ready for sale',
            data: vehicle
        });
    } catch (error) {
        logger.error('Mark vehicle as ready error:', error);
        next(error);
    }
};

// Helper function to update investor SOA
const updateInvestorSOA = async (investorId, vehicle, allocation) => {
    try {
        const InvestorSOA = require('../models/InvestorSOA');

        // Find or create SOA record
        let soa = await InvestorSOA.findOne({ investorId });
        if (!soa) {
            soa = new InvestorSOA({
                investorId,
                creditLimit: 0,
                utilizedAmount: 0,
                remainingCredit: 0,
                recentInvestments: [],
                transactions: []
            });
        }

        // Add vehicle to recent investments
        const investment = {
            vehicleId: vehicle._id,
            vehicleInfo: {
                make: vehicle.make,
                model: vehicle.model,
                year: vehicle.year,
                vehicleId: vehicle.vehicleId
            },
            investmentAmount: allocation.amount,
            investmentPercentage: allocation.percentage,
            status: 'ready_for_sale',
            investmentDate: new Date()
        };

        soa.recentInvestments.unshift(investment);

        // Keep only last 10 investments
        if (soa.recentInvestments.length > 10) {
            soa.recentInvestments = soa.recentInvestments.slice(0, 10);
        }

        // Add transaction
        soa.transactions.push({
            type: 'vehicle_ready',
            amount: allocation.amount,
            description: `Vehicle ${vehicle.vehicleId} marked as ready for sale`,
            date: new Date(),
            vehicleId: vehicle._id
        });

        await soa.save();
        logger.info(`Updated SOA for investor ${investorId}`);
    } catch (error) {
        logger.error('Error updating investor SOA:', error);
    }
};

function normalizeLeadAllocations(lead, options = {}) {
    const purchasePrice = options.purchasePrice != null
        ? Number(options.purchasePrice)
        : Number(lead?.priceAnalysis?.purchasedFinalPrice || 0);

    const allocations = Array.isArray(lead?.investorAllocations)
        ? lead.investorAllocations
        : [];

    return allocations.map((allocation) => {
        const investorId = allocation?.investorId?._id || allocation?.investorId;
        if (!investorId) {
            return null;
        }

        const investorDoc = allocation?.investorId && allocation.investorId._id
            ? allocation.investorId
            : (allocation.investor || null);
        const investorPlain = investorDoc
            ? (typeof investorDoc.toObject === 'function' ? investorDoc.toObject() : { ...investorDoc })
            : null;

        let percentage = Number(allocation?.percentage);
        const hasValidPercentage = !Number.isNaN(percentage) && percentage > 0;

        if (!hasValidPercentage && allocation?.amount != null && allocation.amount !== '' && purchasePrice > 0) {
            percentage = Number(((Number(allocation.amount) / purchasePrice) * 100).toFixed(2));
        }

        if (Number.isNaN(percentage)) {
            percentage = 0;
        }

        let amount = 0;
        if (allocation?.amount != null && allocation.amount !== '') {
            amount = Number(allocation.amount);
        } else if (purchasePrice > 0 && percentage > 0) {
            amount = Number(((percentage / 100) * purchasePrice).toFixed(2));
        }

        return {
            investorId,
            investor: investorPlain || undefined,
            name: investorPlain?.name,
            email: investorPlain?.email,
            percentage,
            amount
        };
    }).filter(Boolean);
}

const roundToCurrency = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return 0;
    }
    return Math.round((num + Number.EPSILON) * 100) / 100;
};

function computeInvestorInvoiceShare(allocation, totals) {
    const {
        totalPayable,
        buyingPrice,
        charges = {},
        costAssignments = {},
        baseAmountTotal,
        basePercentageTotal,
        allocationCount
    } = totals;

    const investorRawId = allocation?.investorId?._id || allocation?.investorId;
    const investorKey = investorRawId ? investorRawId.toString() : null;

    const allocationAmount = Number(allocation?.amount) || 0;
    const allocationPercentage = Number(allocation?.percentage) || 0;

    let ratio = null;
    if (baseAmountTotal && allocationAmount > 0) {
        ratio = allocationAmount / baseAmountTotal;
    }
    if ((ratio == null || !Number.isFinite(ratio) || ratio <= 0) && basePercentageTotal > 0 && allocationPercentage > 0) {
        ratio = allocationPercentage / basePercentageTotal;
    }
    if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) {
        const count = allocationCount || 1;
        ratio = 1 / count;
    }

    const shareFromPool = (value) => {
        const numeric = Number(value) || 0;
        if (numeric <= 0) {
            return 0;
        }
        return roundToCurrency(numeric * ratio);
    };

    const computeChargeShare = (key) => {
        const total = Number(charges[key]) || 0;
        if (total <= 0) {
            return 0;
        }
        const assignedInvestor = costAssignments[key];
        if (assignedInvestor && investorKey) {
            return assignedInvestor === investorKey ? roundToCurrency(total) : 0;
        }
        return shareFromPool(total);
    };

    const breakdown = {
        buyingPrice: shareFromPool(buyingPrice),
        transferCost: computeChargeShare('transferCost'),
        detailingInspectionCost: computeChargeShare('detailingInspectionCost'),
        agentCommission: computeChargeShare('agentCommission'),
        carRecoveryCost: computeChargeShare('carRecoveryCost'),
        otherCharges: computeChargeShare('otherCharges')
    };

    const computedTotal = roundToCurrency(
        breakdown.buyingPrice +
        breakdown.transferCost +
        breakdown.detailingInspectionCost +
        breakdown.agentCommission +
        breakdown.carRecoveryCost +
        breakdown.otherCharges
    );

    const derivedPercentage = totalPayable > 0
        ? roundToCurrency((computedTotal / totalPayable) * 100)
        : allocationPercentage;

    return {
        amount: computedTotal,
        percentage: allocationPercentage > 0 ? allocationPercentage : derivedPercentage,
        breakdown
    };
}

// Helper function to update recent investments
const updateRecentInvestments = async (investorId, vehicle, allocation) => {
    try {
        const Investor = require('../models/Investor');

        const investor = await Investor.findById(investorId);
        if (investor) {
            // Update utilization if needed
            // This would depend on your business logic for how utilization is calculated
            logger.info(`Updated recent investments for investor ${investorId}`);
        }
    } catch (error) {
        logger.error('Error updating recent investments:', error);
    }
};

/**
 * @desc    Update vehicle operational checklist
 * @route   PUT /api/v1/purchases/:vehicleId/checklist
 * @access  Private (Admin, Manager)
 */
exports.updateChecklist = async (req, res, next) => {
    try {
        const { checklistItem, completed, notes } = req.body;

        const vehicle = await Vehicle.findById(req.params.vehicleId);

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found'
            });
        }

        // Update checklist item
        if (vehicle.operationalChecklist[checklistItem]) {
            vehicle.operationalChecklist[checklistItem].completed = completed;
            vehicle.operationalChecklist[checklistItem].completedBy = req.userId;
            vehicle.operationalChecklist[checklistItem].completedAt = completed ? new Date() : undefined;
            vehicle.operationalChecklist[checklistItem].notes = notes || '';

            await vehicle.save();

            // Auto-transition to ready_for_sale if all items complete
            if (vehicle.isOperationalChecklistComplete() && vehicle.status === 'in_inventory') {
                vehicle.status = 'ready_for_sale';
                await vehicle.save();
                logger.info(`Vehicle ${vehicle.vehicleId} auto-transitioned to ready_for_sale`);
            }

            res.status(200).json({
                success: true,
                message: 'Checklist updated successfully',
                data: vehicle
            });
        } else {
            res.status(400).json({
                success: false,
                message: 'Invalid checklist item'
            });
        }
    } catch (error) {
        logger.error('Update checklist error:', error);
        next(error);
    }
};

/**
 * @desc    Edit a specific note
 * @route   PUT /api/v1/purchases/leads/:id/notes/:noteId
 * @access  Private (Admin and Manager can only edit their own notes)
 */
exports.editNote = async (req, res, next) => {
    try {
        const { noteId } = req.params;
        const { content } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Note content is required'
            });
        }

        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Find the note
        const noteIndex = lead.notes.findIndex(note => note._id.toString() === noteId);

        if (noteIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Note not found'
            });
        }

        const note = lead.notes[noteIndex];

        // Permission check
        if (req.userRole === 'manager') {
            // Check if lead is accessible
            const assignedToId = lead.assignedTo?._id || lead.assignedTo;
            const isAssignedToThisManager = assignedToId?.toString() === req.userId.toString();
            const isUnassigned = !assignedToId;

            if (!isAssignedToThisManager && !isUnassigned) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. This lead is assigned to another manager.'
                });
            }

            // Manager can only edit their own notes
            if (note.addedBy.toString() !== req.userId.toString()) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only edit your own notes.'
                });
            }
        }

        // Admin can only edit their own notes
        if (req.userRole === 'admin') {
            if (note.addedBy.toString() !== req.userId.toString()) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only edit your own notes.'
                });
            }
        }

        // Store old content for audit
        const oldContent = note.content;

        // Update note
        lead.notes[noteIndex].content = content.trim();
        lead.notes[noteIndex].editedAt = new Date();
        lead.notes[noteIndex].editedBy = req.userId;
        lead.notes[noteIndex].editedByModel = req.userRole === 'admin' ? 'Admin' : 'Manager';

        await lead.save();

        logger.info(`Note edited on lead ${lead.leadId} by ${req.user.email}`);

        // Audit log
        await logLead(req, 'lead_note_edited', `Edited note on lead ${lead.leadId}`, lead, {
            leadContact: lead.contactInfo.name,
            oldContent: oldContent.substring(0, 100) + (oldContent.length > 100 ? '...' : ''),
            newContent: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
            vehicle: lead.vehicleInfo ? `${lead.vehicleInfo.make} ${lead.vehicleInfo.model}` : 'N/A'
        });

        res.status(200).json({
            success: true,
            message: 'Note updated successfully',
            data: lead
        });
    } catch (error) {
        logger.error('Edit note error:', error);
        next(error);
    }
};

/**
 * @desc    Delete a specific note
 * @route   DELETE /api/v1/purchases/leads/:id/notes/:noteId
 * @access  Private (Admin can delete ANY note, Manager can delete own notes only)
 */
exports.deleteNote = async (req, res, next) => {
    try {
        const { noteId } = req.params;

        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Find the note
        const noteIndex = lead.notes.findIndex(note => note._id.toString() === noteId);

        if (noteIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Note not found'
            });
        }

        const note = lead.notes[noteIndex];

        // Permission check
        if (req.userRole === 'manager') {
            // Check if lead is accessible
            const assignedToId = lead.assignedTo?._id || lead.assignedTo;
            const isAssignedToThisManager = assignedToId?.toString() === req.userId.toString();
            const isUnassigned = !assignedToId;

            if (!isAssignedToThisManager && !isUnassigned) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. This lead is assigned to another manager.'
                });
            }

            // Manager can only delete their own notes
            if (note.addedBy.toString() !== req.userId.toString()) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only delete your own notes.'
                });
            }
        }

        // Store note content for audit before deletion
        const deletedContent = note.content;

        // Remove note
        lead.notes.splice(noteIndex, 1);

        await lead.save();

        logger.info(`Note deleted from lead ${lead.leadId} by ${req.user.email}`);

        // Audit log
        await logLead(req, 'lead_note_deleted', `Deleted note from lead ${lead.leadId}`, lead, {
            leadContact: lead.contactInfo.name,
            deletedContent: deletedContent.substring(0, 100) + (deletedContent.length > 100 ? '...' : ''),
            vehicle: lead.vehicleInfo ? `${lead.vehicleInfo.make} ${lead.vehicleInfo.model}` : 'N/A'
        });

        res.status(200).json({
            success: true,
            message: 'Note deleted successfully',
            data: lead
        });
    } catch (error) {
        logger.error('Delete note error:', error);
        next(error);
    }
};

/**
 * @desc    Upload documents to lead
 * @route   POST /api/v1/purchases/leads/:id/documents
 * @access  Private (Admin, Manager)
 */
exports.uploadDocuments = async (req, res, next) => {
    try {
        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Check manager access
        if (req.userRole === 'manager') {
            const assignedToId = lead.assignedTo?._id || lead.assignedTo;
            const isAssignedToThisManager = assignedToId?.toString() === req.userId.toString();
            const isUnassigned = !assignedToId;

            if (!isAssignedToThisManager && !isUnassigned) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. This lead is assigned to another manager.'
                });
            }
        }

        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No files uploaded'
            });
        }

        // Files uploaded to Cloudinary via multer
        // Process categorized files
        const uploadedDocs = [];

        // Handle single file categories
        ['inspectionReport', 'registrationCard', 'onlineHistoryCheck'].forEach(category => {
            if (req.files[category] && req.files[category][0]) {
                const file = req.files[category][0];
                uploadedDocs.push({
                    category: category,
                    fileName: file.originalname,
                    fileType: file.mimetype,
                    fileSize: file.size,
                    url: file.path, // Cloudinary URL
                    publicId: file.filename, // Cloudinary public ID
                    uploadedBy: req.userId,
                    uploadedByModel: req.userRole === 'admin' ? 'Admin' : 'Manager',
                    uploadedAt: new Date()
                });
            }
        });

        // Handle multiple car pictures
        if (req.files['carPictures']) {
            req.files['carPictures'].forEach(file => {
                uploadedDocs.push({
                    category: 'carPictures',
                    fileName: file.originalname,
                    fileType: file.mimetype,
                    fileSize: file.size,
                    url: file.path, // Cloudinary URL
                    publicId: file.filename, // Cloudinary public ID
                    uploadedBy: req.userId,
                    uploadedByModel: req.userRole === 'admin' ? 'Admin' : 'Manager',
                    uploadedAt: new Date()
                });
            });
        }

        lead.attachments = [...(lead.attachments || []), ...uploadedDocs];
        await lead.save();

        logger.info(`${uploadedDocs.length} document(s) uploaded to lead ${lead.leadId}`);

        // Audit log
        const categoryCount = {
            inspectionReport: uploadedDocs.filter(d => d.category === 'inspectionReport').length,
            registrationCard: uploadedDocs.filter(d => d.category === 'registrationCard').length,
            carPictures: uploadedDocs.filter(d => d.category === 'carPictures').length,
            onlineHistoryCheck: uploadedDocs.filter(d => d.category === 'onlineHistoryCheck').length
        };

        await logLead(req, 'lead_documents_uploaded', `Uploaded ${uploadedDocs.length} document(s) to lead ${lead.leadId}`, lead, {
            leadContact: lead.contactInfo.name,
            documentCount: uploadedDocs.length,
            categories: categoryCount,
            fileNames: uploadedDocs.map(d => `${d.category}: ${d.fileName}`).join(', ')
        });

        res.status(200).json({
            success: true,
            message: 'Documents uploaded successfully',
            data: lead
        });
    } catch (error) {
        logger.error('Upload documents error:', error);
        next(error);
    }
};

/**
 * @desc    Delete document from lead
 * @route   DELETE /api/v1/purchases/leads/:id/documents/:docId
 * @access  Private (Admin only)
 */
exports.deleteDocument = async (req, res, next) => {
    try {
        const { docId } = req.params;
        const { cloudinary } = require('../cloudinary');

        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        const docIndex = lead.attachments.findIndex(doc => doc._id.toString() === docId);

        if (docIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Document not found'
            });
        }

        const deletedDoc = lead.attachments[docIndex];

        // Delete from Cloudinary
        if (deletedDoc.publicId) {
            try {
                // PDFs are uploaded as 'raw', images as 'image'
                const resourceType = deletedDoc.fileType === 'application/pdf' ? 'raw' : 'image';
                await cloudinary.uploader.destroy(deletedDoc.publicId, { resource_type: resourceType });
                logger.info(`File deleted from Cloudinary: ${deletedDoc.publicId}`);
            } catch (cloudError) {
                logger.error('Cloudinary deletion error:', cloudError);
                // Continue with database deletion even if Cloudinary fails
            }
        }

        // Remove document from database
        lead.attachments.splice(docIndex, 1);
        await lead.save();

        logger.info(`Document deleted from lead ${lead.leadId}`);

        // Audit log
        await logLead(req, 'lead_document_deleted', `Deleted document from lead ${lead.leadId}`, lead, {
            leadContact: lead.contactInfo.name,
            fileName: deletedDoc.fileName,
            category: deletedDoc.category
        });

        res.status(200).json({
            success: true,
            message: 'Document deleted successfully',
            data: lead
        });
    } catch (error) {
        logger.error('Delete document error:', error);
        next(error);
    }
};

/**
 * @desc    View document inline (proxy endpoint)
 * @route   GET /api/v1/purchases/leads/:leadId/documents/:docId/view
 * @access  Private (Admin, Manager)
 */
exports.viewDocument = async (req, res, next) => {
    try {
        const { leadId, docId } = req.params;
        const axios = require('axios');

        // Find the lead
        const lead = await Lead.findById(leadId);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Check access permissions (manager can only view their assigned or unassigned leads)
        if (req.userRole === 'manager') {
            const assignedToId = lead.assignedTo?._id || lead.assignedTo;
            const isAssignedToThisManager = assignedToId?.toString() === req.userId.toString();
            const isUnassigned = !assignedToId;

            if (!isAssignedToThisManager && !isUnassigned) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. This lead is assigned to another manager.'
                });
            }
        }

        // Find the document
        const document = lead.attachments.find(doc => doc._id.toString() === docId);

        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document not found'
            });
        }

        // Get the Cloudinary URL directly
        const cloudinaryUrl = document.url;

        logger.info(`Proxying document from Cloudinary: ${cloudinaryUrl}`);

        // Fetch the file from Cloudinary
        const response = await axios.get(cloudinaryUrl, {
            responseType: 'arraybuffer'
        });

        // Determine content type
        const contentType = document.fileType || 'application/octet-stream';

        // Set headers to force inline viewing
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

        // Send the file
        res.send(Buffer.from(response.data));

    } catch (error) {
        logger.error('View document error:', error);
        if (error.response?.status === 404) {
            return res.status(404).json({
                success: false,
                message: 'Document not found in Cloudinary'
            });
        }
        next(error);
    }
};

/**
 * @desc    Upload invoice evidence for PO cost field
 * @route   POST /api/v1/purchases/po/:poId/cost-invoice-evidence/:costType
 * @access  Private (Admin)
 */
exports.uploadCostInvoiceEvidence = async (req, res, next) => {
    try {
        const { poId, costType } = req.params;
        const { cloudinary } = require('../cloudinary');
        const Invoice = require('../models/Invoice');

        const purchaseOrder = await PurchaseOrder.findById(poId);
        if (!purchaseOrder) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found'
            });
        }

        const validCostTypes = ['transferCost', 'detailingInspectionCost', 'agentCommission', 'carRecoveryCost', 'otherCharges'];
        if (!validCostTypes.includes(costType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid cost type'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        // Map cost type to investor assignment field in PurchaseOrder
        const costTypeToInvestorField = {
            'transferCost': 'transferCostInvestor',
            'detailingInspectionCost': 'detailingInspectionCostInvestor',
            'agentCommission': 'agentCommissionInvestor',
            'carRecoveryCost': 'carRecoveryCostInvestor',
            'otherCharges': 'otherChargesInvestor'
        };

        const investorField = costTypeToInvestorField[costType];
        const responsibleInvestorId = purchaseOrder[investorField];

        if (!responsibleInvestorId) {
            return res.status(400).json({
                success: false,
                message: `No investor assigned for ${costType}. Please assign an investor first.`
            });
        }

        // Find the invoice for this investor and purchase order
        const invoice = await Invoice.findOne({
            purchaseOrderId: poId,
            investorId: responsibleInvestorId
        });

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found for the assigned investor. Please ensure the invoice has been generated.'
            });
        }

        // Delete existing evidence if any
        const existingEvidence = invoice.costInvoiceEvidence?.[costType];
        if (existingEvidence?.publicId) {
            try {
                const resourceType = existingEvidence.fileType === 'application/pdf' ? 'raw' : 'image';
                await cloudinary.uploader.destroy(existingEvidence.publicId, { resource_type: resourceType });
            } catch (cloudError) {
                logger.error('Error deleting existing evidence from Cloudinary:', cloudError);
            }
        }

        // Store new evidence in the invoice
        if (!invoice.costInvoiceEvidence) {
            invoice.costInvoiceEvidence = {};
        }

        invoice.costInvoiceEvidence[costType] = {
            fileName: req.file.originalname,
            fileType: req.file.mimetype,
            fileSize: req.file.size,
            url: req.file.path,
            publicId: req.file.filename,
            uploadedBy: req.userId,
            uploadedByModel: req.userRole === 'admin' ? 'Admin' : 'Manager',
            uploadedAt: new Date()
        };

        await invoice.save();

        logger.info(`Invoice evidence uploaded for Invoice ${invoice.invoiceNo}, cost type: ${costType}, investor: ${responsibleInvestorId}`);

        res.status(200).json({
            success: true,
            message: 'Invoice evidence uploaded successfully',
            data: invoice
        });
    } catch (error) {
        logger.error('Upload cost invoice evidence error:', error);
        next(error);
    }
};

/**
 * @desc    Delete invoice evidence for PO cost field
 * @route   DELETE /api/v1/purchases/po/:poId/cost-invoice-evidence/:costType
 * @access  Private (Admin)
 */
exports.deleteCostInvoiceEvidence = async (req, res, next) => {
    try {
        const { poId, costType } = req.params;
        const { cloudinary } = require('../cloudinary');
        const Invoice = require('../models/Invoice');

        const purchaseOrder = await PurchaseOrder.findById(poId);
        if (!purchaseOrder) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found'
            });
        }

        const validCostTypes = ['transferCost', 'detailingInspectionCost', 'agentCommission', 'carRecoveryCost', 'otherCharges'];
        if (!validCostTypes.includes(costType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid cost type'
            });
        }

        // Map cost type to investor assignment field in PurchaseOrder
        const costTypeToInvestorField = {
            'transferCost': 'transferCostInvestor',
            'detailingInspectionCost': 'detailingInspectionCostInvestor',
            'agentCommission': 'agentCommissionInvestor',
            'carRecoveryCost': 'carRecoveryCostInvestor',
            'otherCharges': 'otherChargesInvestor'
        };

        const investorField = costTypeToInvestorField[costType];
        const responsibleInvestorId = purchaseOrder[investorField];

        if (!responsibleInvestorId) {
            return res.status(400).json({
                success: false,
                message: `No investor assigned for ${costType}.`
            });
        }

        // Find the invoice for this investor and purchase order
        const invoice = await Invoice.findOne({
            purchaseOrderId: poId,
            investorId: responsibleInvestorId
        });

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found for the assigned investor.'
            });
        }

        const evidence = invoice.costInvoiceEvidence?.[costType];
        if (!evidence) {
            return res.status(404).json({
                success: false,
                message: 'Invoice evidence not found'
            });
        }

        // Delete from Cloudinary
        if (evidence.publicId) {
            try {
                const resourceType = evidence.fileType === 'application/pdf' ? 'raw' : 'image';
                await cloudinary.uploader.destroy(evidence.publicId, { resource_type: resourceType });
            } catch (cloudError) {
                logger.error('Error deleting evidence from Cloudinary:', cloudError);
            }
        }

        // Remove from database using $unset
        await Invoice.updateOne(
            { _id: invoice._id },
            { $unset: { [`costInvoiceEvidence.${costType}`]: '' } }
        );
        
        // Refresh the document
        const updatedInvoice = await Invoice.findById(invoice._id);

        logger.info(`Invoice evidence deleted for Invoice ${invoice.invoiceNo}, cost type: ${costType}`);

        res.status(200).json({
            success: true,
            message: 'Invoice evidence deleted successfully',
            data: updatedInvoice
        });
    } catch (error) {
        logger.error('Delete cost invoice evidence error:', error);
        next(error);
    }
};

/**
 * @desc    Update price analysis for a lead
 * @route   PUT /api/v1/purchases/leads/:id/price-analysis
 * @access  Private (Admin, Manager)
 */
exports.updatePriceAnalysis = async (req, res, next) => {
    try {
        // Normalize empty strings to null
        let { minSellingPrice, maxSellingPrice, purchasedFinalPrice, vin } = req.body;

        minSellingPrice = minSellingPrice || null;
        maxSellingPrice = maxSellingPrice || null;
        purchasedFinalPrice = purchasedFinalPrice || null;

        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Check access permissions (manager can only update their assigned leads)
        if (req.userRole === 'manager') {
            const assignedToId = lead.assignedTo?._id || lead.assignedTo;
            const isAssignedToThisManager = assignedToId?.toString() === req.userId.toString();
            const isUnassigned = !assignedToId;

            if (!isAssignedToThisManager && !isUnassigned) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. This lead is assigned to another manager.'
                });
            }
        }

        // Validate that at least one selling price is provided
        if (!minSellingPrice && !maxSellingPrice) {
            return res.status(400).json({
                success: false,
                message: 'At least Minimum or Maximum Selling Price must be provided'
            });
        }

        // Validate min < max if both provided
        if (minSellingPrice && maxSellingPrice && parseFloat(minSellingPrice) > parseFloat(maxSellingPrice)) {
            return res.status(400).json({
                success: false,
                message: 'Minimum Selling Price cannot be greater than Maximum Selling Price'
            });
        }

        // Update price analysis
        lead.priceAnalysis = {
            minSellingPrice: minSellingPrice ? parseFloat(minSellingPrice) : lead.priceAnalysis?.minSellingPrice,
            maxSellingPrice: maxSellingPrice ? parseFloat(maxSellingPrice) : lead.priceAnalysis?.maxSellingPrice,
            purchasedFinalPrice: purchasedFinalPrice ? parseFloat(purchasedFinalPrice) : lead.priceAnalysis?.purchasedFinalPrice,
            updatedAt: Date.now(),
            updatedBy: req.userId,
            updatedByModel: req.userRole === 'admin' ? 'Admin' : 'Manager'
        };

        // Optionally update VIN (chassis number) when provided in the same request
        if (typeof vin === 'string') {
            const trimmedVin = vin.trim();
            if (trimmedVin.length === 0) {
                // Clear VIN when empty string is provided
                lead.vehicleInfo = { ...lead.vehicleInfo, vin: undefined };
            } else {
                lead.vehicleInfo = { ...lead.vehicleInfo, vin: trimmedVin };
            }
        }

        await lead.save();

        // Create audit log
        await logLead(
            req,
            'price_analysis_updated',
            `Price analysis updated for lead ${lead.leadId}`,
            lead,
            {
                minSellingPrice: lead.priceAnalysis.minSellingPrice,
                maxSellingPrice: lead.priceAnalysis.maxSellingPrice,
                purchasedFinalPrice: lead.priceAnalysis.purchasedFinalPrice,
                vin: lead.vehicleInfo?.vin
            }
        );

        res.status(200).json({
            success: true,
            message: 'Price analysis updated successfully',
            data: lead
        });
    } catch (error) {
        logger.error('Update price analysis error:', error);
        next(error);
    }
};

/**
 * @desc    Update/Edit lead details (Manager can edit when status is 'new')
 * @route   PUT /api/v1/purchases/leads/:id
 * @access  Private (Admin, Manager - only for 'new' status)
 */
exports.updateLead = async (req, res, next) => {
    try {
        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Check access permissions
        if (req.userRole === 'manager') {
            const assignedToId = lead.assignedTo?._id || lead.assignedTo;
            const isAssignedToThisManager = assignedToId?.toString() === req.userId.toString();
            const isUnassigned = !assignedToId;

            if (!isAssignedToThisManager && !isUnassigned) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. This lead is assigned to another manager.'
                });
            }

            // Managers can only edit leads with status 'new'
            if (lead.status !== 'new') {
                return res.status(403).json({
                    success: false,
                    message: 'You can only edit leads with status "new". Use status update for other changes.'
                });
            }
        }

        // Store old values for audit log
        const oldData = {
            contactInfo: { ...lead.contactInfo },
            vehicleInfo: { ...lead.vehicleInfo },
            source: lead.source,
            priority: lead.priority
        };

        // Update allowed fields
        if (req.body.contactInfo) {
            lead.contactInfo = { ...lead.contactInfo, ...req.body.contactInfo };
        }
        if (req.body.vehicleInfo) {
            lead.vehicleInfo = { ...lead.vehicleInfo, ...req.body.vehicleInfo };
        }
        if (req.body.source) lead.source = req.body.source;
        if (req.body.priority) lead.priority = req.body.priority;

        await lead.save();

        logger.info(`Lead ${lead.leadId} updated by ${req.user.email}`);

        // Audit log
        await logLead(req, 'lead_updated', `Updated lead ${lead.leadId} details`, lead, {
            leadContact: lead.contactInfo.name,
            oldContactInfo: `${oldData.contactInfo.name} (${oldData.contactInfo.phone || 'N/A'})`,
            newContactInfo: `${lead.contactInfo.name} (${lead.contactInfo.phone || 'N/A'})`,
            oldVehicle: oldData.vehicleInfo ? `${oldData.vehicleInfo.make} ${oldData.vehicleInfo.model} ${oldData.vehicleInfo.year}` : 'N/A',
            newVehicle: lead.vehicleInfo ? `${lead.vehicleInfo.make} ${lead.vehicleInfo.model} ${lead.vehicleInfo.year}` : 'N/A',
            oldSource: oldData.source,
            newSource: lead.source,
            oldPriority: oldData.priority,
            newPriority: lead.priority
        });

        res.status(200).json({
            success: true,
            message: 'Lead updated successfully',
            data: lead
        });
    } catch (error) {
        logger.error('Update lead error:', error);
        next(error);
    }
};

/**
 * @desc    Bulk update lead status
 * @route   PUT /api/v1/purchases/leads/bulk-status
 * @access  Private (Admin only)
 */
exports.bulkUpdateLeadStatus = async (req, res, next) => {
    try {
        const { leadIds, status, notes } = req.body;

        if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide an array of lead IDs'
            });
        }

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a status'
            });
        }

        // Update all leads
        const updatePromises = leadIds.map(async (leadId) => {
            const lead = await Lead.findById(leadId);
            if (!lead) return null;

            const oldStatus = lead.status;
            lead.status = status;

            // Only add notes if explicitly provided (for manual notes only, not system logs)
            if (notes && notes.trim()) {
                lead.notes.push({
                    content: notes,
                    addedBy: req.userId,
                    addedByModel: req.userRole === 'admin' ? 'Admin' : 'Manager'
                });
            }

            await lead.save();

            // Audit log
            await logLead(req, 'lead_status_updated', `Bulk updated lead ${lead.leadId} status from ${oldStatus} to ${status}`, lead, {
                leadContact: lead.contactInfo.name,
                oldStatus: oldStatus,
                newStatus: status,
                vehicle: lead.vehicleInfo ? `${lead.vehicleInfo.make} ${lead.vehicleInfo.model}` : 'N/A',
                updateType: 'bulk'
            });

            return lead;
        });

        const updatedLeads = await Promise.all(updatePromises);
        const successCount = updatedLeads.filter(l => l !== null).length;

        logger.info(`Bulk updated ${successCount} leads to status: ${status}`);

        res.status(200).json({
            success: true,
            message: `Successfully updated ${successCount} lead(s)`,
            data: {
                updatedCount: successCount,
                totalRequested: leadIds.length
            }
        });
    } catch (error) {
        logger.error('Bulk update lead status error:', error);
        next(error);
    }
};

/**
 * @desc    Assign lead to manager (Admin only)
 * @route   PUT /api/v1/purchases/leads/:id/assign
 * @access  Private (Admin only)
 */
exports.assignLead = async (req, res, next) => {
    try {
        const { assignedTo } = req.body;

        const lead = await Lead.findById(req.params.id).populate('assignedTo', 'name email');

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Get old and new manager details
        const oldManager = lead.assignedTo;
        const newManager = assignedTo ? await require('../models/Manager').findById(assignedTo).select('name email') : null;

        lead.assignedTo = assignedTo || null;
        await lead.save();

        logger.info(`Lead ${lead.leadId} assigned to manager ${assignedTo}`);

        // Audit log with readable names
        const description = assignedTo
            ? `Assigned lead ${lead.leadId} to ${newManager?.name || 'manager'} (${newManager?.email || ''})`
            : `Unassigned lead ${lead.leadId}`;

        await logLead(req, 'lead_assigned', description, lead, {
            oldManager: oldManager ? {
                id: oldManager._id || oldManager,
                name: oldManager.name,
                email: oldManager.email
            } : null,
            newManager: newManager ? {
                id: newManager._id,
                name: newManager.name,
                email: newManager.email
            } : null,
            leadContact: lead.contactInfo.name,
            vehicleInfo: lead.vehicleInfo ? `${lead.vehicleInfo.make} ${lead.vehicleInfo.model}` : 'N/A'
        });

        res.status(200).json({
            success: true,
            message: 'Lead assigned successfully',
            data: lead
        });
    } catch (error) {
        logger.error('Assign lead error:', error);
        next(error);
    }
};

/**
 * @desc    Decline lead approval (reset approval status)
 * @route   POST /api/v1/purchases/leads/:id/decline-approval
 * @access  Private (Admin only)
 */
exports.declineLeadApproval = async (req, res, next) => {
    try {
        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }

        // Check if lead is in pending or approved status
        if (!['pending', 'approved'].includes(lead.approval.status)) {
            return res.status(400).json({
                success: false,
                message: 'Can only decline leads that are pending or approved'
            });
        }

        // Reset approval status
        lead.approval = {
            status: 'not_submitted',
            approvals: []
        };

        await lead.save();

        await logApproval(req, 'lead_approval_declined',
            `Lead ${lead.leadId} approval declined and reset`,
            lead, 'Lead', {
            previousStatus: lead.approval.status,
            approvalsCount: 0
        });

        res.status(200).json({
            success: true,
            message: 'Lead approval declined and reset successfully',
            data: lead
        });
    } catch (error) {
        logger.error('Decline lead approval error:', error);
        next(error);
    }
};

/**
 * @desc    Convert lead to vehicle (manual purchase after DocuSign signing)
 * @route   POST /api/v1/purchases/leads/:id/purchase
 * @access  Private (Admin only)
 */
exports.convertLeadToVehicle = async (req, res, next) => {
    try {
        const lead = await Lead.findById(req.params.id)
            .populate('investorAllocations.investorId', 'name email')
            .populate('createdBy');

        if (!lead) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }

        // Check if lead has a purchase order and DocuSign agreement is signed
        if (!lead.purchaseOrder) {
            return res.status(400).json({
                success: false,
                message: 'Lead must have a purchase order before converting to vehicle'
            });
        }

        const purchaseOrder = await PurchaseOrder.findById(lead.purchaseOrder);
        if (!purchaseOrder || !purchaseOrder.docuSignEnvelopeId || purchaseOrder.docuSignStatus !== 'completed') {
            return res.status(400).json({
                success: false,
                message: 'Purchase Agreement must be signed before converting to vehicle'
            });
        }

        // Check if already in inventory
        if (lead.status === 'inventory') {
            return res.status(400).json({
                success: false,
                message: 'Lead is already in inventory'
            });
        }

        const normalizedAllocations = normalizeLeadAllocations(lead);

        if (normalizedAllocations.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No investors assigned to this lead. Cannot convert to vehicle.'
            });
        }

        const defaultModeOfPayment = req.body.modeOfPayment || '';
        const defaultPaymentReceivedBy = req.body.paymentReceivedBy || '';
        const investorPaymentsInput = Array.isArray(req.body.investorPayments) ? req.body.investorPayments : [];
        const investorPaymentsMap = new Map();
        for (const entry of investorPaymentsInput) {
            if (!entry?.investorId) continue;
            investorPaymentsMap.set(entry.investorId.toString(), {
                modeOfPayment: entry.modeOfPayment || '',
                paymentReceivedBy: entry.paymentReceivedBy || ''
            });
        }

        const missingPaymentInvestor = normalizedAllocations.find((allocation) => {
            const investorKey = allocation?.investorId?._id
                ? allocation.investorId._id.toString()
                : allocation?.investorId?.toString();
            const override = investorKey ? investorPaymentsMap.get(investorKey) : null;
            const modeOfPayment = override?.modeOfPayment || defaultModeOfPayment;
            const paymentReceivedBy = override?.paymentReceivedBy || defaultPaymentReceivedBy;
            return !(modeOfPayment && paymentReceivedBy);
        });

        if (missingPaymentInvestor) {
            const investorName = missingPaymentInvestor?.name || missingPaymentInvestor?.email || 'Investor';
            return res.status(400).json({
                success: false,
                message: `Mode of payment and payment receiver are required for ${investorName}.`
            });
        }

        const invoiceDate = new Date();
        const buyingPrice = Number(lead.priceAnalysis?.purchasedFinalPrice || 0);
        const transferCost = Number(purchaseOrder.transferCost || 0);
        const detailingInspectionCost = Number(purchaseOrder.detailing_inspection_cost || 0);
        const agentCommission = Number(purchaseOrder.agent_commision || 0);
        const carRecoveryCost = Number(purchaseOrder.car_recovery_cost || 0);
        const otherCharges = Number(purchaseOrder.other_charges || 0);
        const totalPayable = buyingPrice + transferCost + detailingInspectionCost + agentCommission + carRecoveryCost + otherCharges;
        const allocationSharesByInvestor = new Map();
        const baseAmountTotal = normalizedAllocations.reduce((sum, allocation) => {
            const value = Number(allocation?.amount) || 0;
            return sum + (Number.isFinite(value) && value > 0 ? value : 0);
        }, 0);
        const basePercentageTotal = normalizedAllocations.reduce((sum, allocation) => {
            const value = Number(allocation?.percentage) || 0;
            return sum + (Number.isFinite(value) && value > 0 ? value : 0);
        }, 0);
        const costAssignments = {
            transferCost: purchaseOrder.transferCostInvestor ? purchaseOrder.transferCostInvestor.toString() : null,
            detailingInspectionCost: purchaseOrder.detailingInspectionCostInvestor ? purchaseOrder.detailingInspectionCostInvestor.toString() : null,
            agentCommission: purchaseOrder.agentCommissionInvestor ? purchaseOrder.agentCommissionInvestor.toString() : null,
            carRecoveryCost: purchaseOrder.carRecoveryCostInvestor ? purchaseOrder.carRecoveryCostInvestor.toString() : null,
            otherCharges: purchaseOrder.otherChargesInvestor ? purchaseOrder.otherChargesInvestor.toString() : null
        };
        const shareContext = {
            totalPayable,
            buyingPrice,
            charges: {
                transferCost,
                detailingInspectionCost,
                agentCommission,
                carRecoveryCost,
                otherCharges
            },
            costAssignments,
            baseAmountTotal,
            basePercentageTotal,
            allocationCount: normalizedAllocations.length
        };

        // Update investor utilization and portfolio (post-purchase) using shared totals
        if (lead.priceAnalysis?.purchasedFinalPrice || totalPayable > 0) {
            for (const allocation of normalizedAllocations) {
                const investorKey = allocation?.investorId?._id
                    ? allocation.investorId._id.toString()
                    : allocation?.investorId?.toString();
                const shareInfo = computeInvestorInvoiceShare(allocation, shareContext);
                if (investorKey) {
                    allocationSharesByInvestor.set(investorKey, shareInfo);
                }
                try {
                    await Investor.findByIdAndUpdate(allocation.investorId, {
                        $inc: { utilizedAmount: shareInfo.amount },
                        $push: {
                            investments: {
                                leadId: lead._id,
                                amount: shareInfo.amount,
                                percentage: shareInfo.percentage || allocation.percentage || 0,
                                date: new Date(),
                                status: 'active'
                            }
                        }
                    });
                    logger.info(`Successfully updated investor ${allocation.investorId} utilization by AED ${shareInfo.amount}`);
                } catch (invErr) {
                    logger.error('Failed to update investor utilization on purchase:', invErr);
                }
            }
        }

        // Update Purchase Order status
        purchaseOrder.status = 'completed';
        await purchaseOrder.save();

        // Update lead status to inventory
        lead.status = 'inventory';
        await lead.save();

        logger.info(`Lead ${lead.leadId} moved to inventory and Purchase Order ${purchaseOrder.poId} completed`);

        // Generate and send invoice

        const Invoice = require('../models/Invoice');
        const createdInvoices = [];
        for (const allocation of normalizedAllocations) {
            const investorDoc = allocation.investor || await Investor.findById(allocation.investorId).select('name email');
            if (!investorDoc) {
                logger.warn(`Investor ${allocation.investorId} not found while creating invoice`);
                continue;
            }

            const investorKey = allocation?.investorId?._id
                ? allocation.investorId._id.toString()
                : allocation?.investorId?.toString();
            const shareInfo = investorKey && allocationSharesByInvestor.has(investorKey)
                ? allocationSharesByInvestor.get(investorKey)
                : computeInvestorInvoiceShare(allocation, shareContext);
            const paymentOverride = investorKey ? investorPaymentsMap.get(investorKey) : null;
            const modeOfPaymentValue = paymentOverride?.modeOfPayment || defaultModeOfPayment || 'Bank Transfer / Cash / Cheque';
            const paymentReceivedByValue = paymentOverride?.paymentReceivedBy || defaultPaymentReceivedBy || 'Authorized Person';
            const breakdown = shareInfo.breakdown;

            const invoice = await Invoice.create({
                leadId: lead._id,
                purchaseOrderId: purchaseOrder._id,
                investorId: allocation.investorId,
                preparedBy: purchaseOrder.prepared_by || req.user?.name || req.user?.email,
                totals: {
                    buying_price: breakdown.buyingPrice,
                    transfer_cost_rta: breakdown.transferCost,
                    detailing_inspection_cost: breakdown.detailingInspectionCost,
                    agent_commission: breakdown.agentCommission,
                    car_recovery_cost: breakdown.carRecoveryCost,
                    other_charges: breakdown.otherCharges,
                    total_amount_payable: shareInfo.amount
                },
                vehicle: {
                    make: lead.vehicleInfo?.make || '',
                    model: lead.vehicleInfo?.model || '',
                    trim: lead.vehicleInfo?.trim || '',
                    year: lead.vehicleInfo?.year ? String(lead.vehicleInfo.year) : '',
                    vin: lead.vehicleInfo?.vin || ''
                },
                status: 'sent',
                sentAt: new Date()
            });

            const invoiceData = {
                invoiceNo: invoice.invoiceNo,
                date: invoiceDate.toLocaleDateString('en-GB'),
                investorName: investorDoc.name || 'Investor',
                preparedBy: purchaseOrder.prepared_by || req.user?.name || req.user?.email || 'Admin',
                referencePoNo: purchaseOrder.poId,
                carMake: lead.vehicleInfo?.make || '',
                carModel: lead.vehicleInfo?.model || '',
                trim: lead.vehicleInfo?.trim || '',
                yearModel: lead.vehicleInfo?.year ? String(lead.vehicleInfo.year) : '',
                chassisNo: lead.vehicleInfo?.vin || '',
                region: lead.vehicleInfo?.region || '',
                buyingPrice: breakdown.buyingPrice,
                transferCost: breakdown.transferCost,
                detailingInspectionCost: breakdown.detailingInspectionCost,
                agentCommission: breakdown.agentCommission,
                carRecoveryCost: breakdown.carRecoveryCost,
                otherCharges: breakdown.otherCharges,
                totalAmountPayable: shareInfo.amount,
                investmentPercentage: shareInfo.percentage,
                modeOfPayment: modeOfPaymentValue,
                paymentReceivedBy: paymentReceivedByValue,
                dateOfPayment: invoiceDate.toLocaleDateString('en-GB')
            };

            if (investorDoc.email) {
                try {
                    const { generateInvoicePdfBuffer } = require('../services/invoicePdfService');
                    const pdfBuffer = await generateInvoicePdfBuffer({
                        invoice_no: invoiceData.invoiceNo,
                        date: invoiceData.date,
                        investor_name: invoiceData.investorName,
                        prepared_by: invoiceData.preparedBy,
                        reference_po_no: invoiceData.referencePoNo,
                        car_make: invoiceData.carMake,
                        car_model: invoiceData.carModel,
                        trim: invoiceData.trim,
                        year_model: invoiceData.yearModel,
                        chassis_no: invoiceData.chassisNo,
                        buying_price: breakdown.buyingPrice,
                        transfer_cost: breakdown.transferCost,
                        detailing_inspection_cost: breakdown.detailingInspectionCost,
                        agent_commission: breakdown.agentCommission,
                        car_recovery_cost: breakdown.carRecoveryCost,
                        other_charges: breakdown.otherCharges,
                        total_amount_payable: shareInfo.amount,
                        investment_percentage: invoiceData.investmentPercentage != null
                            ? Number(invoiceData.investmentPercentage).toFixed(2)
                            : '',
                        mode_of_payment: modeOfPaymentValue,
                        payment_received_by: paymentReceivedByValue,
                        date_of_payment: invoiceData.dateOfPayment
                    });

                    const pdfBase64 = pdfBuffer.toString('base64');
                    invoice.content = pdfBase64;
                    invoice.mimeType = 'application/pdf';
                    invoice.fileSize = pdfBuffer.length;
                    invoice.filePublicId = undefined;
                    await invoice.save();

                    const { sendMailtrapEmail } = require('../services/mailtrapService');
                    await sendMailtrapEmail({
                        recipients: [investorDoc.email],
                        templateUuid: process.env.PURCHASE_ORDER_INVOICE_ID || undefined,
                        templateVariables: {
                            investor_name: invoiceData.investorName,
                            po_number: invoiceData.referencePoNo,
                            issue_date: invoiceData.date,
                            total_amount: `AED ${shareInfo.amount.toLocaleString()}`,
                            year: invoiceData.yearModel || ''
                        },
                        attachments: [{
                            filename: `Invoice_${invoice.invoiceNo}.pdf`,
                            content: pdfBase64,
                            type: 'application/pdf',
                            disposition: 'attachment'
                        }]
                    });

                    logger.info(`Invoice ${invoice.invoiceNo} generated and emailed to ${investorDoc.email}`);
                } catch (invoiceErr) {
                    logger.error('Failed to generate and send invoice:', invoiceErr);
                }
            }

            createdInvoices.push(invoice);
        }

        if (createdInvoices.length > 0) {
            lead.invoice = createdInvoices[0]._id;
            await lead.save();
        }

        // Audit log
        const investorLogDetails = normalizedAllocations.map((allocation) => ({
            id: allocation.investorId,
            name: allocation.name,
            percentage: allocation.percentage,
            amount: (() => {
                const investorKey = allocation?.investorId?._id
                    ? allocation.investorId._id.toString()
                    : allocation?.investorId?.toString();
                const shareInfo = investorKey && allocationSharesByInvestor.has(investorKey)
                    ? allocationSharesByInvestor.get(investorKey)
                    : computeInvestorInvoiceShare(allocation, shareContext);
                return shareInfo.amount;
            })()
        }));

        await logLead(req, 'lead_moved_to_inventory',
            `Lead ${lead.leadId} moved to inventory`,
            lead, {
            leadId: lead.leadId,
            purchasePrice: lead.priceAnalysis?.purchasedFinalPrice,
            investors: investorLogDetails
        });

        await logPurchaseOrder(req, 'po_completed', `Purchase Order ${purchaseOrder.poId} completed for lead ${lead.leadId}`, purchaseOrder, {
            vehicle: `${lead.vehicleInfo?.make} ${lead.vehicleInfo?.model} ${lead.vehicleInfo?.year}`,
            amount: purchaseOrder.amount,
            investors: investorLogDetails
        });

        res.status(200).json({
            success: true,
            message: 'Lead moved to inventory successfully',
            data: {
                lead: lead,
                purchaseOrder: {
                    id: purchaseOrder._id,
                    poId: purchaseOrder.poId,
                    status: purchaseOrder.status,
                    amount: purchaseOrder.amount
                },
                invoice: createdInvoices[0] ? {
                    invoiceNo: createdInvoices[0].invoiceNo,
                    sent: true
                } : null,
                invoices: createdInvoices.map((invoiceEntry) => ({
                    invoiceNo: invoiceEntry.invoiceNo,
                    investorId: invoiceEntry.investorId
                }))
            }
        });
    } catch (error) {
        logger.error('Convert lead to vehicle error:', error);
        next(error);
    }
};

/**
 * @desc    Bulk convert leads to vehicles with invoice payment details
 * @route   POST /api/v1/purchases/leads/bulk-purchase
 * @access  Private (Admin only)
 */
exports.bulkConvertLeadsToVehicles = async (req, res, next) => {
    try {
        const { leads } = req.body; // Array of { leadId, modeOfPayment, paymentReceivedBy }

        if (!leads || !Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide an array of leads with payment details'
            });
        }

        const results = [];
        const errors = [];

        for (const leadData of leads) {
            const { leadId, modeOfPayment, paymentReceivedBy, investorPayments } = leadData;

            if (!leadId) {
                errors.push({ leadId: leadId || 'unknown', error: 'Lead ID is required' });
                continue;
            }

            try {
                const lead = await Lead.findById(leadId)
                    .populate('investorAllocations.investorId', 'name email')
                    .populate('createdBy');

                if (!lead) {
                    errors.push({ leadId, error: 'Lead not found' });
                    continue;
                }

                const normalizedAllocations = normalizeLeadAllocations(lead);
                if (normalizedAllocations.length === 0) {
                    errors.push({ leadId, error: 'No investors assigned to this lead' });
                    continue;
                }

                const defaultModeOfPayment = modeOfPayment || '';
                const defaultPaymentReceivedBy = paymentReceivedBy || '';
                const investorPaymentsInput = Array.isArray(investorPayments) ? investorPayments : [];
                const investorPaymentsMap = new Map();
                for (const entry of investorPaymentsInput) {
                    if (!entry?.investorId) continue;
                    investorPaymentsMap.set(entry.investorId.toString(), {
                        modeOfPayment: entry.modeOfPayment || '',
                        paymentReceivedBy: entry.paymentReceivedBy || ''
                    });
                }

                const missingPaymentInvestor = normalizedAllocations.find((allocation) => {
                    const investorKey = allocation?.investorId?._id
                        ? allocation.investorId._id.toString()
                        : allocation?.investorId?.toString();
                    const override = investorKey ? investorPaymentsMap.get(investorKey) : null;
                    const modeValue = override?.modeOfPayment || defaultModeOfPayment;
                    const receivedByValue = override?.paymentReceivedBy || defaultPaymentReceivedBy;
                    return !(modeValue && receivedByValue);
                });
                if (missingPaymentInvestor) {
                    const investorName = missingPaymentInvestor?.name || missingPaymentInvestor?.email || 'Investor';
                    errors.push({ leadId, error: `Mode of payment and payment receiver are required for ${investorName}` });
                    continue;
                }

                if (!lead.purchaseOrder) {
                    errors.push({ leadId, error: 'Lead must have a purchase order' });
                    continue;
                }

                const purchaseOrder = await PurchaseOrder.findById(lead.purchaseOrder);
                if (!purchaseOrder || !purchaseOrder.docuSignEnvelopeId || purchaseOrder.docuSignStatus !== 'completed') {
                    errors.push({ leadId, error: 'Purchase Agreement must be signed' });
                    continue;
                }

                if (lead.status === 'inventory') {
                    errors.push({ leadId, error: 'Lead is already in inventory' });
                    continue;
                }

                const invoiceDate = new Date();
                const buyingPrice = Number(lead.priceAnalysis?.purchasedFinalPrice || 0);
                const transferCost = Number(purchaseOrder.transferCost || 0);
                const detailingInspectionCost = Number(purchaseOrder.detailing_inspection_cost || 0);
                const agentCommission = Number(purchaseOrder.agent_commision || 0);
                const carRecoveryCost = Number(purchaseOrder.car_recovery_cost || 0);
                const otherCharges = Number(purchaseOrder.other_charges || 0);
                const totalPayable = buyingPrice + transferCost + detailingInspectionCost + agentCommission + carRecoveryCost + otherCharges;
                const allocationSharesByInvestor = new Map();
                const baseAmountTotal = normalizedAllocations.reduce((sum, allocation) => {
                    const value = Number(allocation?.amount) || 0;
                    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
                }, 0);
                const basePercentageTotal = normalizedAllocations.reduce((sum, allocation) => {
                    const value = Number(allocation?.percentage) || 0;
                    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
                }, 0);
                const costAssignments = {
                    transferCost: purchaseOrder.transferCostInvestor ? purchaseOrder.transferCostInvestor.toString() : null,
                    detailingInspectionCost: purchaseOrder.detailingInspectionCostInvestor ? purchaseOrder.detailingInspectionCostInvestor.toString() : null,
                    agentCommission: purchaseOrder.agentCommissionInvestor ? purchaseOrder.agentCommissionInvestor.toString() : null,
                    carRecoveryCost: purchaseOrder.carRecoveryCostInvestor ? purchaseOrder.carRecoveryCostInvestor.toString() : null,
                    otherCharges: purchaseOrder.otherChargesInvestor ? purchaseOrder.otherChargesInvestor.toString() : null
                };
                const shareContext = {
                    totalPayable,
                    buyingPrice,
                    charges: {
                        transferCost,
                        detailingInspectionCost,
                        agentCommission,
                        carRecoveryCost,
                        otherCharges
                    },
                    costAssignments,
                    baseAmountTotal,
                    basePercentageTotal,
                    allocationCount: normalizedAllocations.length
                };

                // Update investor utilization
                if (lead.priceAnalysis?.purchasedFinalPrice || totalPayable > 0) {
                    try {
                        for (const allocation of normalizedAllocations) {
                            const investorKey = allocation?.investorId?._id
                                ? allocation.investorId._id.toString()
                                : allocation?.investorId?.toString();
                            const shareInfo = computeInvestorInvoiceShare(allocation, shareContext);
                            if (investorKey) {
                                allocationSharesByInvestor.set(investorKey, shareInfo);
                            }
                            await Investor.findByIdAndUpdate(allocation.investorId, {
                                $inc: { utilizedAmount: shareInfo.amount },
                                $push: {
                                    investments: {
                                        leadId: lead._id,
                                        amount: shareInfo.amount,
                                        percentage: shareInfo.percentage || allocation.percentage || 0,
                                        date: new Date(),
                                        status: 'active'
                                    }
                                }
                            });
                        }
                    } catch (invErr) {
                        logger.error(`Failed to update investor utilization for lead ${leadId}:`, invErr);
                    }
                }

                // Update Purchase Order status
                purchaseOrder.status = 'completed';
                await purchaseOrder.save();

                // Update lead status to inventory
                lead.status = 'inventory';
                await lead.save();

                // Generate and send invoice

                const Invoice = require('../models/Invoice');
                const createdInvoices = [];
                for (const allocation of normalizedAllocations) {
                    const investorDoc = allocation.investor || await Investor.findById(allocation.investorId).select('name email');
                    if (!investorDoc) {
                        logger.warn(`Investor ${allocation.investorId} not found while creating invoice`);
                        continue;
                    }

                    const investorKey = allocation?.investorId?._id
                        ? allocation.investorId._id.toString()
                        : allocation?.investorId?.toString();
                    const shareInfo = investorKey && allocationSharesByInvestor.has(investorKey)
                        ? allocationSharesByInvestor.get(investorKey)
                        : computeInvestorInvoiceShare(allocation, shareContext);
                    const paymentOverride = investorKey ? investorPaymentsMap.get(investorKey) : null;
                    const modeOfPaymentValue = paymentOverride?.modeOfPayment || defaultModeOfPayment || 'Bank Transfer / Cash / Cheque';
                    const paymentReceivedByValue = paymentOverride?.paymentReceivedBy || defaultPaymentReceivedBy || 'Authorized Person';
                    const breakdown = shareInfo.breakdown;

                    const invoice = await Invoice.create({
                        leadId: lead._id,
                        purchaseOrderId: purchaseOrder._id,
                        investorId: allocation.investorId,
                        preparedBy: purchaseOrder.prepared_by || req.user?.name || req.user?.email,
                        totals: {
                            buying_price: breakdown.buyingPrice,
                            transfer_cost_rta: breakdown.transferCost,
                            detailing_inspection_cost: breakdown.detailingInspectionCost,
                            agent_commission: breakdown.agentCommission,
                            car_recovery_cost: breakdown.carRecoveryCost,
                            other_charges: breakdown.otherCharges,
                            total_amount_payable: shareInfo.amount
                        },
                        vehicle: {
                            make: lead.vehicleInfo?.make || '',
                            model: lead.vehicleInfo?.model || '',
                            trim: lead.vehicleInfo?.trim || '',
                            year: lead.vehicleInfo?.year ? String(lead.vehicleInfo.year) : '',
                            vin: lead.vehicleInfo?.vin || ''
                        },
                        status: 'sent',
                        sentAt: new Date()
                    });

                    const invoiceData = {
                        invoiceNo: invoice.invoiceNo,
                        date: invoiceDate.toLocaleDateString('en-GB'),
                        investorName: investorDoc.name || 'Investor',
                        preparedBy: purchaseOrder.prepared_by || req.user?.name || req.user?.email || 'Admin',
                        referencePoNo: purchaseOrder.poId,
                        carMake: lead.vehicleInfo?.make || '',
                        carModel: lead.vehicleInfo?.model || '',
                        trim: lead.vehicleInfo?.trim || '',
                        yearModel: lead.vehicleInfo?.year ? String(lead.vehicleInfo.year) : '',
                        chassisNo: lead.vehicleInfo?.vin || '',
                        region: lead.vehicleInfo?.region || '',
                        buyingPrice: breakdown.buyingPrice,
                        transferCost: breakdown.transferCost,
                        detailingInspectionCost: breakdown.detailingInspectionCost,
                        agentCommission: breakdown.agentCommission,
                        carRecoveryCost: breakdown.carRecoveryCost,
                        otherCharges: breakdown.otherCharges,
                        totalAmountPayable: shareInfo.amount,
                        investmentPercentage: shareInfo.percentage,
                            modeOfPayment: modeOfPaymentValue,
                            paymentReceivedBy: paymentReceivedByValue,
                        dateOfPayment: invoiceDate.toLocaleDateString('en-GB')
                    };

                    if (investorDoc.email) {
                        try {
                            const { generateInvoicePdfBuffer } = require('../services/invoicePdfService');
                            const pdfBuffer = await generateInvoicePdfBuffer({
                                invoice_no: invoiceData.invoiceNo,
                                date: invoiceData.date,
                                investor_name: invoiceData.investorName,
                                prepared_by: invoiceData.preparedBy,
                                reference_po_no: invoiceData.referencePoNo,
                                car_make: invoiceData.carMake,
                                car_model: invoiceData.carModel,
                                trim: invoiceData.trim,
                                year_model: invoiceData.yearModel,
                                chassis_no: invoiceData.chassisNo,
                            buying_price: breakdown.buyingPrice,
                            transfer_cost: breakdown.transferCost,
                            detailing_inspection_cost: breakdown.detailingInspectionCost,
                            agent_commission: breakdown.agentCommission,
                            car_recovery_cost: breakdown.carRecoveryCost,
                            other_charges: breakdown.otherCharges,
                            total_amount_payable: shareInfo.amount,
                            investment_percentage: invoiceData.investmentPercentage != null
                                ? Number(invoiceData.investmentPercentage).toFixed(2)
                                    : '',
                                mode_of_payment: modeOfPaymentValue,
                                payment_received_by: paymentReceivedByValue,
                                date_of_payment: invoiceData.dateOfPayment
                            });

                            const pdfBase64 = pdfBuffer.toString('base64');
                            invoice.content = pdfBase64;
                            invoice.mimeType = 'application/pdf';
                            invoice.fileSize = pdfBuffer.length;
                            invoice.filePublicId = undefined;
                            await invoice.save();

                            const { sendMailtrapEmail } = require('../services/mailtrapService');
                            await sendMailtrapEmail({
                                recipients: [investorDoc.email],
                                templateUuid: process.env.PURCHASE_ORDER_INVOICE_ID || undefined,
                                templateVariables: {
                                    investor_name: invoiceData.investorName,
                                    po_number: invoiceData.referencePoNo,
                                    issue_date: invoiceData.date,
                                    total_amount: `AED ${shareInfo.amount.toLocaleString()}`,
                                    year: invoiceData.yearModel || ''
                                },
                                attachments: [{
                                    filename: `Invoice_${invoice.invoiceNo}.pdf`,
                                    content: pdfBase64,
                                    type: 'application/pdf',
                                    disposition: 'attachment'
                                }]
                            });
                        } catch (invoiceErr) {
                            logger.error(`Failed to generate invoice for lead ${leadId}:`, invoiceErr);
                        }
                    }

                    createdInvoices.push({
                        invoice,
                        investorId: allocation.investorId
                    });
                }

                if (createdInvoices.length > 0) {
                    lead.invoice = createdInvoices[0].invoice._id;
                    await lead.save();
                }

                results.push({
                    leadId: lead.leadId,
                    success: true,
                    invoices: createdInvoices.map(entry => ({
                        invoiceNo: entry.invoice.invoiceNo,
                        investorId: entry.investorId
                    }))
                });
            } catch (err) {
                logger.error(`Error processing lead ${leadId}:`, err);
                errors.push({ leadId, error: err.message || 'Unknown error' });
            }
        }

        res.status(200).json({
            success: true,
            message: `Processed ${results.length} lead(s) successfully${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
            data: {
                successful: results,
                errors: errors
            }
        });
    } catch (error) {
        logger.error('Bulk convert leads to vehicles error:', error);
        next(error);
    }
};

/**
 * Helper function to create auto follow-ups for under-review leads
 */
async function createAutoFollowUps(leadId, managerId) {
    const followUpDays = [3, 7, 15];

    for (const days of followUpDays) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + days);

        const followUp = await FollowUp.create({
            leadId,
            managerId,
            type: 'call',
            dueDate,
            status: 'pending',
            priority: days <= 3 ? 'high' : 'medium',
            comments: `Auto-generated follow-up for ${days} days review`,
            autoGenerated: true,
            createdBy: managerId
        });

        await Lead.findByIdAndUpdate(leadId, {
            $push: { followUps: followUp._id }
        });
    }

    logger.info(`Auto follow-ups created for lead ${leadId}`);
}

module.exports = exports;

/**
 * @desc    Preview invoice as PDF inline (dev/admin tool)
 * @route   GET /api/v1/purchases/invoices/preview
 * @access  Private (Admin)
 */
// previewInvoice removed per requirements

/**
 * @desc    List investors for assignment
 * @route   GET /api/v1/purchases/investors
 * @access  Private (Admin only)
 */
exports.listInvestors = async (req, res, next) => {
    try {
        const investors = await Investor.find({ status: 'active' }).select('name email creditLimit utilizedAmount decidedPercentageMin decidedPercentageMax');
        // Add remaining credit calculation
        const investorsWithCredit = investors.map(inv => ({
            ...inv.toObject(),
            remainingCredit: inv.creditLimit - inv.utilizedAmount
        }));
        res.status(200).json({ success: true, data: investorsWithCredit });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Assign investor to lead
 * @route   PUT /api/v1/purchases/leads/:id/investor
 * @access  Private (Admin only)
 */
exports.assignInvestorToLead = async (req, res, next) => {
    try {
        const { investorAllocations } = req.body;
        const lead = await Lead.findById(req.params.id);
        if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

        if (!Array.isArray(investorAllocations) || investorAllocations.length === 0) {
            lead.investorAllocations = [];
            await lead.save();

            await logLead(req, 'lead_investors_cleared', `Cleared investors for lead ${lead.leadId}`, lead);

            return res.status(200).json({ success: true, message: 'Investors cleared', data: lead });
        }

        const investorIds = investorAllocations.map(a => a.investorId);
        const uniqueInvestorIds = [...new Set(investorIds.map(id => id?.toString()))];

        if (uniqueInvestorIds.length !== investorAllocations.length) {
            return res.status(400).json({
                success: false,
                message: 'Duplicate investors are not allowed in allocations'
            });
        }

        const investors = await Investor.find({ _id: { $in: uniqueInvestorIds } })
            .select('name email status decidedPercentageMin decidedPercentageMax creditLimit utilizedAmount');

        if (investors.length !== investorAllocations.length) {
            return res.status(404).json({
                success: false,
                message: 'One or more investors were not found'
            });
        }

        const investorsById = new Map(investors.map(inv => [inv._id.toString(), inv]));
        const purchasePrice = Number(lead.priceAnalysis?.purchasedFinalPrice || 0);
        let totalPercentage = 0;

        const normalizedAllocations = investorAllocations.map((allocation) => {
            const investorId = allocation.investorId?.toString();
            const investor = investorsById.get(investorId);
            if (!investor) {
                throw new Error(`Investor not found: ${investorId}`);
            }

            if (investor.status !== 'active') {
                throw new Error(`Investor ${investor.name} is not active`);
            }

            const percentage = Number(allocation.percentage);
            if (Number.isNaN(percentage) || percentage <= 0) {
                throw new Error(`Allocation percentage must be greater than 0 for investor ${investor.name}`);
            }

            const minAllowed = investor.decidedPercentageMin ?? 0;
            const maxAllowed = investor.decidedPercentageMax ?? 100;

            if (percentage < minAllowed || percentage > maxAllowed) {
                throw new Error(
                    `Allocation percentage for ${investor.name} must be between ${minAllowed}% and ${maxAllowed}%`
                );
            }

            totalPercentage += percentage;

            let amount = 0;
            if (allocation.amount != null && allocation.amount !== '') {
                amount = Number(allocation.amount);
                if (Number.isNaN(amount) || amount < 0) {
                    throw new Error(`Allocation amount must be a non-negative number for investor ${investor.name}`);
                }
            } else if (purchasePrice > 0) {
                amount = Number(((percentage / 100) * purchasePrice).toFixed(2));
            }

            return {
                investorId: investor._id,
                percentage,
                amount,
                name: investor.name,
                email: investor.email
            };
        });

        if (totalPercentage > 100.0001) {
            return res.status(400).json({
                success: false,
                message: 'Total allocation percentage cannot exceed 100%'
            });
        }

        lead.investorAllocations = normalizedAllocations.map(({ investorId, percentage, amount }) => ({
            investorId,
            percentage,
            amount
        }));
        await lead.save();

        // Update associated purchase order allocations if draft exists
        if (lead.purchaseOrder) {
            const purchaseOrder = await PurchaseOrder.findById(lead.purchaseOrder);
            if (purchaseOrder) {
                purchaseOrder.investorId = normalizedAllocations[0]?.investorId || null;
                purchaseOrder.investorAllocations = normalizedAllocations.map(({ investorId, percentage, amount }) => ({
                    investorId,
                    percentage,
                    amount: amount || Number(((percentage / 100) * (purchaseOrder.amount || purchasePrice || 0)).toFixed(2))
                }));
                await purchaseOrder.save();
            }
        }

        await logLead(
            req,
            'lead_investors_assigned',
            `Assigned ${normalizedAllocations.length} investor(s) to lead ${lead.leadId}`,
            lead,
            {
                investors: normalizedAllocations.map(({ investorId, percentage, amount, name, email }) => ({
                    id: investorId,
                    name,
                    email,
                    percentage,
                    amount
                }))
            }
        );

        res.status(200).json({ success: true, message: 'Investors assigned', data: lead });
    } catch (error) {
        if (error.message?.startsWith('Allocation') || error.message?.startsWith('Investor')) {
            return res.status(400).json({ success: false, message: error.message });
        }
        next(error);
    }
};

/**
 * @desc    Submit lead for approval (requires docs + completed price analysis + investor)
 * @route   POST /api/v1/purchases/leads/:id/submit-approval
 * @access  Private (Admin only)
 */
exports.submitLeadForApproval = async (req, res, next) => {
    try {
        const lead = await Lead.findById(req.params.id);
        if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

        // Validate required documents
        const hasRegistrationCard = (lead.attachments || []).some(d => d.category === 'registrationCard');
        const hasCarPictures = (lead.attachments || []).some(d => d.category === 'carPictures');
        const hasOnlineHistoryCheck = (lead.attachments || []).some(d => d.category === 'onlineHistoryCheck');

        if (!(hasRegistrationCard && hasCarPictures && hasOnlineHistoryCheck)) {
            return res.status(400).json({ success: false, message: 'Required documents are missing' });
        }

        // Validate price analysis complete
        const pa = lead.priceAnalysis || {};
        if (!(pa.minSellingPrice && pa.maxSellingPrice && pa.purchasedFinalPrice)) {
            return res.status(400).json({ success: false, message: 'Price analysis incomplete' });
        }

        // Validate investor assigned
        if (!Array.isArray(lead.investorAllocations) || lead.investorAllocations.length === 0) {
            return res.status(400).json({ success: false, message: 'Investor allocation is required before submission' });
        }

        // Determine admin's group and auto-approve on submit
        const groups = await AdminGroup.find({}).sort({ name: 1 });
        let groupName = null;
        for (const g of groups) {
            if ((g.members || []).some(m => m.toString() === req.userId.toString())) {
                groupName = g.name;
                break;
            }
        }
        if (!groupName) {
            return res.status(403).json({ success: false, message: 'You are not part of any approval group' });
        }

        lead.approval = lead.approval || {};
        lead.approval.status = 'pending';
        lead.approval.approvals = lead.approval.approvals || [];

        // Add submitter's approval if not already present
        const already = (lead.approval.approvals || []).some(a => a.adminId.toString() === req.userId.toString());
        if (!already) {
            lead.approval.approvals.push({ adminId: req.userId, groupName });
        }

        // Check if approvals cover two distinct groups
        const groupsCovered = new Set(lead.approval.approvals.map(a => a.groupName));
        const isDualMet = groupsCovered.size >= 2;

        // Keep lead visible in Inspection while pending approval
        lead.status = isDualMet ? 'approved' : 'inspection';
        if (isDualMet) {
            lead.approval.status = 'approved';
        }
        await lead.save();

        await logLead(req, 'lead_submitted_for_approval', `Lead ${lead.leadId} submitted for dual approval (${lead.approval.approvals.length}/2)`, lead, {
            investorAllocations: lead.investorAllocations,
            documents: { hasRegistrationCard, hasCarPictures, hasOnlineHistoryCheck },
            priceAnalysisComplete: true,
            groupsCovered: Array.from(groupsCovered),
            fullyApproved: isDualMet
        });

        res.status(200).json({ success: true, message: isDualMet ? 'Lead fully approved' : 'Lead submitted for approval', data: lead });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Approve lead (requires one admin from each group)
 * @route   POST /api/v1/purchases/leads/:id/approve
 * @access  Private (Admin only)
 */
exports.approveLead = async (req, res, next) => {
    try {
        const lead = await Lead.findById(req.params.id);
        if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
        if (!lead.approval || lead.approval.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Lead is not pending approval' });
        }

        // Determine admin's group
        const groups = await AdminGroup.find({}).sort({ name: 1 });
        let groupName = null;
        for (const g of groups) {
            if ((g.members || []).some(m => m.toString() === req.userId.toString())) {
                groupName = g.name;
                break;
            }
        }
        if (!groupName) {
            return res.status(403).json({ success: false, message: 'You are not part of any approval group' });
        }

        // Check if already approved by this admin
        const already = (lead.approval.approvals || []).some(a => a.adminId.toString() === req.userId.toString());
        if (already) {
            return res.status(400).json({ success: false, message: 'You have already approved this lead' });
        }

        // Add approval
        lead.approval.approvals.push({ adminId: req.userId, groupName });

        const groupsCovered = new Set(lead.approval.approvals.map(a => a.groupName));
        const isDualMet = groupsCovered.size >= 2; // at least one from each of 2 groups

        if (isDualMet) {
            // Mark approval achieved but DO NOT change lead.status (stays 'inspection')
            lead.approval.status = 'approved';

            await lead.populate({
                path: 'investorAllocations.investorId',
                select: 'name email decidingPercentageMin decidingPercentageMax creditLimit utilizedAmount status'
            });

            const normalizedAllocations = normalizeLeadAllocations(lead);
            logger.info('DocuSign approval flow - normalized allocations:', normalizedAllocations);

            if (normalizedAllocations.length === 0) {
                logger.warn(`Lead ${lead.leadId} approved but has no investor allocations; skipping DocuSign`);
            } else {
                const userRole = req.userRole || 'admin';
                const userId = req.userId;

                // Ensure a Purchase Order exists and is aligned with allocations
                let purchaseOrder = await PurchaseOrder.findOne({ leadId: lead._id });
                if (!purchaseOrder) {
                    purchaseOrder = await PurchaseOrder.create({
                        leadId: lead._id,
                        investorId: normalizedAllocations[0].investorId || null,
                        amount: lead.priceAnalysis.purchasedFinalPrice || lead.priceAnalysis.maxSellingPrice,
                        investorAllocations: normalizedAllocations.map(({ investorId, percentage, amount }) => ({
                            investorId,
                            amount,
                            percentage
                        })),
                        status: 'draft',
                        notes: `Purchase Order for lead ${lead.leadId}`,
                        createdBy: userId,
                        createdByModel: userRole === 'admin' ? 'Admin' : 'Manager'
                    });
                } else {
                    purchaseOrder.investorId = normalizedAllocations[0].investorId || null;
                    purchaseOrder.investorAllocations = normalizedAllocations.map(({ investorId, percentage, amount }) => ({
                        investorId,
                        amount,
                        percentage
                    }));
                    await purchaseOrder.save();
                }

                lead.purchaseOrder = purchaseOrder._id;
                const poFields = lead.poFields || {};
                if (!poFields.purchase_order_no) poFields.purchase_order_no = purchaseOrder.poId;
                if (!poFields.date) poFields.date = new Date().toLocaleDateString();
                if (!poFields.eid_passport) poFields.eid_passport = lead.contactInfo?.passportOrEmiratesId || '';
                if (!poFields.car_make) poFields.car_make = lead.vehicleInfo?.make || '';
                if (!poFields.car_model) poFields.car_model = lead.vehicleInfo?.model || '';
                if (!poFields.car_trim) poFields.car_trim = lead.vehicleInfo?.trim || '';
                if (!poFields.car_color) poFields.car_color = lead.vehicleInfo?.color || '';
                if (!poFields.car_region) poFields.car_region = lead.vehicleInfo?.region || '';
                if (!poFields.car_mileage && lead.vehicleInfo?.mileage != null) poFields.car_mileage = lead.vehicleInfo.mileage;
                if (!poFields.car_chassis) poFields.car_chassis = lead.vehicleInfo?.vin || '';
                if (!poFields.car_yaer) poFields.car_yaer = String(lead.vehicleInfo?.year || '');
                if (!poFields.buying_price && lead.priceAnalysis?.purchasedFinalPrice != null) poFields.buying_price = lead.priceAnalysis.purchasedFinalPrice;
                lead.poFields = poFields;
                await lead.save();

                const now = new Date();
                const docuSignResults = [];
                const docuSignErrors = [];

                for (const allocation of normalizedAllocations) {
                    logger.info('DocuSign approval flow - processing allocation:', allocation);
                    try {
                        const investor = allocation.investor || await Investor.findById(allocation.investorId)
                            .select('name email decidingPercentageMin decidingPercentageMax creditLimit utilizedAmount');
                        logger.info('DocuSign approval flow - resolved investor:', {
                            allocationInvestorId: allocation.investorId,
                            investor
                        });
                        if (!investor || !investor.email) {
                            logger.warn(`Skipping DocuSign for allocation ${allocation.investorId} on lead ${lead.leadId}: missing investor email`);
                            docuSignErrors.push({
                                investorId: allocation.investorId,
                                reason: 'missing_email'
                            });
                            continue;
                        }

                        const envelope = await docusignService.createLeadPurchaseAgreement({
                            leadId: lead.leadId,
                            investor,
                            priceAnalysis: lead.priceAnalysis,
                            vehicleInfo: lead.vehicleInfo,
                            contactInfo: lead.contactInfo,
                            purchaseOrder,
                            allocation
                        });

                        docuSignResults.push({
                            investorId: allocation.investorId,
                            investorName: investor.name,
                            investorEmail: investor.email,
                            envelopeId: envelope.envelopeId,
                            status: (envelope.status || 'sent').toLowerCase(),
                            sentAt: now
                        });
                    } catch (docuSignError) {
                        logger.error(`Failed to send DocuSign envelope for lead ${lead.leadId} allocation ${allocation.investorId}:`, docuSignError);
                        docuSignErrors.push({
                            investorId: allocation.investorId,
                            reason: docuSignError.message
                        });
                    }
                }

                if (docuSignResults.length > 0) {
                    purchaseOrder.docuSignEnvelopeId = docuSignResults[0].envelopeId;
                    purchaseOrder.docuSignStatus = 'sent';
                    purchaseOrder.docuSignSentAt = now;
                    purchaseOrder.docuSignEnvelopes = docuSignResults;
                    purchaseOrder.investorAllocations = purchaseOrder.investorAllocations.map((allocation) => {
                        const match = docuSignResults.find(result => String(result.investorId) === String(allocation.investorId));
                        if (match) {
                            allocation.docuSignEnvelopeId = match.envelopeId;
                            allocation.docuSignStatus = match.status;
                            allocation.docuSignSentAt = now;
                        }
                        return allocation;
                    });
                    await purchaseOrder.save();

                    logger.info(`DocuSign envelopes sent for lead ${lead.leadId}:`, docuSignResults.map(result => result.envelopeId));
                } else {
                    logger.warn(`No DocuSign envelopes were sent for lead ${lead.leadId}`);
                    purchaseOrder.docuSignStatus = 'failed';
                    purchaseOrder.docuSignError = docuSignErrors.length > 0
                        ? JSON.stringify(docuSignErrors)
                        : 'No investor envelopes were sent';
                    purchaseOrder.docuSignFailedAt = now;
                    await purchaseOrder.save();
                }
            }
        }
        await lead.save();

        await logApproval(req, 'lead_approved', `Lead ${lead.leadId} approved (${lead.approval.approvals.length}/2)`, lead, 'Lead', {
            approvals: lead.approval.approvals.length,
            groupsCovered: Array.from(groupsCovered),
            approved: isDualMet,
            docuSignSent: isDualMet && lead.docuSign?.envelopeId ? true : false
        });

        res.status(200).json({
            success: true,
            message: isDualMet ? 'Lead fully approved and DocuSign envelope sent to investor' : 'Approval recorded. One more group approval needed.',
            data: lead
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Decline lead approval (resets approval so it can be edited/resubmitted)
 * @route   POST /api/v1/purchases/leads/:id/decline
 * @access  Private (Admin only)
 */
exports.declineLead = async (req, res, next) => {
    try {
        const lead = await Lead.findById(req.params.id);
        if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

        // Reset approval and move back to inspection for edits
        lead.approval = { status: 'not_submitted', approvals: [] };
        if (lead.status === 'under_review' || lead.status === 'approved') {
            lead.status = 'inspection';
        }
        await lead.save();

        await logApproval(req, 'lead_declined', `Lead ${lead.leadId} declined and reverted for edits`, lead, 'Lead', {
            status: lead.status
        });

        res.status(200).json({ success: true, message: 'Lead approval reset. You can edit and resubmit.', data: lead });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get signed document from Purchase Order
 * @route   GET /api/v1/purchases/purchase-orders/:id/documents/:documentId
 * @access  Private (Admin, Manager)
 */
exports.getSignedDocument = async (req, res, next) => {
    try {
        const { id, documentId } = req.params;

        // Find the purchase order
        const purchaseOrder = await PurchaseOrder.findById(id);
        if (!purchaseOrder) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found'
            });
        }

        // Find the specific document
        const document = purchaseOrder.docuSignDocuments.find(doc => doc.documentId === documentId);
        if (!document) {
            logger.error(`Document ${documentId} not found in purchase order ${id}. Available documents:`,
                purchaseOrder.docuSignDocuments.map(doc => ({ documentId: doc.documentId, name: doc.name }))
            );
            return res.status(404).json({
                success: false,
                message: 'Document not found'
            });
        }

        logger.info(`Found document ${documentId}:`, {
            name: document.name,
            hasContent: !!document.content,
            contentLength: document.content?.length || 0,
            contentType: typeof document.content
        });

        // Check if user has access to this purchase order
        const lead = await Lead.findOne({ purchaseOrder: purchaseOrder._id });
        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Associated lead not found'
            });
        }

        // Access control
        if (req.userRole === 'manager' && lead.assignedTo?.toString() !== req.userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. This lead is assigned to another manager.'
            });
        }

        // Ensure we have valid base64 PDF content; attempt on-the-fly repair if broken
        const ensureValidPdfBuffer = async () => {
            const decodeToBuffer = (b64) => {
                const cleaned = typeof b64 === 'string' ? b64.replace(/^data:application\/pdf;base64,/, '') : b64;
                try {
                    return Buffer.from(cleaned || '', 'base64');
                } catch (_) {
                    return null;
                }
            };

            let buffer = decodeToBuffer(document.content);
            const looksLikePdf = (buf) => Buffer.isBuffer(buf) && buf.length > 4 && buf.slice(0, 4).toString() === '%PDF';

            if (looksLikePdf(buffer)) return buffer;

            // If content is missing or corrupt, try refetching from DocuSign now
            const sourceEnvelopeId = document.sourceEnvelopeId || purchaseOrder.docuSignEnvelopeId;
            if (!sourceEnvelopeId) {
                return null;
            }

            try {
                const signedDocs = await docusignService.getSignedDocuments(sourceEnvelopeId);
                const refreshed = (signedDocs || []).find(d => String(d.documentId) === String(documentId));
                if (refreshed && refreshed.content) {
                    // Update stored document content for future requests
                    document.content = refreshed.content;
                    document.fileType = refreshed.fileType || document.fileType;
                    document.name = refreshed.name || document.name;
                    // Persist update
                    await purchaseOrder.save();

                    buffer = decodeToBuffer(refreshed.content);
                    if (looksLikePdf(buffer)) return buffer;
                }
            } catch (refetchErr) {
                // Log and continue; will fall back to error response below
                logger.error('Failed to refetch signed document from DocuSign:', refetchErr);
            }

            return null;
        };

        const buffer = await ensureValidPdfBuffer();
        if (!buffer) {
            return res.status(422).json({
                success: false,
                message: 'Signed PDF content is missing or corrupted. Please re-fetch from DocuSign.'
            });
        }

        res.set({
            'Content-Type': document.fileType || 'application/pdf',
            'Content-Disposition': `inline; filename="${document.name}"`,
            'Content-Length': buffer.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });

        res.send(buffer);

    } catch (error) {
        logger.error('Get signed document error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve document'
        });
    }
};

// Update vehicle checklist
const updateVehicleChecklist = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { item, completed, notes, completedBy, completedAt } = req.body;

        // Validate required fields
        if (!item) {
            return res.status(400).json({
                success: false,
                message: 'Checklist item is required'
            });
        }

        // Valid checklist items
        const validItems = ['detailing', 'photoshoot', 'photoshootEdited', 'metaAds', 'onlineAds', 'instagram'];
        if (!validItems.includes(item)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid checklist item'
            });
        }

        // Find the lead (vehicle)
        const lead = await Lead.findById(id);
        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found'
            });
        }

        // Only allow updating checklist for inventory or consignment leads
        if (lead.status !== 'inventory' && lead.status !== 'consignment') {
            return res.status(400).json({
                success: false,
                message: 'Checklist can only be updated for inventory or consignment vehicles'
            });
        }

        // Update the checklist item
        if (!lead.operationalChecklist) {
            lead.operationalChecklist = {};
        }

        // Handle completedAt - convert to Date if it's a string, or use new Date() if completed is true
        let completedAtDate = null;
        if (completed) {
            if (completedAt) {
                completedAtDate = completedAt instanceof Date ? completedAt : new Date(completedAt);
            } else {
                completedAtDate = new Date();
            }
        }

        lead.operationalChecklist[item] = {
            completed: completed === true || completed === 'true',
            notes: notes || '',
            completedBy: completedBy || req.userId,
            completedAt: completedAtDate
        };

        // Mark the operationalChecklist field as modified (required for Mixed type fields)
        lead.markModified('operationalChecklist');

        // Update the lead
        await lead.save();

        logger.info(`Vehicle checklist updated: ${lead.leadId} - ${item}`, {
            leadId: lead._id,
            item,
            completed,
            updatedBy: req.userId
        });

        res.status(200).json({
            success: true,
            message: 'Checklist updated successfully',
            data: {
                vehicle: lead,
                checklistItem: lead.operationalChecklist[item]
            }
        });

    } catch (error) {
        logger.error('Update vehicle checklist error:', error);
        next(error);
    }
};

// Export the function
exports.updateVehicleChecklist = updateVehicleChecklist;

