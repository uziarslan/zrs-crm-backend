const mongoose = require('mongoose');

const sellInvoiceSchema = new mongoose.Schema({
    lead: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        required: true,
        unique: true,
        index: true
    },
    sellOrder: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SellOrder',
        required: true
    },
    invoiceNumber: {
        type: String,
        unique: true,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    preparedBy: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'preparedByModel',
        required: true
    },
    preparedByModel: {
        type: String,
        enum: ['Admin', 'Manager'],
        default: 'Admin'
    },
    preparedByName: {
        type: String
    },
    salesOrderNumber: {
        type: String,
        required: true
    },
    customerName: {
        type: String,
        required: true
    },
    customerContact: {
        type: String,
        required: true
    },
    customerEmail: {
        type: String
    },
    customerIdDocument: {
        type: String,
        required: true
    },
    customerAddress: {
        type: String,
        required: true
    },
    vehicle: {
        make: String,
        model: String,
        trim: String,
        year: Number,
        mileage: Number,
        chassisNo: String,
        color: String
    },
    sellingPrice: {
        type: Number,
        required: true
    },
    transferCost: {
        type: Number,
        default: 0
    },
    insurance: {
        type: Number,
        default: 0
    },
    bankFinanceFee: {
        type: Number,
        default: 0
    },
    otherCharges: {
        type: Number,
        default: 0
    },
    totalInvoiceValue: {
        type: Number,
        required: true
    },
    paymentMode: {
        type: String,
        required: true
    },
    bookingAmountReceived: {
        type: Number,
        default: 0
    },
    balancePaymentReceived: {
        type: Number,
        default: 0
    },
    totalAmountReceived: {
        type: Number,
        required: true
    },
    dateOfFinalPayment: {
        type: Date,
        default: Date.now
    },
    receivedBy: {
        type: String,
        required: true
    },
    // Profit calculations
    purchasePrice: {
        type: Number,
        required: true
    },
    totalCost: {
        type: Number,
        required: true
    },
    totalProfit: {
        type: Number,
        required: true
    },
    zrsProfit: {
        type: Number,
        required: true
    },
    ownerProfit: {
        type: Number,
        default: 0
    },
    investorBreakdown: [{
        investorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Investor'
        },
        investmentAmount: Number,
        ownershipPercentage: Number,
        profitAmount: Number,
        profitPercentage: Number,
        totalPayout: Number
    }],
    pdfContent: {
        type: String,
        required: true
    },
    pdfSize: Number,
    pdfMimeType: {
        type: String,
        default: 'application/pdf'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('SellInvoice', sellInvoiceSchema);

