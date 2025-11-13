const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
    invoiceNo: { type: String, unique: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    investorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Investor', required: true },
    preparedBy: { type: String },
    totals: {
        buying_price: { type: Number, default: 0 },
        transfer_cost_rta: { type: Number, default: 0 },
        detailing_inspection_cost: { type: Number, default: 0 },
        agent_commission: { type: Number, default: 0 },
        car_recovery_cost: { type: Number, default: 0 },
        other_charges: { type: Number, default: 0 },
        total_amount_payable: { type: Number, default: 0 }
    },
    vehicle: {
        make: String,
        model: String,
        trim: String,
        year: String,
        vin: String
    },
    status: { type: String, enum: ['draft', 'sent'], default: 'sent' },
    // Removed Cloudinary storage fields
    mimeType: { type: String },
    fileSize: { type: Number },
    // Optional base64 content for direct storage/delivery when not using Cloudinary
    content: { type: String },
    // Invoice evidence documents for each cost field
    costInvoiceEvidence: {
        transferCost: {
            fileName: String,
            fileType: String,
            fileSize: Number,
            url: String,
            publicId: String,
            uploadedBy: {
                type: mongoose.Schema.Types.ObjectId,
                refPath: 'costInvoiceEvidence.transferCost.uploadedByModel'
            },
            uploadedByModel: {
                type: String,
                enum: ['Admin', 'Manager']
            },
            uploadedAt: Date
        },
        detailingInspectionCost: {
            fileName: String,
            fileType: String,
            fileSize: Number,
            url: String,
            publicId: String,
            uploadedBy: {
                type: mongoose.Schema.Types.ObjectId,
                refPath: 'costInvoiceEvidence.detailingInspectionCost.uploadedByModel'
            },
            uploadedByModel: {
                type: String,
                enum: ['Admin', 'Manager']
            },
            uploadedAt: Date
        },
        agentCommission: {
            fileName: String,
            fileType: String,
            fileSize: Number,
            url: String,
            publicId: String,
            uploadedBy: {
                type: mongoose.Schema.Types.ObjectId,
                refPath: 'costInvoiceEvidence.agentCommission.uploadedByModel'
            },
            uploadedByModel: {
                type: String,
                enum: ['Admin', 'Manager']
            },
            uploadedAt: Date
        },
        carRecoveryCost: {
            fileName: String,
            fileType: String,
            fileSize: Number,
            url: String,
            publicId: String,
            uploadedBy: {
                type: mongoose.Schema.Types.ObjectId,
                refPath: 'costInvoiceEvidence.carRecoveryCost.uploadedByModel'
            },
            uploadedByModel: {
                type: String,
                enum: ['Admin', 'Manager']
            },
            uploadedAt: Date
        },
        otherCharges: {
            fileName: String,
            fileType: String,
            fileSize: Number,
            url: String,
            publicId: String,
            uploadedBy: {
                type: mongoose.Schema.Types.ObjectId,
                refPath: 'costInvoiceEvidence.otherCharges.uploadedByModel'
            },
            uploadedByModel: {
                type: String,
                enum: ['Admin', 'Manager']
            },
            uploadedAt: Date
        }
    },
    sentAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Auto-increment invoice number similar to PO
invoiceSchema.pre('save', async function (next) {
    if (!this.invoiceNo) {
        const last = await this.constructor.findOne({}, {}, { sort: { createdAt: -1 } });
        let nextId = 1;
        if (last && last.invoiceNo) {
            const match = last.invoiceNo.match(/INV(\d+)/);
            if (match) nextId = parseInt(match[1]) + 1;
        }
        this.invoiceNo = `INV${String(nextId).padStart(4, '0')}`;
    }
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);


