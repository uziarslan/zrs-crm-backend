const crypto = require('crypto');

/**
 * Generate a 6-digit OTP
 * @returns {string} 6-digit OTP
 */
exports.generateOTP = () => {
    return crypto.randomInt(100000, 999999).toString();
};

/**
 * Generate a random invite token
 * @returns {string} Random token
 */
exports.generateInviteToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

