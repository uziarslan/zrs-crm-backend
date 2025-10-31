const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Manager = require('../models/Manager');
const Investor = require('../models/Investor');
const logger = require('../utils/logger');

/**
 * Authenticate JWT token and attach user to request
 */
exports.authenticate = async (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No token provided. Authorization denied.'
            });
        }

        const token = authHeader.split(' ')[1];

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Find user based on role
        let user;
        if (decoded.role === 'admin') {
            user = await Admin.findById(decoded.id).select('-passwordHash');
        } else if (decoded.role === 'manager') {
            user = await Manager.findById(decoded.id);
        } else if (decoded.role === 'investor') {
            user = await Investor.findById(decoded.id);
        }

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found. Authorization denied.'
            });
        }

        // Check if user is active
        if (user.status && user.status !== 'active' && decoded.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Account is not active. Please contact administrator.'
            });
        }

        // Attach user to request
        req.user = user;
        req.userId = user._id;
        req.userRole = decoded.role;

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token. Authorization denied.'
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired. Please login again.'
            });
        }
        logger.error('Authentication error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication failed.'
        });
    }
};

/**
 * Check if user is Admin
 */
exports.isAdmin = (req, res, next) => {
    if (req.userRole !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Admin privileges required.'
        });
    }
    next();
};

/**
 * Check if user is Manager (was "user" in original BRD)
 */
exports.isManager = (req, res, next) => {
    if (req.userRole !== 'manager') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Manager privileges required.'
        });
    }
    next();
};

/**
 * Check if user is Investor
 */
exports.isInvestor = (req, res, next) => {
    if (req.userRole !== 'investor') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Investor privileges required.'
        });
    }
    next();
};

/**
 * Check if user is Admin or Manager
 */
exports.isAdminOrManager = (req, res, next) => {
    if (req.userRole !== 'admin' && req.userRole !== 'manager') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Admin or Manager privileges required.'
        });
    }
    next();
};

/**
 * Optional authentication - attach user if token exists but don't require it
 */
exports.optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next();
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        let user;
        if (decoded.role === 'admin') {
            user = await Admin.findById(decoded.id).select('-passwordHash');
        } else if (decoded.role === 'manager') {
            user = await Manager.findById(decoded.id);
        } else if (decoded.role === 'investor') {
            user = await Investor.findById(decoded.id);
        }

        if (user) {
            req.user = user;
            req.userId = user._id;
            req.userRole = decoded.role;
        }

        next();
    } catch (error) {
        // If token is invalid, just continue without user
        next();
    }
};

