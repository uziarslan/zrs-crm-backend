const mongoose = require('mongoose');

const consignmentAgreementSchema = new mongoose.Schema({
    lead: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        required: true,
        index: true
    },
    agreementNumber: {
        type: String,
        unique: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    ownerName: {
        type: String,
        required: true
    },
    ownerContact: String,
    ownerEmiratesIdOrPassport: String,
    ownerAddress: String,
    vehicle: {
        make: String,
        model: String,
        trim: String,
        year: Number,
        mileage: Number,
        chassisNo: String,
        color: String
    },
    agreedAmount: Number,
    duration: {
        type: String,
        default: '30-45 days'
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

consignmentAgreementSchema.pre('save', async function (next) {
    if (!this.agreementNumber) {
        const lastAgreement = await this.constructor.findOne({}, {}, { sort: { createdAt: -1 } });
        let nextId = 1;
        if (lastAgreement?.agreementNumber) {
            const match = lastAgreement.agreementNumber.match(/CA(\d+)/);
            if (match) {
                nextId = parseInt(match[1], 10) + 1;
            }
        }
        this.agreementNumber = `CA${String(nextId).padStart(5, '0')}`;
    }
    next();
});

module.exports = mongoose.model('ConsignmentAgreement', consignmentAgreementSchema);


