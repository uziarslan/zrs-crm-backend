const quickbooksService = require('../services/quickbooksService');
const teamsService = require('../services/teamsService');
const docusignService = require('../services/docusignService');
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
 * @desc    Send DocuSign envelope for PO
 * @route   POST /api/integrations/docusign/send-po/:poId
 * @access  Private (Admin/Manager)
 */
exports.sendDocuSignPO = async (req, res, next) => {
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

        // Check if dual approval is met before sending to DocuSign
        if (!po.isDualApprovalMet()) {
            return res.status(400).json({
                success: false,
                message: 'Purchase Order requires dual admin approval before sending to DocuSign'
            });
        }

        // Prepare investor data
        const investorAllocations = po.investorAllocations.map(allocation => ({
            investorName: allocation.investorId.name,
            investorEmail: allocation.investorId.email,
            amount: allocation.amount,
            percentage: allocation.percentage
        }));

        // Create DocuSign envelope
        const envelope = await docusignService.createPurchaseOrderEnvelope({
            poId: po.poId,
            vehicleId: po.vehicleId?.vehicleId,
            investorAllocations,
            amount: po.amount
        });

        // Update PO with envelope ID
        po.docuSignEnvelopeId = envelope.envelopeId;
        po.docuSignStatus = 'sent';
        po.status = 'pending_signature';
        await po.save();

        logger.info(`DocuSign envelope sent for PO ${po.poId}`);

        res.status(200).json({
            success: true,
            message: 'DocuSign envelope sent to investors',
            data: {
                envelopeId: envelope.envelopeId,
                status: envelope.status
            }
        });
    } catch (error) {
        logger.error('Send DocuSign PO error:', error);
        next(error);
    }
};

/**
 * @desc    DocuSign OAuth callback handler
 * @route   GET /api/integrations/docusign/callback
 * @access  Public (OAuth callback)
 */
exports.docusignCallback = async (req, res, next) => {
    try {
        const { code, error } = req.query;

        if (error) {
            return res.status(400).send(`
                <html>
                    <body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
                        <div style="max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                            <h2 style="color: #d32f2f;">❌ DocuSign Consent Failed</h2>
                            <p>Error: ${error}</p>
                            <p>Please try again or contact support.</p>
                            <a href="/" style="display: inline-block; background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin-top: 20px;">Return to Dashboard</a>
                        </div>
                    </body>
                </html>
            `);
        }

        if (code) {
            return res.status(200).send(`
                <html>
                    <body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
                        <div style="max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                            <h2 style="color: #2e7d32;">✅ DocuSign Consent Granted Successfully!</h2>
                            <p>Your DocuSign integration is now ready to use.</p>
                            <p>You can now:</p>
                            <ul>
                                <li>Create leads and assign investors</li>
                                <li>Submit for dual approval</li>
                                <li>Automatically send DocuSign envelopes to investors</li>
                                <li>Track signing status in real-time</li>
                            </ul>
                            <a href="/" style="display: inline-block; background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin-top: 20px;">Return to Dashboard</a>
                        </div>
                    </body>
                </html>
            `);
        }

        res.status(400).send(`
            <html>
                <body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
                    <div style="max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <h2 style="color: #d32f2f;">❌ Invalid Callback</h2>
                        <p>No authorization code received.</p>
                        <a href="/" style="display: inline-block; background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin-top: 20px;">Return to Dashboard</a>
                    </div>
                </body>
            </html>
        `);
    } catch (error) {
        logger.error('DocuSign callback error:', error);
        res.status(500).send(`
            <html>
                <body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
                    <div style="max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <h2 style="color: #d32f2f;">❌ Server Error</h2>
                        <p>An error occurred processing the DocuSign callback.</p>
                        <a href="/" style="display: inline-block; background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin-top: 20px;">Return to Dashboard</a>
                    </div>
                </body>
            </html>
        `);
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

