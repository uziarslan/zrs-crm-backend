const CSATicket = require('../models/CSATicket');
const logger = require('../utils/logger');

/**
 * @desc    Create CSA ticket
 * @route   POST /api/v1/csa/ticket
 * @access  Private
 */
exports.createTicket = async (req, res, next) => {
    try {
        const ticketData = {
            ...req.body,
            createdBy: req.userId,
            createdByModel: req.userRole === 'admin' ? 'Admin' : 'Manager'
        };

        const ticket = await CSATicket.create(ticketData);

        logger.info(`CSA Ticket ${ticket.ticketId} created`);

        res.status(201).json({
            success: true,
            message: 'Ticket created successfully',
            data: ticket
        });
    } catch (error) {
        logger.error('Create ticket error:', error);
        next(error);
    }
};

/**
 * @desc    Get all CSA tickets
 * @route   GET /api/v1/csa/tickets
 * @access  Private
 */
exports.getTickets = async (req, res, next) => {
    try {
        const { status, priority, type, assignedTo, search } = req.query;

        const query = {};

        if (status) query.status = status;
        if (priority) query.priority = priority;
        if (type) query.type = type;
        if (assignedTo) query.assignedTo = assignedTo;

        // Managers can only see their assigned tickets
        if (req.userRole === 'manager') {
            query.assignedTo = req.userId;
        }

        if (search) {
            query.$or = [
                { ticketId: { $regex: search, $options: 'i' } },
                { subject: { $regex: search, $options: 'i' } },
                { 'customerInfo.name': { $regex: search, $options: 'i' } }
            ];
        }

        const tickets = await CSATicket.find(query)
            .populate('assignedTo', 'name email')
            .sort({ priority: -1, createdAt: -1 });

        res.status(200).json({
            success: true,
            count: tickets.length,
            data: tickets
        });
    } catch (error) {
        logger.error('Get tickets error:', error);
        next(error);
    }
};

/**
 * @desc    Get single ticket by ID
 * @route   GET /api/v1/csa/tickets/:id
 * @access  Private
 */
exports.getTicketById = async (req, res, next) => {
    try {
        const ticket = await CSATicket.findById(req.params.id)
            .populate('assignedTo', 'name email')
            .populate('responses.respondedBy');

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        // Managers can only view their assigned tickets
        if (req.userRole === 'manager' && ticket.assignedTo?.toString() !== req.userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        res.status(200).json({
            success: true,
            data: ticket
        });
    } catch (error) {
        logger.error('Get ticket by ID error:', error);
        next(error);
    }
};

/**
 * @desc    Update ticket status
 * @route   PUT /api/v1/csa/tickets/:id/status
 * @access  Private
 */
exports.updateTicketStatus = async (req, res, next) => {
    try {
        const { status, resolution } = req.body;

        const ticket = await CSATicket.findById(req.params.id);

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        // Managers can only update their assigned tickets
        if (req.userRole === 'manager' && ticket.assignedTo?.toString() !== req.userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        ticket.status = status;

        if (status === 'resolved' || status === 'closed') {
            ticket.resolvedAt = new Date();
            ticket.resolvedBy = req.userId;
            ticket.resolvedByModel = req.userRole === 'admin' ? 'Admin' : 'Manager';
            if (resolution) {
                ticket.resolution = resolution;
            }
        }

        await ticket.save();

        res.status(200).json({
            success: true,
            message: 'Ticket status updated',
            data: ticket
        });
    } catch (error) {
        logger.error('Update ticket status error:', error);
        next(error);
    }
};

/**
 * @desc    Add response to ticket
 * @route   POST /api/v1/csa/tickets/:id/response
 * @access  Private
 */
exports.addTicketResponse = async (req, res, next) => {
    try {
        const { message, isInternal, attachments } = req.body;

        const ticket = await CSATicket.findById(req.params.id);

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        ticket.responses.push({
            respondedBy: req.userId,
            respondedByModel: req.userRole === 'admin' ? 'Admin' : 'Manager',
            message,
            isInternal: isInternal || false,
            attachments: attachments || []
        });

        await ticket.save();

        res.status(200).json({
            success: true,
            message: 'Response added to ticket',
            data: ticket
        });
    } catch (error) {
        logger.error('Add ticket response error:', error);
        next(error);
    }
};

/**
 * @desc    Assign ticket to manager
 * @route   PUT /api/v1/csa/tickets/:id/assign
 * @access  Private (Admin only)
 */
exports.assignTicket = async (req, res, next) => {
    try {
        const { managerId } = req.body;

        const ticket = await CSATicket.findById(req.params.id);

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        ticket.assignedTo = managerId;
        await ticket.save();

        res.status(200).json({
            success: true,
            message: 'Ticket assigned successfully',
            data: ticket
        });
    } catch (error) {
        logger.error('Assign ticket error:', error);
        next(error);
    }
};

/**
 * @desc    Get CSA dashboard stats
 * @route   GET /api/v1/csa/dashboard
 * @access  Private
 */
exports.getDashboard = async (req, res, next) => {
    try {
        const query = req.userRole === 'manager' ? { assignedTo: req.userId } : {};

        const totalTickets = await CSATicket.countDocuments(query);
        const openTickets = await CSATicket.countDocuments({ ...query, status: 'open' });
        const inProgressTickets = await CSATicket.countDocuments({ ...query, status: 'in_progress' });
        const resolvedTickets = await CSATicket.countDocuments({ ...query, status: 'resolved' });
        const closedTickets = await CSATicket.countDocuments({ ...query, status: 'closed' });
        const urgentTickets = await CSATicket.countDocuments({ ...query, priority: 'urgent', status: { $in: ['open', 'in_progress'] } });

        // Get tickets by type
        const ticketsByType = await CSATicket.aggregate([
            { $match: query },
            { $group: { _id: '$type', count: { $sum: 1 } } }
        ]);

        // Average resolution time (for resolved/closed tickets)
        const resolvedTicketsList = await CSATicket.find({
            ...query,
            status: { $in: ['resolved', 'closed'] },
            resolvedAt: { $exists: true }
        });

        let avgResolutionTime = 0;
        if (resolvedTicketsList.length > 0) {
            const totalResolutionTime = resolvedTicketsList.reduce((sum, ticket) => {
                return sum + (ticket.resolvedAt - ticket.createdAt);
            }, 0);
            avgResolutionTime = totalResolutionTime / resolvedTicketsList.length / (1000 * 60 * 60); // in hours
        }

        res.status(200).json({
            success: true,
            data: {
                totalTickets,
                openTickets,
                inProgressTickets,
                resolvedTickets,
                closedTickets,
                urgentTickets,
                ticketsByType,
                avgResolutionTimeHours: Math.round(avgResolutionTime * 100) / 100
            }
        });
    } catch (error) {
        logger.error('Get CSA dashboard error:', error);
        next(error);
    }
};

module.exports = exports;

