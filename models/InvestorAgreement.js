const mongoose = require('mongoose');

const investorAgreementSchema = new mongoose.Schema({
    investorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Investor',
        required: [true, 'Investor ID is required']
    },
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        required: [true, 'Admin ID is required']
    },
    envelopeId: {
        type: String,
        required: [true, 'DocuSign envelope ID is required'],
        unique: true
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'signed', 'completed', 'declined', 'voided', 'failed'],
        default: 'sent'
    },
    docuSignStatus: {
        type: String,
        enum: ['sent', 'delivered', 'signed', 'completed', 'declined', 'voided', 'failed'],
        default: 'sent'
    },
    sentAt: {
        type: Date,
        default: Date.now
    },
    completedAt: {
        type: Date
    },
    activationEmailSent: {
        type: Boolean,
        default: false
    },
    activationEmailSentAt: {
        type: Date
    },
    signedDocuments: [{
        documentId: String,
        name: String,
        fileType: {
            type: String,
            default: 'application/pdf'
        },
        fileSize: Number,
        content: String, // Base64 encoded PDF
        uri: String
    }],
    agreementData: {
        adminName: String,
        adminDesignation: String,
        investorName: String,
        investorEmail: String,
        investorEid: String,
        decidedPercentageMin: Number,
        decidedPercentageMax: Number,
        investmentAmount: Number, // Credit limit
        date: Date
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

// Update timestamp
investorAgreementSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

// Index for faster queries
investorAgreementSchema.index({ investorId: 1 });
investorAgreementSchema.index({ adminId: 1 });
investorAgreementSchema.index({ envelopeId: 1 });
investorAgreementSchema.index({ status: 1 });

module.exports = mongoose.model('InvestorAgreement', investorAgreementSchema);

