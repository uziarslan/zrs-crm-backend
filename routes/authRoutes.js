const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate, isAdmin } = require('../middleware/auth');
const { otpRateLimiter, strictRateLimiter } = require('../middleware/rateLimiter');
const {
    validate,
    loginValidation,
    otpRequestValidation,
    otpVerifyValidation,
    inviteValidation
} = require('../middleware/validators');

// Admin login
router.post(
    '/admin/login',
    strictRateLimiter,
    loginValidation,
    validate,
    authController.adminLogin
);

// OTP-based authentication for Manager/Investor
router.post(
    '/request-otp',
    otpRateLimiter,
    otpRequestValidation,
    validate,
    authController.requestOTP
);

router.post(
    '/verify-otp',
    strictRateLimiter,
    otpVerifyValidation,
    validate,
    authController.verifyOTP
);

// Get current user
router.get('/user', authenticate, authController.getCurrentUser);

// Admin invite Manager/Investor
router.post(
    '/invite',
    authenticate,
    isAdmin,
    inviteValidation,
    validate,
    authController.inviteUser
);

// Accept invitation
router.post('/accept-invite/:token', authController.acceptInvite);

module.exports = router;

