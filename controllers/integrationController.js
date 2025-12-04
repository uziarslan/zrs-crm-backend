const quickbooksService = require('../services/quickbooksService');
const teamsService = require('../services/teamsService');
const zohoSignService = require('../services/zohoSignService');
const PurchaseOrder = require('../models/PurchaseOrder');
const Investor = require('../models/Investor');
const logger = require('../utils/logger');

/**
 * @desc    Get QuickBooks OAuth URL
 * @route   GET /api/integrations/quickbooks/auth-url
 * @access  Private (Admin only)
 */
exports.getQuickBooksAuthUrl = async (req, res, next) => {
    try {
        const authUrl = quickbooksService.getAuthorizationUrl();

        res.status(200).json({
            success: true,
            authUrl
        });
    } catch (error) {
        logger.error('Get QuickBooks auth URL error:', error);
        next(error);
    }
};

/**
 * @desc    QuickBooks OAuth callback
 * @route   GET /api/integrations/quickbooks/callback
 * @access  Public (OAuth callback)
 */
exports.quickbooksCallback = async (req, res, next) => {
    try {
        const { code, realmId } = req.query;

        if (!code) {
            return res.status(400).json({
                success: false,
                message: 'Authorization code is required'
            });
        }

        const tokens = await quickbooksService.exchangeCodeForToken(code);

        // In production, store tokens securely in database associated with the admin user

        res.send(`
      <html>
        <body>
          <h1>QuickBooks Connected Successfully!</h1>
          <p>You can close this window and return to the CRM.</p>
          <script>window.close();</script>
        </body>
      </html>
    `);
    } catch (error) {
        logger.error('QuickBooks callback error:', error);
        res.status(500).send('Failed to connect QuickBooks');
    }
};

/**
 * @desc    Get Microsoft Graph OAuth URL
 * @route   GET /api/integrations/ms-graph/auth-url
 * @access  Private (Admin/Manager)
 */
exports.getMSGraphAuthUrl = async (req, res, next) => {
    try {
        const authUrl = teamsService.getAuthorizationUrl();

        res.status(200).json({
            success: true,
            authUrl
        });
    } catch (error) {
        logger.error('Get MS Graph auth URL error:', error);
        next(error);
    }
};

/**
 * @desc    Microsoft Graph OAuth callback
 * @route   GET /api/integrations/ms-graph/callback
 * @access  Public (OAuth callback)
 */
exports.msGraphCallback = async (req, res, next) => {
    try {
        const { code } = req.query;

        if (!code) {
            return res.status(400).json({
                success: false,
                message: 'Authorization code is required'
            });
        }

        const tokens = await teamsService.exchangeCodeForToken(code);

        // In production, store tokens securely in database

        res.send(`
      <html>
        <body>
          <h1>Microsoft Calendar Connected Successfully!</h1>
          <p>You can close this window and return to the CRM.</p>
          <script>window.close();</script>
        </body>
      </html>
    `);
    } catch (error) {
        logger.error('MS Graph callback error:', error);
        res.status(500).send('Failed to connect Microsoft Calendar');
    }
};

/**
 * @desc    Send Zoho Sign request for PO
 * @route   POST /api/integrations/sign/send-po/:poId
 * @access  Private (Admin/Manager)
 */
exports.sendZohoSignPO = async (req, res, next) => {
    try {
        const po = await PurchaseOrder.findById(req.params.poId)
            .populate('vehicleId')
            .populate('investorAllocations.investorId');

        if (!po) {
            return res.status(404).json({
                success: false,
                message: 'Purchase Order not found'
            });
        }

        // Check if dual approval is met before sending to Zoho Sign
        if (!po.isDualApprovalMet()) {
            return res.status(400).json({
                success: false,
                message: 'Purchase Order requires dual admin approval before sending to Zoho Sign'
            });
        }

        // Prepare investor data
        const investorAllocations = po.investorAllocations.map((allocation) => ({
            investorId: allocation.investorId?._id || allocation.investorId,
            investorName: allocation.investorId?.name,
            investorEmail: allocation.investorId?.email,
            amount: allocation.amount,
            percentage: allocation.percentage
        }));

        // Create Zoho Sign requests (one per investor)
        const envelopes = await zohoSignService.createPurchaseOrderEnvelope({
            poId: po.poId,
            vehicleId: po.vehicleId?.vehicleId,
            investorAllocations,
            amount: po.amount
        });

        const envelopeStatus = (status) => (status || 'sent').toLowerCase();
        const now = new Date();

        po.docuSignEnvelopeId = envelopes[0]?.envelopeId || null;
        po.docuSignStatus = 'sent';
        po.docuSignSentAt = now;
        po.status = 'pending_signature';
        po.docuSignEnvelopes = envelopes.map((env) => ({
            investorId: env.investorId,
            investorName: env.investorName,
            investorEmail: env.investorEmail,
            envelopeId: env.envelopeId,
            status: envelopeStatus(env.status),
            sentAt: now
        }));

        po.investorAllocations = po.investorAllocations.map((allocation) => {
            const match = envelopes.find((env) => String(env.investorId) === String(allocation.investorId));
            if (match) {
                allocation.docuSignEnvelopeId = match.envelopeId;
                allocation.docuSignStatus = envelopeStatus(match.status);
                allocation.docuSignSentAt = now;
            }
            return allocation;
        });

        await po.save();

        logger.info(`Zoho Sign requests sent for PO ${po.poId}:`, envelopes.map(env => env.envelopeId));

        res.status(200).json({
            success: true,
            message: 'Zoho Sign requests sent to investors',
            data: envelopes
        });
    } catch (error) {
        logger.error('Send Zoho Sign PO error:', error);
        next(error);
    }
};


/**
 * @desc    Create test drive calendar event
 * @route   POST /api/integrations/teams/test-drive
 * @access  Private (Manager)
 */
exports.createTestDriveEvent = async (req, res, next) => {
    try {
        const { vehicleId, customerName, customerEmail, startTime, duration } = req.body;

        const Vehicle = require('../models/Vehicle');
        const vehicle = await Vehicle.findById(vehicleId);

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found'
            });
        }

        // Create calendar event
        const event = await teamsService.createTestDriveEvent({
            vehicleInfo: {
                vehicleId: vehicle.vehicleId,
                make: vehicle.make,
                model: vehicle.model,
                year: vehicle.year,
                mileage: vehicle.mileage
            },
            customerName,
            customerEmail,
            startTime,
            duration: duration || 60 // Default 60 minutes
        });

        logger.info(`Test drive event created: ${event.eventId}`);

        res.status(201).json({
            success: true,
            message: 'Test drive scheduled successfully',
            data: event
        });
    } catch (error) {
        logger.error('Create test drive event error:', error);
        next(error);
    }
};

module.exports = exports;

