const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Webhooks are public (no authentication) but should verify signatures in production

router.post('/docusign', webhookController.docusignWebhook);
router.post('/quickbooks', webhookController.quickbooksWebhook);
router.post('/teams', webhookController.teamsWebhook);

// Test endpoint
router.post('/test', (req, res) => {
    console.log('🧪 Test webhook called!');
    console.log('📋 Request body:', req.body);
    console.log('📋 Request rawBody:', req.rawBody);
    res.json({ success: true, message: 'Test webhook working' });
});

module.exports = router;

