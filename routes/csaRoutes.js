const express = require('express');
const router = express.Router();
const csaController = require('../controllers/csaController');
const { authenticate, isAdmin, isAdminOrManager } = require('../middleware/auth');
const {
    validate,
    createTicketValidation,
    mongoIdValidation
} = require('../middleware/validators');

// Create ticket
router.post(
    '/ticket',
    authenticate,
    isAdminOrManager,
    createTicketValidation,
    validate,
    csaController.createTicket
);

// Get all tickets
router.get('/tickets', authenticate, csaController.getTickets);

// Get ticket by ID
router.get(
    '/tickets/:id',
    authenticate,
    mongoIdValidation,
    validate,
    csaController.getTicketById
);

// Update ticket status
router.put(
    '/tickets/:id/status',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    validate,
    csaController.updateTicketStatus
);

// Add response to ticket
router.post(
    '/tickets/:id/response',
    authenticate,
    isAdminOrManager,
    mongoIdValidation,
    validate,
    csaController.addTicketResponse
);

// Assign ticket (Admin only)
router.put(
    '/tickets/:id/assign',
    authenticate,
    isAdmin,
    mongoIdValidation,
    validate,
    csaController.assignTicket
);

// Get dashboard stats
router.get('/dashboard', authenticate, csaController.getDashboard);

module.exports = router;

