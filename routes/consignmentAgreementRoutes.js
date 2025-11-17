const express = require('express');
const { param } = require('express-validator');
const { createConsignmentAgreement, downloadConsignmentAgreement } = require('../controllers/consignmentAgreementController');
const { authenticate, isAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validators');

const router = express.Router();

router.post(
    '/:leadId',
    authenticate,
    isAdmin,
    param('leadId').isMongoId().withMessage('Invalid lead ID'),
    validate,
    createConsignmentAgreement
);

router.get(
    '/:agreementId/download',
    authenticate,
    isAdmin,
    param('agreementId').isMongoId().withMessage('Invalid agreement ID'),
    validate,
    downloadConsignmentAgreement
);

module.exports = router;


