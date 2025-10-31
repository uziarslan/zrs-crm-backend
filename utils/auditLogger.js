const AuditLog = require('../models/AuditLog');
const logger = require('./logger');

/**
 * Create audit log entry
 * @param {Object} logData - Audit log data
 */
const createAuditLog = async (logData) => {
    try {
        const auditLog = await AuditLog.create({
            category: logData.category,
            action: logData.action,
            description: logData.description,
            performedBy: logData.performedBy,
            targetEntity: logData.targetEntity || { entityType: 'None' },
            metadata: logData.metadata || {},
            severity: logData.severity || 'medium',
            ipAddress: logData.ipAddress,
            userAgent: logData.userAgent
        });

        // Also log to winston for immediate tracking
        logger.info(`[AUDIT] ${logData.action}: ${logData.description}`, {
            logId: auditLog.logId,
            category: logData.category,
            user: logData.performedBy?.userEmail
        });

        return auditLog;
    } catch (error) {
        logger.error('Failed to create audit log:', error);
        // Don't throw - audit logging should not break main functionality
    }
};

/**
 * Helper to extract user info from request
 */
const getUserInfo = (req) => {
    return {
        userId: req.userId,
        userModel: req.userRole === 'admin' ? 'Admin' : req.userRole === 'manager' ? 'Manager' : 'Investor',
        userName: req.user?.name,
        userEmail: req.user?.email,
        userRole: req.userRole
    };
};

/**
 * Helper to log authentication events
 */
exports.logAuth = async (req, action, description, user, metadata = {}) => {
    return createAuditLog({
        category: 'authentication',
        action,
        description,
        performedBy: {
            userId: user?._id,
            userModel: user?.role === 'admin' ? 'Admin' : user?.role === 'manager' ? 'Manager' : 'Investor',
            userName: user?.name,
            userEmail: user?.email,
            userRole: user?.role
        },
        metadata,
        severity: action.includes('failed') ? 'high' : 'low',
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
    });
};

/**
 * Helper to log user management events
 */
exports.logUserManagement = async (req, action, description, targetUser, metadata = {}) => {
    return createAuditLog({
        category: 'user_management',
        action,
        description,
        performedBy: getUserInfo(req),
        targetEntity: {
            entityType: targetUser?.role === 'manager' ? 'Manager' : 'Investor',
            entityId: targetUser?._id,
            entityName: targetUser?.email
        },
        metadata,
        severity: 'medium',
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
    });
};

/**
 * Helper to log lead management events
 */
exports.logLead = async (req, action, description, lead, metadata = {}) => {
    return createAuditLog({
        category: 'lead_management',
        action,
        description,
        performedBy: getUserInfo(req),
        targetEntity: {
            entityType: 'Lead',
            entityId: lead?._id,
            entityName: lead?.leadId
        },
        metadata,
        severity: 'low',
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
    });
};

/**
 * Helper to log purchase order events
 */
exports.logPurchaseOrder = async (req, action, description, po, metadata = {}) => {
    return createAuditLog({
        category: 'purchase_order',
        action,
        description,
        performedBy: getUserInfo(req),
        targetEntity: {
            entityType: 'PurchaseOrder',
            entityId: po?._id,
            entityName: po?.poId
        },
        metadata,
        severity: action.includes('approve') ? 'high' : 'medium',
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
    });
};

/**
 * Helper to log sales events
 */
exports.logSale = async (req, action, description, sale, metadata = {}) => {
    return createAuditLog({
        category: 'sales',
        action,
        description,
        performedBy: getUserInfo(req),
        targetEntity: {
            entityType: 'Sale',
            entityId: sale?._id,
            entityName: sale?.saleId
        },
        metadata,
        severity: action.includes('approve') ? 'high' : 'medium',
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
    });
};

/**
 * Helper to log inventory events
 */
exports.logInventory = async (req, action, description, vehicle, metadata = {}) => {
    return createAuditLog({
        category: 'inventory',
        action,
        description,
        performedBy: getUserInfo(req),
        targetEntity: {
            entityType: 'Vehicle',
            entityId: vehicle?._id,
            entityName: vehicle?.vehicleId
        },
        metadata,
        severity: 'low',
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
    });
};

/**
 * Helper to log investor events
 */
exports.logInvestor = async (req, action, description, investor, metadata = {}) => {
    return createAuditLog({
        category: 'investor',
        action,
        description,
        performedBy: getUserInfo(req),
        targetEntity: {
            entityType: 'Investor',
            entityId: investor?._id,
            entityName: investor?.email
        },
        metadata,
        severity: action.includes('credit') ? 'high' : 'medium',
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
    });
};

/**
 * Helper to log approval events
 */
exports.logApproval = async (req, action, description, entity, entityType, metadata = {}) => {
    return createAuditLog({
        category: 'approval',
        action,
        description,
        performedBy: getUserInfo(req),
        targetEntity: {
            entityType,
            entityId: entity?._id,
            entityName: entity?.poId || entity?.saleId
        },
        metadata,
        severity: 'critical',
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
    });
};

module.exports = exports;

