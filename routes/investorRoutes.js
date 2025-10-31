const express = require('express');
const router = express.Router();
const investorController = require('../controllers/investorController');
const { authenticate, isAdmin } = require('../middleware/auth');
const { validate, mongoIdValidation } = require('../middleware/validators');

// Get all investors (Admin only)
router.get('/', authenticate, isAdmin, investorController.getAllInvestors);

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

// Update credit limit (Admin only)
router.put(
    '/:id/credit-limit',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    investorController.updateCreditLimit
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

module.exports = router;

