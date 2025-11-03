const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
    leadId: {
        type: String,
        unique: true
    },
    type: {
        type: String,
        enum: ['purchase', 'sales'],
        required: true
    },
    source: {
        type: String,
        enum: ['phone', 'email', 'walk-in', 'website', 'referral', 'social-media', 'other'],
        required: true
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Manager'
    },
    status: {
        type: String,
        enum: [
            'new',
            'contacted',
            'qualified',
            'negotiation',
            'inspection',
            'under_review',
            'approved',
            'inventory',
            'lost',
            'cancelled'
        ],
        default: 'new'
    },
    contactInfo: {
        name: {
            type: String,
            required: true
        },
        phone: String,
        email: String,
        passportOrEmiratesId: String,
        preferredContact: {
            type: String,
            enum: ['phone', 'email', 'whatsapp']
        }
    },
    vehicleInfo: {
        make: String,
        model: String,
        year: Number,
        mileage: Number,
        color: String,
        trim: String,
        region: String,
        vin: String,
        askingPrice: Number,
        expectedPrice: Number
    },
    notes: [{
        content: String,
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'notes.addedByModel'
        },
        addedByModel: {
            type: String,
            enum: ['Admin', 'Manager']
        },
        addedAt: {
            type: Date,
            default: Date.now
        },
        editedAt: Date,
        editedBy: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'notes.editedByModel'
        },
        editedByModel: {
            type: String,
            enum: ['Admin', 'Manager']
        }
    }],
    followUps: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FollowUp'
    }],
    attachments: [{
        category: {
            type: String,
            enum: ['inspectionReport', 'registrationCard', 'carPictures', 'onlineHistoryCheck'],
            required: true
        },
        fileName: String,
        fileType: String,
        fileSize: Number,
        url: String,
        publicId: String,
        uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'attachments.uploadedByModel'
        },
        uploadedByModel: {
            type: String,
            enum: ['Admin', 'Manager']
        },
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    priceAnalysis: {
        minSellingPrice: Number,
        maxSellingPrice: Number,
        purchasedFinalPrice: Number,
        updatedAt: Date,
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: 'priceAnalysis.updatedByModel'
        },
        updatedByModel: {
            type: String,
            enum: ['Admin', 'Manager']
        }
    },
    // Investor assigned for funding the purchase
    investor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Investor',
        default: null
    },
    // Simple dual approval tracking (1 from each admin group)
    approval: {
        status: {
            type: String,
            enum: ['not_submitted', 'pending', 'approved'],
            default: 'not_submitted'
        },
        approvals: [
            {
                adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
                groupName: String,
                approvedAt: { type: Date, default: Date.now }
            }
        ]
    },

    // Reference to PurchaseOrder for DocuSign integration
    purchaseOrder: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PurchaseOrder',
        default: null
    },
    rateAnalysis: {
        marketValue: Number,
        estimatedProfit: Number,
        analysisDate: Date,
        notes: String
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
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

// Auto-increment lead ID based on type
leadSchema.pre('save', async function (next) {
    if (!this.leadId) {
        const prefix = this.type === 'purchase' ? 'PL' : 'SL';
        const lastLead = await this.constructor.findOne(
            { type: this.type },
            {},
            { sort: { 'createdAt': -1 } }
        );
        let nextId = 1;
        if (lastLead && lastLead.leadId) {
            const match = lastLead.leadId.match(/\d+/);
            if (match) {
                nextId = parseInt(match[0]) + 1;
            }
        }
        this.leadId = `${prefix}${String(nextId).padStart(4, '0')}`;
    }
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Lead', leadSchema);

