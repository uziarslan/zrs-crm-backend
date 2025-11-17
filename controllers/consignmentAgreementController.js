const Lead = require('../models/Lead');
const ConsignmentAgreement = require('../models/ConsignmentAgreement');
const { generateConsignmentAgreementPdf } = require('../services/consignmentAgreementPdfService');
const logger = require('../utils/logger');

const getNextAgreementNumber = async () => {
    const lastAgreement = await ConsignmentAgreement.findOne({}, {}, { sort: { createdAt: -1 } });
    let nextId = 1;
    if (lastAgreement?.agreementNumber) {
        const match = lastAgreement.agreementNumber.match(/CA(\d+)/);
        if (match) {
            nextId = parseInt(match[1], 10) + 1;
        }
    }
    return `CA${String(nextId).padStart(5, '0')}`;
};

const pickString = (...values) => {
    for (const value of values) {
        if (value === undefined || value === null) continue;
        const stringValue = String(value).trim();
        if (stringValue) return stringValue;
    }
    return '';
};

exports.createConsignmentAgreement = async (req, res, next) => {
    try {
        const { leadId } = req.params;
        const lead = await Lead.findById(leadId);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        if (lead.status !== 'consignment') {
            return res.status(400).json({
                success: false,
                message: 'Consignment agreements can only be generated for leads in consignment status'
            });
        }

        const ownerName = pickString(req.body.ownerName, lead.ownerInfo?.name, lead.contactInfo?.name);
        const ownerContact = pickString(req.body.ownerContact, lead.ownerInfo?.contactNumber, lead.contactInfo?.phone);
        const ownerEmiratesIdOrPassport = pickString(
            req.body.ownerEmiratesIdOrPassport,
            lead.ownerInfo?.emiratesIdOrPassport,
            lead.contactInfo?.passportOrEmiratesId
        );
        const ownerAddress = pickString(req.body.ownerAddress, lead.ownerInfo?.address);

        const missingFields = [];
        if (!ownerName) missingFields.push('ownerName');
        if (!ownerAddress) missingFields.push('ownerAddress');
        if (!ownerEmiratesIdOrPassport) missingFields.push('ownerEmiratesIdOrPassport');
        if (!ownerContact) missingFields.push('ownerContact');

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missingFields.join(', ')}`
            });
        }

        const agreedAmountInput = req.body.agreedAmount ?? lead.priceAnalysis?.purchasedFinalPrice;
        const agreedAmount = Number(agreedAmountInput);
        if (!Number.isFinite(agreedAmount) || agreedAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Agreed amount must be a positive number'
            });
        }

        const duration = pickString(req.body.duration, '30-45 days');

        const vehicleInfo = lead.vehicleInfo || {};
        const vehicleSnapshot = {
            make: vehicleInfo.make || '',
            model: vehicleInfo.model || '',
            trim: vehicleInfo.trim || '',
            year: vehicleInfo.year || null,
            mileage: vehicleInfo.mileage || null,
            chassisNo: vehicleInfo.vin || '',
            color: vehicleInfo.color || ''
        };

        const existingAgreement = await ConsignmentAgreement.findOne({ lead: lead._id });
        const agreementNumber = existingAgreement?.agreementNumber || await getNextAgreementNumber();
        const pdfBuffer = await generateConsignmentAgreementPdf({
            agreementNumber,
            agreementDate: new Date(),
            ownerName,
            ownerContact,
            ownerEmiratesIdOrPassport,
            ownerAddress,
            vehicle: vehicleSnapshot,
            agreedAmount,
            duration
        });

        const pdfBase64 = pdfBuffer.toString('base64');

        lead.ownerInfo = {
            ...(lead.ownerInfo || {}),
            name: ownerName,
            contactNumber: ownerContact,
            address: ownerAddress,
            emiratesIdOrPassport: ownerEmiratesIdOrPassport
        };

        await lead.save();

        let agreementDoc = existingAgreement;
        if (agreementDoc) {
            agreementDoc.ownerName = ownerName;
            agreementDoc.ownerContact = ownerContact;
            agreementDoc.ownerEmiratesIdOrPassport = ownerEmiratesIdOrPassport;
            agreementDoc.ownerAddress = ownerAddress;
            agreementDoc.vehicle = vehicleSnapshot;
            agreementDoc.agreedAmount = agreedAmount;
            agreementDoc.duration = duration;
            agreementDoc.pdfContent = pdfBase64;
            agreementDoc.pdfSize = pdfBuffer.length;
            agreementDoc.date = new Date();
            await agreementDoc.save();
        } else {
            agreementDoc = await ConsignmentAgreement.create({
                lead: lead._id,
                agreementNumber,
                ownerName,
                ownerContact,
                ownerEmiratesIdOrPassport,
                ownerAddress,
                vehicle: vehicleSnapshot,
                agreedAmount,
                duration,
                pdfContent: pdfBase64,
                pdfSize: pdfBuffer.length
            });
        }

        const downloadPath = `/api/v1/consignment-agreement/${agreementDoc._id}/download`;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const absoluteDownloadUrl = `${baseUrl}${downloadPath}`;

        logger.info(`Consignment agreement ${agreementDoc.agreementNumber} processed for lead ${lead.leadId}`);

        res.status(201).json({
            success: true,
            message: 'Consignment agreement generated successfully',
            agreement: {
                id: agreementDoc._id,
                agreementNumber: agreementDoc.agreementNumber,
                downloadUrl: absoluteDownloadUrl
            },
            downloadUrl: absoluteDownloadUrl
        });
    } catch (error) {
        logger.error('Create consignment agreement error:', error);
        next(error);
    }
};

exports.downloadConsignmentAgreement = async (req, res, next) => {
    try {
        const { agreementId } = req.params;
        const agreement = await ConsignmentAgreement.findById(agreementId);

        if (!agreement) {
            return res.status(404).json({
                success: false,
                message: 'Agreement not found'
            });
        }

        if (!agreement.pdfContent) {
            return res.status(404).json({
                success: false,
                message: 'Agreement PDF not found'
            });
        }

        const fileName = `${agreement.agreementNumber || 'Consignment_Agreement'}.pdf`;

        res.setHeader('Content-Type', agreement.pdfMimeType || 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        const pdfBuffer = Buffer.from(agreement.pdfContent, 'base64');
        res.send(pdfBuffer);
    } catch (error) {
        logger.error('Download consignment agreement error:', error);
        next(error);
    }
};


