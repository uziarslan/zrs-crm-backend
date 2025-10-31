const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');
const { authenticate } = require('../middleware/auth');

// All export routes require authentication
router.use(authenticate);

// Export inventory
router.get('/inventory', exportController.exportInventory);

// Export leads
router.get('/leads', exportController.exportLeads);

// Export sales report
router.get('/sales', exportController.exportSales);

// Export investor SOA
router.get('/investor-soa/:investorId', exportController.exportInvestorSOA);

module.exports = router;

