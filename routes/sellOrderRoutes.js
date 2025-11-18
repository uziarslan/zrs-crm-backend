const express = require('express');
const { param } = require('express-validator');
const {
    createSellOrder,
    deleteSellOrder,
    downloadSellOrder
} = require('../controllers/sellOrderController');
const { authenticate, isAdmin, isAdminOrManager } = require('../middleware/auth');
const { validate } = require('../middleware/validators');

const router = express.Router();

router.post(
    '/:leadId',
    authenticate,
    isAdmin,
    param('leadId').isMongoId().withMessage('Invalid lead ID'),
    validate,
    createSellOrder
);

router.delete(
    '/:leadId',
    authenticate,
    isAdmin,
    param('leadId').isMongoId().withMessage('Invalid lead ID'),
    validate,
    deleteSellOrder
);

router.get(
    '/:orderId/download',
    authenticate,
    isAdminOrManager,
    param('orderId').isMongoId().withMessage('Invalid order ID'),
    validate,
    downloadSellOrder
);

module.exports = router;


