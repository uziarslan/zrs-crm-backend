const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    logId: {
        type: String,
        unique: true
    },
    category: {
        type: String,
        enum: [
            'authentication',
            'user_management',
            'lead_management',
            'purchase_order',
            'sales',
            'inventory',
            'investor',
            'csa',
            'approval',
            'system'
        ],
        required: true
    },
    action: {
        type: String,
        required: true,
        // Examples: 'user_login', 'lead_created', 'po_approved', 'status_updated', etc.
    },
    description: {
        type: String,
        required: true
    },
    performedBy: {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'performedBy.userModel'
        },
        userModel: {
            type: String,
            enum: ['Admin', 'Manager', 'Investor']
        },
        userName: String,
        userEmail: String,
        userRole: String
    },
    targetEntity: {
        entityType: {
            type: String,
            enum: ['Lead', 'Vehicle', 'PurchaseOrder', 'Sale', 'Manager', 'Investor', 'CSATicket', 'None']
        },
        entityId: mongoose.Schema.Types.ObjectId,
        entityName: String
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        // Store additional context like old/new values, amounts, etc.
    },
    severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    },
    ipAddress: String,
    userAgent: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Auto-increment log ID
auditLogSchema.pre('save', async function (next) {
    if (!this.logId) {
        const lastLog = await this.constructor.findOne({}, {}, { sort: { 'createdAt': -1 } });
        let nextId = 1;
        if (lastLog && lastLog.logId) {
            const match = lastLog.logId.match(/LOG(\d+)/);
            if (match) {
                nextId = parseInt(match[1]) + 1;
            }
        }
        this.logId = `LOG${String(nextId).padStart(6, '0')}`;
    }
    next();
});

// Index for efficient queries
auditLogSchema.index({ category: 1, createdAt: -1 });
auditLogSchema.index({ 'performedBy.userId': 1, createdAt: -1 });
auditLogSchema.index({ 'targetEntity.entityId': 1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);

