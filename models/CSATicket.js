const mongoose = require('mongoose');

const csaTicketSchema = new mongoose.Schema({
    ticketId: {
        type: String,
        unique: true
    },
    type: {
        type: String,
        enum: ['customer_query', 'vehicle_issue', 'document_request', 'complaint', 'feedback', 'other'],
        required: true
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['open', 'in_progress', 'pending_customer', 'resolved', 'closed', 'cancelled'],
        default: 'open'
    },
    relatedTo: {
        entityType: {
            type: String,
            enum: ['vehicle', 'lead', 'sale', 'purchase', 'investor', 'none'],
            default: 'none'
        },
        entityId: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'relatedTo.entityType'
        }
    },
    customerInfo: {
        name: String,
        phone: String,
        email: String
    },
    subject: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Manager'
    },
    responses: [{
        respondedBy: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'responses.respondedByModel'
        },
        respondedByModel: {
            type: String,
            enum: ['Admin', 'Manager']
        },
        message: String,
        isInternal: {
            type: Boolean,
            default: false
        },
        attachments: [{
            url: String,
            filename: String
        }],
        respondedAt: {
            type: Date,
            default: Date.now
        }
    }],
    autoReminders: [{
        daysSinceCreation: Number,
        sentAt: Date,
        recipientEmail: String
    }],
    resolvedAt: Date,
    resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'resolvedByModel'
    },
    resolvedByModel: {
        type: String,
        enum: ['Admin', 'Manager']
    },
    resolution: String,
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'createdByModel'
    },
    createdByModel: {
        type: String,
        enum: ['Admin', 'Manager']
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Auto-increment ticket ID
csaTicketSchema.pre('save', async function (next) {
    if (!this.ticketId) {
        const lastTicket = await this.constructor.findOne({}, {}, { sort: { 'createdAt': -1 } });
        let nextId = 1;
        if (lastTicket && lastTicket.ticketId) {
            const match = lastTicket.ticketId.match(/CSA(\d+)/);
            if (match) {
                nextId = parseInt(match[1]) + 1;
            }
        }
        this.ticketId = `CSA${String(nextId).padStart(4, '0')}`;
    }
    this.updatedAt = Date.now();
    next();
});

// Index for efficient queries
csaTicketSchema.index({ status: 1, priority: 1, createdAt: -1 });
csaTicketSchema.index({ assignedTo: 1, status: 1 });

module.exports = mongoose.model('CSATicket', csaTicketSchema);

