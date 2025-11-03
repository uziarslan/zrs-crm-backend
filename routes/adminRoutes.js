const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, isAdmin } = require('../middleware/auth');
const { validate, mongoIdValidation } = require('../middleware/validators');
const { body } = require('express-validator');

// All routes require admin authentication
router.use(authenticate);
router.use(isAdmin);

// Dashboard
router.get('/dashboard', adminController.getDashboard);

// Search leads
router.get('/search/leads', adminController.searchLeads);

// Manager management
router.get('/managers', adminController.getManagers);

router.put(
    '/managers/:id/status',
    mongoIdValidation,
    body('status').isIn(['invited', 'active', 'inactive']).withMessage('Invalid status'),
    validate,
    adminController.updateManagerStatus
);

// Admin management
router.get('/admins', adminController.getAdmins);

router.post(
    '/create-admin',
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    validate,
    adminController.createAdmin
);

// Audit logs
router.get('/audit-logs', adminController.getAuditLogs);

// Approval Groups
router.get('/groups', adminController.getAdminGroups);
router.put('/groups',
    body('groups').isArray().withMessage('groups must be an array'),
    body('groups.*.name').notEmpty().withMessage('Group name is required'),
    body('groups.*.members').isArray().withMessage('Group members must be an array'),
    validate,
    adminController.updateAdminGroups
);

module.exports = router;

