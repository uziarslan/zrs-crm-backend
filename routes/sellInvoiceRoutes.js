const express = require('express');
const { param, body } = require('express-validator');
const { createSellInvoice, downloadSellInvoice } = require('../controllers/sellInvoiceController');
const { authenticate, isAdminOrManager } = require('../middleware/auth');
const { validate } = require('../middleware/validators');

const router = express.Router();

router.post(
    '/:leadId',
    authenticate,
    isAdminOrManager,
    param('leadId').isMongoId().withMessage('Invalid lead ID'),
    body('balancePaymentReceived').optional().isFloat({ min: 0 }).withMessage('Balance payment received must be a positive number'),
    body('paymentMode').optional().isIn(['Cash', 'Bank Transfer', 'Cheque', 'Finance']).withMessage('Invalid payment mode'),
    validate,
    createSellInvoice
);

router.get(
    '/:invoiceId/download',
    authenticate,
    isAdminOrManager,
    param('invoiceId').isMongoId().withMessage('Invalid Sell Invoice ID'),
    validate,
    downloadSellInvoice
);

module.exports = router;

