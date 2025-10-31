const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');
const { authenticate, isAdmin, isAdminOrManager } = require('../middleware/auth');
const {
    validate,
    createLeadValidation,
    createSaleValidation,
    mongoIdValidation
} = require('../middleware/validators');

// Sales lead routes
router.post(
    '/lead',
    authenticate,
    isAdminOrManager,
    createLeadValidation,
    validate,
    salesController.createSalesLead
);

router.get('/leads', authenticate, salesController.getSalesLeads);

// Sales routes
router.post(
    '/:vehicleId/close',
    authenticate,
    isAdminOrManager,
    createSaleValidation,
    validate,
    salesController.closeSale
);

router.post(
    '/:id/approve',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    salesController.approveSale
);

router.get('/', authenticate, salesController.getSales);

router.get('/report', authenticate, salesController.getSalesReport);

// Follow-up routes
router.post(
    '/leads/:leadId/followup',
    authenticate,
    isAdminOrManager,
    salesController.createFollowUp
);

router.put(
    '/followup/:id/complete',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    validate,
    salesController.completeFollowUp
);

module.exports = router;

