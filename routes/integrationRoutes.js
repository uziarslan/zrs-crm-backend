const express = require('express');
const router = express.Router();
const integrationController = require('../controllers/integrationController');
const { authenticate, isAdmin, isAdminOrManager } = require('../middleware/auth');

// QuickBooks routes
router.get(
    '/quickbooks/auth-url',
    authenticate,
    isAdmin,
    integrationController.getQuickBooksAuthUrl
);

router.get('/quickbooks/callback', integrationController.quickbooksCallback);

// Microsoft Graph / Teams routes
router.get(
    '/ms-graph/auth-url',
    authenticate,
    isAdminOrManager,
    integrationController.getMSGraphAuthUrl
);

router.get('/ms-graph/callback', integrationController.msGraphCallback);

// Zoho Sign routes
router.post(
    '/sign/send-po/:poId',
    authenticate,
    isAdminOrManager,
    integrationController.sendZohoSignPO
);

// Teams calendar
router.post(
    '/teams/test-drive',
    authenticate,
    isAdminOrManager,
    integrationController.createTestDriveEvent
);

module.exports = router;

