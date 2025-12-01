const mongoose = require('mongoose');

const sellOrderSchema = new mongoose.Schema({
    lead: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        required: true,
        unique: true,
        index: true
    },
    salesOrderNumber: {
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
        inclusion: {
            type: String,
            enum: ['included', 'excluded'],
            default: 'included'
        },
        amount: {
            type: Number,
            default: 0
        }
    },
    insurance: {
        inclusion: {
            type: String,
            enum: ['included', 'excluded'],
            default: 'included'
        },
        amount: {
            type: Number,
            default: 0
        }
    },
    bankFinanceFee: {
        type: Number,
        default: 0
    },
    inspectionCost: {
        type: Number,
        default: 0
    },
    totalPayable: {
        type: Number,
        default: 0
    },
    paymentMode: {
        type: String,
        required: true
    },
    bookingAmount: {
        type: Number,
        default: 0
    },
    balanceAmount: {
        type: Number,
        default: 0
    },
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

module.exports = mongoose.model('SellOrder', sellOrderSchema);


