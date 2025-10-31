const { body, param, query, validationResult } = require('express-validator');

/**
 * Middleware to check validation results
 */
exports.validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array()
        });
    }
    next();
};

/**
 * Validation rules for authentication
 */
exports.loginValidation = [
    body('email').isEmail().withMessage('Please provide a valid email'),
    body('password').notEmpty().withMessage('Password is required')
];

exports.otpRequestValidation = [
    body('email').isEmail().withMessage('Please provide a valid email')
];

exports.otpVerifyValidation = [
    body('email').isEmail().withMessage('Please provide a valid email'),
    body('otp').notEmpty().withMessage('OTP is required').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
];

exports.inviteValidation = [
    body('email').isEmail().withMessage('Please provide a valid email'),
    body('role').isIn(['manager', 'investor']).withMessage('Role must be manager or investor'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('creditLimit').if(body('role').equals('investor')).isNumeric().withMessage('Credit limit must be a number')
];

/**
 * Validation rules for leads
 */
exports.createLeadValidation = [
    body('type').isIn(['purchase', 'sales']).withMessage('Type must be purchase or sales'),
    body('source').isIn(['phone', 'email', 'walk-in', 'website', 'referral', 'social-media', 'other']).withMessage('Invalid source'),
    body('contactInfo.name').notEmpty().withMessage('Contact name is required'),
    body('contactInfo.phone').optional().isMobilePhone().withMessage('Invalid phone number'),
    body('contactInfo.email').optional().isEmail().withMessage('Invalid email')
];

/**
 * Validation rules for vehicles
 */
exports.createVehicleValidation = [
    body('make').notEmpty().withMessage('Make is required'),
    body('model').notEmpty().withMessage('Model is required'),
    body('year').isInt({ min: 1900, max: new Date().getFullYear() + 1 }).withMessage('Invalid year'),
    body('mileage').isNumeric().withMessage('Mileage must be a number'),
    body('ownerName').notEmpty().withMessage('Owner name is required'),
    body('askingPrice').isNumeric().withMessage('Asking price must be a number')
];

/**
 * Validation rules for purchase orders
 */
exports.createPOValidation = [
    body('vehicleId').notEmpty().withMessage('Vehicle ID is required'),
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('investorAllocations').isArray({ min: 1 }).withMessage('At least one investor allocation is required'),
    body('investorAllocations.*.investorId').notEmpty().withMessage('Investor ID is required'),
    body('investorAllocations.*.amount').isNumeric().withMessage('Allocation amount must be a number'),
    body('investorAllocations.*.percentage').isNumeric().withMessage('Allocation percentage must be a number')
];

/**
 * Validation rules for sales
 */
exports.createSaleValidation = [
    body('vehicleId').notEmpty().withMessage('Vehicle ID is required'),
    body('customerName').notEmpty().withMessage('Customer name is required'),
    body('sellingPrice').isNumeric().withMessage('Selling price must be a number')
];

/**
 * Validation rules for CSA tickets
 */
exports.createTicketValidation = [
    body('type').isIn(['customer_query', 'vehicle_issue', 'document_request', 'complaint', 'feedback', 'other']).withMessage('Invalid ticket type'),
    body('subject').notEmpty().withMessage('Subject is required'),
    body('description').notEmpty().withMessage('Description is required'),
    body('customerInfo.name').optional().notEmpty().withMessage('Customer name cannot be empty')
];

/**
 * ID parameter validation
 */
exports.mongoIdValidation = [
    param('id').isMongoId().withMessage('Invalid ID format')
];

