const mongoose = require('mongoose');

const saleSchema = new mongoose.Schema({
    saleId: {
        type: String,
        unique: true
    },
    vehicleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vehicle',
        required: true
    },
    customerId: String,
    customerName: {
        type: String,
        required: true
    },
    customerContact: {
        phone: String,
        email: String
    },
    sellingPrice: {
        type: Number,
        required: true
    },
    purchasePrice: Number,
    profit: Number,
    profitPercentage: Number,
    investorBreakdown: [{
        investorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Investor'
        },
        investmentAmount: Number,
        investmentPercentage: Number,
        profitAmount: Number,
        profitPercentage: Number,
        totalPayout: Number
    }],
    salesInvoiceDoc: {
        url: String,
        publicId: String
    },
    approvedBy: [{
        adminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin'
        },
        approvedAt: {
            type: Date,
            default: Date.now
        },
        comments: String
    }],
    status: {
        type: String,
        enum: [
            'draft',
            'pending_approval',
            'approved',
            'invoice_generated',
            'completed',
            'rejected',
            'cancelled'
        ],
        default: 'draft'
    },
    invoiceGenerated: {
        type: Boolean,
        default: false
    },
    invoiceUrl: String,
    invoiceGeneratedAt: Date,
    paymentStatus: {
        type: String,
        enum: ['pending', 'partial', 'paid'],
        default: 'pending'
    },
    paymentDetails: [{
        amount: Number,
        method: String,
        transactionId: String,
        date: Date,
        notes: String
    }],
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead'
    },
    testDrives: [{
        scheduledAt: Date,
        completedAt: Date,
        feedback: String,
        teamsEventId: String
    }],
    notes: String,
    rejectionReason: String,
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

// Auto-increment sale ID
saleSchema.pre('save', async function (next) {
    if (!this.saleId) {
        const lastSale = await this.constructor.findOne({}, {}, { sort: { 'createdAt': -1 } });
        let nextId = 1;
        if (lastSale && lastSale.saleId) {
            const match = lastSale.saleId.match(/S(\d+)/);
            if (match) {
                nextId = parseInt(match[1]) + 1;
            }
        }
        this.saleId = `S${String(nextId).padStart(4, '0')}`;
    }

    // Calculate profit if not provided
    if (this.sellingPrice && this.purchasePrice && !this.profit) {
        this.profit = this.sellingPrice - this.purchasePrice;
        this.profitPercentage = (this.profit / this.purchasePrice) * 100;
    }

    this.updatedAt = Date.now();
    next();
});

// Method to check if dual approval is met (2-of-4)
saleSchema.methods.isDualApprovalMet = function () {
    return this.approvedBy && this.approvedBy.length >= 2;
};

// Method to check if admin already approved
saleSchema.methods.hasAdminApproved = function (adminId) {
    return this.approvedBy.some(approval => approval.adminId.toString() === adminId.toString());
};

module.exports = mongoose.model('Sale', saleSchema);

