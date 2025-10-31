const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for OTP requests - prevent abuse
 * Max 5 OTP requests per email per 15 minutes
 */
exports.otpRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per windowMs
    message: {
        success: false,
        message: 'Too many OTP requests. Please try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Use email from request body as key
        return req.body.email || req.ip;
    }
});

/**
 * General API rate limiter
 * Max 100 requests per IP per 15 minutes
 */
exports.apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: {
        success: false,
        message: 'Too many requests. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Strict rate limiter for sensitive operations
 * Max 10 requests per 15 minutes
 */
exports.strictRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
        success: false,
        message: 'Too many attempts. Please try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

