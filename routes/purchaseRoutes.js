const express = require('express');
const router = express.Router();
const multer = require('multer');
const { storage } = require('../cloudinary');
const purchaseController = require('../controllers/purchaseController');
const { authenticate, isAdmin, isAdminOrManager } = require('../middleware/auth');
const {
    validate,
    createLeadValidation,
    createPOValidation,
    mongoIdValidation
} = require('../middleware/validators');
const { body } = require('express-validator');

// Configure multer with Cloudinary storage
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only PDF, PNG, and JPG files are allowed.'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max file size (Cloudinary free tier actual limit)
    },
    fileFilter: fileFilter
});

// Lead routes
router.post(
    '/leads',
    authenticate,
    isAdminOrManager,
    createLeadValidation,
    validate,
    purchaseController.createLead
);

router.get('/leads', authenticate, purchaseController.getLeads);

router.put(
    '/leads/bulk-status',
    authenticate,
    isAdmin,
    body('leadIds').isArray().withMessage('leadIds must be an array'),
    body('status').notEmpty().withMessage('Status is required'),
    body('notes').optional().isString(),
    validate,
    purchaseController.bulkUpdateLeadStatus
);

router.get(
    '/leads/:id',
    authenticate,
    mongoIdValidation,
    validate,
    purchaseController.getLeadById
);

router.put(
    '/leads/:id/status',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    validate,
    purchaseController.updateLeadStatus
);

router.put(
    '/leads/:id/notes/:noteId',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    body('content').notEmpty().withMessage('Note content is required'),
    validate,
    purchaseController.editNote
);

router.delete(
    '/leads/:id/notes/:noteId',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    validate,
    purchaseController.deleteNote
);

router.put(
    '/leads/:id/price-analysis',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    body('vin')
        .optional({ values: 'falsy' })
        .isString()
        .isLength({ min: 5, max: 30 })
        .withMessage('VIN must be a string between 5 and 30 characters'),
    body('minSellingPrice')
        .optional({ values: 'falsy' })
        .isFloat({ min: 0 })
        .withMessage('Minimum Selling Price must be a positive number'),
    body('maxSellingPrice')
        .optional({ values: 'falsy' })
        .isFloat({ min: 0 })
        .withMessage('Maximum Selling Price must be a positive number'),
    body('purchasedFinalPrice')
        .optional({ values: 'falsy' })
        .isFloat({ min: 0 })
        .withMessage('Purchased Final Price must be a positive number'),
    validate,
    purchaseController.updatePriceAnalysis
);

// Assign investor to lead (Admin only)
router.put(
    '/leads/:id/investor',
    authenticate,
    isAdmin,
    mongoIdValidation,
    body('investorId').notEmpty().withMessage('Investor ID is required'),
    validate,
    purchaseController.assignInvestorToLead
);

// List investors (Admin only)
router.get(
    '/investors',
    authenticate,
    isAdmin,
    purchaseController.listInvestors
);

// Submit for approval (Admin only)
router.post(
    '/leads/:id/submit-approval',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    purchaseController.submitLeadForApproval
);

// Approve lead (Admin only)
router.post(
    '/leads/:id/approve',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    purchaseController.approveLead
);

// Decline lead (Admin only)
router.post(
    '/leads/:id/decline',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    purchaseController.declineLead
);

// Decline lead approval (Admin only)
router.post(
    '/leads/:id/decline-approval',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    purchaseController.declineLeadApproval
);

// Convert lead to vehicle (Admin only)
router.post(
    '/leads/:id/purchase',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    purchaseController.convertLeadToVehicle
);

router.post(
    '/leads/:id/documents',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    upload.fields([
        { name: 'inspectionReport', maxCount: 1 },
        { name: 'registrationCard', maxCount: 1 },
        { name: 'carPictures', maxCount: 20 },
        { name: 'onlineHistoryCheck', maxCount: 1 }
    ]),
    purchaseController.uploadDocuments
);

router.delete(
    '/leads/:id/documents/:docId',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    purchaseController.deleteDocument
);

router.put(
    '/leads/:id',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    validate,
    purchaseController.updateLead
);

// Create/Update Purchase Order cost fields for a lead (draft before approval)
router.put(
    '/leads/:id/purchase-order',
    authenticate,
    isAdmin,
    mongoIdValidation,
    body('transferCost').notEmpty().isFloat({ min: 0 }).withMessage('transferCost is required'),
    body('detailing_inspection_cost').notEmpty().isFloat({ min: 0 }).withMessage('detailing_inspection_cost is required'),
    body('agent_commision').optional({ values: 'falsy' }).isFloat({ min: 0 }),
    body('car_recovery_cost').optional({ values: 'falsy' }).isFloat({ min: 0 }),
    body('other_charges').optional({ values: 'falsy' }).isFloat({ min: 0 }),
    validate,
    purchaseController.upsertLeadPurchaseOrder
);

router.put(
    '/leads/:id/assign',
    authenticate,
    isAdmin,
    mongoIdValidation,
    body('assignedTo').optional().isMongoId().withMessage('Invalid manager ID'),
    validate,
    purchaseController.assignLead
);

// Purchase Order routes
router.post(
    '/po',
    authenticate,
    isAdminOrManager,
    createPOValidation,
    validate,
    purchaseController.createPurchaseOrder
);

router.get('/po', authenticate, purchaseController.getPurchaseOrders);

router.post(
    '/po/:id/approve',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    purchaseController.approvePurchaseOrder
);

// Inventory routes
router.get('/inventory', authenticate, purchaseController.getInventory);

router.get(
    '/inventory/:id',
    authenticate,
    mongoIdValidation,
    validate,
    purchaseController.getVehicleById
);

router.put(
    '/vehicles/:id/mark-ready',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    validate,
    purchaseController.markVehicleAsReady
);

router.put(
    '/:vehicleId/checklist',
    authenticate,
    isAdminOrManager,
    purchaseController.updateChecklist
);

// Vehicle checklist update route
router.put(
    '/vehicles/:id/checklist',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    body('item').notEmpty().withMessage('Checklist item is required'),
    body('completed').optional().isBoolean().withMessage('Completed must be a boolean'),
    body('notes').optional().isString().withMessage('Notes must be a string'),
    validate,
    purchaseController.updateVehicleChecklist
);

// Mark vehicle as ready for sale
router.put(
    '/vehicles/:id/mark-ready',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    validate,
    purchaseController.markVehicleAsReady
);

// Proxy endpoint to serve PDFs inline
router.get(
    '/leads/:leadId/documents/:docId/view',
    authenticate,
    isAdminOrManager,
    purchaseController.viewDocument
);

// Signed documents from Purchase Orders
router.get(
    '/po/:id/documents/:documentId',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    validate,
    purchaseController.getSignedDocument
);

// Send test invoice email (no purchase action)
router.post(
    '/po/:id/invoice/test',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    purchaseController.sendInvoiceTestEmail
);

// Preview invoice inline (dev/admin)
router.get(
    '/invoices/preview',
    authenticate,
    isAdmin,
    purchaseController.previewInvoice
);

module.exports = router;

