const mongoose = require('mongoose');

const purchaseOrderSchema = new mongoose.Schema({
    poId: {
        type: String,
        unique: true
    },
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead'
    },
    investorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Investor'
    },
    amount: {
        type: Number,
        required: true
    },
    investorAllocations: [{
        investorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Investor',
            required: true
        },
        amount: {
            type: Number,
            required: true
        },
        ownershipPercentage: {
            type: Number,
            required: true,
            min: 0,
            max: 100
        },
        profitPercentage: {
            type: Number,
            min: 0,
            max: 100
        },
        vehicleUnderInvestorName: {
            type: Boolean,
            default: false
        },
        docuSignEnvelopeId: String,
        docuSignStatus: {
            type: String,
            enum: ['created', 'sent', 'delivered', 'signed', 'completed', 'declined', 'voided', 'failed'],
            default: 'created'
        },
        docuSignSentAt: Date,
        docuSignCompletedAt: Date
    }],
    docuSignEnvelopes: [{
        investorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Investor'
        },
        investorName: String,
        investorEmail: String,
        envelopeId: String,
        status: {
            type: String,
            enum: ['created', 'sent', 'delivered', 'signed', 'completed', 'declined', 'voided', 'failed'],
            default: 'sent'
        },
        sentAt: Date,
        completedAt: Date
    }],
    docuSignEnvelopeId: String,
    docuSignStatus: {
        type: String,
        enum: ['created', 'sent', 'delivered', 'signed', 'completed', 'declined', 'voided', 'failed'],
        default: 'created'
    },
    docuSignSentAt: Date,
    docuSignSignedAt: Date,
    docuSignError: String,
    docuSignFailedAt: Date,
    docuSignDocuments: [{
        documentId: String,
        name: String,
        fileType: String,
        fileSize: Number,
        // Base64 content of the PDF returned by Zoho Sign (used for inline viewing)
        content: String,
        // Optional Zoho Sign uri reference
        uri: String,
        sourceEnvelopeId: String,
        investorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Investor'
        }
    }],
    total_investment: { type: Number },
    prepared_by: { type: String },
    status: {
        type: String,
        enum: [
            'draft',
            'pending_signature',
            'signed',
            'completed'
        ],
        default: 'draft'
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

// Auto-increment PO ID
purchaseOrderSchema.pre('save', async function (next) {
    if (!this.poId) {
        const lastPO = await this.constructor.findOne({}, {}, { sort: { 'createdAt': -1 } });
        let nextId = 1;
        if (lastPO && lastPO.poId) {
            const match = lastPO.poId.match(/PO(\d+)/);
            if (match) {
                nextId = parseInt(match[1]) + 1;
            }
        }
        this.poId = `PO${String(nextId).padStart(4, '0')}`;
    }
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
