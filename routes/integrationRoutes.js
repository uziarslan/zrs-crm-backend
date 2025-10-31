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

// DocuSign routes
router.get('/docusign/callback', integrationController.docusignCallback);
router.post(
    '/docusign/send-po/:poId',
    authenticate,
    isAdminOrManager,
    integrationController.sendDocuSignPO
);

// Teams calendar
router.post(
    '/teams/test-drive',
    authenticate,
    isAdminOrManager,
    integrationController.createTestDriveEvent
);

module.exports = router;

