const mongoose = require('mongoose');

const investorSOASchema = new mongoose.Schema({
    investorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Investor',
        required: true
    },
    soaId: {
        type: String,
        unique: true
    },
    periodStart: {
        type: Date,
        required: true
    },
    periodEnd: {
        type: Date,
        required: true
    },
    creditLimit: Number,
    openingBalance: Number,
    closingBalance: Number,
    totalInvestments: Number,
    totalReturns: Number,
    utilizedAmount: Number,
    remainingCredit: Number,
    transactions: [{
        transactionId: String,
        date: Date,
        type: {
            type: String,
            enum: ['investment', 'return', 'profit', 'adjustment']
        },
        description: String,
        vehicleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Vehicle'
        },
        purchaseOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PurchaseOrder'
        },
        saleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Sale'
        },
        debit: Number,
        credit: Number,
        balance: Number
    }],
    investments: [{
        vehicleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Vehicle'
        },
        vehicleDetails: String,
        investmentDate: Date,
        investmentAmount: Number,
        investmentPercentage: Number,
        status: {
            type: String,
            enum: ['active', 'sold', 'settled']
        },
        saleDate: Date,
        saleAmount: Number,
        profitAmount: Number,
        profitPercentage: Number,
        totalReturn: Number
    }],
    summary: {
        totalActiveInvestments: Number,
        totalSettledInvestments: Number,
        totalProfit: Number,
        averageROI: Number
    },
    documentUrl: String,
    documentPublicId: String,
    generatedAt: {
        type: Date,
        default: Date.now
    },
    generatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin'
    },
    emailedAt: Date,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Auto-increment SOA ID
investorSOASchema.pre('save', async function (next) {
    if (!this.soaId) {
        const lastSOA = await this.constructor.findOne({}, {}, { sort: { 'createdAt': -1 } });
        let nextId = 1;
        if (lastSOA && lastSOA.soaId) {
            const match = lastSOA.soaId.match(/SOA(\d+)/);
            if (match) {
                nextId = parseInt(match[1]) + 1;
            }
        }
        this.soaId = `SOA${String(nextId).padStart(4, '0')}`;
    }
    next();
});

// Index for efficient queries
investorSOASchema.index({ investorId: 1, periodStart: 1, periodEnd: 1 });

module.exports = mongoose.model('InvestorSOA', investorSOASchema);

