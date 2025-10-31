const jwt = require('jsonwebtoken');

/**
 * Generate JWT token for user
 * @param {Object} user - User object with id and role
 * @returns {string} JWT token
 */
exports.generateToken = (user) => {
    const payload = {
        id: user._id,
        email: user.email,
        role: user.role
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
};

/**
 * Generate invite token (short-lived)
 * @param {Object} data - Data to encode
 * @returns {string} JWT token
 */
exports.generateInviteToken = (data) => {
    return jwt.sign(data, process.env.JWT_SECRET, {
        expiresIn: '7d' // Invite valid for 7 days
    });
};

/**
 * Verify and decode token
 * @param {string} token - JWT token
 * @returns {Object} Decoded token payload
 */
exports.verifyToken = (token) => {
    return jwt.verify(token, process.env.JWT_SECRET);
};

