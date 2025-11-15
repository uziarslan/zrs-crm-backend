const express = require('express');
const router = express.Router();
const investorController = require('../controllers/investorController');
const { authenticate, isAdmin } = require('../middleware/auth');
const { validate, mongoIdValidation } = require('../middleware/validators');

// Get all investors (Admin only)
router.get('/', authenticate, isAdmin, investorController.getAllInvestors);

// Create investor (Admin only)
router.post('/', authenticate, isAdmin, investorController.createInvestor);

// Get investor SOA
router.get(
    '/:id/soa',
    authenticate,
    mongoIdValidation,
    validate,
    investorController.getInvestorSOA
);

// Get investor inventory
router.get(
    '/:id/inventory',
    authenticate,
    mongoIdValidation,
    validate,
    investorController.getInvestorInventory
);

// Update investor (Admin only)
router.put(
    '/:id',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    investorController.updateInvestor
);

// Update credit limit (Admin only)
router.put(
    '/:id/credit-limit',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    investorController.updateCreditLimit
);

// Delete investor (Admin only)
router.delete(
    '/:id',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    investorController.deleteInvestor
);

// Generate SOA (Admin only)
router.post(
    '/:id/generate-soa',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    investorController.generateSOA
);

// Get investor agreement document (Admin only)
router.get(
    '/:id/agreement/document',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    investorController.getInvestorAgreementDocument
);

// Resend activation email (Admin only)
router.post(
    '/:id/resend-activation',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    investorController.resendActivationEmail
);

module.exports = router;

